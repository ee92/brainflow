import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pino from 'pino';
import { Pool } from 'pg';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/services/migration.js';

const TEST_DB_URL: string | undefined = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

interface DiagramPayload {
  id: number;
  slug: string;
  title: string;
  description: string;
  content: string;
  diagram_type: 'mermaid';
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

interface ApiError {
  code: string;
  message: string;
  status: number;
  requestId: string;
}

interface ApiSuccess<TData> {
  ok: true;
  data: TData;
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

interface ApiFailure {
  ok: false;
  error: ApiError;
}

type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

let pool: Pool;
let server: Server;
let baseUrl = '';
let teardownDb: (() => Promise<void>) | undefined;

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
  if (value === null || typeof value === 'string') {
    return false;
  }

  return typeof value.port === 'number';
}

async function setupDatabase(): Promise<() => Promise<void>> {
  if (!TEST_DB_URL) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for integration tests');
  }

  const dbUrl: URL = new URL(TEST_DB_URL);
  const adminDb: string = process.env.TEST_ADMIN_DB || 'postgres';
  const tempDb: string = `draw_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const adminUrl: URL = new URL(TEST_DB_URL);
  adminUrl.pathname = `/${adminDb}`;

  const adminPool: Pool = new Pool({ connectionString: adminUrl.toString() });
  await adminPool.query(`CREATE DATABASE ${tempDb}`);
  await adminPool.end();

  dbUrl.pathname = `/${tempDb}`;
  process.env.DATABASE_URL = dbUrl.toString();

  return async (): Promise<void> => {
    const teardownAdmin: Pool = new Pool({ connectionString: adminUrl.toString() });
    await teardownAdmin.query(`DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE)`);
    await teardownAdmin.end();
  };
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function request<TData>(path: string, options: RequestOptions = {}): Promise<{ response: Response; body: ApiResponse<TData> }> {
  const response: Response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body,
  });

  const body: ApiResponse<TData> = await response.json();
  return { response, body };
}

async function createSeedDiagram(overrides: Partial<DiagramPayload> = {}): Promise<DiagramPayload> {
  const payload = {
    title: 'Example System Overview',
    slug: 'example-overview',
    description: 'High-level C4 context diagram',
    content: 'graph TD; A-->B',
    diagram_type: 'mermaid',
    tags: ['architecture', 'example'],
    ...overrides,
  };

  const { body } = await request<DiagramPayload>('/api/v1/diagrams', { method: 'POST', body: JSON.stringify(payload) });
  if (!body.ok) {
    throw new Error(body.error.message);
  }

  return body.data;
}

describe('Diagram API', { concurrency: 1 }, (): void => {
  before(async (): Promise<void> => {
    teardownDb = await setupDatabase();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await runMigrations(pool, pino({ enabled: false }));

    const app = createApp({ logger: pino({ enabled: false }), pool, readiness: { migrations: true } });
    await new Promise<void>((resolve: () => void): void => {
      server = app.listen(0, (): void => resolve());
    });

    const address: string | AddressInfo | null = server.address();
    if (!isAddressInfo(address)) {
      throw new Error('Server did not bind to an address');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
      server.close((error?: Error): void => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await pool.end();

    if (teardownDb) {
      await teardownDb();
    }
  });

  beforeEach(async (): Promise<void> => {
    await pool.query('TRUNCATE TABLE diagrams RESTART IDENTITY CASCADE');
  });

  it('POST /api/v1/diagrams creates diagram with all fields', async (): Promise<void> => {
    const { response, body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Example System Overview',
        slug: 'example-overview',
        description: 'High-level C4 context diagram',
        content: 'graph TD; A-->B',
        diagram_type: 'mermaid',
        tags: ['example', 'architecture'],
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.slug, 'example-overview');
    assert.equal(body.data.title, 'Example System Overview');
    assert.equal(body.data.content, 'graph TD; A-->B');
  });

  it('POST /api/v1/diagrams creates diagram with auto-generated slug', async (): Promise<void> => {
    const { body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Quick Sketch Diagram', content: 'graph TD; A-->B' }),
    });

    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.slug, 'quick-sketch-diagram');
  });

  it('POST /api/v1/diagrams returns 400 for missing title', async (): Promise<void> => {
    const { response, body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ content: 'graph TD; A-->B' }),
    });

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    if (!body.ok) {
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('POST /api/v1/diagrams returns 400 for missing content', async (): Promise<void> => {
    const { response } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Missing Content' }),
    });

    assert.equal(response.status, 400);
  });

  it('POST /api/v1/diagrams returns 400 for invalid slug format', async (): Promise<void> => {
    const { response } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad Slug', slug: 'Invalid Slug!', content: 'graph TD; A-->B' }),
    });

    assert.equal(response.status, 400);
  });

  it('POST /api/v1/diagrams returns 409 for duplicate slug', async (): Promise<void> => {
    await createSeedDiagram();

    const { response, body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Dup', slug: 'example-overview', content: 'graph TD; B-->C' }),
    });

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    if (!body.ok) {
      assert.equal(body.error.code, 'SLUG_CONFLICT');
    }
  });

  it('POST /api/v1/diagrams returns 413 for content > 500KB', async (): Promise<void> => {
    const { response, body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Huge', content: 'a'.repeat(512001) }),
    });

    assert.equal(response.status, 413);
    assert.equal(body.ok, false);
    if (!body.ok) {
      assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    }
  });

  it('POST /api/v1/diagrams normalizes tags to lowercase sorted unique', async (): Promise<void> => {
    const { body } = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Tags',
        content: 'graph TD; A-->B',
        tags: ['Zulu', 'alpha', 'alpha', 'beta'],
      }),
    });

    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.deepEqual(body.data.tags, ['alpha', 'beta', 'zulu']);
  });

  it('GET /api/v1/diagrams returns list without content field', async (): Promise<void> => {
    await createSeedDiagram();

    const { body } = await request<DiagramPayload[]>('/api/v1/diagrams');
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.length, 1);
    assert.equal(Object.hasOwn(body.data[0], 'content'), false);
  });

  it('GET /api/v1/diagrams supports pagination (limit, offset)', async (): Promise<void> => {
    await createSeedDiagram({ slug: 'a', title: 'A' });
    await createSeedDiagram({ slug: 'b', title: 'B' });

    const { body } = await request<DiagramPayload[]>('/api/v1/diagrams?limit=1&offset=1');
    assert.equal(body.ok, true);
    if (!body.ok || !body.meta) {
      return;
    }

    assert.equal(body.data.length, 1);
    assert.equal(body.meta.limit, 1);
    assert.equal(body.meta.offset, 1);
    assert.equal(body.meta.total, 2);
  });

  it('GET /api/v1/diagrams supports search', async (): Promise<void> => {
    await createSeedDiagram({ slug: 'alpha', title: 'Alpha Diagram', description: 'searchable' });
    await createSeedDiagram({ slug: 'beta', title: 'Beta Diagram', description: 'other' });

    const { body } = await request<DiagramPayload[]>('/api/v1/diagrams?search=alpha');
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].slug, 'alpha');
  });

  it('GET /api/v1/diagrams supports tag filtering', async (): Promise<void> => {
    await createSeedDiagram({ slug: 'one', tags: ['a', 'b'] });
    await createSeedDiagram({ slug: 'two', tags: ['a'] });

    const { body } = await request<DiagramPayload[]>('/api/v1/diagrams?tags=a,b');
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].slug, 'one');
  });

  it('GET /api/v1/diagrams supports sorting (updated_at, created_at, title)', async (): Promise<void> => {
    await createSeedDiagram({ slug: 'zeta', title: 'Zeta' });
    await createSeedDiagram({ slug: 'alpha', title: 'Alpha' });

    const byTitle = await request<DiagramPayload[]>('/api/v1/diagrams?sort=title&order=asc');
    const byCreated = await request<DiagramPayload[]>('/api/v1/diagrams?sort=created_at&order=desc');
    const byUpdated = await request<DiagramPayload[]>('/api/v1/diagrams?sort=updated_at&order=desc');

    assert.equal(byTitle.body.ok, true);
    if (byTitle.body.ok) {
      assert.equal(byTitle.body.data[0].slug, 'alpha');
    }

    assert.equal(byCreated.body.ok, true);
    if (byCreated.body.ok) {
      assert.equal(byCreated.body.data.length, 2);
    }

    assert.equal(byUpdated.body.ok, true);
    if (byUpdated.body.ok) {
      assert.equal(byUpdated.body.data.length, 2);
    }
  });

  it('GET /api/v1/diagrams excludes soft-deleted diagrams', async (): Promise<void> => {
    const d = await createSeedDiagram();
    await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version }),
    });

    const { body } = await request<DiagramPayload[]>('/api/v1/diagrams');
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.length, 0);
  });

  it('GET /api/v1/diagrams/:slug returns full diagram with content', async (): Promise<void> => {
    const d = await createSeedDiagram();
    const { body } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`);
    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.content, 'graph TD; A-->B');
  });

  it('GET /api/v1/diagrams/:slug returns 404 for non-existent slug', async (): Promise<void> => {
    const { response } = await request<DiagramPayload>('/api/v1/diagrams/nope');
    assert.equal(response.status, 404);
  });

  it('GET /api/v1/diagrams/:slug returns 404 for soft-deleted diagram', async (): Promise<void> => {
    const d = await createSeedDiagram();
    await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version }),
    });

    const { response } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`);
    assert.equal(response.status, 404);
  });

  it('PATCH /api/v1/diagrams/:slug updates title only', async (): Promise<void> => {
    const d = await createSeedDiagram();

    const { body } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Title', version: d.version }),
    });

    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.title, 'Updated Title');
  });

  it('PATCH /api/v1/diagrams/:slug updates content only', async (): Promise<void> => {
    const d = await createSeedDiagram();

    const { body } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'graph TD; B-->C', version: d.version }),
    });

    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.equal(body.data.content, 'graph TD; B-->C');
  });

  it('PATCH /api/v1/diagrams/:slug updates tags', async (): Promise<void> => {
    const d = await createSeedDiagram();

    const { body } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: ['z', 'a', 'a'], version: d.version }),
    });

    assert.equal(body.ok, true);
    if (!body.ok) {
      return;
    }

    assert.deepEqual(body.data.tags, ['a', 'z']);
  });

  it('PATCH /api/v1/diagrams/:slug returns 412 for version mismatch', async (): Promise<void> => {
    const d = await createSeedDiagram();

    const { response, body } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Mismatch', version: d.version + 1 }),
    });

    assert.equal(response.status, 412);
    assert.equal(body.ok, false);
    if (!body.ok) {
      assert.equal(body.error.code, 'VERSION_MISMATCH');
    }
  });

  it('PATCH /api/v1/diagrams/:slug returns 404 for non-existent slug', async (): Promise<void> => {
    const { response } = await request<DiagramPayload>('/api/v1/diagrams/missing', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'X', version: 1 }),
    });
    assert.equal(response.status, 404);
  });

  it('PATCH /api/v1/diagrams/:slug does not allow slug change', async (): Promise<void> => {
    const d = await createSeedDiagram();
    const { response } = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'PATCH',
      body: JSON.stringify({ slug: 'new-slug', version: d.version }),
    });

    assert.equal(response.status, 400);
  });

  it('DELETE /api/v1/diagrams/:slug soft-deletes diagram', async (): Promise<void> => {
    const d = await createSeedDiagram();
    const deleted = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version }),
    });

    assert.equal(deleted.response.status, 200);

    const get = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`);
    assert.equal(get.response.status, 404);
  });

  it('DELETE /api/v1/diagrams/:slug returns 412 for version mismatch', async (): Promise<void> => {
    const d = await createSeedDiagram();
    const deleted = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version + 1 }),
    });

    assert.equal(deleted.response.status, 412);
  });

  it('DELETE /api/v1/diagrams/:slug allows creating new diagram with same slug after delete', async (): Promise<void> => {
    const d = await createSeedDiagram();
    await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version }),
    });

    const recreated = await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'Recreated', slug: d.slug, content: 'graph TD; X-->Y' }),
    });

    assert.equal(recreated.response.status, 201);
  });

  it('POST /api/v1/diagrams/:slug/restore restores soft-deleted diagram', async (): Promise<void> => {
    const d = await createSeedDiagram();
    await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: d.version }),
    });

    const restored = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}/restore`, { method: 'POST' });
    assert.equal(restored.response.status, 200);

    const get = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}`);
    assert.equal(get.response.status, 200);
  });

  it('POST /api/v1/diagrams/:slug/restore returns 404 for non-deleted diagram', async (): Promise<void> => {
    const d = await createSeedDiagram();
    const restored = await request<DiagramPayload>(`/api/v1/diagrams/${d.slug}/restore`, { method: 'POST' });
    assert.equal(restored.response.status, 404);
  });

  it('POST /api/v1/diagrams/:slug/restore returns 409 if active diagram with same slug exists', async (): Promise<void> => {
    const original = await createSeedDiagram({ slug: 'reusable' });
    await request<DiagramPayload>(`/api/v1/diagrams/${original.slug}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: original.version }),
    });

    await request<DiagramPayload>('/api/v1/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title: 'New One', slug: 'reusable', content: 'graph TD; A-->B' }),
    });

    const restored = await request<DiagramPayload>('/api/v1/diagrams/reusable/restore', { method: 'POST' });
    assert.equal(restored.response.status, 409);
  });
});
