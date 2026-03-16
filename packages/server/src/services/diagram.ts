import type { Pool } from 'pg';
import { AppError } from '../middleware/errors.js';
import type {
  CreateDiagramInput,
  ListDiagramsInput,
  UpdateDiagramInput,
} from '../schemas/diagram.js';
import type { DiagramRecord, DiagramSummary } from '../types/diagram.js';

interface CountRow {
  total: number;
}

interface DiagramListResult {
  data: DiagramSummary[];
  total: number;
  limit: number;
  offset: number;
}

function normalizeTags(tags: string[] = []): string[] {
  const cleaned: string[] = tags
    .map((tag: string): string => tag.trim().toLowerCase())
    .filter((tag: string): boolean => tag.length > 0);

  return [...new Set(cleaned)].sort((left: string, right: string): number => left.localeCompare(right));
}

function slugify(title: string): string {
  const base: string = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return base.slice(0, 255) || 'diagram';
}

interface PgErrorWithCode {
  code: string;
}

function hasErrorCode(error: unknown): error is PgErrorWithCode {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!('code' in error)) {
    return false;
  }

  return typeof error.code === 'string';
}

function mapDuplicateSlugError(error: unknown, slug: string): never {
  if (hasErrorCode(error) && error.code === '23505') {
    throw new AppError('SLUG_CONFLICT', `A diagram with slug '${slug}' already exists`, 409);
  }

  throw error;
}

function parseTagFilter(tagsParam?: string): string[] {
  if (!tagsParam) {
    return [];
  }

  return normalizeTags(tagsParam.split(','));
}

