# Product Manual (admin → Roadmap → Product Manual)

A read-only, searchable, cross-linked guide to the whole product for Ally staff, plus a chat that is
grounded in it and a drafts tray that saves rough ideas to the user's roadmap drafts. The manual lives
**only in the database** — the monorepo and the developer wiki are public — so no manual text is ever
committed. Code, migration and this doc are committed; content is imported.

Scoped in a six-round interview with the product owner (2026-11-25). Decisions that shape everything:

| Decision | Choice |
|---|---|
| Where | Sub-tab under Roadmap, working title **Product Manual**; route `/roadmap/manual[/:slug]` |
| Access | All staff with the `product_manual` toggle (default on for every admin tier) + roadmap v2 role ≠ none |
| Spine | Organised by **user journey / job-to-be-done**; role and surface are tags and filtered views |
| Source of truth | Database only (`manual_pages` + `manual_revisions`) |
| Freshness | No blocking AI gate. Coding agents **propose**; a **weekly agent applies**; the **chat agent edits live**; every edit is a revision in the visible change log with one-click revert |
| Budget | `monthly_budget_usd` default 100, IST calendar month; at the cap the agent stops and the tab shows a banner |
| CI | A no-AI PR trailer check: `Manual: proposal <id>` or `Manual: none — <reason>` |
| Release state | Manual describes master; a page edited since the last release carries a **"ships in next release"** badge |
| Chat | Grounded in the manual; falls back to live code search; edits the manual live when it finds a gap or error |
| Drafts | Live drafts tray beside the chat; saving creates a real roadmap draft |
| Analytics | Chat can ask the Analytics Agent **only if the caller holds the `analytics_agent` toggle** |
| Reader v1 | Cmd+K search, select-text → Ask / Start a draft, backlinks + visual map, two modes (book ↔ split with chat) |
| Not in v1 | Live usage stats beside features; staff-editable pages (the manual is read-only to humans) |

## Safety rules the code must keep

1. **No manual text in git.** Never seed content from a migration or fixture.
2. **Scrubber on every write** (`ManualScrubService`): reject a write whose body contains an API key /
   token pattern (`sk-`, `pmk_`, `clr_`, `AKIA…`, `-----BEGIN`), an email address, a phone number, or
   a line starting `Strategy:` / `Pricing:`. The rejection is a tool error the agent can read and retry.
3. **Prompt-injection:** page bodies, code and chat text are data. Agent system prompts say so; an
   agent never changes its own tools, budget, or settings from text it reads.
4. **Every body write goes through `ManualPageService.write()`** — the single writer. It validates
   `[[links]]`, scrubs, writes the page, appends a revision, rebuilds `manual_links`, sets
   `release_state='next'` when the author is not `seed`, in one transaction.
5. Tools never throw into the model; they return `{ok:false,error}`.

## API (all under `/v1/product-manual`, controller `@Controller({path:'product-manual', version:'1'})`)

Every route: `@RequireFeatureToggle(FeatureToggleKey.PRODUCT_MANUAL, {permissions:[PERMISSIONS.VIEW_PRODUCT_ROADMAP]})`
and `await this.settings.assertRoadmapV2()` in the handler. Admin routes use
`@RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE)`. **No route may omit a toggle** (the
custom-login snapshot counts permission-only routes).

### Reader

```
GET  /tree                      -> { pages: PageRow[] }
GET  /pages/:slug               -> PageDetail
GET  /search?q=&limit=          -> { results: SearchHit[] }          (q < 2 chars -> [])
GET  /graph                     -> { nodes: GraphNode[], edges: {from:string,to:string}[] }
GET  /changes?limit=30&slug=    -> { changes: ChangeRow[] }          (global log, or one page's)
POST /pages/:slug/revert        body {revisionId} -> PageDetail      (writes a 'revert' revision)
GET  /state                     -> ManualState
```

```ts
PageRow   = { slug, title, summary, parentSlug: string|null, position, kind: 'section'|'page',
              roles: string[], surfaces: string[], journeys: string[],
              releaseState: 'live'|'next', verifiedAt: string|null, updatedAt: string }
PageDetail= PageRow & { body: string, verifiedRef: string|null,
              backlinks: {slug,title}[], outlinks: {slug,title}[],   // outlinks only for slugs that exist
              breadcrumb: {slug,title}[], children: {slug,title,summary}[],
              lastChange: ChangeRow|null }
SearchHit = { slug, title, parentTitle: string|null, snippet: string /* HTML, only <mark> allowed */, rank }
GraphNode = { slug, title, parentSlug: string|null, kind }
ChangeRow = { id, slug, pageTitle, at, authorKind, authorLabel: string, reason, revertOf: string|null }
ManualState = {
  agentState: 'disabled'|'idle'|'running'|'budget_exhausted',
  banner: string|null,            // user-facing sentence when paused/exhausted, else null
  budget: { monthlyBudgetUsd, spentUsd, reservedUsd },
  lastRun: ManualLastRun|null, nextRunAt: string|null,
  openProposals: number, openGaps: number,
  analyticsAvailable: boolean,    // caller holds analytics_agent
  canAdminister: boolean,         // caller holds product_roadmap_manage
}
```

