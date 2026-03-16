# your-domain.com — Architecture Specification v2

## Overview

A self-hosted diagram viewer and manager. Users create and browse architecture diagrams via a web UI. Agents and scripts create/update diagrams via REST API or CLI. Diagrams use Mermaid syntax with C4 architecture conventions.

This application replaces  at `your-domain.com`.

**This document is the single source of truth for implementation.** Every detail is specified. Follow it exactly.

---

## Tech Stack (exact versions)

| Component       | Technology                | Version  |
|-----------------|---------------------------|----------|
| Runtime         | Node.js                   | 22 LTS   |
| API framework   | Express                   | ^4.21    |
| Database        | PostgreSQL                | 15       |
| DB client       | pg (node-postgres)        | ^8.13    |
| Frontend        | React                     | ^18.3    |
| Build tool      | Vite                      | ^6.x     |
| Routing         | react-router-dom          | ^7.x     |
| Data fetching   | @tanstack/react-query     | ^5.x     |
| Diagrams        | mermaid                   | ^11.x    |
| Pan/zoom        | panzoom                   | ^9.x     |
| Logging         | pino + pino-http          | ^9.x     |
| Rate limiting   | express-rate-limit        | ^7.x     |
| Validation      | zod                       | ^3.x     |
| Container       | Docker + Compose           | v2       |

No other dependencies unless explicitly listed here.

---

## Monorepo Structure

```
draw/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.js              # entry point: boot, graceful shutdown
│   │   │   ├── app.js                # Express app factory (for testing)
│   │   │   ├── routes/
│   │   │   │   ├── diagrams.js       # CRUD routes
│   │   │   │   └── health.js         # /healthz, /readyz
│   │   │   ├── services/
│   │   │   │   ├── diagram.js        # business logic layer
│   │   │   │   └── migration.js      # migration runner
│   │   │   ├── db/
│   │   │   │   ├── pool.js           # pg pool singleton
│   │   │   │   └── migrations/
│   │   │   │       └── 001_initial.sql
│   │   │   ├── middleware/
│   │   │   │   ├── errors.js         # global error handler
│   │   │   │   ├── validate.js       # zod validation middleware
│   │   │   │   └── requestId.js      # X-Request-ID injection
│   │   │   └── schemas/
│   │   │       └── diagram.js        # zod schemas for request validation
│   │   ├── test/
│   │   │   ├── diagrams.test.js      # API integration tests
│   │   │   └── migrations.test.js    # migration runner tests
│   │   └── package.json
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.jsx              # React entry, QueryClientProvider
│   │   │   ├── App.jsx               # Router setup
│   │   │   ├── components/
│   │   │   │   ├── Layout.jsx        # two-panel shell
│   │   │   │   ├── Sidebar.jsx       # sidebar container
│   │   │   │   ├── DiagramList.jsx   # scrollable diagram list
│   │   │   │   ├── DiagramViewer.jsx # mermaid render + panzoom
│   │   │   │   ├── SearchBar.jsx     # debounced search input
│   │   │   │   ├── Toolbar.jsx       # zoom/fit/copy/fullscreen buttons
│   │   │   │   ├── ErrorState.jsx    # error display component
│   │   │   │   ├── EmptyState.jsx    # no diagrams prompt
│   │   │   │   └── LoadingSkeleton.jsx
│   │   │   ├── hooks/
│   │   │   │   ├── useDiagrams.js    # TanStack Query: list + search
│   │   │   │   └── useDiagram.js     # TanStack Query: single diagram
│   │   │   ├── api/
│   │   │   │   └── client.js         # fetch wrapper with error handling
│   │   │   └── styles/
│   │   │       ├── variables.css     # CSS custom properties (theme)
│   │   │       ├── global.css        # reset + base styles
│   │   │       └── components/       # per-component CSS modules
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   │
│   └── cli/
│       ├── src/
│       │   └── index.js              # CLI entry (commander.js or yargs)
│       ├── test/
│       │   └── cli.test.js
│       └── package.json
│
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── .env.example
├── package.json                       # npm workspaces root
├── LICENSE                            # MIT
└── README.md
```

