import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR: string = path.join(__dirname, '../db/migrations');
const MIGRATION_LOCK_KEY = 'draw_migrations';

interface Logger {
  info: (metadata: Record<string, unknown>, message: string) => void;
}

interface ChecksumRow {
  checksum: string;
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

export async function runMigrations(pool: Pool, logger: Logger, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<void> {
  await pool.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files: string[] = (await readdir(migrationsDir))
      .filter((file: string): boolean => file.endsWith('.sql'))
      .sort((left: string, right: string): number => left.localeCompare(right));

    for (const filename of files) {
      const fullPath: string = path.join(migrationsDir, filename);
      const contents: string = await readFile(fullPath, 'utf8');
      const checksum: string = sha256(contents);

      const existing = await pool.query<ChecksumRow>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [filename],
      );

      if (existing.rowCount !== null && existing.rowCount > 0) {
        const existingRow: ChecksumRow | undefined = existing.rows[0];
        if (!existingRow) {
          throw new Error(`Missing migration row for ${filename}`);
        }

        if (existingRow.checksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${filename}`);
        }
        continue;
      }

      await pool.query('BEGIN');
      try {
        await pool.query(contents);
        await pool.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum],
        );
        await pool.query('COMMIT');
        logger.info({ filename }, 'Applied migration');
      } catch (error: unknown) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
  }
}