export async function createDiagram(pool: Pool, input: CreateDiagramInput): Promise<DiagramRecord> {
  const slug: string = input.slug ?? slugify(input.title);
  const tags: string[] = normalizeTags(input.tags);

  try {
    const result = await pool.query<DiagramRecord>(
      `INSERT INTO diagrams (slug, title, description, content, diagram_type, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
      [slug, input.title, input.description, input.content, input.diagram_type, tags],
    );

    if (result.rowCount === 0 || result.rowCount === null) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create diagram', 500);
    }

    const created: DiagramRecord | undefined = result.rows[0];
    if (!created) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create diagram', 500);
    }

    return created;
  } catch (error: unknown) {
    return mapDuplicateSlugError(error, slug);
  }
}

export async function listDiagrams(pool: Pool, filters: ListDiagramsInput): Promise<DiagramListResult> {
  const where: string[] = ['deleted_at IS NULL'];
  const values: Array<string | number | string[]> = [];

  if (filters.search) {
    values.push(filters.search);
    where.push(`to_tsvector('english', title || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', $${values.length})`);
  }

  const tagFilter: string[] = parseTagFilter(filters.tags);
  if (tagFilter.length > 0) {
    values.push(tagFilter);
    where.push(`tags @> $${values.length}::text[]`);
  }

  const sortFieldMap: Record<ListDiagramsInput['sort'], string> = {
    updated_at: 'updated_at',
    created_at: 'created_at',
    title: 'title',
  };

  const sortField: string = sortFieldMap[filters.sort];
  const sortOrder: string = filters.order === 'asc' ? 'ASC' : 'DESC';

  values.push(filters.limit);
  const limitRef: string = `$${values.length}`;
  values.push(filters.offset);
  const offsetRef: string = `$${values.length}`;

  const whereSql: string = `WHERE ${where.join(' AND ')}`;
  const dataQuery: string = `
    SELECT id, slug, title, description, diagram_type, tags, version, created_at, updated_at
    FROM diagrams
    ${whereSql}
    ORDER BY ${sortField} ${sortOrder}, id DESC
    LIMIT ${limitRef}
    OFFSET ${offsetRef}
  `;

  const countValues: Array<string | string[]> = values.slice(0, values.length - 2).filter(
    (value: string | number | string[]): value is string | string[] => typeof value !== 'number',
  );
  const countQuery: string = `SELECT COUNT(*)::int AS total FROM diagrams ${whereSql}`;

  const [dataResult, countResult] = await Promise.all([
    pool.query<DiagramSummary>(dataQuery, values),
    pool.query<CountRow>(countQuery, countValues),
  ]);

  if (countResult.rowCount === 0 || countResult.rowCount === null) {
    throw new AppError('INTERNAL_ERROR', 'Failed to count diagrams', 500);
  }

  const countRow: CountRow | undefined = countResult.rows[0];
  if (!countRow) {
    throw new AppError('INTERNAL_ERROR', 'Failed to count diagrams', 500);
  }

  return {
    data: dataResult.rows,
    total: countRow.total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getDiagram(pool: Pool, slug: string): Promise<DiagramRecord> {
  const result = await pool.query<DiagramRecord>(
    `SELECT id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at
     FROM diagrams
     WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (result.rowCount === 0 || result.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const diagram: DiagramRecord | undefined = result.rows[0];
  if (!diagram) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  return diagram;
}

export async function updateDiagram(pool: Pool, slug: string, input: UpdateDiagramInput): Promise<DiagramRecord> {
  const currentResult = await pool.query<DiagramRecord>(
    `SELECT id, version, slug, title, description, content, diagram_type, tags, created_at, updated_at
     FROM diagrams
     WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (currentResult.rowCount === 0 || currentResult.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const current: DiagramRecord | undefined = currentResult.rows[0];
  if (!current) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  if (current.version !== input.version) {
    throw new AppError('VERSION_MISMATCH', 'Version does not match current diagram version', 412);
  }

  const updates: string[] = [];
  const values: Array<string | string[] | number> = [];

  if (typeof input.title === 'string') {
    values.push(input.title);
    updates.push(`title = $${values.length}`);
  }

  if (typeof input.description === 'string') {
    values.push(input.description);
    updates.push(`description = $${values.length}`);
  }

  if (typeof input.content === 'string') {
    values.push(input.content);
    updates.push(`content = $${values.length}`);
  }

  if (input.tags) {
    values.push(normalizeTags(input.tags));
    updates.push(`tags = $${values.length}`);
  }

  if (updates.length === 0) {
    return {
      ...current,
      version: input.version,
    };
  }

  values.push(slug);

  const result = await pool.query<DiagramRecord>(
    `UPDATE diagrams
     SET ${updates.join(', ')}
     WHERE slug = $${values.length} AND deleted_at IS NULL
     RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
    values,
  );

  if (result.rowCount === 0 || result.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const updated: DiagramRecord | undefined = result.rows[0];
  if (!updated) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  return updated;
}

export async function deleteDiagram(pool: Pool, slug: string, version: number): Promise<DiagramRecord> {
  const currentResult = await pool.query<Pick<DiagramRecord, 'id' | 'version'>>(
    `SELECT id, version FROM diagrams WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (currentResult.rowCount === 0 || currentResult.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const current: Pick<DiagramRecord, 'id' | 'version'> | undefined = currentResult.rows[0];
  if (!current) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  if (current.version !== version) {
    throw new AppError('VERSION_MISMATCH', 'Version does not match current diagram version', 412);
  }

  const result = await pool.query<DiagramRecord>(
    `UPDATE diagrams
     SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
    [current.id],
  );

  if (result.rowCount === 0 || result.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const deleted: DiagramRecord | undefined = result.rows[0];
  if (!deleted) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  return deleted;
}

export async function restoreDiagram(pool: Pool, slug: string): Promise<DiagramRecord> {
  const [activeResult, deletedResult] = await Promise.all([
    pool.query<Pick<DiagramRecord, 'id'>>(`SELECT id FROM diagrams WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`, [slug]),
    pool.query<Pick<DiagramRecord, 'id'>>(
      `SELECT id FROM diagrams WHERE slug = $1 AND deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
      [slug],
    ),
  ]);

  if (deletedResult.rowCount === 0 || deletedResult.rowCount === null) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  if (activeResult.rowCount !== null && activeResult.rowCount > 0) {
    throw new AppError('SLUG_CONFLICT', `A diagram with slug '${slug}' already exists`, 409);
  }

  const deletedRow: Pick<DiagramRecord, 'id'> | undefined = deletedResult.rows[0];
  if (!deletedRow) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  try {
    const result = await pool.query<DiagramRecord>(
      `UPDATE diagrams
       SET deleted_at = NULL
       WHERE id = $1
       RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
      [deletedRow.id],
    );

    if (result.rowCount === 0 || result.rowCount === null) {
      throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
    }

    const restored: DiagramRecord | undefined = result.rows[0];
    if (!restored) {
      throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
    }

    return restored;
  } catch (error: unknown) {
    return mapDuplicateSlugError(error, slug);
  }
}

export { normalizeTags, slugify };