### Rules
- **No business logic in route handlers.** Routes call services, services call DB.
- **All DB queries live in `services/diagram.js`** — routes never import `pool.js` directly.
- **All request validation uses zod schemas** via the `validate.js` middleware.
- **No `any` types, no untyped catches.** Every error is handled explicitly.

---

## Database Schema

### Migration: `001_initial.sql`

```sql
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

-- Migration tracking table
CREATE TABLE schema_migrations (
    id         SERIAL PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL UNIQUE,
    checksum   VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Schema Design Rules
- **All columns NOT NULL** except `deleted_at` (the soft-delete marker) and `description` (defaults to empty string).
- **UUID primary keys** — no sequence leakage, federation-safe.
- **Slug uniqueness** enforced ONLY via partial index (allows slug reuse after soft delete).
- **Tags** are canonicalized to lowercase, sorted, and deduplicated at the application layer before insert/update.
- **`version`** column enables optimistic concurrency control. Incremented automatically by trigger.
- **`diagram_type`** CHECK constraint lists allowed types. Add new types here when D2/Graphviz support lands.

---

## Migration Runner

Runs on server startup. Implements safe, idempotent migrations.

### Algorithm

```
1. Acquire pg_advisory_lock(hash('draw_migrations'))
2. CREATE TABLE IF NOT EXISTS schema_migrations (...)
3. Read all .sql files from db/migrations/ sorted alphabetically
4. For each file:
   a. Compute SHA-256 checksum of file contents
   b. Check schema_migrations for this filename
   c. If found: compare checksum. MISMATCH → abort with error (migration file was modified)
   d. If not found:
      i.  BEGIN transaction
      ii. Execute the SQL file contents
      iii. INSERT INTO schema_migrations (filename, checksum)
      iv. COMMIT