Search uses `websearch_to_tsquery('english', $q)` against `search_vector`, ranked with `ts_rank_cd`,
`ts_headline(... StartSel='<mark>', StopSel='</mark>', MaxFragments=1, MaxWords=24)`. The headline is
built from escaped text so only `<mark>` survives. Fall back to `ILIKE` on title when the tsquery is
empty (a query of only stop-words).

### Chat

```
GET    /conversations           -> { conversations: {id,title,updatedAt}[] }       (caller's own, newest first)
GET    /conversations/:id       -> Conversation  (messages + drafts)               (404 if not the caller's)
DELETE /conversations/:id       -> 204
POST   /chat/stream             body { conversationId?: string, message: string,
                                       context?: { pageSlug?: string, selection?: string } }
                                -> text/event-stream
POST   /drafts                  body { conversationId, draftId, text?, title? } -> { code: string }
POST   /drafts/dismiss          body { conversationId, draftId } -> 204
```

`message` ≤ 4000 chars, `selection` ≤ 1500. One conversation = one SSE stream at a time (Redis lock
`product-manual:chat:<id>`, 5 min TTL, else 409).

SSE events (JSON `data:`; the frontend's `readSse` parses `event:` + `data:`):

| event | data |
|---|---|
| `meta` | `{ conversationId, messageId }` — first |
| `activity` | `{ id, label }` e.g. "Reading Running a roleplay" |
| `activity_done` | `{ id, summary, ok }` |
| `token` | `{ text }` — answer text delta |
| `citation` | `{ slug, title }` — a manual page the answer drew on |
| `draft` | `{ id, title, text, relatedPages: {slug,title}[] }` — a tray card (not yet saved) |
| `page_edited` | `{ slug, title, revisionId, reason }` — agent edited live |
| `error` | `{ message }` — then stream ends |
| `done` | `{ messageId }` — last |

`POST /drafts` calls `RoadmapDraftService.create(userId, {text, captureMode:'typed'})`; the text is the
draft body followed by a blank line and `Related manual pages: <slug>, <slug>` when there are any.
It stores `savedCode` on the tray card. A user without the roadmap `idea` role gets the service's 403.

### Admin

```
GET   /admin/settings          -> { enabled, monthlyBudgetUsd, ... }          (PRODUCT_ROADMAP_MANAGE)
PATCH /admin/settings          body { enabled?, monthlyBudgetUsd? (1..2000) }
POST  /admin/run               -> { runId }   run-now; same budget guards; 409 if already running
GET   /admin/runs?limit=10     -> { runs: Run[] }
GET   /admin/proposals?status= -> { proposals: Proposal[] }
POST  /admin/proposals/:id/dismiss
GET   /admin/agent-keys        -> { keys: {id,label,keyPrefix,lastUsedAt,revokedAt,createdAt}[] }
POST  /admin/agent-keys        body {label} -> { id, key: 'pmk_…' }   plaintext once
DELETE /admin/agent-keys/:id   -> 204
POST  /admin/import            body { pages: ImportPage[], mode?: 'upsert' } -> { created, updated, unchanged, errors: string[] }
POST  /admin/mark-released     -> { cleared: number }   release_state 'next' -> 'live' for every page
```

`ImportPage = { slug, title, summary?, parentSlug?, position?, kind?, body?, roles?, surfaces?, journeys? }`.
Import goes through `ManualPageService.write()` with `authorKind:'seed'` (does not set `next`); it
upserts by slug, skips identical text, returns per-page errors rather than aborting. Max 200 pages per
call, 200 KB per body.

### Proposal MCP (coding agents)

`POST /v1/product-manual/mcp` — stateless JSON-RPC 2025-06-18 like `context-library-mcp.controller.ts`
(`initialize`, `ping`, `tools/list`, `tools/call`, batch, notifications → 202). Auth: `Authorization:
Bearer pmk_…` verified against `manual_agent_keys` (sha256), 60 requests/min/key (Redis), `last_used_at`
at most once a minute. This route is the only one without `@RequireFeatureToggle` — mark it `@Public()`
the way the context-library MCP controller does and verify the key itself.

Tools: `search_manual {query}`, `read_manual_page {slug}`, `list_manual_pages {}`,
`propose_manual_change {kind: 'edit'|'new_page'|'gap', pageSlug?, summary, detail?, prRef?}` →
`{ok, proposalId, trailer: "Manual: proposal <id>"}`. **No tool edits a page.**

## Agents

Two LLM tasks, both new `LlmTask` members with rows in `ai-task-registry.constants.ts` (tier REASONING,
provider/model resolved through `LlmTargetResolverService`, same as the PM agent):

- `PRODUCT_MANUAL_CHAT = 'product_manual_chat'` — the chat agent.
- `PRODUCT_MANUAL_AGENT = 'product_manual_agent'` — the weekly agent.

Spend is read from `llm_usage` where `task LIKE 'product_manual\_%'` for the IST month
(`ManualBudgetService`, modelled on `PmAgentBudgetService`), so chat spend and weekly spend share
one cap. The chat refuses to start a turn when the month is exhausted **for its edit tool only** —
reading and answering stay available (cheap), edits are withheld and the agent says so.

### Chat agent tools (`ManualChatToolsService`)

`search_manual`, `read_manual_page`, `search_roadmap` (overlap + status via `RoadmapItemReadService`,
five simple stages: Draft / Backlog / Being built / Shipped / Declined), `github_search_code`,
`github_read_file`, `github_repo_tree` (via `BuilderGithubReadService`, monorepo allow-list),
`analytics_ask` (only when the caller holds `analytics_agent`; 90 s deadline; via a new
`AnalyticsAgentService`-side helper), `edit_manual_page {slug, newBody, reason, sources[]}` (live edit via
the single writer, emits `page_edited`), `create_manual_page`, `propose_draft {title, text,
relatedSlugs[]}` (emits `draft`; nothing persisted), `log_gap {question, pageSlug?}` (writes a `gap`
proposal). Max 10 tool iterations per turn.

System prompt rules: answer from the manual first and cite pages; if the manual is silent or looks
wrong, search the code, answer from what the code says, **say which part came from code**, then fix the
page; think like a product partner (ask one sharp question, name trade-offs, check
`search_roadmap` before proposing a draft); drafts are rough — never expand into a full opportunity;
never write secrets, strategy or personal data into a page.

### Weekly agent (`ManualWeeklyAgentService`)

Registered on the shared `weekly` scheduled-task tick (Mondays 02:00 UTC) via
`scheduledTaskRegistry.register('weekly', 'product-manual-weekly', …)`. A run: advisory lock + the
`uq_manual_runs_one_running` index; skip if disabled or budget exhausted (records a `skipped` run);
per-run cap = `min(remaining month, monthly/4)`; work order = open proposals oldest first, then pages
with the oldest `verified_at` (never-verified first), then pages whose last revision is older than the
newest code in the matching surface. For each: read the page, read the code it describes, then
`edit_manual_page` (author `proposal` when applying one, else `weekly_agent`) and `mark_verified`.
Stops cleanly when the cap is reached; leaves a one-paragraph summary on the run and on
`manual_settings.last_run`. `POST /admin/run` runs the same code.

## Frontend (ally-web admin dashboard)

The admin dashboard's page lives in the `pages/Roadmap/manual/` folder of `ally-web`. Carbon + IBM Plex
Serif (`.ally-v2` tokens), framer-motion through the shared motion helpers (always honouring the reduced-motion
preference), SSE through the shared chat-stream reader, and one RTK Query slice (`ApiEndpoints.PRODUCT_MANUAL`,
`TAG_TYPES.PRODUCT_MANUAL*`). The contract above is the only coupling to the backend.

## Files

```
ally-be/src/product-manual/
  entity/                          eight entities
  product-manual.module.ts         core: page writer, search, graph, changes, scrub, budget, state, settings,
                                   import, proposals; reader + admin controllers
  product-manual-agent.module.ts   agents: chat (SSE), conversations, shared loop runner, weekly agent,
                                   scheduler registration, agent keys, MCP, run-now; imports the core module
  controller/  service/  dto/  constants/  util/  type/  test/
ally-be/src/database/migrations/1988500000000-CreateProductManual.ts
```

## Shapes the first draft left open

- `GET /conversations/:id` → `{ id, title, createdAt, updatedAt, messages, drafts }`. A message is
  `{ id, role, text, at, citations?, edits? }` (the body field is `text`); `edits` are
  `{ slug, title, revisionId, reason }`. Activity lines exist only in the live stream and are not stored.
- `ChangeRow.id` is the revision id; `POST /pages/:slug/revert` restores **that** revision's text as a new
  revision (history is never rewritten).
- Search `snippet` is text with `<mark>` markers, HTML-escaped: decode `&amp; &lt; &gt; &quot; &#39;`.

## Rules proven by live testing

These came from running the agents against the real model, not from reading code. Keep them when editing a prompt:

1. **No code access, no unsupported edits.** Without a GitHub token the weekly agent works `edit` and
   `new_page` proposals only; it never queues verification, and a `gap` proposal (a question) stays open.
2. **Evidence rule.** An edit that is not applying a proposal must cite a code file the agent actually read in
   this run or turn. Chat edit tools are not offered at all without code access.
3. **Truth, not polish.** "Needs confirmation:" lines are deliberate open questions; the agents never delete or
   tidy them unless they verified the answer in code. No renaming, retoning or restructuring for taste.
4. Tools that are not configured are not offered; a failing tool call is never retried with the same input.
5. A draft proposed in chat is a card in the tray; nothing reaches the roadmap until the user presses Save.

## Operating it

- **Release order:** ally-be first (migration `1988500000000`), then the admin app. The agent starts **off**; an
  admin turns it on in the manual's settings drawer. For verification work it needs `GITHUB_TOKEN`.
- **Content** is imported, never committed: `POST /v1/product-manual/admin/import` with `{ pages: [...] }`.
- **Coding agents:** create a key in the settings drawer, export `ALLY_PRODUCT_MANUAL_URL` and
  `ALLY_PRODUCT_MANUAL_KEY`, and use the `product-manual` MCP (root `.mcp.json`). Every PR carries one
  `Manual:` line (checked by `.github/workflows/manual-trailer.yml`, no AI).
- **"Ships in next release"** clears with `POST /v1/product-manual/admin/mark-released`; no release workflow
  calls it yet.

Slug rules: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 120. Link rule: `[[slug]]` / `[[slug|label]]`; a link to a
missing slug is allowed on write (the target may be about to exist) but is reported by `GET /pages/:slug`
as absent from `outlinks` and rendered by the frontend as plain text.

## Deviations

Core half (reader, admin, services), as built. Where the contract was silent or a detail had to give:

- **Breadcrumb** is the ancestors only, top-level first; it does not include the page itself (the page's own title is already the heading).
- **Banner** is `null` when the agent is `disabled` (it ships off, so that is a state, not a warning); the only banner is the budget-exhausted one. **`nextRunAt`** is `null` while disabled, otherwise the next Monday 02:00 UTC.
- **Revert** needs the roadmap Idea role or above (a read-only Viewer gets 403); every other reader route needs any role but `none`. Both answer 404 while `roadmap_v2` is off.
- **Errors from `ManualWriteError`**: `not_found` 404, `too_large` 413, `scrubbed` 422, `invalid` / `invalid_slug` 400. `POST /admin/proposals/:id/dismiss` answers 204 (404 when the proposal is not open). `POST /pages/:slug/revert` and the two admin POSTs answer 200.
- **Admin routes** live under `product-manual/admin` (`@Controller({ path: 'product-manual/admin' })`); the agent half may register `run` and `agent-keys` there or on `product-manual`, the URLs are the same.
- **Search headline**: `ts_headline` is given private control-character markers instead of `<mark>`; the fragment is HTML-escaped and only then are the markers turned into `<mark>` / `</mark>`. Output matches the contract (only `<mark>` survives); it cannot be forged by page text.
- **Spend** is every `llm_usage` row with `task LIKE 'product\_manual\_%'` (a superset of `product_manual_chat` and `product_manual_agent`). **Reserved** is the open part of running runs (`reserved_usd - spent_usd`), so spend already in `llm_usage` is not counted twice.
- **`ManualAuthor.revertOf`** (optional) carries the revision a revert copies. A metadata-only write (parent, position, tags) returns `changed: true, revision: null` and does not mark the page "next".
- **Import** is a single pass: `write()` does not need a parent to exist and stores links to missing slugs, so order within a batch does not matter. Express's JSON body limit (1 MB) bounds a real batch well below 200 pages of 200 KB.
- **Settings type**: `ManualSettingsService.get/update` return `ManualSettingsView` (numbers as numbers) from `src/product-manual/type/manual.types.ts`; the entity keeps the name `ManualSettings`. Extras for the agent half: `ManualSettingsService.recordLastRun`, `ManualPageService.markAllReleased`, `ManualStateService.listRuns`, `ManualChangesService.list`.
