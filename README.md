# 🧠 Brainflow

A self-hosted diagram viewer and manager. Create, browse, and link architecture diagrams with Mermaid syntax.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Mermaid diagrams** — flowcharts, sequence diagrams, and more
- **Dark/light theme** — with CSS variable theming
- **Search & tags** — full-text search, tag filtering
- **Clickable nodes** — link diagram nodes to other diagrams for drill-down navigation
- **Pan & zoom** — smooth navigation for large diagrams
- **REST API** — full CRUD with optimistic locking
- **CLI** — pipe-friendly command-line tool for automation
- **Self-hosted** — single `docker compose up`, no external dependencies

## Quick Start

```bash
git clone https://github.com/youruser/brainflow.git
cd brainflow
cp .env.example .env
# Edit .env and set DRAW_DB_PASSWORD
docker compose up -d
```

Open http://localhost:3030

## Create a Diagram

```bash
curl -X POST http://localhost:3030/api/v1/diagrams \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Architecture",
    "content": "graph LR\n  A[Frontend] --> B[API] --> C[(Database)]"
  }'
```

Or use the CLI:
```bash
echo "graph LR; A-->B-->C" | npx @brainflow/cli create "Quick sketch" --stdin
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/diagrams` | List all diagrams |
| GET | `/api/v1/diagrams/:slug` | Get a diagram |
| POST | `/api/v1/diagrams` | Create a diagram |
| PATCH | `/api/v1/diagrams/:slug` | Update (requires `version`) |
| DELETE | `/api/v1/diagrams/:slug` | Soft delete (requires `version`) |

Full API documentation in [ARCHITECTURE.md](ARCHITECTURE.md).

## Linking Diagrams

Add click directives to make nodes navigate to other diagrams:

```
graph LR
  A[System Overview] --> B[API Server]
  click B "/d/api-server-detail" "View API details"
```

Clicking "API Server" navigates to the `api-server-detail` diagram.

## Development

```bash
# Start dev database
docker compose -f docker-compose.dev.yml up -d

# Install dependencies
npm install

# Start server
DATABASE_URL=postgres://draw:draw@localhost:5433/draw npm start

# Start frontend (separate terminal)
npm run dev --workspace=packages/web
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development guide.

## Tech Stack

- **Backend:** Node.js 22, Express, PostgreSQL 15, Zod, Pino
- **Frontend:** React 18, Vite, TanStack Query, Mermaid.js, Panzoom
- **CLI:** Commander.js
- **Deployment:** Docker, Docker Compose

## License

MIT