5. Release advisory lock
```

### Rules
- **Each migration runs in its own transaction.** Partial application is impossible.
- **Advisory lock prevents race conditions** if multiple instances start simultaneously.
- **Checksum tracking prevents silent edits** to already-applied migrations.
- **Migrations are append-only.** Never edit an applied migration. Create a new one.
- **The app does NOT start accepting HTTP requests until migrations complete.** Express listener binds AFTER migration runner finishes.

---

## REST API

Base path: `/api/v1`

### Health Endpoints (no base path)

| Method | Path      | Description                              | Response              |
|--------|-----------|------------------------------------------|-----------------------|
| GET    | `/healthz`| Process alive                            | `{ ok: true }`       |
| GET    | `/readyz` | DB connected + migrations complete       | `{ ok: true, db: "connected", migrations: "current" }` |

### Diagram Endpoints

| Method | Path                          | Description              | Success | Error codes              |
|--------|-------------------------------|--------------------------|---------|--------------------------|
| GET    | `/api/v1/diagrams`            | List diagrams (metadata) | 200     | 500                      |
| GET    | `/api/v1/diagrams/:slug`      | Get full diagram         | 200     | 404, 500                 |
| POST   | `/api/v1/diagrams`            | Create diagram           | 201     | 400, 409, 413, 500       |
| PATCH  | `/api/v1/diagrams/:slug`      | Partial update           | 200     | 400, 404, 409, 412, 413, 500 |
| DELETE | `/api/v1/diagrams/:slug`      | Soft delete              | 200     | 404, 412, 500            |
| POST   | `/api/v1/diagrams/:slug/restore` | Restore soft-deleted  | 200     | 404, 409, 500            |

### Query Parameters (GET /api/v1/diagrams)

| Param    | Type   | Default      | Description                              |
|----------|--------|--------------|------------------------------------------|
| search   | string | —            | Full-text search on title + description   |
| tags     | string | —            | Comma-separated, AND logic               |
| sort     | enum   | `updated_at` | One of: `updated_at`, `created_at`, `title` |
| order    | enum   | `desc`       | One of: `asc`, `desc`                    |
| limit    | int    | 50           | Max 100                                  |
| offset   | int    | 0            | For pagination                           |

Sort always includes tie-breaker: `ORDER BY <sort> <order>, id DESC`.

### Request Bodies

**POST /api/v1/diagrams** (create):
```json
{
    "title": "Example System Overview",
    "slug": "example-overview",
    "description": "High-level C4 context diagram",
    "content": "C4Context\n  title example-app...",
    "diagram_type": "mermaid",
    "tags": ["example-app", "architecture"]
}
```
- `slug` is optional. If omitted, auto-generated from title: lowercase, replace non-alphanumeric with hyphens, collapse consecutive hyphens, trim hyphens from edges, truncate to 255 chars.
- `description` is optional, defaults to empty string.
- `diagram_type` is optional, defaults to `"mermaid"`.
- `tags` is optional, defaults to `[]`.
- `title` and `content` are required.

**PATCH /api/v1/diagrams/:slug** (update):
```json
{
    "title": "Updated Title",
    "description": "New description",
    "content": "graph TD; A-->B",
    "tags": ["new-tag"],
    "version": 3
}
```
- All fields optional except `version` (required for optimistic locking).
- **`slug` is immutable.** Cannot be changed after creation.
- **`version` must match current version.** If mismatch → 412 Precondition Failed.

**DELETE /api/v1/diagrams/:slug**:
- Request body: `{ "version": 3 }` (required for optimistic locking)
- Or header: `If-Match: 3`
- Either is accepted. Body takes precedence.

### Response Envelope

**Success (single resource):**
```json
{
    "ok": true,
    "data": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "slug": "example-overview",
        "title": "Example System Overview",
        "description": "High-level C4 context diagram",
        "content": "C4Context\n  ...",
        "diagram_type": "mermaid",
        "tags": ["architecture", "example-app"],
        "version": 1,
        "created_at": "2026-03-15T21:00:00.000Z",
        "updated_at": "2026-03-15T21:00:00.000Z"
    }
}
```

**Success (list):**
```json
{
    "ok": true,
    "data": [ { ... }, { ... } ],
    "meta": {
        "total": 42,
        "limit": 50,
        "offset": 0
    }
}
```
List responses include all fields EXCEPT `content` (metadata only). Client fetches content via GET /:slug.

**Error:**
```json
{
    "ok": false,
    "error": {
        "code": "SLUG_CONFLICT",
        "message": "A diagram with slug 'example-overview' already exists",
        "status": 409,
        "requestId": "req_abc123"
    }
}
```

### Error Code Catalog

| Code                 | HTTP | When                                           |
|----------------------|------|-------------------------------------------------|
| VALIDATION_ERROR     | 400  | Request body fails zod schema validation        |
| NOT_FOUND            | 404  | Slug does not exist or is soft-deleted           |
| SLUG_CONFLICT        | 409  | Slug already exists (create or restore)          |
| VERSION_MISMATCH     | 412  | Version in request doesn't match current version |
| PAYLOAD_TOO_LARGE    | 413  | Content exceeds 500KB                            |
| RATE_LIMITED         | 429  | Too many requests. Include `Retry-After` header  |
| INTERNAL_ERROR       | 500  | Unexpected server error                          |

### Zod Schemas

```javascript
// schemas/diagram.js
const createDiagramSchema = z.object({
    title: z.string().min(1).max(500),
    slug: z.string().min(1).max(255).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
    description: z.string().max(10000).optional().default(''),
    content: z.string().min(1).max(512000),
    diagram_type: z.enum(['mermaid']).optional().default('mermaid'),
    tags: z.array(z.string().max(100).regex(/^[a-z0-9-]+$/))
            .max(20).optional().default([]),
});

const updateDiagramSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(10000).optional(),
    content: z.string().min(1).max(512000).optional(),
    tags: z.array(z.string().max(100).regex(/^[a-z0-9-]+$/))
            .max(20).optional(),
    version: z.number().int().min(1),  // REQUIRED
});

