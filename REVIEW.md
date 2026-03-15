# Architecture Review — draw.bots.town

This review evaluates `ARCHITECTURE.md` against correctness, operability, and scale safety for a production v1.

## Executive Verdict

The plan is a strong draft, but it is not yet production-safe. The first failures at scale will be:
1. Migration runner non-atomic behavior and race conditions on multi-instance startup
2. Weak API consistency (missing idempotency/concurrency semantics, missing endpoints for deleted resources, non-specific error model)
3. Search/index mismatch (tags/search behavior not fully aligned with query patterns)
4. Operational security defaults (`CORS_ORIGIN=*`, no backup/restore SLO, weak secret posture)

Proceed only after fixing the high-priority items marked `P0`.

---

## 1. Schema Design

### Strengths
- Correct use of UUID PKs.
- Partial unique index on `slug` for soft-delete behavior is intentional and valid.
- Trigger-based `updated_at` is good.
- Content size check constraint is good.

### Issues and Recommendations

1. `P0` Missing NOT NULL and default constraints on operational columns.
- Problem: `diagram_type`, `tags`, `created_at`, `updated_at` are nullable by current DDL.
- Risk: inconsistent rows and null-handling bugs.
- Fix:
  - `diagram_type VARCHAR(50) NOT NULL DEFAULT 'mermaid'`
  - `tags TEXT[] NOT NULL DEFAULT '{}'::text[]`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

2. `P0` Missing check constraints for semantic validation in DB.
- Problem: API validates slug/tags/title lengths, DB does not enforce most of it.
- Risk: invalid data can enter via manual SQL, future scripts, or buggy clients.
- Fix:
  - `CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')`
  - `CHECK (char_length(title) BETWEEN 1 AND 500)`
  - `CHECK (char_length(slug) BETWEEN 1 AND 255)`
  - `CHECK (array_length(tags,1) IS NULL OR array_length(tags,1) <= 20)`
  - Optional: enforce tag length with trigger/function or normalized tag table.

3. `P1` Case/collation behavior for slug uniqueness is underspecified.
- Problem: regex implies lowercase, but DB uniqueness can still be collation-sensitive edge-case prone.
- Fix: either use `citext` for slug with lowercase normalization, or enforce lowercase in DB check and API transformation before insert.

4. `P1` Search index does not include `content` or `tags`; API semantics unclear.
- Problem: `search` only title+description now; users often expect tags/content matching.
- Fix:
  - Decide explicit semantics: metadata-only search vs full search.
  - If full search needed, add weighted tsvector column with generated expression and GIN index.

5. `P1` `tags TEXT[]` is acceptable for v1 but weak for analytics/filtering at scale.
- Problem: poor tag governance (duplicates like `Swap.Win` vs `swap.win`, typos).
- Fix for v1.1: normalize to `tags` table + `diagram_tags` join table; in v1 at least canonicalize tags to lowercase and unique-sorted at write-time.

6. `P1` Missing optimistic locking/version column.
- Problem: concurrent edits overwrite silently.
- Fix: add `version INT NOT NULL DEFAULT 1`, increment on update; support `If-Match`/ETag or `version` precondition in PATCH.

7. `P2` `_migrations` naming is okay but use a dedicated schema.
- Fix: put migration metadata in `schema_migrations` under `public` or `meta` schema with unique filename + checksum.

---

## 2. API Design

### Strengths
- Clear CRUD coverage and soft-delete restore concept.
- Useful list query params.
- Reasonable validation boundaries.

### Issues and Recommendations

1. `P0` Missing idempotency and conflict semantics for create/update.
- Problem: retries can create duplicates/conflicts unpredictably.
- Fix:
  - Support `Idempotency-Key` on `POST /diagrams`.
  - Return deterministic 409 payload when slug exists.

2. `P0` Missing concurrency controls.
- Problem: last-write-wins data loss.
- Fix:
  - Add ETag to resource responses.
  - Require `If-Match` on PATCH/DELETE (or `version` field).
  - Return `412 Precondition Failed` on mismatch.

3. `P1` `GET /diagrams/:slug` ignores deleted-resource retrieval use case.
- Fix options:
  - `?include_deleted=true` (admin/internal only), or
  - `GET /diagrams/:slug/history` later, or
  - dedicated endpoint for deleted retrieval in v1 if CLI/admin needs restore workflows.

