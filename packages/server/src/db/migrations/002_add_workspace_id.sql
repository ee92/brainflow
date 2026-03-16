-- Add workspace_id for multi-tenant row-level isolation.
-- Self-hosted installations use the 'default' workspace.
ALTER TABLE diagrams
ADD COLUMN workspace_id VARCHAR(100) NOT NULL DEFAULT 'default';

-- Index for workspace-scoped queries
CREATE INDEX idx_diagrams_workspace ON diagrams(workspace_id) WHERE deleted_at IS NULL;

-- Replace slug uniqueness: scoped to workspace instead of global
DROP INDEX IF EXISTS idx_diagrams_slug_active;

CREATE UNIQUE INDEX idx_diagrams_slug_workspace
ON diagrams(slug, workspace_id)
WHERE deleted_at IS NULL;
