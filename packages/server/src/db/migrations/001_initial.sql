-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Main diagrams table
CREATE TABLE diagrams (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          VARCHAR(255) NOT NULL
                    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
                    CHECK (char_length(slug) BETWEEN 1 AND 255),
    title         VARCHAR(500) NOT NULL
                    CHECK (char_length(title) BETWEEN 1 AND 500),
    description   TEXT DEFAULT '',
    content       TEXT NOT NULL
                    CHECK (char_length(content) BETWEEN 1 AND 512000),
    diagram_type  VARCHAR(50) NOT NULL DEFAULT 'mermaid'
                    CHECK (diagram_type IN ('mermaid')),
    tags          TEXT[] NOT NULL DEFAULT '{}'::text[]
                    CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 20),
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ DEFAULT NULL
);

-- Slugs must be unique among non-deleted diagrams
-- NO column-level UNIQUE constraint — only this partial index
CREATE UNIQUE INDEX idx_diagrams_slug_active ON diagrams(slug) WHERE deleted_at IS NULL;

-- Tag filtering
CREATE INDEX idx_diagrams_tags ON diagrams USING GIN(tags) WHERE deleted_at IS NULL;

-- Full-text search on title + description
CREATE INDEX idx_diagrams_search ON diagrams USING GIN(
    to_tsvector('english', title || ' ' || COALESCE(description, ''))
) WHERE deleted_at IS NULL;

-- Sorting indexes
CREATE INDEX idx_diagrams_updated ON diagrams(updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_diagrams_created ON diagrams(created_at DESC) WHERE deleted_at IS NULL;

-- Auto-update updated_at and increment version on every UPDATE
CREATE OR REPLACE FUNCTION update_diagram_metadata()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_diagrams_metadata
    BEFORE UPDATE ON diagrams
    FOR EACH ROW
    EXECUTE FUNCTION update_diagram_metadata();

-- Migration tracking table (created by runner, but IF NOT EXISTS for safety)
CREATE TABLE IF NOT EXISTS schema_migrations (
    id         SERIAL PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL UNIQUE,
    checksum   VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
