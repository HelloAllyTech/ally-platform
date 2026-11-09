# First Principles — plan (revision 2)

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> Replaces the third-party **Stacks** MCP everywhere it is used today.

## What changed in revision 2

| Gap in revision 1 | Fix |
|---|---|
| Nothing proved the feature makes PRDs better, and "applied" was whatever the agent chose to cite, so the effectiveness score rewarded citing, not helping | **§3 Success measures**: a retrieval benchmark, a distillation yield report, and Builder's existing *replay eval* run with principles on vs off. Citations are now **verified** before they count (§8.4) |
| Staging text sat in Postgres, so nightly **database backups would keep the document text** | Staging text moves to **Redis with a 24h TTL**. Postgres holds only hashes and counts (§6.2) |
| Text is deleted after distilling, so a better prompt can never re-process old documents, and the plan didn't say so | **Re-distil by re-upload**, which merges into existing principles and keeps their codes and history (§6.6) |
| The plan guided the agent, not the admin | Every principle carries a **probe question** the interviewer asks you. Conflicting principles become **trade-off decision cards** (reusing Builder's `DecisionCard`). The PRD panel shows **principle coverage per section** (§8) |
| One blended vector, no re-ranking, no relevance floor, no cap on how much lands in context | **Two vectors** (statement and situations), an **optional re-rank** kept only if the benchmark says it helps, relevance bands instead of raw scores, and a **context budget** (§7, §8.2) |
| The LLM graded its own output, nothing stopped platitudes, no per-document cap, document text could inject instructions | Separate **critic pass**, **platitude anchors**, **density cap**, **injection screening** (§6.4) |
| Each section was distilled with no idea what the whole document is about | A **document overview pass** runs first and is the cached prefix for every section call (§6.3) |
| The proactive brief would go live untested | **Shadow mode** first; on by default only after the replay eval passes (§10, chunks 4–5) |

## 0. The idea in one paragraph

An admin uploads PDF or EPUB documentation about product, UX, architecture and engineering
practice. The browser parses each document into sections. ally-be first works out what the
whole document covers,
then has an LLM **distil** each section into short, punchy, self-contained **principles**
(rules, heuristics, anti-patterns and trade-offs) in our own words, each with the situations
it applies to and a question that tests whether a PRD honours it. The document and its text
are **never kept**: they live in memory for at most a day and are not written to the database.
Over time this builds a library that the Builder PRD interview searches many times per
session, turning principles into questions for the admin and checks on the draft. The
copilots and engineers' Claude Code search it too. Every search, every hit, every principle
actually used (verified, not just cited), and whether that PRD shipped is recorded, so
retrieval gets measurably better and the library can be pruned using data.

## 1. Decisions already made

| Question | Decision |
|---|---|
| Name | **First Principles** (admin tab: Builder → First Principles; each item is a *principle*) |
| Review gate | **Auto-publish + spot-check.** Principles that pass the quality gate go live at once; borderline ones wait in a short review queue |
| Processing | **Background on the server.** The browser parses and uploads all sections, then can close. ally-be distils in the background |
| Replace Stacks in | **All four places:** Builder interview (+ research + PRD review), Roadmap Copilot, Course Copilot, engineers' Claude Code (our own MCP endpoint replaces `stacks-bridge.mjs`) |
| Seeding | The owner has the documents that seeded Stacks and will upload them once the upload screen (chunk 3) is live |
| Ally house rules | **Uploaded documents only.** No import of the deprecated `wiki/product/` pages. Hand-adding a principle stays available |
| Distillation model | **Builder's configured model** (same resolution as the interview) |
| Engineer access | **Separate read-only keys** that can only search principles, not the Skills Store keys |
| What gets uploaded | **Documentation** (PDF, EPUB) of any length, from a short guide to a long manual |
| Naming | Code, schema, prompts, UI copy and code documentation say **document** (or **source** for the database record) for an upload, and no other term |

## 2. What exists today (and what we reuse)

| Existing piece | Where | How we use it |
|---|---|---|
| `StacksClientService` (JSON-RPC to Stacks) | `ally-be/src/llm-agent/service/stacks-client.service.ts` | **Deleted** at the end. Its soft-failure messaging ("a failed lookup says nothing about coverage") carries over. Note: per its own header, Builder has never reached Stacks in production, so the Builder swap has nothing to regress |
| Builder tools `stacks_search` / `stacks_get` | `ally-be/src/builder/service/builder-interview-tools.service.ts`, evidence log, turn receipt, `interviewer_system.txt`, `research_system.txt` | Replaced by `principles_search` / `principles_get` |
| Roadmap + Course Copilot Stacks tools | `ally-be/src/product-roadmap/service/roadmap-copilot-tools.service.ts`, `ally-be/src/course-copilot/service/course-copilot-tools.service.ts` | Pointed at the same service |
| Knowledge Base pattern: Postgres is the system of record, the Weaviate index in ally-ai is derived from it, `embeddingStatus` / `textHash` / reconciliation sweep | `ally-be/src/knowledge-base/`, `ally-be/src/product-roadmap/service/roadmap-vector.service.ts`, `ally-ai/app/core/knowledge_base/` | Same pattern for principles. **No pgvector** (the codebase deliberately avoids it) |
| Retrieval logging + LLM relevance judge (`kb_retrievals`, passages, passage judgments) | `ally-be/src/knowledge-base/entity/` | Model for `fp_retrievals` / `fp_retrieval_hits` / `fp_hit_judgments`. Same "measurement, not mitigation" rule and fire-and-forget writes |
| **Builder replay eval** (recorded interviews + human-written checklists, run N times with overrides; `prompt_gate` suites decide whether a prompt change goes live) | `ally-be/src/builder/eval/`, `builder-eval-*.entity.ts` | **The success measure.** Run the same fixtures with principles off vs on (an override), and gate every First Principles prompt change through it |
| **Decision cards** | `ally-be/src/builder/service/builder-decision.service.ts`, `ally-web/apps/ally-admin-dashboard/src/components/builder/DecisionCard.tsx` | Trade-off cards when two applicable principles pull in different directions |
| PRD review | `ally-be/src/builder/service/builder-prd-review.service.ts`, `PrdReviewFindings.tsx` | Gains a principle check pass |
| Lesson usage loop (`appliedLessonIds`, `sourceCount`, curator retires unused lessons) | `builder-knowledge.service.ts`, `builder-lesson-curator.service.ts` | Same loop for principles |
| Builder outcomes (did the PRD ship / build pass) | `builder-outcome.service.ts` | Links "principle applied" to "PRD shipped" |
| Skills Store prompts (`.txt` default + typed contract) | `ally-be/docs/adding-a-prompt.md` | New prompts: overview, distiller, critic, consolidator, query planner, re-ranker, citation verifier, PRD principle check |
| Skills Store personal keys | `ally-be/src/prompt/service/skills-store-key.service.ts` | **Pattern only** (hashing, issuing, revoking) for the new read-only principles key |
| Redis | ally-be (already used for caching, pub/sub, rate limits) | Short-lived staging of section text, with a TTL |
| `@nestjs/schedule` | ally-be | Background distillation worker (no new SQS queue, so no infra-repo change) |
| Server-side PDF/EPUB extractors | `ally-be/src/knowledge-base/extractor/` | **Not used** (parsing happens in the browser so the file never leaves the admin's machine). Their section heuristics are worth porting |

Gaps found in ally-ai: the Weaviate client has `near_vector_search` but **no hybrid (BM25 +
vector) search** and no named vectors. Weaviate 1.28 (the local image) supports both;
**chunk 1 confirms the production server version** before relying on named vectors.

## 3. Success measures (new): how we know it works

Three measurements, built before the features they judge. Every threshold below is a first
guess to be revised once real numbers exist.

| Measure | What it answers | How | Bar to clear |
|---|---|---|---|
| **Retrieval benchmark** | Does a situation-style query find the right principles? | A golden set of ~60 situation queries, each with its labelled relevant principles. Built from thumbs on the admin preview search (chunk 3) plus judged production hits (chunk 6). Metrics: precision@8, recall@20, nDCG@8 | Precision@8 ≥ 0.6 before the proactive brief is on by default. Every retrieval change (alpha, vectors, re-rank, boosts) must not lower nDCG |
| **Distillation yield report** | Is a document producing sharp principles or noise? | Per source: candidates → kept / merged / reviewed / rejected (with reasons: verbatim, platitude, injection, critic), review rate, plus a 20-principle random sample the admin rates 1–5 | Review rate ≤ 20%; mean sample rating ≥ 3.5; platitude rate falling across prompt versions |
| **PRD outcome (replay eval)** | Do PRDs actually get better? | Builder's replay eval: the same fixtures with First Principles off vs on, scored against their human-written checklists, plus the PRD review's finding count | The proactive brief and probes only go on by default if checklist pass rate improves and no fixture regresses. Every First Principles prompt change goes through a `prompt_gate` suite |

Traffic from `admin_preview` and eval runs is tagged and **excluded** from usage stats and
effectiveness, so tuning and testing don't skew the numbers.

## 4. Architecture

```
 Admin browser (ally-admin-dashboard)
   PDF (pdfjs) / EPUB (jszip + DOMParser)
   → clean → split into sections → SHA-256 of file
        │  POST /first-principles/sources             (metadata + hash, no text)
        │  POST /first-principles/sources/:id/sections (batched section text)
        ▼
 ally-be  ── first-principles module ─────────────────────────────────────────
   Redis  fp:section:{id}  (section text, TTL 24h, deleted once distilled)
   Postgres fp_ingest_sections (status, hash, counts; never text)
        │  worker (cron, claims rows with FOR UPDATE SKIP LOCKED, concurrency N)
        ▼
   OVERVIEW (once per document: outline + opening + closing sections → overview + vocabulary)
   DISTIL each section, with the overview as a cached prefix → candidates
     → deterministic gate (length, vocab, verbatim, injection)
     → platitude check + CRITIC pass (separate prompt)
     → dedupe vs library: merge as corroboration | review | publish
   CONSOLIDATE per document: cluster, sharpen, keep best ≤ cap, detect tensions
        ▼
   fp_principles (system of record) ──upsert──► ally-ai Weaviate `FirstPrinciple`
                                                 (vectors: statement, situations; hybrid)
   Retrieval: queries → hybrid (both vectors) → RRF → [re-rank] → bands → bounded prior
        ◄── Builder interview / research / PRD review / brief
        ◄── Roadmap Copilot, Course Copilot
        ◄── /mcp endpoint ◄── engineers' Claude Code
   logs: fp_retrievals, fp_retrieval_hits; citations → verifier → fp_usage_events
```

## 5. Data model (ally-be Postgres, platform-global, `BaseWithoutTenantEntity`)

All tables are prefixed `fp_`. **No document file and no source text is stored in
Postgres**, so none of it can reach a database backup.

### `fp_sources`: one row per uploaded document
`id`, `title`, `publisher` (organisation or author), `docVersion`, `year` (pre-filled from
PDF metadata or EPUB OPF; all editable), `kind` (`pdf` | `epub`), `fileHash` (SHA-256),
`titleKey` (normalised title + publisher, to catch the same document uploaded as both PDF
and EPUB), `overview` (≤ 150 words, our own summary of what the document covers and argues,
used as context and shown in the UI), `pageCount`,
`sectionCount`, `sectionsDistilled`, `sectionsFailed`, `status` (`uploading` | `queued` |
`distilling` | `consolidating` | `complete` | `failed` | `archived`), `yield` jsonb (the §3
yield report), `distillModel`, `promptVersions` jsonb, `inputTokens`, `outputTokens`,
`cachedInputTokens`, `costUsd`, `costCapUsd`, `generation` (1 for the first distil, +1 per
re-distil), `uploadedBy`, timestamps.

### `fp_ingest_sections`: progress tracking (no text)
`id`, `sourceId`, `ordinal`, `sectionPath` (e.g. "Part II › Ch 7 › Empty states"),
`pageFrom`, `pageTo`, `textHash`, `tokenCount`, `status` (`pending` | `claimed` | `done` |
`failed` | `skipped` | `expired`), `attempts`, `claimedAt`, `error`, `candidatesFound`,
`candidatesKept`. The text itself is in Redis (§6.2).

### `fp_principles`: the library
| Field | Purpose |
|---|---|
| `code` | Stable human handle, `FP-0142`. What the PRD cites. Never reused |
| `statement` | The principle itself, imperative, ≤ 160 chars ("Design the empty state before the full state") |
| `rationale` | Why it holds, ≤ 300 chars |
| `appliesWhen` `text[]` | 1–4 trigger situations ("designing a list view that can have zero items"). Embedded as their own vector, because interview queries describe situations |
| `probe` | **New.** One question an interviewer can ask to test whether a PRD honours it ("What does a brand-new user see before they have any items?"). This is how a principle reaches the admin |
| `antiPattern` | What breaking it looks like (used by the PRD principle check) |
| `kind` | `rule` · `heuristic` · `anti_pattern` · `trade_off` · `checklist_item` |
| `strength` | `must` · `should` · `consider` |
| `domain` | Controlled list: `product_strategy`, `discovery`, `ux_ui`, `interaction`, `content_copy`, `data_viz`, `accessibility`, `architecture`, `backend`, `data`, `ai_llm`, `security_privacy`, `reliability`, `performance`, `testing`, `delivery`, `metrics_analytics`, `growth`, `instructional_design` |
| `topics` `text[]` | Free-form, normalised (lower-kebab, merged against a synonym table) |
| `keywords` `text[]` | Exact terms for BM25 |
| `prdSections` `text[]` | Where it bites: `problem`, `users`, `goals_metrics`, `scope`, `ux_states`, `requirements`, `architecture`, `data_model`, `api`, `rollout`, `risks`, `testing` |
| `lifecycleStage` | `discovery` · `definition` · `design` · `build` · `launch` · `iterate` |
| `quality` jsonb | The **critic's** scores 1–5 (specificity, actionability, standalone clarity), platitude similarity, and the gate's verdict and reasons |
| `status` | `active` · `review` · `archived` · `superseded` (`supersededById`: old codes **redirect** to the successor, so citations in past PRDs still resolve) |
| `origin` | `distilled` · `manual` |
| `sourceCount` | How many distinct documents independently produced it (corroboration) |
| `embeddingStatus`, `embeddingAttempts`, `embeddedAt`, `textHash` | Same as Knowledge Base and roadmap. An edit changes `textHash`, which re-embeds |
| usage counters (denormalised, recomputed nightly, eval + preview traffic excluded) | `timesRetrieved`, `timesSurfaced`, `timesRead`, `timesProbed`, `timesAppliedVerified`, `timesHelpful`, `timesUnhelpful`, `timesInShippedPrd`, `lastRetrievedAt`, `lastAppliedAt`, `effectiveness` (§8.4) |
| `version`, `createdBy`, `editedBy` | Edits are versioned in `fp_principle_versions` |

### `fp_principle_sources`: many-to-many, the "inspired by" record
`principleId`, `sourceId`, `generation`, `sectionPath`, `pageFrom`, `pageTo`, `confidence`,
`extractedAt`. Records the location (document, section, pages) and never the text.

### `fp_principle_relations` (new): how principles relate
`fromId`, `toId`, `type` (`tension` · `refines` · `prerequisite` · `related`), `note`
(one line: what the trade-off is), `origin` (`consolidation` · `curator` · `admin`),
`confidence`. Tensions drive the trade-off decision cards (§8.3).

### `fp_retrievals`: one row per search call
`id`, `consumer` (`builder_interview` · `builder_research` · `builder_prd_review` ·
`builder_brief` · `roadmap_copilot` · `course_copilot` · `mcp_dev` · `admin_preview` ·
`eval`), `sessionId`, `turnIndex`, `query`, `queryOrigin` (`agent_tool` · `planner` ·
`section_focus` · `prd_review` · `human`), `filters` jsonb, `pipeline` jsonb (alpha,
vectors, rerank on/off: so the benchmark can compare configurations), `limit`,
`resultCount`, `topBand`, `latencyMs`, `failed`, `shadow` (logged but not shown to the
model), `createdAt`. Queries are stored verbatim: reading the zero-hit ones is how you find
gaps.

### `fp_retrieval_hits`: one row per returned principle
`retrievalId`, `principleId`, `rank`, `bm25Score`, `statementVectorScore`,
`situationVectorScore`, `rrfScore`, `rerankScore`, `band` (`high` · `medium` · `low`),
`boostedScore`, `surfaced`, `explorationSlot`.

### `fp_hit_judgments`: sampled relevance labels (benchmark + floor calibration)
`hitId`, `relevant` (`yes` · `partial` · `no`), `judge` (`llm` · `admin`), `judgeModel`,
`reason`, `createdAt`. Same shape and purpose as `kb_retrieval_passage_judgments`.

### `fp_usage_events`: what happened after retrieval
`principleId`, `sessionId`, `consumer`, `type` (`read` · `probed` · `cited` ·
`applied_verified` · `cite_rejected` · `dismissed` · `helpful` · `unhelpful` · `shipped`),
`retrievalId?`, `prdVersionId?`, `actorId?`, `note?`, `createdAt`.

### `fp_reader_keys`: engineers' read-only MCP keys
`id`, `ownerId`, `label`, `keyHash`, `lastUsedAt`, `revokedAt`, `createdAt` (§9).

## 6. Ingestion

### 6.1 Browser (ally-admin-dashboard → Builder → First Principles → Library)
1. Admin drops a `.pdf` / `.epub` (multi-file supported, processed one at a time).
2. Hash the file (WebCrypto SHA-256). `POST /sources` with the hash, title and publisher.
   - Same hash already distilled → "Already in the library (distilled 3 Oct, 64 principles).
     Re-distil with the current prompts?" (§6.6)
   - Same `titleKey`, different hash (e.g. the EPUB of a document already uploaded as PDF) →
     warn before going ahead.
3. Parse:
   - **PDF** with `pdfjs-dist`. Sections come from `getOutline()` (outline entries mapped
     to pages). Fallback: font-size heading detection. Last resort: 8-page windows. Remove
     running headers and footers (lines repeated across pages) and page numbers. No text
     layer means a scanned PDF: refuse with a clear message (no OCR in v1).
   - **EPUB** with `jszip` + `DOMParser`: OPF spine for order, `nav.xhtml` / NCX for the
     section tree, strip markup to paragraphs.
   - Default-skip boilerplate sections by title (table of contents, index, legal or licence
     notices, copyright, revision history). Each can be re-enabled in the preview.
   - Pack into sections of roughly 2.5–4k tokens on paragraph boundaries, each carrying its
     `sectionPath` and page range. Mark the opening sections (introduction, overview, summary) and the closing ones for the
     overview pass.
4. Preview: title, publisher and version (editable), section tree with skip toggles, **cost estimate and a
   cost cap** (default 1.5× the estimate). Admin confirms.
5. `POST /sources/:id/sections` in batches (≤ 1 MB each). The tab can then close.
6. The library page polls source status: a progress bar per document, then its yield report.

New ally-web dependencies: `pdfjs-dist`, `jszip` (new, not upgrades).

### 6.2 Staging without retention
- Section text goes to **Redis** under `fp:section:{id}` with a **24h TTL**, and is deleted
  the moment that section is distilled. Postgres only ever sees `textHash`, counts and status.
- If a key expires before it is distilled (worker down for a day), the section becomes
  `expired` and the UI asks for the file to be dropped again. The hash check means only the
  missing sections are re-sent.
- Chunk 2 checks Redis persistence settings. A snapshot taken during the window can hold
  text until the next snapshot overwrites it, which is acceptable and short-lived. Postgres
  backups, which are kept for much longer, never see it.

### 6.3 Background worker (ally-be)
- A `@nestjs/schedule` interval claims `pending` sections with `FOR UPDATE SKIP LOCKED`
  (safe across replicas), with a global concurrency cap (start at 3) and a 3-attempt retry
  with backoff. Postgres is the queue, so no new SQS queue and no infra-repo change.
- **Overview pass, once per document** (`first_principles_overview`): the section tree plus
  the opening and closing sections produce a ≤ 150-word overview, the document's key terms,
  and which sections look like reference material, narrative or filler. Without this, each
  section is distilled blind and generic principles repeat across sections. A document of
  only one or two sections skips this pass.
- **Distil each section** (`first_principles_distiller`, JSON output contract). Prefix:
  rules + controlled vocabularies + document overview, the same for every section of a
  document, so
  **Anthropic prompt caching** makes calls after the first much cheaper. Then the section
  text and `sectionPath`. Output: **0–4** candidates with every §5 field, including `probe`.
  Rules: own words only; no quotes; no examples or case studies lifted from the document; one idea
  per principle; prefer the specific and surprising over the obvious; "0 principles" is a
  valid answer.
- Stop the document if `costUsd` reaches `costCapUsd`; the admin can raise the cap and resume.

### 6.4 Quality gate
In order, cheapest first:
1. **Deterministic**: length limits, required fields, valid vocabulary values.
2. **Verbatim check**: reject any candidate sharing an 8-word run with its section. This
   guarantees we keep meaning, not text.
3. **Injection screen**: reject candidates that address an AI or carry instructions or
   payloads ("ignore previous", "system prompt", URLs, code, tool names). Uploaded
   documents are untrusted input, and these principles end up in Builder's and engineers' agents. The
   distiller prompt also treats section text strictly as data.
4. **Platitude check**: embedding similarity against a maintained list of platitude anchors
   ("know your users", "keep it simple", "communicate with stakeholders"). Similarity ≥ 0.85
   → reject. The list grows from review rejections.
5. **Critic pass** (`first_principles_critic`, a separate prompt, batched per section): scores
   specificity, actionability and standalone clarity. LLMs grade their own output generously,
   so the distiller no longer self-scores. Any score < 3 → `review`.
6. **Dedupe** against the library (same embedding call):
   - similarity ≥ 0.92 → **merge**: no new row, add an `fp_principle_sources` link,
     `sourceCount++`. If the new wording scores higher, it becomes a proposed rewrite in review
   - 0.85–0.92 → `review`, flagged "possible duplicate of FP-xxxx"
   - < 0.85 → `active`, then embed both vectors and index
   - The admin's review decisions are logged so these thresholds can be tuned from data

Section text is deleted from Redis after step 6. Every rejection is counted by reason in the
source's yield report.

### 6.5 Consolidation (once per document, after its last section)
`first_principles_consolidator` over the document's new principles:
- Cluster by similarity and merge each cluster into its sharpest statement; the rest become
  `superseded` (their codes redirect).
- **Density cap**, scaled to the document: keep the best principles up to roughly 1 per 2
  sections (at least 3, at most 80), ranked by critic score and distinctiveness. A short
  guide yields a handful; a long manual yields dozens. The rest are archived with reason
  `over_cap`, so they stay recoverable. "The absolute core best practices", not everything
  the document says.
- **Tension detection**: compare kept principles against their nearest library neighbours
  and record `tension` / `refines` relations with a one-line note.
- Source → `complete`; the yield report is finalised.

### 6.6 Re-distilling and archiving
- The text is gone after distillation, so **the only way to apply a better prompt to an old
  document is to drop the file again.** That is accepted, and the UI says so plainly.
- Re-distil runs the same pipeline as `generation + 1`, but dedupe treats that source's
  existing principles as merge targets: matching principles keep their **code and usage
  history** and take the better wording; new ones are added; principles the new generation
  no longer produces are flagged in review rather than deleted.
- Archiving a source archives principles whose **only** source it is, and decrements
  `sourceCount` on the rest.

### 6.7 Review queue (the spot-check)
Builder → First Principles → Review. Cards show the statement, rationale, probe, critic
scores, why it was held, the possible duplicate side by side, and the source section.
Actions: approve, edit + approve, merge into FP-xxxx, reject (optionally "reject as
platitude", which adds it to the anchors). Bulk approve. Target ≤ 20% of candidates here.

## 7. Retrieval

### 7.1 ally-ai
- New Weaviate collection `FirstPrinciple` with **two named vectors**:
  - `statement`: `statement + rationale`
  - `situations`: `appliesWhen + probe`, which matches how interview queries are phrased

  Properties: `principle_id`, `code`, `statement`, `applies_when`, `probe`, `keywords`,
  `topics`, `domain`, `prd_sections`, `kind`, `strength`, `status`. Embeddings use OpenAI
  `text-embedding-3-small` (the existing client).
- Add `hybrid_search` to `vector_db/weaviate.py` (BM25 over statement, keywords and
  applies_when, plus both named vectors; `alpha`; filters). Add endpoints for bulk upsert,
  delete, list IDs, search and embed-only (for dedupe and platitude checks), mirroring the
  roadmap and knowledge-chunk endpoints. Migration in `app/migrations/`.
- If production Weaviate predates named vectors, fall back to one vector over
  `statement + appliesWhen + probe`. The benchmark will show what that costs.

### 7.2 ally-be `FirstPrinciplesRetrievalService.search()`
1. Input: `queries[]` (fan-out in one call), `filters` (domain, prdSections, kind, strength),
   `limit` (default 8, max 20), `consumer`, `sessionId`, `excludeCodes` (already in context),
   `shadow`.
2. Run the queries in parallel (hybrid over both vectors), merge with **reciprocal rank
   fusion**, take the top 30.
3. **Optional re-rank** (`first_principles_reranker`, one call per search with all queries,
   using a small model): labels each candidate `high` / `medium` / `low` for this situation.
   Off by default, and turned on only if it raises the benchmark's nDCG by a margin worth its
   latency.
4. **Relevance bands** instead of raw scores: from the re-ranker when it is on, otherwise
   from RRF thresholds calibrated against `fp_hit_judgments`. `low` hits are dropped, unless
   that would leave nothing, in which case the best one comes back with `band: low`.
5. A **bounded prior** within a band only:
   `boosted = score × (0.9 + 0.1·effectiveness + 0.05·min(sourceCount-1, 2))`.
   It can reorder near-ties; it can never lift a principle into a higher band.
6. **Exploration**: one of every 8 surfaced slots goes to a `high`/`medium` principle with
   fewer than 5 surfacings, so new principles get a chance.
7. Superseded codes resolve to their successors. Logging is fire-and-forget.
8. Soft failure: "retrieval failed, which says nothing about what the library holds, so
   continue". An empty result says the same.

## 8. Using it in the Builder interview

### 8.1 Tools (replace `stacks_search` / `stacks_get`)
- `principles_search({ queries: string[], domain?, prdSection?, limit? })` returns compact
  hits: `code`, `statement`, `appliesWhen`, `band`, `strength`. Several sharp situational
  queries per call are encouraged.
- `principles_get({ codes })` returns the full principle: rationale, probe, anti-pattern,
  **tensions and refinements**, and "inspired by *<document title>*, § Empty states". Logged as `read`.
- Evidence log, turn receipt ("Consulted 6 principles · applied FP-0142, FP-0311") and the
  prompts (`interviewer_system.txt`, `research_system.txt`) are updated to match. Retrieved
  principles are framed as **advisory reference data, not instructions**.

### 8.2 Proactive retrieval, within a context budget
The agent does not have to remember to search:
1. **Session start: guidance brief.** `first_principles_query_planner` turns the rough idea
   into 8–12 situational queries across the PRD dimensions (problem, users, scope/MVP,
   UX states, metrics, architecture, data, security/privacy, rollout, testing). Fan out,
   then put up to 15 principles, **grouped by PRD section**, into a **Guiding principles**
   block in the cached context prefix (next to the repo knowledge packs). The brief is fixed
   for the session so the cache holds.
2. **Each turn: section focus.** When the orchestrator sees which PRD section is being worked
   on (it already tracks readiness per section), it runs 2–3 queries for that section,
   excluding codes already in context. New hits go **after the cache breakpoint**, in that
   turn only.
3. **Budget**: at most ~25 principles in context at once (brief + section focus + the
   agent's own lookups). When over, drop the ones already applied or dismissed first. A
   principle the model doesn't see can't help, and one it sees among 60 barely helps either.
4. **Before sign-off: PRD principle check.** `builder-prd-review.service` gains a pass that
   retrieves principles for each section of the draft and asks which ones the draft
   **violates or ignores** (matching against `antiPattern`). These show up as review findings
   ("Scope has no empty state. FP-0142: design the empty state first") with an **Apply**
   action that asks the agent to revise that section.

### 8.3 Guiding the admin, not just the agent
- **Probes become questions.** The interviewer is told to turn the highest-band unaddressed
  principles for the current section into its next question, using the principle's `probe`
  and citing it ("FP-0142 suggests deciding the empty state first: what does a brand-new
  user see?"). Logged as `probed`. This is what makes the interview feel principled rather
  than generic.
- **Trade-offs become decisions.** When two principles in context have a `tension` relation
  and both apply, the orchestrator raises a **decision card** (existing
  `builder-decision.service` / `DecisionCard.tsx`): the two principles, the one-line
  trade-off, and the options. The admin's choice is recorded in the PRD with both codes.
- **Coverage view.** The PRD panel shows, per section, the principles applied, probed but
  open, and violated (from the PRD check), so the admin can see at a glance where the draft
  is thin.
- **Chips** on turn receipts and the PRD panel: code, statement on hover, thumbs up/down.

### 8.4 Tracking what was actually used, honestly
- **Cited**: the PRD cites principles inline as `[FP-0142]`. Each PRD version save parses
  citations.
- **Citation integrity**:
  - A cited code that was never surfaced in this session, or doesn't exist, is
    `cite_rejected`. It is stripped from the PRD and flagged in the turn receipt, which
    catches invented codes.
  - The remaining citations go to `first_principles_citation_verifier` (a small model, on
    all of them while volume is low, sampled later). It checks that the cited sentence
    genuinely applies the principle. Only a pass becomes `applied_verified`.
  - Without this the agent learns that citing is rewarded, and the effectiveness score
    measures citing instead of helping.
- **Dismissed**: surfaced in context but never probed, read or cited by session end.
- **Helpful / unhelpful**: thumbs on chips.
- **Shipped**: when `builder-outcome` records a merged build for the session, every
  `applied_verified` principle in it gets a `shipped` event.
- **Effectiveness** (nightly, Bayesian-smoothed so a principle seen twice can't score 1.0;
  eval and preview traffic excluded):
  `applyRate = (appliedVerified + probed·0.5 + 1) / (surfaced + 5)`,
  `feedback = (helpful + 1) / (helpful + unhelpful + 2)`,
  `effectiveness = 0.6·applyRate_norm + 0.25·feedback + 0.15·shippedRate_norm`.
  "Shipped" is heavily confounded, so it gets the smallest weight. It only feeds the bounded
  in-band prior and the Insights tab, never a filter.
- **Curator** (nightly, like the lesson curator): proposes archiving principles that have
  been surfaced at least 30 times with 0 verified applications, proposes merges for
  principles that keep surfacing together, and proposes new `tension` relations. All of
  these go to the review queue. Nothing is archived automatically.

## 9. Other consumers

- **Roadmap Copilot**: swap its `stacks_*` tools for the same two tools (`consumer =
  roadmap_copilot`).
- **Course Copilot**: same swap, filtered to `instructional_design` by default. It only
  returns useful results once instructional-design documentation is uploaded, and it says so
  rather than claiming the library is empty of guidance.
- **Engineers' Claude Code**:
  - ally-be exposes `POST /first-principles/mcp`: JSON-RPC `tools/list` + `tools/call` for
    `search_principles`, `get_principles`, `list_domains`, plus a `planning_context` prompt,
    matching the four Stacks surfaces so habits carry over.
  - Auth: a **separate read-only personal key** (`fp_reader_keys`) that can only call these
    tools, sent as `Authorization: Bearer`. Engineers create one from Builder → First
    Principles → Access; the issue/revoke flow copies the Skills Store key service's
    pattern. Per-key rate limit (Redis) and `lastUsedAt` tracking.
  - Each repo's `.mcp.json` points at it (HTTP transport, key from env). Then delete
    `stacks-bridge.mjs` and the `.claude/skills/stacks` skill (replaced by a
    `first-principles` skill). Update every `CLAUDE.md` / `AGENTS.md` and rewrite
    `wiki/contributing/planning-with-stacks.md` as `planning-with-first-principles.md`.
  - Retrievals log with `consumer = mcp_dev`. Engineers' sessions give no applied signal, so
    they count toward retrieval stats only.

## 10. Admin UI (Builder → First Principles)

| Tab | Contents |
|---|---|
| **Library** | Upload zone; sources table with progress, cost, overview and yield report; principle browser with filters by domain / kind / strength / source / status; edit, archive, add a principle by hand; relations shown on each principle |
| **Search preview** | Runs the real retrieval as `admin_preview`, showing bands and per-signal scores, with a pipeline switch (re-rank on/off, alpha). **Thumbs on results feed the retrieval benchmark** |
| **Review** | The spot-check queue (§6.7), including curator proposals |
| **Access** | Engineers create and revoke their read-only MCP keys (§9) |
| **Insights** | Benchmark scores over time; library size by domain; top applied; never surfaced; surfaced often, never applied; **gap list**: zero-hit and low-band queries clustered into topics ("6 sessions asked about offline sync and found nothing: consider uploading documentation on it"); per-source yield vs usefulness; usage by consumer |

Feature toggle: add `BUILDER_FIRST_PRINCIPLES` (separate from `BUILDER`) so it can be rolled
out and switched off on its own. Builder settings get two switches: `principlesBrief`
(off / shadow / on) and `principlesProbes` (off / on).

## 11. Build order (chunks; each one ships and is tested on its own)

| # | Chunk | Done when |
|---|---|---|
| 1 | **Library core**: `fp_*` migrations; ally-ai `FirstPrinciple` collection with named vectors (or the fallback), `hybrid_search`, upsert/search/embed endpoints; `FirstPrinciplesRetrievalService` with RRF, bands, logging; add a principle by hand via the API | Hand-added principles come back from hybrid search with bands and are logged; prod Weaviate version confirmed; tests and lint green in ally-be and ally-ai |
| 2 | **Server ingestion**: sources/sections API, Redis staging, worker, overview → distil → gate (verbatim, injection, platitude, critic) → dedupe → consolidation (cap, tensions), cost cap, re-distil merge, yield report | Posting a real document's sections produces a capped set of principles with a yield report; no section text in Postgres; Redis keys gone afterwards |
| 3 | **Browser upload + Library / Search preview / Review UI**; thumbs in Search preview | The owner uploads the seed documents end to end; a first ~60-query **retrieval benchmark** exists from preview thumbs |
| 4 | **Builder swap**: `principles_*` tools, prompts, receipts, citation parsing, integrity check + verifier; proactive brief in **shadow** mode (logged, not shown) | An interview cites `[FP-…]`, invented codes are stripped, verified applications are recorded; Stacks is no longer called by Builder |
| 5 | **Guiding the admin**: brief + section focus within the budget, probes as questions, tension decision cards, PRD principle check with Apply, coverage view; **replay eval off vs on** | The replay eval shows an improvement with no fixture regressing, after which `principlesBrief` and `principlesProbes` go on by default |
| 6 | **Feedback loop + Insights**: thumbs, shipped linkage, LLM hit judge, nightly effectiveness, in-band prior, exploration, re-rank A/B on the benchmark, curator, Insights tab with gap list | Insights shows real numbers; the re-rank decision is made from the benchmark |
| 7 | **Copilots + MCP + Stacks removal**: Roadmap/Course Copilot swap, read-only keys + Access tab, `/mcp` endpoint, `.mcp.json` in every repo, delete `StacksClientService` + bridge + skill + `STACKS_*` config, docs/wiki rewrite | `grep -ri stacks` finds only history notes |

Chunks 1–4 make it usable; 5–6 make it good and prove it; 7 finishes the cutover. Stacks
stays wired for engineers until chunk 7, so nobody loses guidance while the library fills up.
Every new prompt from chunk 2 on goes through the Skills Store, and from chunk 5 on through
a `prompt_gate` eval suite.

## 12. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Copyright: keeping the document's text | Parsing happens in the browser; text sits only in Redis with a 24h TTL, never in Postgres or backups; the 8-word verbatim check; only location metadata is stored, never passages |
| Bland, generic principles | Overview pass for context, critic pass, platitude anchors, density cap, and the yield report's sample rating; Insights flags "surfaced, never applied" |
| Prompt injection via an uploaded document | Distiller treats text as data; injection screen in the gate; principles framed as advisory data to every agent; read-only MCP keys |
| The agent games citations | Only surfaced codes count; invented codes are stripped; the verifier must pass before anything counts as applied |
| Too much in context dilutes the interview | ~25-principle budget, a fixed cached brief, per-turn additions after the cache breakpoint |
| Library bloat from overlapping documents | Merge as corroboration, consolidation per document, density cap, curator merge proposals |
| A better prompt can't reach old documents | Re-distil by re-upload, merging while keeping codes and history (§6.6) |
| Feedback loop locks in early favourites | In-band prior only (max ±10%), exploration slot, raw scores logged |
| Agent claims "the library has nothing on X" | Same tool-message discipline Stacks used; zero-hit queries feed the gap list |
| It doesn't actually improve PRDs | The replay eval gates the proactive features; if it shows no gain they stay off and we learn why before building more |
| Long document, worker crash, Redis expiry | Per-section status with retries; expired sections re-sent by re-dropping the file (hash-matched) |
| Cost | Estimate and cap before confirm; prompt caching on the per-document prefix; tokens and cost per source; concurrency cap |

## 13. Open questions

None blocking. All four earlier questions were answered on 2026-11-09 and are recorded in §1.
Thresholds marked as first guesses (§3, §6.4, §6.5, §7.2, §8.4) are meant to be revised
from real data, not decided up front.
