# Brainflow — Full Product Vision

## One-Liner

**AI-native diagram platform. Talk to your diagrams. They talk to each other.**

---

## The Market

| Competitor | Price | AI | Self-hosted | Connected Diagrams | Agent API |
|---|---|---|---|---|---|
| **Mermaid Chart** | Free / $10-20/user/mo | ✅ 300+ AI credits | ❌ | ❌ | ❌ |
| **Excalidraw+** | Free / $7/user/mo | ❌ | ✅ (OSS) | ❌ | ❌ |
| **Eraser.io** | Free (3 files) / $10/user/mo | ✅ 5 free, unlimited paid | ❌ | ❌ | ❌ |
| **draw.io** | Free | ❌ | ✅ | ❌ | ❌ |
| **Brainflow** | Free (self-host) / TBD SaaS | ✅ | ✅ (OSS, MIT) | ✅ | ✅ |

**Our wedge:** Nobody else has connected diagrams + agent API + self-hosted + AI chat. We're the only tool where diagrams link to each other (drill-down navigation) and where AI agents can maintain diagrams programmatically.

**Who we're taking from:**
- Mermaid Chart users who want self-hosted or agent integration
- Eraser.io users who hit free tier limits (3 files is nothing)
- Teams manually maintaining architecture diagrams in Confluence/Notion that rot the moment they're created
- AI/agent developers who want their agents to output visual documentation

---

## Product Tiers

### Free (self-hosted)
Everything. No feature gating. MIT license.
- Unlimited diagrams, versions, chat history
- BYOK for AI (bring your own API key)
- Full REST API + CLI + agent skill
- Connected diagrams, rollback, source editor
- Single-user / small team (no auth built in — use reverse proxy)

This is the growth engine. Open source users → community → contributors → word of mouth.

### Free (cloud)
Generous enough to be useful, limited enough to convert.
- **5 diagrams**
- **20 AI chat messages/month**
- Full editor (source + chat + rollback)
- Connected diagrams
- Export (PNG/SVG)
- 1 user, no sharing

### Pro ($8/user/month, $6 annual)
The individual power user.
- **Unlimited diagrams**
- **Unlimited AI chat** (we pay the LLM cost — built into price)
- Full version history (free tier: last 10 versions)
- Custom domains for sharing (your-company.brainflow.dev)
- Priority support
- API access with personal API key

### Team ($14/user/month, $10 annual)
Collaboration features.
- Everything in Pro
- **Workspaces** — shared diagram collections
- **Team members with roles** (admin, editor, viewer)
- **Guest access** — unlimited free guests with view-only
- **SSO** (Google, GitHub, SAML)
- **Audit log** — who changed what, when
- **Shared chat history** — see all edits across team members and agents
- Agent API keys per workspace (not per user)

### Enterprise (custom pricing)
- Everything in Team
- Self-hosted with commercial license + support
- SLA, dedicated support, custom integrations
- On-prem deployment assistance
- Volume discounts

---

## Architecture (SaaS-ready)

### Multi-tenancy Model

```
User → belongs to → Workspace(s)
Workspace → owns → Diagram(s)
Diagram → has → Version(s), ChatMessage(s)
```

Every diagram belongs to a workspace. Users can be members of multiple workspaces. The self-hosted version is a single implicit workspace with no auth.

### Database Schema Additions

