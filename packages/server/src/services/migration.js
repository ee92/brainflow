import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');
const MIGRATION_LOCK_KEY = 'draw_migrations';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export async function runMigrations(pool, logger, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
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

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename);
      const contents = await readFile(fullPath, 'utf8');
      const checksum = sha256(contents);

      const existing = await pool.query(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [filename],
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== checksum) {
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
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
  }
}