4. `P1` Missing hard-delete/admin purge endpoint semantics.
- If soft delete is permanent in v1, state that explicitly.
- If eventual purge needed, define privileged endpoint and retention policy.

5. `P1` Pagination model uses offset only.
- Problem: offset degrades for large datasets and inconsistent pages under concurrent writes.
- Fix:
  - Keep offset for v1, but add cursor pagination option for forward compatibility.

6. `P1` No OpenAPI/JSON schema contract.
- Fix: define OpenAPI spec now; generate request/response validators from schema.

7. `P1` HTTP status model incomplete.
- Add explicit handling for:
  - `401/403` (if behind proxy auth fails or future auth)
  - `405` method not allowed
  - `413` payload too large
  - `422` semantically invalid payload
  - `429` rate limit exceeded with retry headers

8. `P1` Sorting parameters ambiguous.
- Problem: `sort=updated|created|title` not mapped to exact columns in spec.
- Fix: define strict enum mapping and default tie-breaker (`updated_at DESC, id DESC`).

9. `P2` Missing batch endpoints.
- Not mandatory for v1, but useful for CLI/agent throughput:
  - bulk fetch metadata by slugs
  - bulk tag updates

---

## 3. Frontend Architecture

### Strengths
- Clear component split and route model.
- Lazy-loading Mermaid is good.
- Error state includes raw source fallback.

### Issues and Recommendations

1. `P0` Sanitization and Mermaid security level not specified.
- Problem: rendering untrusted Mermaid can become XSS vector depending on Mermaid config and HTML labels.
- Fix:
  - Set Mermaid `securityLevel` explicitly (`strict` preferred).
  - Validate/strip dangerous directives server-side for stored diagrams.

2. `P1` State ownership strategy is vague (`SWR or simple fetch + state`).
- Problem: inconsistent behavior and cache bugs.
- Fix: choose one now. Recommendation: TanStack Query (or SWR) with explicit cache keys and stale policies.

3. `P1` No virtualized list strategy.
- Problem: sidebar list performance collapses with large datasets.
- Fix: use list virtualization (`react-window` or similar) once list exceeds threshold.

4. `P1` No offline/error retry strategy.
- Fix: specify retry backoff, user-visible retry control, and network timeout policy.

5. `P1` URL/state sync edge cases missing.
- Cases to define:
  - slug not found
  - deleted diagram direct link
  - search term in URL for shareability

6. `P2` Accessibility details missing.
- Fix: keyboard navigation for diagram list, focus management on route change, ARIA labels for toolbar actions.

---

## 4. Docker / Deployment

### Strengths
- Multi-stage Docker build is appropriate.
- Health-gated dependency in compose is good.

### Issues and Recommendations

1. `P0` Runtime image runs as root.
- Fix:
  - Create non-root user and `USER` switch.
  - Ensure copied files owned by runtime user.

2. `P0` `CORS_ORIGIN=*` default is unsafe.
- Fix: default to explicit trusted origin(s), fail startup if production and wildcard configured.

3. `P0` Secrets handling is weak.
- Problem: default DB password `draw` invites accidental insecure deploy.
- Fix: require non-default password in production profile; support Docker secrets/env-file separation.

4. `P1` Missing readiness/liveness endpoints split.
- Current `/health` conflates health and readiness.
- Fix:
  - `/healthz` (process alive)
  - `/readyz` (DB reachable + migrations complete)

5. `P1` No resource policy for Node memory/CPU tuning.
- Fix: set `NODE_OPTIONS=--max-old-space-size=...` and define CPU limits/reservations as needed.

6. `P1` No backup/restore runbook for Postgres volume.
- Fix: add scheduled `pg_dump`, retention, restore test cadence, and RPO/RTO targets.

7. `P1` No log shipping/observability plan.
- Fix: include structured request IDs, error correlation IDs, and destination (journald, Loki, etc.).

8. `P2` `deploy.resources` in plain docker-compose is often ignored outside Swarm.
- Fix: clarify runtime (Swarm vs compose) or move limits to runtime-supported options.

---

## 5. CLI Design

### Strengths
- Good pipe-first ergonomics (`--stdin`, stdout-friendly).
- JSON output mode is correct for agent usage.

### Issues and Recommendations