const deleteDiagramSchema = z.object({
    version: z.number().int().min(1),  // REQUIRED
});

const listDiagramsSchema = z.object({
    search: z.string().max(200).optional(),
    tags: z.string().max(500).optional(),  // comma-separated, split in handler
    sort: z.enum(['updated_at', 'created_at', 'title']).optional().default('updated_at'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});
```

### Middleware Stack (in order)

1. `requestId` — generates UUID, sets `X-Request-ID` header, attaches to `req.id`
2. `pino-http` — structured request logging with request ID
3. `express.json({ limit: '1mb' })` — body parser with size limit
4. `express-rate-limit` — 100 requests per minute per IP
5. `cors` — configurable origin via `CORS_ORIGIN` env var
6. Routes
7. `errors` — global error handler, formats error envelope

### Rate Limiting

100 requests per minute per IP. Response on limit:
```
HTTP 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{
    "ok": false,
    "error": {
        "code": "RATE_LIMITED",
        "message": "Too many requests. Try again in 30 seconds.",
        "status": 429,
        "requestId": "req_xyz"
    }
}
```

### Graceful Shutdown

```javascript
// index.js
const server = app.listen(PORT, () => { ... });

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        logger.info({ signal }, 'Shutting down...');
        server.close(() => {
            pool.end().then(() => process.exit(0));
        });
        // Force kill after 10 seconds
        setTimeout(() => process.exit(1), 10000);
    });
}
```

---

## Web UI

### Architecture

```
main.jsx
  └── QueryClientProvider (TanStack Query)
      └── BrowserRouter
          └── App.jsx
              └── Routes
                  ├── / → Navigate to /d/:latest-slug (or EmptyState)
                  ├── /d/:slug → Layout
                  │   ├── Sidebar (left panel, collapsible)
                  │   │   ├── SearchBar
                  │   │   └── DiagramList
                  │   └── DiagramViewer (main panel)
                  │       ├── Toolbar
                  │       ├── MermaidRenderer (lazy-loaded)
                  │       └── RawSourcePanel (collapsible)
                  └── * → 404 page
```

### QueryClient Configuration

```javascript
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,       // 30 seconds before refetch
            gcTime: 5 * 60_000,      // 5 min garbage collection
            retry: 2,                // retry failed requests twice
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
            refetchOnWindowFocus: true,
        },
    },
});
```

### Query Keys & Hooks

```javascript
// hooks/useDiagrams.js
const diagramKeys = {
    all: ['diagrams'],
    list: (filters) => ['diagrams', 'list', filters],
    detail: (slug) => ['diagrams', 'detail', slug],
};

function useDiagrams(filters) {
    return useQuery({
        queryKey: diagramKeys.list(filters),
        queryFn: () => api.listDiagrams(filters),
    });
}

// hooks/useDiagram.js
function useDiagram(slug) {
    return useQuery({
        queryKey: diagramKeys.detail(slug),
        queryFn: () => api.getDiagram(slug),
        enabled: !!slug,
    });
}
```

### API Client

```javascript
// api/client.js
const BASE = '/api/v1';

async function request(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const body = await res.json();
    if (!body.ok) {
        const err = new Error(body.error?.message || 'Unknown error');
        err.code = body.error?.code;
        err.status = res.status;
        throw err;
    }
    return body;
}

