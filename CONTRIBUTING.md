# Contributing

## Development Setup

1. Clone the repo
2. Start the dev database:
   ```bash
   docker-compose -f docker-compose.dev.yml up -d
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server (auto-runs migrations):
   ```bash
   DATABASE_URL=postgres://draw:draw@localhost:5433/draw npm start
   ```
5. Start the frontend dev server (in another terminal):
   ```bash
   npm run dev --workspace=packages/web
   ```
6. Open http://localhost:5173

## Testing

```bash
# Server integration tests (requires Postgres)
DATABASE_URL=postgres://draw:draw@localhost:5433/draw node --test packages/server/test/*.test.js

# CLI tests
node --test packages/cli/test/*.test.js
```

## Project Structure

- `packages/server/` — Express API + migrations
- `packages/web/` — React frontend (Vite)
- `packages/cli/` — CLI tool

## Code Style

- ES modules (`import`/`export`)
- No TypeScript (plain JS with JSDoc where helpful)
- Zod for runtime validation
- Service layer pattern: routes → services → database

## Pull Requests

- One feature/fix per PR
- Include tests for new functionality
- Run the full test suite before submitting
- Update ARCHITECTURE.md if you change the API or schema
