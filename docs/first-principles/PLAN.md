# First Principles — plan

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> Replaces the third-party **Stacks** MCP everywhere it is used today.

## 0. The idea in one paragraph

An admin uploads PDF or EPUB books about product, UX, architecture and engineering practice.
The browser parses each book into sections and sends that text to ally-be, which has an LLM
**distil** it into short, punchy, self-contained **principles**: rules, heuristics,
anti-patterns and trade-offs, written in our own words. The book and its text are
**never kept**. Only the principles stay, plus rich metadata and a record of which book
inspired each one. Over time this builds a library that the Builder PRD interview (and the
copilots, and engineers' Claude Code sessions) search many times per session. Every search,
every hit, every principle the interview actually applies, and whether that PRD shipped is
recorded, so retrieval gets measurably better and the library can be pruned using data.

## 1. Decisions already made

| Question | Decision |
|---|---|
| Name | **First Principles** (admin tab: Builder → First Principles; each item is a *principle*) |
| Review gate | **Auto-publish + spot-check.** Principles that pass the quality gate go live at once; borderline ones (low score or possible duplicate) wait in a short review queue |
| Processing | **Background on the server.** The browser parses and uploads all sections, then can close. ally-be distils in the background and deletes each section's text as soon as it is distilled |
| Replace Stacks in | **All four places:** Builder interview (+ research + PRD review), Roadmap Copilot, Course Copilot, engineers' Claude Code (our own MCP endpoint replaces `stacks-bridge.mjs`) |
| Seeding | The owner has the books that seeded Stacks and will upload them once the upload screen (chunk 3) is live |
| Ally house rules | **Books only.** No import of the deprecated `wiki/product/` pages. Hand-adding a principle stays available |
| Distillation model | **Builder's configured model** (same resolution as the interview) |
| Engineer access | **Separate read-only keys** that can only search principles, not the Skills Store keys |

## 2. What exists today (and what we reuse)

| Existing piece | Where | How we use it |
|---|---|---|
| `StacksClientService` (JSON-RPC to Stacks) | `ally-be/src/llm-agent/service/stacks-client.service.ts` | **Deleted** at the end. Its soft-failure messaging ("a failed lookup says nothing about coverage") carries over |
| Builder tools `stacks_search` / `stacks_get` | `builder-interview-tools.service.ts:421`, evidence log, turn receipt, `interviewer_system.txt`, `research_system.txt` | Replaced by `principles_search` / `principles_get` |
| Roadmap + Course Copilot Stacks tools | `roadmap-copilot-tools.service.ts`, `course-copilot-tools.service.ts` | Pointed at the same service |
| Knowledge Base pattern: Postgres is the system of record, the Weaviate index in ally-ai is derived from it, `embeddingStatus` / `textHash` / reconciliation sweep | `ally-be/src/knowledge-base/`, `ally-be/src/product-roadmap/service/roadmap-vector.service.ts`, `ally-ai/app/core/knowledge_base/` | Same pattern for principles. **No pgvector** (the codebase deliberately avoids it) |
| Retrieval logging (`kb_retrievals` + passage rows + judge) | `knowledge-base/entity/kb-retrieval*.ts` | Model for `fp_retrievals` / `fp_retrieval_hits`. Same "measurement, not mitigation" rule and fire-and-forget writes |
| Lesson usage loop (`appliedLessonIds`, `sourceCount`, curator retires unused lessons) | `builder-knowledge.service.ts`, `builder-lesson-curator.service.ts` | Same loop for principles: applied IDs, corroboration count, curator |
| Builder outcomes (did the PRD ship / build pass) | `builder-outcome.service.ts` | Links "principle applied" to "PRD shipped" |
| Skills Store prompts (`.txt` default + typed contract) | `ally-be/docs/adding-a-prompt.md` | New prompts: distiller, consolidator, query planner, PRD principle check |
| Skills Store personal keys | `ally-be/src/prompt/service/skills-store-key.service.ts` | **Pattern only** (hashing, issuing, revoking) for a new read-only principles key; the keys themselves are not reused |
| `@nestjs/schedule` | ally-be | Background distillation worker (no new SQS queue, so no infra-repo change) |
| Server-side PDF/EPUB extractors | `knowledge-base/extractor/` | **Not used.** You asked for parsing in the browser, so the file never leaves the admin's machine. The section heuristics are worth porting to the browser parser |

Gap found: ally-ai's Weaviate client has `near_vector_search` but **no hybrid (BM25 + vector)
search**. Principles are short and keyword-heavy ("empty state", "idempotency key"), so pure
vector search will miss exact terms. We add `hybrid_search`.

## 3. Architecture

```
 Admin browser (ally-admin-dashboard)
   PDF (pdfjs) / EPUB (jszip + DOMParser)
   → clean → split into sections → SHA-256 of file
        │  POST /first-principles/sources            (metadata + hash only)
        │  POST /first-principles/sources/:id/sections (batched section text)
        ▼
 ally-be  ── first-principles module ─────────────────────────────────────────
   fp_ingest_sections (staging: text lives here only until distilled, max 24h)
        │  worker (cron, claims rows with FOR UPDATE SKIP LOCKED, concurrency N)
        ▼
   DISTIL (LLM, Skills Store prompt) → candidate principles
        → quality gate (scores, length, verbatim-overlap check)
        → dedupe vs library (embedding similarity via ally-ai)
        → publish | merge as corroboration | review queue
   section text DELETED
        │  when every section is done: CONSOLIDATE pass per source
        ▼
   fp_principles (system of record) ──upsert──► ally-ai Weaviate `FirstPrinciple`
                                                 (derived index, hybrid search)
   Retrieval API ◄── Builder interview / research / PRD review
                 ◄── Roadmap Copilot, Course Copilot
                 ◄── /mcp endpoint ◄── engineers' Claude Code
   every call → fp_retrievals + fp_retrieval_hits; citations → fp_usage_events
```

## 4. Data model (ally-be Postgres, platform-global, `BaseWithoutTenantEntity`)

All tables are prefixed `fp_`. No document file and no source text is stored outside the
short-lived staging table.

### `fp_sources`: one row per uploaded book
`id`, `title`, `author`, `year` (pre-filled from PDF metadata or EPUB OPF; editable),
`kind` (`pdf` | `epub`), `fileHash` (SHA-256, unique among non-archived rows, so the same
book is never distilled twice), `pageCount`, `sectionCount`, `sectionsDistilled`,
`sectionsFailed`, `status` (`uploading` | `queued` | `distilling` | `consolidating` |
`complete` | `failed` | `archived`), `principlesCreated`, `principlesMerged`,
`principlesQueuedForReview`, `distillModel`, `promptVersion`, `inputTokens`,
`outputTokens`, `costUsd`, `uploadedBy`, timestamps.

### `fp_ingest_sections`: staging, temporary
`id`, `sourceId`, `ordinal`, `sectionPath` (e.g. "Part II › Ch 7 › Empty states"),
`pageFrom`, `pageTo`, `text` (**nulled the moment it is distilled**), `textHash`,
`tokenCount`, `status` (`pending` | `claimed` | `done` | `failed` | `skipped`),
`attempts`, `claimedAt`, `error`, `candidatesFound`. A sweeper nulls any `text` older
than 24h whatever its status. Once text is nulled, only the hash and counts remain.

### `fp_principles`: the library
| Field | Purpose |
|---|---|
| `code` | Stable human handle, `FP-0142`. What the PRD cites, short and readable |
| `statement` | The principle itself, imperative, ≤ 160 chars ("Design the empty state before the full state") |
| `rationale` | Why it holds, ≤ 300 chars |
| `appliesWhen` `text[]` | 1–4 trigger situations ("designing a list view that can have zero items"). **The most important field for retrieval**, because interview queries describe situations |
| `antiPattern` | What breaking it looks like (helps the PRD review spot violations) |
| `kind` | `rule` · `heuristic` · `anti_pattern` · `trade_off` · `checklist_item` |
| `strength` | `must` · `should` · `consider` |
| `domain` | Controlled list: `product_strategy`, `discovery`, `ux_ui`, `interaction`, `content_copy`, `data_viz`, `accessibility`, `architecture`, `backend`, `data`, `ai_llm`, `security_privacy`, `reliability`, `performance`, `testing`, `delivery`, `metrics_analytics`, `growth` |
| `topics` `text[]` | Free-form, normalised (lower-kebab, merged against a synonym table) |
| `keywords` `text[]` | Exact terms for BM25 |
| `prdSections` `text[]` | Where it bites: `problem`, `users`, `goals_metrics`, `scope`, `ux_states`, `requirements`, `architecture`, `data_model`, `api`, `rollout`, `risks`, `testing` |
| `lifecycleStage` | `discovery` · `definition` · `design` · `build` · `launch` · `iterate` |
| `quality` jsonb | LLM self-scores 1–5: specificity, actionability, generality, plus the gate's verdict |
| `status` | `active` · `review` · `archived` · `superseded` (`supersededById`) |
| `origin` | `distilled` · `manual` (Ally house rules added by hand, no source) |
| `sourceCount` | How many distinct books independently produced it (corroboration) |
| `embeddingStatus`, `embeddingAttempts`, `embeddedAt`, `textHash` | Same as Knowledge Base and roadmap |
| usage counters (denormalised, recomputed nightly) | `timesRetrieved`, `timesSurfaced`, `timesRead`, `timesApplied`, `timesHelpful`, `timesUnhelpful`, `timesInShippedPrd`, `lastRetrievedAt`, `lastAppliedAt`, `effectiveness` (see §7) |
| `version`, `createdBy`, `editedBy` | Edits are versioned in `fp_principle_versions` |

### `fp_principle_sources`: many-to-many, the "inspired by" record
`principleId`, `sourceId`, `sectionPath`, `pageFrom`, `pageTo`, `confidence`,
`extractedAt`. Records the location (book, chapter, pages) and never the text.

### `fp_retrievals`: one row per search call
`id`, `consumer` (`builder_interview` · `builder_research` · `builder_prd_review` ·
`builder_auto_brief` · `roadmap_copilot` · `course_copilot` · `mcp_dev` · `admin_preview`),
`sessionId`, `turnIndex`, `query`, `queryOrigin` (`agent_tool` · `auto_planner` ·
`prd_review` · `human`), `filters` jsonb, `alpha`, `limit`, `resultCount`, `topScore`,
`latencyMs`, `failed`, `createdAt`. Stored verbatim, same reasoning as `kb_retrievals`:
reading the zero-hit queries is how you find gaps.

### `fp_retrieval_hits`: one row per returned principle
`retrievalId`, `principleId`, `rank`, `hybridScore`, `vectorScore`, `bm25Score`,
`boostedScore`, `surfaced` (did it make the cut shown to the model?).

### `fp_usage_events`: what happened after retrieval
`principleId`, `sessionId`, `consumer`, `type` (`read` · `applied` · `dismissed` ·
`helpful` · `unhelpful` · `shipped`), `retrievalId?`, `prdVersionId?`, `actorId?`,
`note?`, `createdAt`.

## 5. Ingestion

### 5.1 Browser (ally-admin-dashboard → Builder → First Principles → Library)
1. Admin drops a `.pdf` / `.epub` (multi-file supported, processed one at a time).
2. Hash the file (WebCrypto SHA-256). `POST /sources` with the hash. If it is already
   distilled, say "Already in the library, distilled 3 Oct, 142 principles" and stop.
3. Parse:
   - **PDF** with `pdfjs-dist`. Sections come from `getOutline()` (bookmarks mapped to
     pages). Fallback: font-size heading detection. Last resort: 8-page windows.
     Remove running headers and footers (lines repeated across pages) and page numbers.
     No text layer means a scanned PDF: refuse with a clear message (no OCR in v1).
   - **EPUB** with `jszip` + `DOMParser`: OPF spine for order, `nav.xhtml` / NCX for the
     section tree, strip markup to paragraphs.
   - Skip front and back matter by title (copyright, contents, index, bibliography,
     acknowledgements, about the author).
   - Pack into sections of roughly 2.5–4k tokens on paragraph boundaries, each carrying its
     `sectionPath` and page range.
4. Show a preview: title/author (editable), section list with skip toggles, estimated cost.
   Admin confirms.
5. `POST /sources/:id/sections` in batches (≤ 1 MB each). Then the tab can close.
6. The library page polls source status and shows a progress bar per book.

New ally-web dependencies: `pdfjs-dist`, `jszip` (new, not upgrades).

### 5.2 Background worker (ally-be)
- A `@nestjs/schedule` interval claims `pending` sections with `FOR UPDATE SKIP LOCKED`
  (safe across replicas), with a global concurrency cap (start at 3) and a 3-attempt retry
  with backoff. Postgres is the queue, so no new SQS queue and no infra-repo change.
- **Distil** (Skills Store prompt `first_principles_distiller`, JSON output contract):
  input is the section text, `sectionPath`, book title, and the controlled vocabularies.
  Output is 0–N candidates with every field in §4. Prompt rules: own words only; no quotes;
  no examples tied to the book's anecdotes; one idea per principle; skip filler and
  storytelling; "0 principles" is a valid answer for a narrative section.
- **Quality gate** (deterministic, in code):
  - length limits; required fields; vocab values valid
  - **verbatim check**: reject any candidate sharing an 8-word run with its section
    (guarantees we keep meaning, not text)
  - self-scores: any score < 3 → `review`
- **Dedupe**, by embedding and searching the existing library:
  - similarity ≥ 0.92 → **merge**: no new row, add an `fp_principle_sources` link,
    `sourceCount++`. If the new wording scores higher, keep it as a proposed rewrite in review
  - 0.85–0.92 → `review` flagged "possible duplicate of FP-xxxx"
  - < 0.85 → `active`, then embed and index
  - Thresholds are first guesses. The admin review decisions are logged so they can be tuned
- Null the section `text`. Update source counters.
- **Consolidate** (once per source, after its last section): cluster the source's new
  principles by similarity. An LLM (`first_principles_consolidator`) merges each cluster into
  the sharpest single statement, with the rest marked `superseded`. Then source → `complete`.

### 5.3 Review queue (the spot-check)
Builder → First Principles → Review. Cards show statement, rationale, scores, the reason it
was held, the possible duplicate side by side, and the source chapter. Actions: approve, edit
+ approve, merge into FP-xxxx, reject. Bulk approve. Expect roughly 10–20% of candidates here.

## 6. Retrieval

### 6.1 ally-ai
- New Weaviate collection `FirstPrinciple`. Properties: `principle_id`, `code`, `statement`,
  `applies_when`, `keywords`, `topics`, `domain`, `prd_sections`, `kind`, `strength`,
  `status`. The vector is computed from the text
  `statement + applies_when + keywords` (OpenAI `text-embedding-3-small`, existing client).
- Add `hybrid_search` to `vector_db/weaviate.py` (BM25 + vector, `alpha` parameter,
  filters) and endpoints for bulk upsert, delete, list IDs, and search, mirroring the
  roadmap and knowledge-chunk endpoints. Migration in `app/migrations/`.

### 6.2 ally-be `FirstPrinciplesRetrievalService.search()`
- Input: `queries[]` (fan-out in one call), `filters` (domain, prdSections, kind, strength),
  `limit` (default 8, max 20), `consumer`, `sessionId`, `excludeIds` (already in context).
- Run the queries in parallel, merge with **reciprocal rank fusion**, apply a small
  **bounded** prior: `boosted = rrf × (0.9 + 0.1·effectiveness + 0.05·min(sourceCount-1, 2))`.
  The prior can reorder near-ties but never pull an off-topic principle above a relevant
  one. Raw and boosted scores are both logged, so the boost can be audited or turned off.
- Exploration: one of every 8 surfaced slots goes to a relevant principle with fewer than
  5 surfacings, so new principles get a chance (no rich-get-richer lock-in).
- Log `fp_retrievals` + `fp_retrieval_hits` fire-and-forget.
- Soft failure: same message discipline as the Stacks client ("retrieval failed, which says
  nothing about what the library holds, so continue").

## 7. Using it in the Builder interview

### 7.1 Tools (replace `stacks_search` / `stacks_get`)
- `principles_search({ queries: string[], domain?, prdSection?, limit? })` returns compact
  hits: `code`, `statement`, `appliesWhen`, `domain`, `strength`. Several sharp queries per
  call are encouraged.
- `principles_get({ codes })` returns the full principle: rationale, anti-pattern, related
  principles, "inspired by *Book*, ch. 7". Logged as `read`.
- Evidence log, turn receipt ("Consulted 6 principles · applied FP-0142, FP-0311") and the
  prompts (`interviewer_system.txt`, `research_system.txt`) are updated to match.

### 7.2 Proactive retrieval (the "keeps running multiple queries" part)
The agent does not have to remember to search:
1. **Session start: guidance brief.** A query-planner prompt
   (`first_principles_query_planner`) turns the rough idea into 8–12 situational queries,
   one or more per PRD dimension (problem, users, scope/MVP, UX states, metrics,
   architecture, data, security/privacy, rollout, testing). Fan out, then put the top ~15 in
   a **Guiding principles** block in the cached context prefix (next to the repo knowledge
   packs, so prompt caching still works).
2. **Each turn: section focus.** When the orchestrator sees which PRD section is being
   worked on (it already tracks readiness per section), it runs 2–3 queries for that section,
   excluding principles already in context, and adds any new ones to that turn's context.
3. **Before sign-off: PRD principle check.** `builder-prd-review.service` gets a new pass
   that retrieves principles for each section of the draft and asks the reviewer prompt
   which ones the draft **violates or ignores** (using `antiPattern`). These show up as review
   findings ("Scope has no empty state. FP-0142: design the empty state first"), so the admin
   is guided toward a complete PRD.

### 7.3 Tracking what was actually used
- **Applied:** the PRD cites principles inline as `[FP-0142]`. On every PRD version save we
  parse citations and record an `applied` event for each code that is new to this session.
  The citation in the document is the source of truth, because it is checkable.
- **Dismissed:** surfaced in context but never read or cited by session end.
- **Helpful / unhelpful:** thumbs on each principle chip in the turn receipt and PRD panel.
- **Shipped:** when `builder-outcome` records a merged build for the session, every principle
  applied in it gets a `shipped` event.
- **Effectiveness** (nightly job, Bayesian-smoothed so a principle seen twice can't score 1.0):
  `applyRate = (applied + 1) / (surfaced + 5)`,
  `feedback = (helpful + 1) / (helpful + unhelpful + 2)`,
  `effectiveness = 0.6·applyRate_norm + 0.25·feedback + 0.15·shippedRate_norm`.

## 8. Other consumers

- **Roadmap Copilot**: swap its `stacks_*` tools for the same two tools (`consumer =
  roadmap_copilot`).
- **Course Copilot**: same swap. Note: it currently asks for *instructional-design*
  guidance; that only works once instructional-design books are uploaded. Add a domain
  `instructional_design` and have its tool filter to it by default.
- **Engineers' Claude Code**:
  - ally-be exposes `POST /first-principles/mcp`: JSON-RPC `tools/list` + `tools/call`
    for `search_principles`, `get_principles`, `list_domains`, plus a `planning_context`
    prompt, matching the four Stacks surfaces so habits carry over.
  - Auth: a **separate read-only personal key** (`fp_reader_keys`: hashed, owner, label,
    `lastUsedAt`, `revokedAt`) that can only call the search tools, sent as
    `Authorization: Bearer`. Engineers create one from Builder → First Principles → Access;
    the issue/revoke flow copies the Skills Store key service's pattern.
  - Each repo's `.mcp.json` points at it (HTTP transport, key from env). Then delete
    `stacks-bridge.mjs` and the `.claude/skills/stacks` skill (replaced by a
    `first-principles` skill). Update every `CLAUDE.md` / `AGENTS.md` and rewrite
    `wiki/contributing/planning-with-stacks.md` as `planning-with-first-principles.md`.
  - Retrievals log with `consumer = mcp_dev`, so dev usage shows in the same analytics.

## 9. Admin UI (Builder → First Principles)

| Tab | Contents |
|---|---|
| **Library** | Upload zone; sources table with progress, counts and cost; principle browser with search box (runs the real retrieval as `admin_preview`, showing scores), filters by domain / kind / strength / source / status, and edit / archive / add manual principle |
| **Review** | The spot-check queue (§5.3) |
| **Access** | Engineers create and revoke their read-only keys for the MCP endpoint (§8) |
| **Insights** | Library size by domain; top applied; **never surfaced** (dead weight or bad keywords); **surfaced often, never applied** (noisy, rewrite or archive); **zero/low-score queries** (what to upload next); per-source yield vs usefulness ("this book gave 140 principles, 3 ever applied"); usage by consumer over time |

Turn receipts and the PRD panel get principle chips (code + statement on hover + thumbs).

Feature toggle: reuse `BUILDER`, or add `BUILDER_FIRST_PRINCIPLES` if you want to roll it out
separately.

## 10. Build order (chunks; each one ships and is tested on its own)

| # | Chunk | Done when |
|---|---|---|
| 1 | **Data model + ally-ai index**: migrations for `fp_*`; `FirstPrinciple` collection; `hybrid_search`; upsert/search endpoints; manual-add principle API | A manually added principle is searchable via hybrid search, tests green in both repos |
| 2 | **Server ingestion**: sources/sections API, staging table, worker, distiller prompt, quality gate, verbatim check, dedupe, consolidation, 24h sweeper | Posting the sections of a real book produces principles; staging text is null afterwards |
| 3 | **Browser parser + Library/Review UI**: pdf/epub parsing, preview, batched upload, progress, principle browser, review queue | Admin uploads a PDF and an EPUB end to end |
| 4 | **Builder swap**: retrieval service + logging, `principles_*` tools, prompts, receipts, citation parsing → `applied` events | An interview cites `[FP-…]` and the events are recorded; Stacks is no longer called by Builder |
| 5 | **Proactive retrieval**: query planner brief, per-section queries, PRD principle check in review | A rough idea produces a guiding-principles block and review findings |
| 6 | **Feedback + Insights**: thumbs, shipped linkage, nightly effectiveness, bounded boost, exploration, Insights tab | Insights tab shows real numbers |
| 7 | **Copilots + MCP + Stacks removal**: Roadmap/Course Copilot swap, read-only keys + Access tab, `/mcp` endpoint, `.mcp.json` in every repo, delete `StacksClientService` + bridge + skill + `STACKS_*` config, docs/wiki rewrite | `grep -ri stacks` finds only history notes |

Chunks 1–4 make it usable; 5–6 make it good; 7 finishes the cutover. Stacks stays wired
for engineers until chunk 7, so nobody loses guidance while the library fills up.

## 11. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Copyright: keeping the book's text | Browser parses locally; text lives only in staging until distilled (24h hard cap); the 8-word verbatim check rejects copied phrasing; we store location metadata, never passages |
| Bland, generic principles ("Know your users") | Distiller prompt demands specificity + `appliesWhen`; specificity score < 3 goes to review; Insights flags "surfaced, never applied" |
| Library bloat from overlapping books | Similarity merge → corroboration instead of duplicates; consolidation pass per book |
| Feedback loop locks in early favourites | Bounded boost (max ±10%), exploration slot, raw scores logged |
| Agent claims "the library has nothing on X" | Same tool-message discipline Stacks used; zero-hit queries logged for the Insights gap list |
| Long book, worker crash midway | Per-section rows with retry/attempts; the source shows "38/42 sections, 1 failed, retry" |
| Cost | Estimate shown before confirm; tokens + cost recorded per source; concurrency cap |

## 12. Open questions

None. All four earlier questions were answered on 2026-11-09 and are recorded in §1.