export const api = {
    listDiagrams: (filters) => request(`/diagrams?${new URLSearchParams(filters)}`),
    getDiagram: (slug) => request(`/diagrams/${slug}`),
    createDiagram: (data) => request('/diagrams', { method: 'POST', body: JSON.stringify(data) }),
    updateDiagram: (slug, data) => request(`/diagrams/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteDiagram: (slug, version) => request(`/diagrams/${slug}`, { method: 'DELETE', body: JSON.stringify({ version }) }),
    restoreDiagram: (slug) => request(`/diagrams/${slug}/restore`, { method: 'POST' }),
};
```

### Mermaid Configuration

```javascript
// Inside DiagramViewer.jsx (lazy loaded)
import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',          // matches app theme
    securityLevel: 'strict', // CRITICAL: prevents XSS from diagram content
    fontFamily: 'system-ui, -apple-system, sans-serif',
    flowchart: { useMaxWidth: true },
    c4: { useMaxWidth: true },
});
```

**`securityLevel: 'strict'`** is mandatory. This prevents HTML injection via Mermaid's HTML label feature. Never change this to `'loose'`.

For complex diagrams, prefer Mermaid's ELK layout where supported (for example, large flowcharts with heavy edge crossing), because it generally produces clearer node spacing and fewer overlaps than default layout engines.

### Click-to-Navigate

The frontend supports Mermaid `click` directives without relaxing Mermaid security.

1. Parse `click <nodeId> "<url>" "<tooltip>"` directives from the raw diagram source.
2. Strip those directives before calling `mermaid.render(...)` to avoid strict-mode rendering issues.
3. After SVG render, locate target nodes using:
   - Mermaid-generated SVG IDs (contains/exact match)
   - `data-id` attributes
   - Exact label text match
4. Decorate matching nodes (cursor + visual indicator) and attach navigation handlers.
5. Distinguish click vs drag by comparing `mousedown` and `mouseup` pointer movement so pan/zoom drags do not trigger navigation.

This approach keeps `securityLevel: 'strict'` while still enabling drill-down navigation between diagrams.

### Component Specifications

**Sidebar.jsx**
- Width: 320px default, collapsible to 0px on mobile (hamburger toggle)
- Breakpoint: 768px (below = collapsed by default)
- Search debounce: 300ms
- List shows: title (truncated to 2 lines), tags as colored pills, relative time ("2h ago")
- Active diagram highlighted
- Sorted by API sort order

**DiagramViewer.jsx**
- Renders Mermaid SVG into a container div
- Wraps container with `panzoom` for pan/zoom/pinch
- On content change: re-render Mermaid, reset zoom to fit
- On Mermaid parse error: show `ErrorState` with error message + raw source

**Toolbar.jsx**
- Buttons: Zoom In (+), Zoom Out (-), Fit to Screen, Copy Source, Toggle Raw, Fullscreen
- Copy Source: copies raw Mermaid text to clipboard, shows "Copied!" toast for 2s
- Fullscreen: uses Fullscreen API on the viewer container
- All buttons have `aria-label` attributes

**SearchBar.jsx**
- Input with search icon, clear button when non-empty
- Debounced: fires API call 300ms after last keystroke
- Updates URL query param: `/d/current-slug?q=search-term`

**ErrorState.jsx**
- Red-tinted panel showing: error icon, error message, raw Mermaid source in a `<pre>` block
- Used for both Mermaid parse errors and API errors

**EmptyState.jsx**
- Shown when no diagrams exist
- Message: "No diagrams yet. Create one via the API or CLI."
- Centered in main panel

**LoadingSkeleton.jsx**
- Pulsing placeholder rectangles matching the diagram viewer layout
- Shown while TanStack Query is loading

### URL Routing & Edge Cases

| URL | Behavior |
|-----|----------|
| `/` | Redirect to `/d/:slug` of most recently updated diagram. If no diagrams exist, show EmptyState. |
| `/d/:slug` | Load and display diagram. If not found, show 404 with message "Diagram not found." |
| `/d/:slug?q=search` | Load diagram + pre-fill search bar with query |
| `/anything-else` | 404 page |

### Theming (CSS Variables)

```css
/* variables.css */
:root {
    --bg-primary: #1a1a2e;
    --bg-secondary: #16213e;
    --bg-tertiary: #0f3460;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0a0;
    --accent: #4fc3f7;
    --accent-hover: #29b6f6;
    --error: #ef5350;
    --success: #66bb6a;
    --border: #2a2a4a;
    --sidebar-width: 320px;
    --toolbar-height: 48px;
}

[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f5f5f5;
    --bg-tertiary: #e8e8e8;
    --text-primary: #1a1a1a;
    --text-secondary: #666666;
    --accent: #1976d2;
    --accent-hover: #1565c0;
    --error: #d32f2f;
    --success: #388e3c;
    --border: #e0e0e0;
}
```

Dark theme is default. Toggle stored in `localStorage('draw-theme')`. Applied as `data-theme` attribute on `<html>`.

### Vite Configuration

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    root: '.',
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
    server: {
        proxy: {
            '/api': 'http://localhost:3030',
            '/healthz': 'http://localhost:3030',
            '/readyz': 'http://localhost:3030',
        },
    },
});
```

---

## CLI

### Package: `@draw/cli`

Executable name: `draw`

### Commands

```
draw list                                    List all diagrams
  --tag <tag>                                Filter by tag
  --search <query>                           Full-text search
  --sort <field>                             Sort: updated_at, created_at, title
  --order <dir>                              Order: asc, desc
  --limit <n>                                Max results (default 50)
  --offset <n>                               Pagination offset
  --json                                     Output as JSON (for agents/scripts)

