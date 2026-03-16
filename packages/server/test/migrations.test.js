import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import pino from 'pino';
import { runMigrations } from '../src/services/migration.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

async function createTemporaryDatabase() {
  if (!TEST_DB_URL) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for migration tests');
  }

  const base = new URL(TEST_DB_URL);
  const adminDb = process.env.TEST_ADMIN_DB || 'postgres';
  const dbName = `draw_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const adminUrl = new URL(TEST_DB_URL);
  adminUrl.pathname = `/${adminDb}`;

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  await adminPool.end();

  base.pathname = `/${dbName}`;

  return {
    connectionString: base.toString(),
    async cleanup() {
      const teardown = new Pool({ connectionString: adminUrl.toString() });
      await teardown.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await teardown.end();
    },
  };
}

async function createMigrationDir(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'draw-migrations-'));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents, 'utf8');
  }
  return dir;
}

async function withDatabase(fn) {
  const db = await createTemporaryDatabase();
  const pool = new Pool({ connectionString: db.connectionString });

  try {
    await fn(pool);
  } finally {
    await pool.end();
    await db.cleanup();
  }
}

test('applies migrations in order', async () => {
  await withDatabase(async (pool) => {
    const dir = await createMigrationDir({
      '001_a.sql': 'CREATE TABLE one (id INT PRIMARY KEY);',
      '002_b.sql': 'CREATE TABLE two (id INT PRIMARY KEY);',
    });

    try {
      await runMigrations(pool, pino({ enabled: false }), dir);
      const result = await pool.query(`SELECT to_regclass('public.one') AS one_name, to_regclass('public.two') AS two_name`);
      assert.equal(result.rows[0].one_name, 'one');
      assert.equal(result.rows[0].two_name, 'two');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('skips already-applied migrations', async () => {
  await withDatabase(async (pool) => {
    const dir = await createMigrationDir({
      '001_a.sql': 'CREATE TABLE once_only (id INT PRIMARY KEY);',
    });

    try {
      await runMigrations(pool, pino({ enabled: false }), dir);
      await runMigrations(pool, pino({ enabled: false }), dir);
      const count = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
      assert.equal(count.rows[0].count, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('fails on checksum mismatch', async () => {
  await withDatabase(async (pool) => {
    const dir = await createMigrationDir({
      '001_checksum.sql': 'CREATE TABLE checksum_test (id INT PRIMARY KEY);',
    });

    try {
      await runMigrations(pool, pino({ enabled: false }), dir);
      await writeFile(path.join(dir, '001_checksum.sql'), 'CREATE TABLE checksum_test_changed (id INT PRIMARY KEY);', 'utf8');
      await assert.rejects(
        runMigrations(pool, pino({ enabled: false }), dir),
        /checksum mismatch/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('handles concurrent startup (advisory lock)', async () => {
  await withDatabase(async (pool) => {
    const dir = await createMigrationDir({
      '001_lock.sql': 'CREATE TABLE lock_test (id INT PRIMARY KEY);',
      '002_lock.sql': 'CREATE TABLE lock_test_two (id INT PRIMARY KEY);',
    });

    try {
      const secondPool = new Pool({ connectionString: pool.options.connectionString });
      await Promise.all([
        runMigrations(pool, pino({ enabled: false }), dir),
        runMigrations(secondPool, pino({ enabled: false }), dir),
      ]);

      const count = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
      assert.equal(count.rows[0].count, 2);
      await secondPool.end();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