```sql
-- 002_auth.sql

CREATE TABLE workspaces (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    slug          VARCHAR(100) NOT NULL UNIQUE
                    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    plan          VARCHAR(20) NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'team', 'enterprise', 'self-hosted')),
    -- Limits (null = unlimited)
    max_diagrams      INTEGER DEFAULT 5,
    max_ai_messages   INTEGER DEFAULT 20,  -- per month
    max_versions      INTEGER DEFAULT 10,  -- per diagram
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(255),
    avatar_url    TEXT,
    -- Auth provider
    github_id     VARCHAR(50) UNIQUE,
    google_id     VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255),  -- for email/password auth
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          VARCHAR(20) NOT NULL DEFAULT 'editor'
                    CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE api_keys (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    name          VARCHAR(100) NOT NULL,
    key_hash      VARCHAR(255) NOT NULL,  -- bcrypt hash of the key
    key_prefix    VARCHAR(10) NOT NULL,   -- first 8 chars for identification
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add workspace_id to existing diagrams table
ALTER TABLE diagrams ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
CREATE INDEX idx_diagrams_workspace ON diagrams(workspace_id) WHERE deleted_at IS NULL;
```

```sql
-- 003_chat_and_versions.sql

CREATE TABLE diagram_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id    UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    version       INTEGER NOT NULL,
    content       TEXT NOT NULL,
    title         VARCHAR(500),
    description   TEXT,
    tags          TEXT[],
    source        VARCHAR(20) NOT NULL DEFAULT 'api'
                    CHECK (source IN ('api', 'chat', 'editor', 'cli', 'agent')),
    source_detail TEXT DEFAULT '',
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(diagram_id, version)
);

CREATE INDEX idx_versions_diagram ON diagram_versions(diagram_id, version DESC);

CREATE TABLE diagram_chats (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id    UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content       TEXT NOT NULL,
    -- Snapshot of diagram content AFTER this message was applied
    diagram_snapshot TEXT DEFAULT NULL,
    diagram_version INTEGER DEFAULT NULL,
    -- Who sent this
    user_id       UUID REFERENCES users(id),
    source        VARCHAR(20) DEFAULT 'browser'
                    CHECK (source IN ('browser', 'agent', 'api')),
    source_name   VARCHAR(100),  -- e.g. "OpenClaw", "Claude Code", "Egor"
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chats_diagram ON diagram_chats(diagram_id, created_at ASC);

-- Monthly usage tracking for AI limits
CREATE TABLE usage_tracking (
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    month         DATE NOT NULL,  -- first of month
    ai_messages   INTEGER NOT NULL DEFAULT 0,
    api_calls     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, month)
);
```

### Self-hosted Mode

When `SELF_HOSTED=true` (the default):
- No auth required — all requests are authorized
- Single implicit workspace (auto-created on first boot)
- All limits set to NULL (unlimited)
- No Stripe, no usage tracking
- `workspace_id` is auto-populated on all operations

This means the codebase is the same. Self-hosted just skips auth middleware and uses a default workspace. No feature flags, no code branches — just different defaults.

### Auth Flow (SaaS)

```
Sign up → GitHub OAuth / Google OAuth / Email+Password
    ↓
Create workspace (or accept invite)
    ↓
Redirect to workspace dashboard
    ↓
JWT in httpOnly cookie (browser) or Bearer token (API)
```

Sessions: JWT with 7-day expiry, refresh via httpOnly cookie. API keys are separate (long-lived, per-workspace, hashed in DB).

### LLM Architecture

```
Browser chat → POST /api/v1/diagrams/:slug/chat
    ↓
Server:
    1. Check AI message quota (SaaS) or skip (self-hosted)
    2. Load diagram content + last N chat messages
    3. Build prompt (system + context + history + user message)
    4. Call LLM provider
    5. Validate Mermaid output (server-side parse)
    6. If invalid → retry with error context (max 2 retries)
    7. If valid → PATCH diagram, save version, save chat messages
    8. Stream response via SSE to browser
    ↓
Browser re-renders diagram in real time
```

**LLM Provider abstraction:**

```typescript
interface LLMProvider {
    chat(messages: Message[], options: LLMOptions): AsyncIterable<string>;
}

// Implementations:
// - AnthropicProvider (Claude)
// - OpenAIProvider (GPT)
// - OpenRouterProvider (any model)
// - OllamaProvider (local)
// - GatewayProvider (OpenClaw agent passthrough)
```