draw get <slug>                              Print diagram Mermaid content to stdout
  --json                                     Full metadata + content as JSON

draw create <title>                          Create a new diagram
  --file <path>                              Read content from file
  --stdin                                    Read content from stdin
  --slug <slug>                              Custom slug (auto-generated if omitted)
  --description <text>                       Description
  --tag <tag>                                Tag (repeatable: --tag a --tag b)
  --json                                     Output as JSON

draw update <slug>                           Update an existing diagram
  --file <path>                              Read new content from file
  --stdin                                    Read new content from stdin
  --title <title>                            Update title
  --description <text>                       Update description
  --tag <tag>                                Replace tags (repeatable)
  --json                                     Output as JSON

draw delete <slug>                           Soft-delete a diagram

draw url <slug>                              Print the diagram URL to stdout

draw open <slug>                             Open diagram in default browser
```

### Configuration

| Env var        | Default                  | Description           |
|----------------|--------------------------|-----------------------|
| DRAW_API_URL   | http://localhost:3030    | API base URL          |
| DRAW_TOKEN     | —                        | Auth token (future)   |

### Exit Codes

| Code | Meaning                |
|------|------------------------|
| 0    | Success                |
| 1    | General/unknown error  |
| 2    | Validation/input error |
| 3    | Resource not found     |
| 4    | Conflict (slug exists) |
| 5    | Network/server error   |

### Pipe Examples

```bash
# Create from stdin
echo "graph TD; A-->B" | draw create "Quick sketch" --stdin
# → Created "Quick sketch" → https://your-domain.com/d/quick-sketch

# Get content and pipe to file
draw get example-overview > backup.mmd

# Agent workflow: generate + create in one shot
echo "C4Context..." | draw create "My Architecture" --stdin --tag project --json
```

### Output Format

**Human-readable (default):**
```
  example-overview    Example System Overview    [architecture, example-app]    2h ago
  liquidation-flow     Liquidation Bot Flow        [trading]                  1d ago
```

**JSON (--json):**
```json
[
  {"slug":"example-overview","title":"Example System Overview","tags":["architecture","example-app"],"updated_at":"2026-03-15T21:00:00Z"},
  {"slug":"liquidation-flow","title":"Liquidation Bot Flow","tags":["trading"],"updated_at":"2026-03-14T10:00:00Z"}
]
```

---

## Docker

### Dockerfile

```dockerfile
# Stage 1: Build frontend
FROM node:22-alpine AS web-build
WORKDIR /app
COPY package*.json ./
COPY packages/web/package*.json packages/web/
COPY packages/server/package*.json packages/server/
RUN npm ci --workspace=packages/web
COPY packages/web/ packages/web/
RUN npm run build --workspace=packages/web