1. `P0` Missing authentication/context flags for future-proofing.
- Even with Cloudflare Access, CLI needs a token/header mechanism for automation.
- Fix: add `--token`/env support and generic header injection.

2. `P1` Missing timeout/retry controls.
- Fix: global flags `--timeout`, `--retries`, `--retry-backoff`.

3. `P1` Missing explicit exit code contract.
- Fix:
  - `0` success
  - `2` validation/user input error
  - `3` not found
  - `4` conflict
  - `5` network/server error

4. `P1` Missing format controls for `list`.
- Fix: add `--limit`, `--offset`, `--search`, `--sort`, `--order` parity with API.

5. `P2` Missing shell completion/docs generation.
- Useful but not blocking.

---

## 6. Overall Architecture (Coupling, Extensibility, Scale)

1. `P0` Migration-on-startup tightly coupled to app boot.
- Problem: multiple app replicas can race on startup migrations.
- Fix: separate migrator job/init container with DB advisory lock; app should fail if schema version incompatible.

2. `P1` API + web served from same process is acceptable for v1, but cache strategy is missing.
- Fix: ensure static assets use immutable cache headers and API has appropriate no-cache where needed.

3. `P1` No explicit domain model boundaries.
- Add service layer boundaries now (diagram service, search service, migration service) to avoid route-level business logic sprawl.

4. `P1` Future versioning table planned, but no event/audit design.
- At minimum for v1: audit columns (`created_by`, `updated_by`) are optional if identity exists later; otherwise leave placeholder design doc.

---

## 7. Migration Strategy

### Critical Gaps

1. `P0` Non-transactional migration execution.
- Problem: partial migration can leave DB corrupted.
- Fix: execute each migration inside a transaction where possible.

2. `P0` No global lock.
- Problem: concurrent nodes can apply same migration.
- Fix: use `pg_advisory_lock` during migration run.

3. `P0` No checksum tracking.
- Problem: edited migration files are undetected.
- Fix: store filename + checksum + applied_at; fail on checksum mismatch.

4. `P1` No backward-compat deployment protocol.
- Fix: define expand/contract migration pattern:
  - Expand schema (add nullable/new columns)
  - Deploy app using both old+new
  - Backfill
  - Contract old fields in later release

5. `P1` No rollback strategy.
- Fix: forward-fix preferred, but define when rollback allowed and how to restore from backup.

---

## 8. Error Handling and Resilience

1. `P0` Error taxonomy too shallow.
- Fix: define stable machine-readable error codes per domain (`SLUG_CONFLICT`, `INVALID_TAG`, `MERMAID_PARSE_FAILED`, etc.).

2. `P1` Missing request timeout/circuit-breaker behavior.
- Fix: server-side request timeout, DB query timeout, and standardized timeout error mapping.

3. `P1` No retry policy guidance for clients/CLI.
- Fix: retry only idempotent operations by default; do not auto-retry PATCH/POST without idempotency keys.

4. `P1` No degraded-mode behavior.
- Example: if DB unavailable, health endpoints should reflect readiness fail and API should return fast, consistent errors.

5. `P2` Missing rate-limit response details.
- Fix: include `Retry-After` and consistent 429 error payload.

---

## 9. Missing Entirely for v1

1. `P0` OpenAPI spec and generated validation.
2. `P0` Integration test plan (API + DB migrations + soft-delete/restore behavior).
3. `P0` Security baseline:
- dependency scanning
- pinned base image digests
- non-root container
- strict CORS
4. `P1` Observability baseline:
- request IDs
- structured error logs with stack traces in non-prod only
- basic metrics (req count, latency, error rate, DB pool stats)
5. `P1` Backup/restore runbook with restore drills.
6. `P1` SLO definition (availability, p95 latency, error budget).
7. `P2` Data retention policy for soft-deleted diagrams.

---

## Recommended Minimum Change Set Before Build (`P0` Only)

1. Harden DB schema constraints and nullability.
2. Redesign migration runner with advisory lock + transaction + checksum.
3. Add optimistic concurrency control for PATCH/DELETE.
4. Fix container security (non-root) and secure env defaults (no wildcard CORS / weak default password).
5. Add OpenAPI contract and enforce request/response validation.
6. Define explicit error code catalog and status mapping.

If these are implemented first, the architecture becomes a credible production v1 foundation.