Self-hosted: BYOK via env vars (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`).
SaaS: we provide the LLM — Anthropic Claude Sonnet. Cost is baked into subscription price. At ~$3/1M input tokens and average diagram edit being ~2K tokens, that's roughly $0.006 per AI edit. Even heavy users doing 1000 edits/month cost us $6 — well within an $8/mo subscription.

### Agent Integration

Agents interact via the REST API. For SaaS, they use workspace API keys. For self-hosted, no auth needed.

The chat endpoint accepts a `source` field:

```json
POST /api/v1/diagrams/:slug/chat
{
    "message": "Add a Redis cache layer",
    "source": "agent",
    "source_name": "OpenClaw",
    "version": 5
}
```

This means all edits (human and agent) appear in the same chat timeline. When a human opens the diagram, they see:

```
[OpenClaw] Added Redis cache between API and DB (v6)
[Claude Code] Reorganized layout, added connection labels (v7)
[You] Make the cache connection dashed (v8)
```

Each message links to the version it produced. Click any version to preview or restore.

**Multi-agent conflict resolution:**
- Optimistic locking (existing `version` field) prevents clobbering
- If an agent gets a 412, it should re-fetch the diagram and retry
- Chat history shows exactly what happened and in what order
- Rollback is always available

---

## UI Layout (Full)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🧠 Brainflow    [Workspace ▾]              [🔔] [👤 Profile]  │
├──────────┬──────────────────────────────────┬───────────────────┤
│ Sidebar  │                                  │   Right Panel     │
│          │                                  │                   │
│ 🔍 search│     Rendered Diagram             │  [Chat] [Source]  │
│ 🏷 tags  │     (pan + zoom + click nav)     │  [History]        │
│          │                                  │                   │
│ diagram1 │                                  │  💬 Chat:         │
│ diagram2 │                                  │  > Add a DB       │
│ diagram3 │                                  │  ✓ Added Postgres │
│   └─child│                                  │  > Connect to API │
│ diagram4 │                                  │  ✓ Added arrow    │
│ ...      │                                  │                   │
│          │                                  │  [Type message...│
│ [+ New]  │                                  │  [Send] [⚙️ Model]│
├──────────┴──────────────────────────────────┴───────────────────┤
│ v8 · saved 2s ago · 14 nodes · by OpenClaw  │  [◀ v7] [v9 ▶]  │
└─────────────────────────────────────────────────────────────────┘
```

### Key UI Features

**Connected diagram tree:** Sidebar shows diagram hierarchy based on click-link relationships. `diagram3` has a child `child` because diagram3's Mermaid has `click NodeX "/d/child"`. This tree is computed from link analysis, not manual organization.

**Workspace switcher:** Top-left dropdown for users in multiple workspaces.

**Inline version navigation:** Status bar has prev/next version arrows. Scrub through history without opening the history panel.

**Model selector:** In chat panel, users can pick their preferred model (SaaS: included models; self-hosted: whatever BYOK is configured).

**"New Diagram" flow:**
1. Click "+ New"
2. Two options: "Start blank" or "Describe with AI"
3. Blank → source editor with empty diagram
4. AI → chat prompt: "What would you like to diagram?" → generates first version

**Share/embed:**
- Public link: `brainflow.dev/s/{workspace}/{slug}` (view-only, no auth)
- Embed: `<iframe src="brainflow.dev/embed/{workspace}/{slug}">` (rendered diagram only)
- Both require "sharing enabled" toggle per diagram (off by default)

---

## Revenue Model

### Unit Economics (per user/month)

| Cost | Amount |
|---|---|
| LLM (avg 200 AI edits/user/mo) | ~$1.20 |
| Postgres (RDS or equivalent) | ~$0.50 |
| Compute (container hosting) | ~$0.30 |
| Bandwidth/CDN | ~$0.10 |
| **Total COGS** | **~$2.10** |
| **Pro price** | **$8.00** |
| **Gross margin** | **~74%** |

Heavy AI users (1000+ edits/month) push COGS to ~$6 but that's the 99th percentile. The median user probably does 50 AI edits/month (~$0.30 LLM cost).

### Growth Levers

1. **Open source → self-hosted users → cloud converts.** Excalidraw model. The self-hosted version is the funnel top.
2. **Agent ecosystem.** Every OpenClaw/LangChain/CrewAI user who wants visual output is a potential user. Skill on ClawHub, integrations with agent frameworks.
3. **Embeds.** Diagrams embedded in docs/READMEs drive traffic back to Brainflow.
4. **Connected diagrams as the moat.** Once you have 20+ linked diagrams, switching cost is high. Your architecture documentation IS the product.

---

## Implementation Roadmap

### Phase 1: Editor Foundation (2 sessions)
Make Brainflow usable without an agent.
- Right panel with Source tab (CodeMirror + Mermaid syntax highlighting)
- Live preview (debounced re-render)
- Save to API (PATCH with optimistic locking)
- "+ New Diagram" button + creation flow
- Status bar (version, save state, node count)
- **No backend changes except: add `source` field to PATCH endpoint**

### Phase 2: Version History (1 session)
Never lose work.
- Migration: `diagram_versions` table
- Auto-snapshot on every update
- History tab in right panel
- Click to preview, button to restore
- Inline prev/next in status bar

### Phase 3: AI Chat (2 sessions)
The killer feature.
- Migration: `diagram_chats` table
- Chat tab in right panel
- BYOK LLM config
- LLM provider abstraction (Anthropic, OpenAI, OpenRouter, Ollama)
- Server-side Mermaid validation + retry loop
- SSE streaming to browser
- Chat history per diagram (shared across all editors)
- `source` + `source_name` on chat messages

### Phase 4: Auth + Multi-tenancy (2 sessions)
Required for SaaS.
- Migration: `workspaces`, `users`, `workspace_members`, `api_keys`
- GitHub + Google OAuth
- Email/password with bcrypt
- JWT sessions
- Workspace CRUD
- Role-based access (owner, admin, editor, viewer)
- All existing endpoints scoped to workspace
- Self-hosted mode: no auth, single workspace

### Phase 5: SaaS Infrastructure (1-2 sessions)
Ship the cloud version.
- Stripe integration (subscriptions, checkout, webhook)
- Usage tracking + quota enforcement
- Landing page (pricing, features, sign up)
- Deploy to Fly.io or Railway (managed Postgres)
- Custom domain: brainflow.dev
- Monitoring, error tracking (Sentry)

### Phase 6: Polish + Growth (ongoing)
- Public sharing + embeds
- PNG/SVG export
- Diagram templates
- Connected diagram tree view in sidebar
- Graph overview (meta-diagram showing all connections)
- ClawHub skill publication
- Agent framework integrations

---

## Open Questions for Egor

1. **Domain name.** `brainflow.dev`? `brainflow.app`? `brainflow.io`? Should we check availability and grab one?

2. **Hosting.** Fly.io, Railway, Render, or our own VPS (Hetzner)? Managed is less work but more cost. Hetzner is cheaper but we manage everything.

3. **Phase 1 priority.** Start building now, or keep planning? I think the plan is solid enough to start — Phase 1 has no irreversible decisions.

4. **Should chat messages be editable/deletable?** If someone asks the AI something dumb and it makes a bad edit, can they delete that chat exchange and the associated version? Or is the history always immutable (with rollback being the only recourse)?

5. **Mermaid only, or support other syntaxes?** D2, Graphviz, PlantUML all have users. Supporting multiple renderers is a differentiator but adds complexity. Could be a Phase 6+ thing.

6. **Naming.** Are we keeping "Brainflow" or is that a working title? It's distinctive and available as a GitHub org, but worth confirming before we build a brand around it.