# Stage 2: Production server
FROM node:22-alpine
RUN addgroup -S draw && adduser -S draw -G draw
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json packages/server/
RUN npm ci --workspace=packages/server --omit=dev && chown -R draw:draw /app
COPY --chown=draw:draw packages/server/ packages/server/
COPY --chown=draw:draw --from=web-build /app/packages/web/dist packages/server/public
USER draw
EXPOSE 3030
CMD ["node", "packages/server/src/index.js"]
```

### .dockerignore

```
node_modules
.git
*.md
.env
.env.*
!.env.example
packages/cli
packages/web/node_modules
packages/server/node_modules
packages/server/test
packages/web/src
```

### docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    volumes:
      - draw-pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: draw
      POSTGRES_USER: draw
      POSTGRES_PASSWORD: ${DRAW_DB_PASSWORD:?DRAW_DB_PASSWORD is required}
    healthcheck:
      test: pg_isready -U draw -d draw
      interval: 5s
      timeout: 3s
      retries: 5
    # No ports exposed — only reachable by the app service

  app:
    build: .
    restart: unless-stopped
    ports:
      - "${DRAW_PORT:-3030}:3030"
    environment:
      DATABASE_URL: postgres://draw:${DRAW_DB_PASSWORD}@postgres:5432/draw
      PORT: 3030
      CORS_ORIGIN: ${CORS_ORIGIN:-*}
      NODE_ENV: production
      DB_QUERY_TIMEOUT: 10000
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  draw-pgdata:
```

### docker-compose.dev.yml

```yaml
services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5433:5432"
    volumes:
      - draw-dev-pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: draw
      POSTGRES_USER: draw
      POSTGRES_PASSWORD: draw
    healthcheck:
      test: pg_isready -U draw -d draw
      interval: 5s
      retries: 5

volumes:
  draw-dev-pgdata:
```

### .env.example

```bash
# Required
DRAW_DB_PASSWORD=change-me-in-production

# Optional
DRAW_PORT=3030
CORS_ORIGIN=https://your-domain.com
```

**Note:** `DRAW_DB_PASSWORD` uses `?` syntax in compose — Docker will refuse to start if this env var is not set. No more accidental `draw` passwords in production.

---

## Server Boot Sequence

Exact order of operations on `node packages/server/src/index.js`:

```
1. Load environment variables
2. Create pino logger
3. Create pg Pool (DATABASE_URL)
4. Run migration runner:
   a. Acquire advisory lock
   b. Apply pending migrations in transaction
   c. Release lock
   d. If migration fails → log error, exit(1)
5. Create Express app (app.js):
   a. requestId middleware
   b. pino-http logging
   c. express.json({ limit: '1mb' })
   d. rate limiter
   e. cors
   f. static files (packages/server/public)
   g. health routes (/healthz, /readyz)
   h. API routes (/api/v1/diagrams)
   i. SPA fallback: serve index.html for non-API, non-file routes
   j. global error handler
6. Start HTTP server on PORT
7. Register SIGTERM/SIGINT shutdown handlers
8. Log "Server ready on port {PORT}"
```

The SPA fallback (step 5i) is important: any request that doesn't match `/api/*`, `/healthz`, `/readyz`, or a static file should serve `index.html` so that client-side routing works (e.g., direct link to `/d/example-overview`).

---

## Testing

### Integration Tests (server/test/)

Run against a real Postgres instance (use docker-compose test service or testcontainers).

**Test cases (minimum):**

