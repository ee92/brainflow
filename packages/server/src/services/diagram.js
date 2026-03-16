import { AppError } from '../middleware/errors.js';

function normalizeTags(tags = []) {
  const cleaned = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(cleaned)].sort((a, b) => a.localeCompare(b));
}

function slugify(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return base.slice(0, 255) || 'diagram';
}

function mapDuplicateSlugError(error, slug) {
  if (error?.code === '23505') {
    throw new AppError('SLUG_CONFLICT', `A diagram with slug '${slug}' already exists`, 409);
  }
  throw error;
}

function parseTagFilter(tagsParam) {
  if (!tagsParam) {
    return [];
  }
  return normalizeTags(tagsParam.split(','));
}

export async function createDiagram(pool, input) {
  const slug = input.slug ?? slugify(input.title);
  const tags = normalizeTags(input.tags || []);

  try {
    const result = await pool.query(
      `INSERT INTO diagrams (slug, title, description, content, diagram_type, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
      [slug, input.title, input.description ?? '', input.content, input.diagram_type ?? 'mermaid', tags],
    );
    return result.rows[0];
  } catch (error) {
    mapDuplicateSlugError(error, slug);
  }
}

export async function listDiagrams(pool, filters) {
  const where = ['deleted_at IS NULL'];
  const values = [];

  if (filters.search) {
    values.push(filters.search);
    where.push(`to_tsvector('english', title || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', $${values.length})`);
  }

  const tagFilter = parseTagFilter(filters.tags);
  if (tagFilter.length > 0) {
    values.push(tagFilter);
    where.push(`tags @> $${values.length}::text[]`);
  }

  const sortFieldMap = {
    updated_at: 'updated_at',
    created_at: 'created_at',
    title: 'title',
  };

  const sortField = sortFieldMap[filters.sort] || 'updated_at';
  const sortOrder = filters.order === 'asc' ? 'ASC' : 'DESC';

  values.push(filters.limit);
  const limitRef = `$${values.length}`;
  values.push(filters.offset);
  const offsetRef = `$${values.length}`;

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const dataQuery = `
    SELECT id, slug, title, description, diagram_type, tags, version, created_at, updated_at
    FROM diagrams
    ${whereSql}
    ORDER BY ${sortField} ${sortOrder}, id DESC
    LIMIT ${limitRef}
    OFFSET ${offsetRef}
  `;

  const countValues = values.slice(0, values.length - 2);
  const countQuery = `SELECT COUNT(*)::int AS total FROM diagrams ${whereSql}`;

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataQuery, values),
    pool.query(countQuery, countValues),
  ]);

  return {
    data: dataResult.rows,
    total: countResult.rows[0].total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getDiagram(pool, slug) {
  const result = await pool.query(
    `SELECT id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at
     FROM diagrams
     WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (result.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  return result.rows[0];
}

export async function updateDiagram(pool, slug, input) {
  const currentResult = await pool.query(
    `SELECT id, version, slug, title, description, content, diagram_type, tags, created_at, updated_at
     FROM diagrams
     WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (currentResult.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const current = currentResult.rows[0];

  if (current.version !== input.version) {
    throw new AppError('VERSION_MISMATCH', 'Version does not match current diagram version', 412);
  }

  const updates = [];
  const values = [];

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

  const result = await pool.query(
    `UPDATE diagrams
     SET ${updates.join(', ')}
     WHERE slug = $${values.length} AND deleted_at IS NULL
     RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
    values,
  );

  return result.rows[0];
}

export async function deleteDiagram(pool, slug, version) {
  const currentResult = await pool.query(
    `SELECT id, version FROM diagrams WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );

  if (currentResult.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  const current = currentResult.rows[0];

  if (current.version !== version) {
    throw new AppError('VERSION_MISMATCH', 'Version does not match current diagram version', 412);
  }

  const result = await pool.query(
    `UPDATE diagrams
     SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
    [current.id],
  );

  return result.rows[0];
}

export async function restoreDiagram(pool, slug) {
  const [activeResult, deletedResult] = await Promise.all([
    pool.query(`SELECT id FROM diagrams WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`, [slug]),
    pool.query(
      `SELECT id FROM diagrams WHERE slug = $1 AND deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
      [slug],
    ),
  ]);

  if (deletedResult.rowCount === 0) {
    throw new AppError('NOT_FOUND', 'Diagram not found.', 404);
  }

  if (activeResult.rowCount > 0) {
    throw new AppError('SLUG_CONFLICT', `A diagram with slug '${slug}' already exists`, 409);
  }

  try {
    const result = await pool.query(
      `UPDATE diagrams
       SET deleted_at = NULL
       WHERE id = $1
       RETURNING id, slug, title, description, content, diagram_type, tags, version, created_at, updated_at`,
      [deletedResult.rows[0].id],
    );

    return result.rows[0];
  } catch (error) {
    mapDuplicateSlugError(error, slug);
  }
}

export { normalizeTags, slugify };