```
diagrams.test.js:
  POST /api/v1/diagrams
    ✓ creates diagram with all fields
    ✓ creates diagram with auto-generated slug
    ✓ returns 400 for missing title
    ✓ returns 400 for missing content
    ✓ returns 400 for invalid slug format
    ✓ returns 409 for duplicate slug
    ✓ returns 413 for content > 500KB
    ✓ normalizes tags to lowercase sorted unique

  GET /api/v1/diagrams
    ✓ returns list without content field
    ✓ supports pagination (limit, offset)
    ✓ supports search
    ✓ supports tag filtering
    ✓ supports sorting (updated_at, created_at, title)
    ✓ excludes soft-deleted diagrams

  GET /api/v1/diagrams/:slug
    ✓ returns full diagram with content
    ✓ returns 404 for non-existent slug
    ✓ returns 404 for soft-deleted diagram

  PATCH /api/v1/diagrams/:slug
    ✓ updates title only
    ✓ updates content only
    ✓ updates tags
    ✓ returns 412 for version mismatch
    ✓ returns 404 for non-existent slug
    ✓ does not allow slug change

  DELETE /api/v1/diagrams/:slug
    ✓ soft-deletes diagram
    ✓ returns 412 for version mismatch
    ✓ allows creating new diagram with same slug after delete

  POST /api/v1/diagrams/:slug/restore
    ✓ restores soft-deleted diagram
    ✓ returns 404 for non-deleted diagram
    ✓ returns 409 if active diagram with same slug exists

migrations.test.js:
    ✓ applies migrations in order
    ✓ skips already-applied migrations
    ✓ fails on checksum mismatch
    ✓ handles concurrent startup (advisory lock)
```

---


```bash

# 2. Create .env file
cp .env.example .env
# Edit .env: set DRAW_DB_PASSWORD to something secure

# 3. (Optional local development) start dev Postgres only
docker compose -f docker-compose.dev.yml up -d

# 4. Build and start production stack
docker compose up -d --build

# 5. Verify
curl http://localhost:3030/healthz   # → { "ok": true }
curl http://localhost:3030/readyz    # → { "ok": true, "db": "connected", "migrations": "current" }
curl http://localhost:3030/api/v1/diagrams  # → { "ok": true, "data": [], "meta": {...} }

# 6. Update Cloudflare tunnel
# In :
# Ensure your-domain.com service points to localhost:3030

# 7. Verify public access
curl https://your-domain.com/healthz


# 9. Create test diagram
curl -X POST https://your-domain.com/api/v1/diagrams \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Diagram",
    "content": "graph TD\n  A[Start] --> B[End]",
    "tags": ["test"]
  }'
# Verify it appears in the UI
```

---

## Backup Strategy

### Script: `scripts/backup.sh`

```bash
#!/bin/bash
# Run from project root
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U draw draw > "$BACKUP_DIR/draw_$TIMESTAMP.sql"
# Keep last 30 backups
ls -t "$BACKUP_DIR"/draw_*.sql | tail -n +31 | xargs rm -f 2>/dev/null
echo "Backup: $BACKUP_DIR/draw_$TIMESTAMP.sql"
```

### Restore

```bash
cat backups/draw_YYYYMMDD_HHMMSS.sql | docker compose exec -T postgres psql -U draw draw
```

### Schedule (cron)

```
```

---

## Future (not built, architected for)

These features are NOT in v1. The schema and API are designed so they can be added without breaking changes.

| Feature | How the current design supports it |
|---------|-------------------------------------|
| Version history | Add `diagram_versions` table with FK to `diagrams.id`. The `version` column is already tracked. |
| Cross-references | Add `diagram_references` table (source_id, target_id). Tags already allow loose grouping. |
| Auth | Add middleware before routes. No route changes needed. Token check in header. |
| Chat panel | Add new frontend component. Uses existing POST/PATCH API. No backend changes. |
| D2/Graphviz | Add to `diagram_type` CHECK constraint. Frontend lazy-loads renderer by type. |
| PNG/SVG export | Add `GET /api/v1/diagrams/:slug/export?format=png`. Server-side rendering with Puppeteer. |
| Global graph view | Query all diagrams + references, render as meta-Mermaid diagram. Frontend-only feature. |
| Batch operations | Add `POST /api/v1/diagrams/batch` endpoint. No schema changes. |

---

## OpenClaw Integration (NOT in this repo)

Separate skill, installed independently:
```
skills/draw/
├── SKILL.md        # teaches the agent the API contract
└── draw.mjs        # thin wrapper: calls HTTP API, formats output
```

The skill simply calls the REST API documented above. It does not need any special access or internal knowledge of the codebase.
