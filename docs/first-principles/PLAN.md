# First Principles — plan (revision 4)

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> Replaces the third-party **Stacks** MCP everywhere it is used today.

## What changed in revision 4: UX review

The experience is designed around one promise: **drop documents, walk away, and find sharper
interviews waiting.** Measured against that and Builder's own conventions (the room's
deep-linked tabs, `Sheet`, `CommandPalette`, `DiffBlock`, `DecisionCard`, and the motion rules
in `builderMotion.ts`), revision 3's UX had these problems:

| Finding | Change |
|---|---|
| Six tabs (Queue, Library, Search preview, Review, Access, Insights) split one job across six places | **One "First Principles" tab in the Builder room with three views: Library, Inbox, Insights** (§10.2) |
| The upload queue was a tab, but uploads run in the background | An **upload dock** that stays visible anywhere in Builder, like a download tray, with a clear "safe to close this tab" moment (§10.3) |
| Exceptions (duplicates, scanned PDFs, cost cap) would interrupt with questions | **Every exception has a default and appears as a quiet row in the dock**; nothing blocks the rest of the drop (§10.3) |
| Pipeline jargon (distil, segment, band, RRF, MMR) would leak into the UI | A **copy glossary**: the UI says "extract principles", "part", "Strong match". Diagnostics hide behind "How was this found?" (§10.9) |
| No payoff moment when a document finishes | A **"what you got"** toast and a highlighted "new from this document" view (§10.3, §10.4) |
| Review, duplicate decisions, grading and failures were scattered | **One Inbox**, one count, keyboard triage, optimistic actions with undo instead of confirm dialogs (§10.5) |
| Benchmark labelling was a chore hidden in a debug screen | **Grading tasks in the Inbox**: one search at a time, keys 0–3, stop any time (§10.5) |
| The interview would recite codes ("FP-0142 suggests…") | **Principles shape natural questions**; a quiet "Guided by" chip carries the reference. At most one principle-led question per turn (§10.7) |
| Coverage, trade-offs and PRD fixes were three new panels | Coverage lives in the session side panel as **Principles in play**; trade-offs are outcome-worded decision cards with a recommendation; fixes **preview as a diff** before applying (§10.7) |
| Explicit thumbs everywhere would nag | **Feedback is mostly implicit** (accept, dismiss, "not relevant"); thumbs only on hover |
| Insights was a wall of charts | **Three answers first** (Is it helping? What's missing? What's noise?), each with one action (§10.6) |
| Engineer setup was "create a key" | A **Connect Claude Code** sheet: key shown once, a pre-filled config snippet, and a **Test connection** button (§10.8) |
| No first-run, loading, partial, error or saturated states; no accessibility or motion rules | A **states table**, accessibility rules and motion rules for every surface (§10.9) |

## What changed in revision 3: RAG design review

Revision 3 is a review against retrieval-augmented generation practice. The overall shape
holds: First Principles is **proposition indexing**, where the retrieval unit is a short,
atomic claim rather than a passage, and that suits this use well. These changes make it
hold up:

| Finding | Why it matters | Change |
|---|---|---|
| **No source to fall back on.** Most RAG systems retrieve a small unit and then expand to its surrounding passage ("small-to-big"). We delete the source text, so that fallback does not exist | A principle that only makes sense next to its source paragraph is useless once retrieved | Every principle must be **decontextualised**: subject named, no pronouns or "this approach", domain explicit. The critic checks it (§6.5) |
| **Nothing checked that a principle is actually in the document** | The distiller can add its own general knowledge, and the library stops reflecting what was uploaded. Once the text is deleted this can never be checked again | A **groundedness check** at distil time: each candidate must be supported by its segment (§6.5) |
| **Size-first segmentation, no overlap, no text clean-up** | Ideas that span a boundary are lost; lists and tables are cut in half; two-column PDFs come out scrambled | **Structure-first segmentation** with context-only overlap that is never extracted twice, atomic blocks kept whole, and a normalisation pass (§6.2) |
| **Extraction capped at 4 per segment** | Dense segments lose principles before any ranking happens | Extract up to 8, then cap at document level, where ranking has the whole picture (§6.4, §6.6) |
| **One vocabulary per principle** | A query that says "zero state" misses a principle written as "empty state" | **Synthetic example queries** per principle (doc2query) and synonym-rich keywords, held apart from the eval queries so the benchmark doesn't leak (§5, §7.1) |
| **Blended hybrid scoring, unlogged per signal** | Can't tell which signal found or missed a principle; can't tune them | **Three separate retrievers** (field-weighted BM25, statement vector, situations vector) fused with RRF in ally-be, each logged (§7) |
| **Hard metadata filters** | Domain and PRD-section labels are LLM-assigned and noisy; a hard filter silently removes relevant principles | Filters are **soft boosts** by default, with back-off when a strict filter returns too little (§7.3) |
| **No diversity step** | The top 8 can be five rewordings of one idea | **MMR** diversification, and `refines` relations collapse to the most specific principle (§7.3) |
| **Re-ranking off by default** | A second-stage re-ranker is usually the largest single precision gain in a recall-then-rerank pipeline | Two-stage by design: **50 candidates → graded LLM re-rank → final**. On by default for interview traffic, unless the benchmark shows no gain (§7.3) |
| **Queries carry no session context** | "empty state" means different things for a counsellor's mobile app and an admin export | **Contextualised vector queries**: a short session descriptor is added to the vector side only; BM25 keeps the raw query. Decided by A/B on the benchmark (§7.3) |
| **The benchmark only labels what the current pipeline returns** | Biased toward today's setup, and recall can't be measured | **Pooled judgments** across several retrievers, graded 0–3, a frozen test split, stage-wise metrics, and an LLM judge calibrated against admin labels (§3) |
| **No index versioning** | Changing the embedding model or text template means a risky in-place rebuild | **Versioned collections** with a blue/green swap after the benchmark passes (§7.2) |
| **Weaviate could serve stale or archived principles** | The index lags behind edits and archives | Hits are **hydrated from Postgres**, which is the source of truth; anything not `active` is dropped (§7.3) |
| **No context assembly rules** | Format, ordering and abstention affect how well the model uses what it is given | A fixed **principle card** format, ordering rules, and an explicit "no confident match" (§8.2) |
| **"Applied" rate ignores position** | Principles shown first get applied more just for being first | **Position-adjusted** effectiveness, using exploration slots (§8.4) |
| **Ambiguous duplicates all went to humans** | Review load grows with every overlapping document | An **LLM adjudicator** decides same / refines / conflicts / different; only uncertain cases reach review (§6.5) |

Revision 2 (success measures, Redis staging, re-distil, probes and decision cards, critic and
platitude gate, overview pass, shadow mode) and the later decisions (documentation, not other
uploads; no names; multi-document queue) all still stand.

## 0. The idea in one paragraph

An admin drops any number of PDF or EPUB documents about product, UX, architecture and
engineering practice. The browser cleans and splits each one by its structure into
segments. ally-be first writes an overview of the whole document, then has an LLM **distil**
each segment into short, self-contained **principles**: rules, heuristics, anti-patterns and
trade-offs, in our own words. Each principle is checked against its segment to confirm it is
really there, and carries the situations it applies to, the searches that should find it, and a
question that tests whether a PRD honours it. The documents and their text are **never kept**.
The library is searched by three retrievers whose results are fused, re-ranked and
diversified, many times per Builder interview. Principles become questions for the admin and
checks on the draft PRD. The copilots and engineers' Claude Code search it too. Every search,
hit and verified use is logged, and a pooled, graded benchmark proves each change helps before
it ships.

## 1. Decisions already made

| Question | Decision |
|---|---|
| Name | **First Principles**: a fourth tab in the Builder room (Now · Rules · History · First Principles); each item is a *principle* |
| Review gate | **Auto-publish + spot-check.** Principles that pass the quality gate go live at once; borderline ones wait in a short review queue |
| Processing | **Background on the server.** The browser parses and uploads all segments, then can close. ally-be distils in the background |
| Uploading | **Drop many documents at once and keep adding while it runs.** They queue in the browser for parsing, then on the server for distilling, in the order dropped (reorderable) |
| Replace Stacks in | **All four places:** Builder interview (+ research + PRD review), Roadmap Copilot, Course Copilot, engineers' Claude Code (our own MCP endpoint replaces `stacks-bridge.mjs`) |
| Seeding | The owner has the documents that seeded Stacks and will upload them once the upload screen (chunk 3) is live |
| Ally house rules | **Uploaded documents only.** No import of the deprecated `wiki/product/` pages. Hand-adding a principle stays available |
| Distillation model | **Builder's configured model** (same resolution as the interview). Smaller models are used only for the high-volume judging steps (re-rank, adjudication, citation check, relevance judge) |
| Engineer access | **Separate read-only keys** that can only search principles, not the Skills Store keys |
| What gets uploaded | **Documentation** (PDF, EPUB) of any length, from a short guide to a long manual |
| Naming | Code, schema, prompts, UI copy and code documentation say **document** (or **source** for the database record) for an upload, and no other term. The piece of a document sent to the distiller is a **segment** |
| Source metadata | **Title, version and year only.** No author, publisher or contributor names are stored, sent to the server, or written into principles or overviews |

## 2. What exists today (and what we reuse)

| Existing piece | Where | How we use it |
|---|---|---|
| `StacksClientService` (JSON-RPC to Stacks) | `ally-be/src/llm-agent/service/stacks-client.service.ts` | **Deleted** at the end. Its soft-failure messaging ("a failed lookup says nothing about coverage") carries over. Per its own header, Builder has never reached Stacks in production, so the Builder swap has nothing to regress |
| Builder tools `stacks_search` / `stacks_get` | `ally-be/src/builder/service/builder-interview-tools.service.ts`, evidence log, turn receipt, `interviewer_system.txt`, `research_system.txt` | Replaced by `principles_search` / `principles_get` |
| Roadmap + Course Copilot Stacks tools | `ally-be/src/product-roadmap/service/roadmap-copilot-tools.service.ts`, `ally-be/src/course-copilot/service/course-copilot-tools.service.ts` | Pointed at the same service |
| Knowledge Base pattern: Postgres is the system of record, the Weaviate index in ally-ai is derived from it, `embeddingStatus` / `textHash` / reconciliation sweep | `ally-be/src/knowledge-base/`, `ally-be/src/product-roadmap/service/roadmap-vector.service.ts`, `ally-ai/app/core/knowledge_base/` | Same pattern. **No pgvector** (the codebase deliberately avoids it) |
| Retrieval log tables (`kb_retrievals`, passages, passage judgments) | `ally-be/src/knowledge-base/entity/` | Model for `fp_retrievals` / `fp_retrieval_hits` / `fp_judgments`. Same "measurement, not mitigation" rule and fire-and-forget writes |
| **RAG-quality judge** (per-passage labels, versioned prompt, token usage emitted, judges empty retrievals too) | `ally-ai/app/core/rag_quality/` | Reused with a First Principles rubric for graded relevance labels (§3) |
| **Builder replay eval** (recorded interviews + human-written checklists, run N times with overrides; `prompt_gate` suites decide whether a prompt change goes live) | `ally-be/src/builder/eval/`, `builder-eval-*.entity.ts` | The end-to-end success measure: principles off vs on, and a gate on every First Principles prompt change |
| **Decision cards** | `ally-be/src/builder/service/builder-decision.service.ts`, `ally-web/apps/ally-admin-dashboard/src/components/builder/DecisionCard.tsx` | Trade-off cards when two applicable principles pull in different directions |
| PRD review | `ally-be/src/builder/service/builder-prd-review.service.ts`, `PrdReviewFindings.tsx` | Gains a principle check pass |
| Lesson usage loop (`appliedLessonIds`, `sourceCount`, curator) | `builder-knowledge.service.ts`, `builder-lesson-curator.service.ts` | Same loop for principles |
| Builder outcomes | `builder-outcome.service.ts` | Links "principle applied" to "PRD shipped" |
| Skills Store prompts (`.txt` default + typed contract) | `ally-be/docs/adding-a-prompt.md` | Every new prompt: overview, distiller, critic, adjudicator, consolidator, query planner, re-ranker, citation verifier, PRD principle check, synthetic eval queries |
| Skills Store personal keys | `ally-be/src/prompt/service/skills-store-key.service.ts` | **Pattern only** for the new read-only principles key |
| Redis | ally-be | Segment staging with a TTL; query-embedding and per-session result caches; MCP rate limits |
| `@nestjs/schedule` | ally-be | Background distillation worker and nightly jobs (no new SQS queue, so no infra-repo change) |
| Server-side PDF/EPUB extractors | `ally-be/src/knowledge-base/extractor/` | **Not used** (parsing happens in the browser). Their heading and clean-up heuristics are worth porting |

Gaps found in ally-ai: the Weaviate client has `near_vector_search` but **no BM25 query with
property boosts, no named vectors, and no flat index config** (existing collections all use
HNSW). Weaviate 1.28 (the local image) supports all three; **chunk 1 confirms the production
server version**.

## 3. Success measures: how we know it works

Measurement comes before the features it judges. Thresholds are first guesses to revise from
real numbers.

### 3.1 Retrieval benchmark
- **Queries**, stratified across domains and PRD sections:
  1. admin-written situations ("designing the first screen of a new feature");
  2. real queries from `fp_retrievals` once Builder uses the library (chunk 4 onward);
  3. **synthetic queries** generated from sampled principles by a *separate* prompt
     (`first_principles_eval_queries`). These are **never indexed**, so they can't leak into
     the principles' own example queries.

  Some queries deliberately have **no** relevant principle, to test abstention.
- **Pooled, graded judgments.** For each query, take the union of the top 20 from BM25-only,
  each vector alone, fused, and fused + re-rank. Label every pooled hit 0–3 (0 irrelevant,
  1 related, 2 relevant, 3 exactly what the situation needs). Labelling only what the current
  pipeline shows would bias the set toward it and make recall unmeasurable.
- **Labellers:** the admin grades results through **grading tasks in the Inbox** (§10.5, chunk 3). The
  ally-ai RAG-quality judge, with a First Principles rubric, labels at scale only after its
  agreement with the admin's labels reaches **Cohen's κ ≥ 0.6** on a shared sample.
- **Splits:** a **tuning** split (thresholds, alpha, weights are chosen on it) and a frozen
  **test** split (reported, never tuned on). Start at ~60 queries and grow past 150.
- **Metrics, by stage:**

  | Stage | Metric | Why |
  |---|---|---|
  | Candidates (before re-rank) | **Recall@50** | A principle missing here can never be shown, whatever the re-ranker does |
  | Final list | **nDCG@8**, precision@8 (grade ≥ 2), MRR | Ranking quality of what the model sees |
  | Abstention | Share of no-answer queries returning nothing `high` | The library should say "nothing confident" rather than pad |
  | Diversity | Mean pairwise similarity of the final 8 | Catches rewordings crowding the list |
  | Cost | p50 / p95 latency, tokens per search | Re-rank and query expansion have to earn their cost |

- **Runner:** `first-principles:eval` (a script and an admin endpoint) runs the benchmark
  against a named pipeline config and stores a report. It runs on every change to retrieval
  code, index template or retrieval prompts, and nightly. **Bars:** test-split Recall@50
  ≥ 0.9 and nDCG@8 ≥ 0.6 before the proactive brief is on by default. No change ships if it
  lowers test-split nDCG@8.

### 3.2 Distillation quality
- **Per-document yield report:**
  - candidates → kept / merged / reviewed / rejected, with reasons (ungrounded, not
    standalone, verbatim, injection, platitude, critic, duplicate)
  - groundedness rate and standalone rate
  - review rate
  - a 20-principle random sample the admin rates 1–5
- **Extraction recall spot-check:** for three reference documents, the admin writes down
  the ~10 principles they would expect. Coverage, judged by semantic match, should reach
  ≥ 7/10.
- **Bars:** review rate ≤ 20%; sample rating ≥ 3.5; groundedness ≥ 95% of kept principles.

### 3.3 PRD outcome (replay eval)
Builder's replay eval runs the same fixtures with First Principles off vs on, scored against
their human-written checklists, plus the PRD review's finding count. The proactive brief and
probes go on by default only if the checklist pass rate improves and no fixture regresses.
Every First Principles prompt change goes through a `prompt_gate` suite.

### 3.4 Online signals (Insights tab)
Zero-result rate, low-band-only rate, re-rank drop rate (candidates graded ≤ 1), p95 latency,
cost per session, cache hit rate. Traffic from `admin_preview` and `eval` is excluded from
usage stats and effectiveness.

## 4. Architecture

```
 Admin browser (ally-admin-dashboard)
   drop many PDF / EPUB files → browser queue
   Web Worker, 2 at a time: SHA-256 → extract → normalise → structure-first segments
        │  POST /first-principles/sources/check       (all hashes + titles of the drop)
        │  POST /first-principles/sources             (per document: metadata + hash, no text)
        │  POST /first-principles/sources/:id/segments (batched segment text + context)
        ▼
 ally-be  ── first-principles module ─────────────────────────────────────────
   Redis  fp:segment:{id}  (segment text + context-only overlap, TTL 24h, deleted once distilled)
   Postgres fp_sources (queue order, status) + fp_ingest_segments (hash, counts; never text)
        │  worker (cron, FOR UPDATE SKIP LOCKED, by queuePosition then ordinal, concurrency N)
        ▼
   OVERVIEW (once per document)
   DISTIL each segment (overview as cached prefix) → up to 8 decontextualised candidates
     → deterministic gate (fields, vocab, attribution, verbatim, injection)
     → CRITIC: grounded in segment? standalone? specific? + platitude check
     → dedupe (statement vector): merge | ADJUDICATE (same/refines/conflicts/new) | publish
   CONSOLIDATE per document: cluster, sharpen, density cap, relations
        ▼
   fp_principles (system of record) ──outbox upsert──► ally-ai Weaviate `FirstPrinciple_vN`
                                                        (flat index; vectors: statement,
                                                         situations; BM25 with field boosts)
   Retrieval (ally-be):
     queries → [contextualise vector side] → 3 retrievers each → RRF → soft-filter boosts
       → top 50 → graded re-rank → hydrate from Postgres → bands → MMR → in-band prior
       → exploration slot → principle cards
        ◄── Builder interview / research / PRD review / brief
        ◄── Roadmap Copilot, Course Copilot
        ◄── /mcp endpoint ◄── engineers' Claude Code
   logs: fp_retrievals, fp_retrieval_hits (per-retriever ranks); citations → verifier → usage
   eval: pooled benchmark runner → reports (tuning / test split)
```

## 5. Data model (ally-be Postgres, platform-global, `BaseWithoutTenantEntity`)

All tables are prefixed `fp_`. **No document file and no source text is stored in
Postgres**, so none of it can reach a database backup.

### `fp_sources`: one row per uploaded document
`id`, `title`, `docVersion`, `year` (title pre-filled from PDF metadata or EPUB OPF; all
editable), `kind` (`pdf` | `epub`), `language`, `fileHash` (SHA-256), `titleKey` (normalised
title, to catch the same document uploaded as both PDF and EPUB), `overview` (≤ 150 words,
our own summary of what the document covers and argues, naming no people or organisations),
`pageCount`, `segmentCount`, `segmentsDistilled`, `segmentsFailed`, `extractionWarnings`
jsonb (e.g. "multi-column layout detected", "no outline; headings inferred"), `status`
(`uploading` | `queued` | `distilling` | `consolidating` | `paused` | `complete` | `failed` |
`cancelled` | `archived`), `batchId`, `queuePosition`, `queuedAt`, `pausedAt`,
`estimatedStartAt`, `yield` jsonb (§3.2), `distillModel`, `promptVersions` jsonb,
`inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`, `costCapUsd`, `generation`,
`uploadedBy`, timestamps.

### `fp_ingest_segments`: progress tracking (no text)
`id`, `sourceId`, `ordinal`, `sectionPath` (the document's heading path, e.g. "Design guide ›
Lists › Empty states"), `pageFrom`, `pageTo`, `textHash`, `tokenCount`, `blockTypes`
(paragraphs, list, table, code), `status` (`pending` | `claimed` | `done` | `failed` |
`skipped` | `expired`), `attempts`, `claimedAt`, `error`, `candidatesFound`,
`candidatesKept`. The text itself is in Redis (§6.3).

### `fp_principles`: the library (the retrieval unit)
| Field | Purpose |
|---|---|
| `code` | Stable human handle, `FP-0142`. What the PRD cites. Never reused |
| `statement` | The principle, imperative, **decontextualised**, ≤ 160 chars ("Design a list view's empty state before its populated state") |
| `rationale` | Why it holds, ≤ 300 chars, self-contained |
| `appliesWhen` `text[]` | 1–4 trigger situations ("designing a list view that can have zero items") |
| `exampleQueries` `text[]` | 3–5 short searches this principle should answer ("zero state", "first-run screen with no data"). Generated at distil time, indexed for retrieval, **not shown** to users |
| `probe` | One question an interviewer asks to test whether a PRD honours it |
| `antiPattern` | What breaking it looks like (used by the PRD principle check) |
| `kind` | `rule` · `heuristic` · `anti_pattern` · `trade_off` · `checklist_item` |
| `strength` | `must` · `should` · `consider` |
| `domain` | Controlled list: `product_strategy`, `discovery`, `ux_ui`, `interaction`, `content_copy`, `data_viz`, `accessibility`, `architecture`, `backend`, `data`, `ai_llm`, `security_privacy`, `reliability`, `performance`, `testing`, `delivery`, `metrics_analytics`, `growth`, `instructional_design` |
| `topics` `text[]` | Free-form, normalised (lower-kebab, merged against a synonym table) |
| `keywords` `text[]` | Exact terms for BM25, **including synonyms and variants** ("empty state", "zero state", "blank slate") |
| `prdSections` `text[]` | Where it bites: `problem`, `users`, `goals_metrics`, `scope`, `ux_states`, `requirements`, `architecture`, `data_model`, `api`, `rollout`, `risks`, `testing` |
| `lifecycleStage` | `discovery` · `definition` · `design` · `build` · `launch` · `iterate` |
| `quality` jsonb | Critic results: `grounded` (supported / partial / unsupported), `standalone` (bool), specificity / actionability 1–5, platitude similarity, gate verdict and reasons |
| `status` | `active` · `review` · `archived` · `superseded` (`supersededById`; old codes **redirect**) |
| `origin` | `distilled` · `manual` |
| `sourceCount` | How many distinct documents independently produced it |
| `distillPromptVersion` | Which distiller version produced the current wording |
| `embeddingStatus`, `embeddingAttempts`, `embeddedAt`, `textHash`, `indexVersion` | Outbox for the index. `textHash` covers every indexed field, so any edit re-embeds |
| usage counters (nightly; eval + preview excluded) | `timesRetrieved`, `timesSurfaced`, `timesRead`, `timesProbed`, `timesAppliedVerified`, `timesHelpful`, `timesUnhelpful`, `timesInShippedPrd`, `lastRetrievedAt`, `lastAppliedAt`, `effectiveness` (§8.4) |
| `version`, `createdBy`, `editedBy` | Edits are versioned in `fp_principle_versions` |

### `fp_principle_sources`: the "inspired by" record
`principleId`, `sourceId`, `generation`, `sectionPath`, `pageFrom`, `pageTo`, `confidence`,
`extractedAt`. The location only, never the text.

### `fp_principle_relations`: how principles relate
`fromId`, `toId`, `type` (`tension` · `refines` · `prerequisite` · `related`), `note`,
`origin` (`adjudicator` · `consolidation` · `curator` · `admin`), `confidence`.

### `fp_retrievals`: one row per search call
`id`, `consumer` (`builder_interview` · `builder_research` · `builder_prd_review` ·
`builder_brief` · `roadmap_copilot` · `course_copilot` · `mcp_dev` · `admin_preview` ·
`eval`), `sessionId`, `turnIndex`, `queries` `text[]` (verbatim), `contextDescriptor`,
`queryOrigin` (`agent_tool` · `planner` · `section_focus` · `prd_review` · `human`),
`filters` jsonb (with `strict`), `pipeline` jsonb (index version, retrievers, RRF k, weights,
rerank on/off and model, MMR λ: so reports can compare configurations), `limit`,
`candidateCount`, `resultCount`, `topBand`, `filterBackoff` (bool), `cacheHit`, `latencyMs`
(per stage), `failed`, `shadow`, `createdAt`.

### `fp_retrieval_hits`: one row per candidate that reached re-ranking
`retrievalId`, `principleId`, `bm25Rank`, `statementRank`, `situationsRank` (null when that
retriever missed it), `rrfScore`, `rerankGrade` (0–3), `band`, `mmrDropped`, `finalRank`,
`boostedScore`, `surfaced`, `explorationSlot`. Logging all candidates rather than just the
shown ones is what makes per-retriever recall measurable from production traffic.

### `fp_judgments`: graded relevance labels
`queryId` (benchmark) or `hitId` (production sample), `principleId`, `grade` (0–3), `judge`
(`admin` · `llm`), `judgeModel`, `rubricVersion`, `reason`, `split` (`tuning` · `test` ·
`production`), `createdAt`.

### `fp_benchmark_queries` and `fp_eval_reports`
Queries with `origin` (`admin` · `production` · `synthetic`), `split`, `domain`,
`prdSection`, `expectsNoAnswer`. Reports store the pipeline config, metrics per stage and
split, and the per-query results, so any two configs can be compared.

### `fp_usage_events`: what happened after retrieval
`principleId`, `sessionId`, `consumer`, `type` (`read` · `probed` · `cited` ·
`applied_verified` · `cite_rejected` · `dismissed` · `helpful` · `unhelpful` · `shipped`),
`retrievalId?`, `finalRank?`, `explorationSlot?`, `prdVersionId?`, `actorId?`, `note?`,
`createdAt`.

### `fp_reader_keys`: engineers' read-only MCP keys
`id`, `ownerId`, `label`, `keyHash`, `lastUsedAt`, `revokedAt`, `createdAt` (§9).

## 6. Ingestion

### 6.1 Browser: the upload queue (the experience is in §10.3)
The admin drops **any number of `.pdf` / `.epub` files at once**, and can drop more while the
queue runs. Each file moves on its own:

`hashing → checking → parsing → ready → uploading → queued on server → distilling → complete`

1. **Hash** each file (WebCrypto SHA-256) and `POST /sources/check` with all the hashes and
   titles in one call. Duplicates are caught within the drop as well as against the library:
   - same hash already distilled → offer re-distil (§6.7); default skip
   - same hash twice in one drop → the second copy is removed
   - same `titleKey`, different hash → flagged; default skip
2. **Parse** in a **Web Worker**, two files at a time (§6.2). A file that fails (e.g. a
   scanned PDF with no text layer; no OCR in v1) is marked failed and the queue carries on.
3. **Ready**: each file shows title, version, segment count, extraction warnings and a cost
   estimate.
   - **Auto-queue** (always on unless "Review before adding" is chosen) sends it straight on
     with default skips and a cost cap of 1.5× the estimate.
   - With "Review before adding", or by opening a row in the dock, a preview sheet lets the
     admin edit title and version, view the parts, and toggle sections.
   - A running **batch total** shows documents, segments, estimated cost and estimated
     finish, with an optional batch cost cap.
4. **Upload**: `POST /sources` per document (with `batchId`), then
   `POST /sources/:id/segments` in batches (≤ 1 MB), one document at a time. Memory is
   released per file once it is uploaded.
5. **The tab only has to stay open until the last file is uploaded**, which usually takes
   seconds to a few minutes. The dock says so and a `beforeunload` warning covers that window,
   then the dock says it is safe to close (§10.3). Files not yet uploaded can be dropped
   again; the hash check resumes them.
6. Progress after upload comes over Builder's existing WebSocket gateway
   (`builder.gateway.ts`), with polling as a fallback, so the dock moves without refreshes.

New ally-web dependencies: `pdfjs-dist`, `jszip` (new, not upgrades).

### 6.2 Extraction and segmentation (in the Web Worker)
Segmentation decides what the distiller can see at once, so it follows the document's
structure first and size second.

**Extract**
- **PDF** (`pdfjs-dist`): text items with their positions.
  - Rebuild reading order from coordinates, detecting columns by x-position clusters, so
    two-column layouts don't interleave.
  - Remove running headers and footers (lines repeated at the same position across pages)
    and page numbers.
  - Headings come from `getOutline()` mapped to pages. Fallback: font size and weight
    relative to the body text. Last resort: 8-page windows, with an extraction warning.
- **EPUB** (`jszip` + `DOMParser`): OPF spine for order, `nav.xhtml` / NCX for the heading
  tree, and real `h1–h6` / `ul` / `ol` / `table` / `pre` / `figcaption` elements.
- **Metadata:** only the title is read. Author, creator, publisher and contributor fields
  (PDF info dictionary, EPUB `dc:creator` / `dc:publisher` / `dc:contributor`) are ignored
  and never sent.

**Normalise**
- Unicode NFKC; fix ligatures ("ﬁ" → "fi") and smart-quote debris.
- Join words hyphenated across a line break ("manage-\nment" → "management"), but keep real
  hyphens.
- Collapse whitespace; drop inline footnote markers and append footnote text to the
  paragraph that cites it.
- Tables become one line per row (`header: value; header: value`). Figures are reduced to
  their captions. Code blocks are kept verbatim and flagged.
- Detect the language (`language` on the source). Principles are always written in English.

**Segment**
- **Default-skip** boilerplate by heading: table of contents, index, legal or licence notices,
  copyright, revision history, about the authors or contributors. All but the last can be
  re-enabled in the preview.
- **Split at heading boundaries first.** Pack consecutive sibling sections under one parent
  up to a **target of ~2,500 tokens**, with a hard **maximum of ~4,000**.
- Sections under ~400 tokens merge into their sibling or parent rather than travelling alone.
- Sections over the maximum split at sub-headings, then at paragraph boundaries.
- **Atomic blocks are never split:** a list, a table, a code block, and a heading with its
  first paragraph.
- **Context-only overlap:** each segment carries, in a separate field, its full
  `sectionPath`, the last ~150 tokens of the previous segment and the next segment's heading.
  The distiller is told this context is **for understanding only and must not be extracted
  from**. Ideas that span a boundary survive, and nothing is extracted twice.
- Token counts use a fast approximation with a 10% safety margin. Cost estimates use the same
  counts.
- Mark the opening (introduction, overview, summary) and closing segments for the overview
  pass.

### 6.3 Staging without retention
- Segment text and its context-only overlap go to **Redis** under `fp:segment:{id}` with a
  **24h TTL**, and are deleted the moment the segment is distilled. Postgres only ever sees
  `textHash`, counts and status.
- An expired key marks the segment `expired`; dropping the file again re-sends only what is
  missing.
- The server computes `estimatedStartAt` per document from queue position and recent
  throughput, and warns before queueing anything that would wait past ~20h.
- Chunk 2 checks Redis persistence. A snapshot can briefly hold text until it is overwritten,
  which is acceptable. Postgres backups never see it.

### 6.4 Background worker and distillation
- A `@nestjs/schedule` interval claims `pending` segments with `FOR UPDATE SKIP LOCKED`,
  ordered by `queuePosition` then `ordinal`.
  - Global concurrency cap (start at 3); 3-attempt retry with backoff.
  - Paused and cancelled documents are skipped. Cancel deletes that document's Redis text
    at once.
  - A failure never blocks the queue.
  - A batch-complete notification goes through Builder's notification bell.
- **Overview pass, once per document** (`first_principles_overview`): the heading tree plus
  the opening and closing segments produce a ≤ 150-word overview, the document's key terms
  with their definitions, and which sections are reference material, narrative or filler.
  Documents of one or two segments skip it.
- **Distil each segment** (`first_principles_distiller`, JSON output contract).
  - **Cached prefix** (identical across a document's segments, so Anthropic prompt caching
    applies): rules, controlled vocabularies, the overview and key terms.
  - **Then:** the segment, clearly delimited as untrusted data, and its context-only
    overlap.
  - **Output:** up to **8** candidates, each with every §5 field, including `exampleQueries`
    and `probe`. Each also names which part of the segment supports it, as a paragraph
    index, which the critic uses and which is never stored as text.
  - **Rules:**
    - own words only; no quotes; no examples or case studies lifted from the document
    - **no attributions** (no names of people or organisations, no "as X argues")
    - **decontextualise**: name the subject, no pronouns or "this approach", no reference
      to "the document" or "the above", no term the overview defines that is used without
      saying what it means
    - one idea per principle; prefer the specific and non-obvious; "0 principles" is valid
    - `keywords` include common synonyms and variants; `exampleQueries` are phrased the way
      a product manager or engineer would search, not as restatements of the principle
- Stop the document if `costUsd` reaches `costCapUsd`; the admin can raise the cap and resume.

### 6.5 Quality gate
In order, cheapest first. Every outcome is counted by reason in the yield report.
1. **Deterministic**: length limits, required fields, valid vocabulary, no attribution
   phrasing ("according to", "as … argues", "coined by"), no unresolved references ("this
   approach", "the above", "as mentioned").
2. **Verbatim check**: reject any candidate whose statement, rationale or probe shares an
   8-word run with its segment, so we keep meaning, not text.
3. **Injection screen**: reject candidates that address an AI or carry instructions or
   payloads ("ignore previous", "system prompt", URLs, code, tool names). The distiller also
   treats segment text strictly as data.
4. **Platitude check**: statement-vector similarity ≥ 0.85 to any maintained platitude anchor
   ("know your users", "keep it simple") → reject. Anchors grow from review rejections.
5. **Critic pass** (`first_principles_critic`, separate prompt and model call, batched per
   segment, **with the segment text**). For each candidate:
   - **Grounded?** Is it supported by the segment it came from (supported / partial /
     unsupported)? Unsupported is rejected; partial goes to review. This is the only point
     where groundedness can ever be checked, because the text is deleted next.
   - **Standalone?** Would a reader with no access to the document understand and act on it?
     No → one automatic rewrite attempt, then review.
   - **Specificity and actionability** 1–5; any score < 3 → review.
   - **Names**: flags any person or organisation name → review, with the name highlighted.
6. **Dedupe** against the library, on the **statement vector** only (situations can
   legitimately overlap between different principles). Runs under a Postgres advisory lock,
   so two documents distilled in parallel cannot both publish the same principle.
   - Similarity ≥ 0.93 → **merge as corroboration**: add an `fp_principle_sources` link and
     increment `sourceCount`; better wording becomes a proposed rewrite.
   - 0.80–0.93 → **adjudicator** (`first_principles_adjudicator`, small model) compares the
     candidate with its nearest 3 neighbours and decides `same` (merge), `refines` (publish +
     relation), `conflicts` (publish + `tension` relation), `different` (publish) or
     `unsure` (review). This keeps humans out of the easy cases.
   - < 0.80 → publish as `active`.
   - Thresholds are calibrated for `text-embedding-3-small` against the admin's review
     decisions, which are logged.

The segment's text is deleted from Redis once all its candidates have passed through.

### 6.6 Consolidation (once per document, after its last segment)
`first_principles_consolidator` over the document's new principles:
- Cluster by statement similarity and merge each cluster into its sharpest standalone
  statement; the rest become `superseded` (codes redirect).
- **Density cap**, scaled to the document: keep the best up to roughly 1 per 2 segments
  (at least 3, at most 80), ranked by critic scores, groundedness and distinctiveness
  (distance to the nearest library neighbour). Archive the rest with reason `over_cap`, so
  they stay recoverable. Capping here, not at extraction, lets ranking see the whole
  document.
- Relation pass: kept principles vs their nearest library neighbours → `tension` /
  `refines` / `prerequisite`.
- Queue the kept principles for indexing; source → `complete`; the yield report is
  finalised.

### 6.7 Re-distilling and archiving
- The text is gone after distillation, so **the only way to apply a better prompt to an old
  document is to drop the file again**. The UI says so.
- Re-distil runs as `generation + 1`. Dedupe treats that source's existing principles as
  merge targets: matches keep their **code and usage history** and take the better wording.
  Principles the new generation no longer produces are flagged in review, not deleted.
- Archiving a source archives principles whose only source it is, and decrements
  `sourceCount` on the rest.

### 6.8 Review (the spot-check)
Held principles, adjudicator "unsure" cases and curator proposals all land in the **Inbox**
(§10.5). Target ≤ 20% of candidates held.

## 7. Retrieval

### 7.1 What is indexed
Each principle is one object in Weaviate collection **`FirstPrinciple_v{N}`**:

| Retriever | Text | Why |
|---|---|---|
| **BM25** (field-boosted) | `statement^2`, `keywords^2`, `exampleQueries^1.5`, `appliesWhen^1`, `topics^1` | Exact terms, acronyms, jargon ("idempotency key", "p95") that embeddings blur |
| **`statement` vector** | `"{domain}: {statement} {rationale}"` | Matches queries phrased as rules or outcomes |
| **`situations` vector** | `"{domain}: {appliesWhen…} {exampleQueries…} {probe}"` | Matches situation-style queries, which is how the interview asks |

Filterable properties: `principle_id`, `code`, `domain`, `prd_sections`, `kind`, `strength`,
`status`, `lifecycle_stage`.

- Embeddings: OpenAI `text-embedding-3-small` (existing client). `text-embedding-3-large` is
  evaluated on the benchmark in chunk 6 and adopted only if test-split nDCG@8 improves enough
  to justify the cost.
- **Flat (exact) vector index** for both vectors. The library will hold thousands of
  principles, not millions, so exact search is fast and has none of HNSW's recall loss or
  tuning. Switch to Weaviate's `dynamic` index if it passes ~10k.
- BM25 uses `word` tokenisation with lowercasing. Synonyms come from `keywords` and
  `exampleQueries` rather than stemming.

### 7.2 ally-ai changes and index lifecycle
- Add to `vector_db/weaviate.py`:
  - `bm25_search` (with property boosts and filters)
  - `near_vector_search` on a named target vector
  - an embed-only endpoint (for dedupe and platitude checks)
  - bulk upsert, delete, list IDs with `textHash`
- Migration in `app/migrations/` creates `FirstPrinciple_v1`.
- **Index versioning (blue/green):** a change to the embedding model, text templates or
  properties creates `FirstPrinciple_v{N+1}`.
  1. Backfill it from Postgres, which holds everything needed.
  2. Run the benchmark against both versions.
  3. Flip a config pointer in ally-be.
  4. Drop the old version after a day.
- **Sync** is an outbox: `embeddingStatus` / `textHash` on each principle, a worker that
  embeds and upserts, and a nightly reconciliation that diffs IDs and hashes in both
  directions and repairs drift.

### 7.3 ally-be `FirstPrinciplesRetrievalService.search()`
**Input:** `queries[]` (1–6; near-duplicates collapsed), `filters` (domain, prdSections,
kind, strength, `strict`), `limit` (default 8, max 20), `consumer`, `sessionId`,
`contextDescriptor?`, `excludeCodes`, `shadow`.

1. **Cache:** a Redis query-embedding cache keyed on model and text, plus a per-session result
   cache for 10 minutes. Cache hits are logged as such.
2. **Contextualise (vector side only):** when a session has a context descriptor (≤ 25
   words, e.g. "mobile app for mental-health counsellors in training; admin-facing reports"),
   the vector query becomes `"{descriptor} — {query}"`. BM25 keeps the raw query, so context
   can't drown exact terms. On by default only if the benchmark A/B says so.
3. **Retrieve:** for each query, run **BM25 (top 30)**, **statement vector (top 30)** and
   **situations vector (top 30)** in parallel. Each retriever's ranks are kept.
4. **Fuse** with **reciprocal rank fusion**, `score = Σ 1/(60 + rank)` across every retriever
   and query, with per-retriever weights (start equal; tuned on the tuning split).
5. **Soft filters:** a requested domain, PRD section, kind or strength adds a rank bonus
   rather than excluding. With `strict: true` they are hard filters, and if that leaves
   fewer than `limit` candidates the search **backs off** to soft and says so
   (`filterBackoff`).
6. **Candidate pool:** top **50** by fused score, minus `excludeCodes`. Recall@50 is
   measured here.
7. **Re-rank** (`first_principles_reranker`, small model, one listwise call per search). It
   sees the queries, the context descriptor and each candidate's statement and appliesWhen,
   and returns a **grade 0–3** per candidate. On by default for Builder consumers if the
   benchmark confirms the gain (expected); MCP traffic follows the same config unless its
   latency budget says otherwise. If re-rank fails or times out (> 2.5s), fall back to the
   fused order with bands from calibrated RRF thresholds, and log it.
8. **Hydrate from Postgres** by ID. Drop anything not `active`; resolve superseded codes to
   successors; use the current wording, never the index's copy.
9. **Bands:** grade 3 → `high`, 2 → `medium`, ≤ 1 → dropped. If nothing reaches `medium`,
   return an explicit **"no confident match"** plus the single best `low` hit, labelled as
   such.
10. **Diversify** with **MMR** (λ = 0.7 on statement vectors) within the kept set, and when
    two results are linked by `refines`, keep the more specific one. This stops five
    rewordings of one idea filling the list.
11. **In-band prior:** `boosted = score × (0.9 + 0.1·effectiveness + 0.05·min(sourceCount-1, 2))`.
    It can reorder within a band, never across bands.
12. **Exploration:** one of every 8 slots goes to a `high`/`medium` principle with fewer
    than 5 surfacings, flagged `explorationSlot` (this also feeds the position correction in
    §8.4).
13. **Log** `fp_retrievals` plus a hit row for every candidate (fire-and-forget), with
    per-stage latency.
14. **Soft failure:** "retrieval failed, which says nothing about what the library holds, so
    continue". An empty result says the same.

**Latency targets** (first guesses): p95 < 800 ms without re-rank, < 2.5 s with.

### 7.4 Experiments, not defaults
Each of these is built behind a pipeline switch and adopted only on a test-split gain:
- **HyDE**: generate a hypothetical principle for the query and search the statement vector
  with it. An extra LLM call, so it has to earn it.
- `text-embedding-3-large` vs `-small`.
- Retriever weights and RRF `k`.
- Contextualised vector queries (step 2) on vs off.

## 8. Using it in the Builder interview

### 8.1 Tools (replace `stacks_search` / `stacks_get`)
- `principles_search({ queries: string[], domain?, prdSection?, strict?, limit? })` returns
  principle cards (§8.2) with `band`. Several sharp situational queries per call are
  encouraged. The tool description says filters are soft unless `strict`.
- `principles_get({ codes })` returns the full principle: rationale, probe, anti-pattern,
  tensions and refinements, and "inspired by *<document title>*, § Empty states". Logged as
  `read`.
- Evidence log, turn receipt ("Consulted 6 principles · applied FP-0142, FP-0311") and the
  prompts (`interviewer_system.txt`, `research_system.txt`) are updated to match.

### 8.2 Context assembly and proactive retrieval
**Principle card**, the one format every consumer gets (~40–60 tokens):
```
[FP-0142 · must · ux_states · high] Design a list view's empty state before its populated state.
  When: a list or feed can have zero items, especially on first use.
```
**Assembly rules**
- Cards are wrapped in a delimited **reference block** marked as advisory data, not
  instructions.
- Group by PRD section. Within a group, order by band, then score.
- Lead with the strongest group: models use the start of a long context best.
- An explicit "no confident match" line is shown rather than padding with weak hits.

**Proactive retrieval** (the agent doesn't have to remember to search):
1. **Session start: guidance brief.** `first_principles_query_planner` turns the rough idea
   into the session **context descriptor** plus 8–12 situational queries across the PRD
   dimensions. Fan out, then put up to 15 cards, grouped by PRD section, into a **Guiding
   principles** block in the cached context prefix (next to the repo knowledge packs). The
   brief is fixed for the session so the cache holds.
2. **Each turn: section focus.** When the orchestrator sees which PRD section is being
   worked on, it runs 2–3 queries for it, excluding codes already in context. New cards go
   **after the cache breakpoint**, in that turn only.
3. **Budget:** at most ~25 cards (~1.5k tokens) in context at once. When over, drop applied
   or dismissed ones first.
4. **Before sign-off: PRD principle check.** `builder-prd-review.service` gains a pass. For
   each PRD section it retrieves principles using the section's own text as the query and
   asks which ones the draft violates or ignores, matching against `antiPattern`. Findings
   ("Scope has no empty state. FP-0142") come with an **Apply** action.

### 8.3 Guiding the admin, not just the agent
- **Probes become natural questions.** The interviewer turns the strongest unaddressed
  principle for the current section into its next question, in its own voice. The reference
  travels as a chip under the message, never as prose. At most one principle-led question per
  turn. Logged as `probed`.
- **Trade-offs become decisions** when two strong-match principles in the same PRD section
  have a `tension` relation (at most one per turn).
- **Coverage** shows as "Principles in play" in the session side panel.
- **The PRD check** offers fixes as previewable diffs.

How each of these looks and behaves is in §10.7.

### 8.4 Tracking what was actually used, honestly
- **Cited:** the PRD cites `[FP-0142]`. Each PRD version save parses citations.
- **Citation integrity:**
  - A code never surfaced in this session, or nonexistent, is `cite_rejected`, stripped and
    flagged.
  - The rest go to `first_principles_citation_verifier` (small model; all of them while
    volume is low, sampled later). It checks the cited text genuinely applies the principle.
    Only a pass becomes `applied_verified`.
- **Dismissed:** surfaced but never probed, read or cited by session end.
- **Helpful / unhelpful:** mostly implicit. Accepting a fix or answering a principle-led
  question counts as helpful; "Not relevant" on a finding or chip counts as unhelpful. Thumbs
  appear only on hover of a chip.
- **Shipped:** when `builder-outcome` records a merged build, every `applied_verified`
  principle in that session gets a `shipped` event.
- **Effectiveness** (nightly, Bayesian-smoothed; eval and preview excluded), with a
  **position correction**:
  - Each surfacing counts by the expected apply rate at its `finalRank`, estimated from
    exploration slots. A principle that is applied often only because it is always shown
    first is not over-credited.
  - `applyRate = (appliedVerified + 0.5·probed + 1) / (Σ positionWeight + 5)`
  - `feedback = (helpful + 1) / (helpful + unhelpful + 2)`
  - `effectiveness = 0.6·applyRate_norm + 0.25·feedback + 0.15·shippedRate_norm`
  - It only feeds the in-band prior and Insights, never a filter.
- **Curator** (nightly): proposes archiving principles surfaced ≥ 30 times with 0 verified
  applications, merges for principles that keep co-surfacing, and new relations. Everything
  goes to review; nothing is archived automatically.

## 9. Other consumers

- **Roadmap Copilot**: swap its `stacks_*` tools for the same two tools (`consumer =
  roadmap_copilot`), passing the opportunity description as the context descriptor.
- **Course Copilot**: same swap, with a soft `instructional_design` boost by default. It
  says when the library holds little on the topic rather than claiming there is no guidance.
- **Engineers' Claude Code**:
  - ally-be exposes `POST /first-principles/mcp`: JSON-RPC `tools/list` + `tools/call` for
    `search_principles`, `get_principles`, `list_domains`, plus a `planning_context`
    prompt, matching the four Stacks surfaces so habits carry over. Results use the same
    principle cards.
  - Auth: a **separate read-only personal key** (`fp_reader_keys`) sent as
    `Authorization: Bearer`, created from the **Connect Claude Code** sheet (§10.8), with a
    per-key rate limit (Redis) and `lastUsedAt`.
  - Each repo's `.mcp.json` points at it. Then delete `stacks-bridge.mjs` and the
    `.claude/skills/stacks` skill (replaced by a `first-principles` skill). Update every
    `CLAUDE.md` / `AGENTS.md`, and rewrite `wiki/contributing/planning-with-stacks.md` as
    `planning-with-first-principles.md`.
  - Retrievals log with `consumer = mcp_dev` (retrieval stats only; no applied signal).

## 10. Experience design

### 10.1 What it must feel like
1. **Drop and walk away.** No click is required between dropping files and finding principles
   in the library. Every question the system could ask has a default; exceptions appear as
   quiet rows, never as dialogs.
2. **Show the payoff, not the pipeline.** The admin sees documents become principles. Stages,
   scores and retrievers exist only behind "How was this found?".
3. **The interview stays a conversation.** Principles shape the questions; they are never
   recited. A code is a chip, never a sentence.
4. **One place for everything that needs you.** Held principles, duplicate decisions, failed
   documents and grading tasks share one Inbox and one count.
5. **Fast, and keyboard all the way.** Optimistic actions with undo, instant search, keyboard
   triage, live progress.

Builder's house rules apply throughout:
- Carbon components, Tailwind, lucide icons; existing Builder pieces (`Sheet`,
  `CommandPalette`, `DiffBlock`, `DecisionCard`, `TurnReceipt`, `SessionPanel`) are extended
  rather than new ones invented.
- The motion vocabulary in `builderMotion.ts`.
- Every state is specified before styling (§10.9).

### 10.2 Where it lives
The Builder room gains a fourth tab: **Now · Rules · History · First Principles**
(`?tab=principles`). Inside it are three views, each deep-linkable with `?view=`:

| View | Job | Primary action |
|---|---|---|
| **Library** (default) | See and search what we know; see each document's result | **Add documents** |
| **Inbox** (count badge) | Everything that needs a person | Work the next item |
| **Insights** | Is it helping, what's missing, what's noise | Act on the top suggestion |

Plus three things that aren't tabs:
- the **upload dock**, visible anywhere in Builder while documents are being added (§10.3)
- the **principle sheet** (`?principle=FP-0142`), openable from anywhere a code appears
- the **Connect Claude Code** sheet, from the tab's overflow menu (§10.8)

The command palette gains "Add documents", "Search principles", "Open Inbox" and
"Go to FP-…".

Revision 3's six tabs map in as follows:
- Queue → the dock
- Search preview → the Library search box, plus "How was this found?"
- Review → the Inbox
- Access → the Connect sheet

### 10.3 Adding documents
**Entry points**
- Drop anywhere on the tab. A full-tab overlay says "Drop to add 4 documents". Files that
  aren't PDF or EPUB are named in the overlay before the drop ("2 files will be skipped: not
  PDF or EPUB").
- The **Add documents** button opens a file picker, so dropping is never required (keyboard
  and screen readers). Its menu has one option: "Review before adding".
- The command palette.

**The upload dock** sits bottom-right, is collapsible, and survives navigation within Builder.
- **Header:** one summary line, "Adding 12 documents · about 4 min left".
- **Rows:** one per document, with its title, **one progress bar across all stages**, a
  plain stage label and its time left.
- **Stage labels:** Reading → Uploading → Waiting (3rd in line) → Extracting principles
  (14 of 31 parts) → Finishing up → **23 principles added**.
- **Row actions** on hover or focus: pause, cancel, move up. Cancel offers 6 seconds of undo.
- **Browser tab title** carries progress: "(5/12) First Principles".

**The tab-close moment**
- While anything is still reading or uploading, the dock header says "Keep this tab open · 2
  still uploading", and leaving the page triggers the browser's warning.
- When the last upload lands, the header changes to **"✓ Safe to close this tab. We'll let
  you know when it's done."** It is one of only two expressive animations in the feature.

**Exceptions** appear as rows in the dock with the default already applied, so nothing waits:

| Situation | Row says | Actions (default first) |
|---|---|---|
| Same file already in the library | "Already in your library" | **Skip** · Re-extract with current settings |
| Same title, different file | "Looks like the PDF added on 3 Oct" | **Skip** · Add anyway |
| Scanned PDF, no text | "No text to read: this looks like a scanned PDF. Export a text-based PDF and drop it again." | **Remove** |
| Cost cap reached | "Paused at the $4.10 limit" | **Continue** · Stop here |
| Would wait past 24h | "Would start in ~22h, after its text expires" | **Add later** · Add anyway |
| Some parts failed | "22 of 24 parts done" | **Retry 2 parts** |

**Cost** shows as small text in the dock footer ("≈ $6.20 estimated") and only interrupts if
the batch limit is set and reached.

**The payoff**
- When a document finishes, the notification bell and a toast say: "**Design systems guide:
  23 principles added**, 4 strengthened existing ones, 2 need a look". The action is **See
  what's new**.
- That opens the Library filtered to that document, newest first, with new rows briefly
  highlighted.
- The toast is the second expressive animation; everything else uses the productive set.

### 10.4 Library
A dense desktop list, because admins use it for long stretches.

**Top of the view**
- A search box (`/` focuses it). Results update as you type, debounced to ~250 ms.
- Filter chips with counts: domain, strength, kind, document, status.
- Sort: best match / most used / newest.
- A segmented control: **Principles | Documents**.

**A principle row**
- The **statement** is the hero.
- Under it, one muted line: domain · strength · "from 2 documents" · "used in 6 PRDs".
- The code sits right-aligned in mono, with copy on hover.
- Strength is shown as icon + word ("Must"), never colour alone.
- Search results add a match label ("Strong match" / "Good match") with an icon.

**Principle sheet** (existing `Sheet`), in reading order:
1. the statement
2. **Why**: the rationale
3. **When it applies**
4. **Question it raises**: the probe
5. **Warning sign**: the anti-pattern
6. **Related** and **Trade-offs**, as linked chips
7. **Where it came from**: document title and section, never names
8. **Usage**: a small sparkline and "applied in 6 PRDs"
9. **History**

Actions: **Edit** inline (no modal; save on blur, with undo), Archive (undo toast), Copy code.

**"How was this found?"** is a toggle beside the search box. It adds per-row diagnostics:
keyword, statement and situation ranks, grade, and why anything was dropped. This replaces the
separate search preview tab. Library search uses the fast pipeline (no re-rank) so results
never reshuffle under the cursor; the toggle can switch re-rank on to compare.

**Documents view**
- A table: title, version, added, principles kept, need a look, cost, status.
- A row opens a sheet with the overview and the yield report written as sentences: "Read 31
  parts · kept 23 principles · strengthened 6 existing ones · left out 9 as too generic ·
  2 need a look".
- Actions: Re-extract (drop the file again) and Archive.

**New principle** (overflow menu) opens a form with **live hints** from the same
deterministic checks the pipeline uses: a length counter, "Say what 'this approach' is", "No
names of people or organisations".

### 10.5 Inbox
**One queue** for:
- principles held for a look
- "same or different?" decisions
- curator suggestions
- failed or expired documents
- grading tasks

It is grouped by type with counts, and ordered by impact: anything holding up a document
first, grading last.

**One item at a time**, in a focused card:
- The **reason it's here comes first**, in one sentence ("Might be the same as FP-0142").
- Keyboard: `A` approve · `E` edit · `R` reject · `M` merge · `S` skip · `J`/`K` next and
  previous · `?` shortcut sheet. Every shortcut also has a visible button with its key shown.
- "Same or different?" cards show both principles side by side with differences highlighted
  (`DiffBlock`). Choices: **Same: merge** · **One refines the other** · **They conflict** ·
  **Different**.

**Optimistic and reversible**
- An action applies instantly and the next card slides in (productive motion, 240 ms). An
  undo toast stays for 6 seconds.
- There are no confirmation dialogs, because every action is reversible: rejected means
  archived and recoverable.
- The next three cards are prefetched so the next one is instant.

**Bulk:** when grouped by document, "Approve all 12 from Design systems guide" opens a peek
list first.

**Grading tasks** build the benchmark:
- "Grade 8 results for: *designing a first-run screen*". Keys `0`–`3` map to **Not relevant
  · Related · Relevant · Exactly right**.
- Progress reads "23 of 60 searches graded · about a minute each".
- The admin can stop at any point.

**Empty state:** "Nothing needs you. Documents only send things here when a decision is
needed." It is calm, with no celebration.

**Attention:** a count badge on the tab only. Inbox items never send notifications, so the
library never nags.

### 10.6 Insights
Three answers at the top, each with one action:

| Question | Example | Action |
|---|---|---|
| **Is it helping?** | "PRDs written with principles pass 18% more checklist items" (replay eval), plus the verified-use trend | View report |
| **What's missing?** | "Offline sync: 6 sessions searched and found nothing" (gap clusters) | **Add documents** (opens the picker) |
| **What's noise?** | "14 principles shown 30+ times, never used" | Review in Inbox |

Below the fold:
- Carbon charts: library by domain, usage by consumer, search quality by split over time,
  latency.
- Labelled axes, small-sample warnings, and never colour as the only carrier of meaning.

### 10.7 Inside the interview
- **Principle-led questions read naturally.** "What should someone see the first time they
  open this, before they have any scenarios?" sits above a quiet chip, **Guided by:
  design the empty state first**, with the code on hover. The message itself never says
  "FP-0142 suggests". At most one per turn.
- **Principles in play.** A collapsible section in the existing `SessionPanel`, "Principles in
  play (12)", grouped by PRD section. Each principle carries a status as icon and word:
  **Applied** ✓, **Open** ○, **Trade-off** ⚠. This *is* the coverage view; there is no
  separate panel.
- **Trade-off cards** (`DecisionCard`):
  - Options are worded as outcomes, not principle names ("Ship the list without first-use
    tips (faster)" vs "Add first-use tips (clearer)").
  - The principles appear as small chips.
  - A **recommended** option comes with a one-line reason, plus **Decide later**.
  - Raised only when both principles are strong matches in the same PRD section, at most one
    per turn.
- **PRD check findings**, grouped by PRD section with must-fix first:
  - Each finding has one sentence, a principle chip, and **Preview fix**, which opens a
    `DiffBlock` with the proposed change and Accept / Edit / **Not relevant**.
  - "Not relevant" is recorded as unhelpful feedback, so feedback needs no extra widget.
  - "Accept all must-fixes" shows the list first.
- **Citations in the PRD** render as small superscript chips; hover shows the principle.
  Exports (`prdExport.ts`) turn them into a short "Principles applied" footnote list.
- **Turn receipt:** "Consulted 6 principles · used 2", collapsed by default.
- **No waiting on principles.** Proactive retrieval never delays the first token: the guidance
  brief builds alongside the first turn and joins from the second if it is late. There is no
  "searching principles…" spinner; the receipt reports it afterwards.

### 10.8 Connect Claude Code (engineers)
A three-step sheet:
1. **Create a key**, named "My laptop" by default. It is shown once, with a copy button.
2. **Add it to your repo**: a pre-filled `.mcp.json` snippet and env line, each with copy.
3. **Test connection** runs a real search with the key and shows "Connected: 8 principles for
   'empty state'", or the exact failure in plain words.

Below the steps: your keys, last used, and Revoke (with undo).

### 10.9 States, copy, accessibility and motion
**States**

| Surface | First run / empty | Loading | Partial | Error | Saturated |
|---|---|---|---|---|---|
| Library | Hero drop zone: "Drop product, UX and engineering documentation. We pull out the principles and delete the text." Three-step strip (Drop → We extract → Your interviews use them). A privacy line: "Files are never stored. Text is deleted as soon as principles are extracted, within 24 hours at most." | Skeleton rows; after 3 s "Still loading…" | — | Inline retry with the reason | Virtualised list (5,000+ rows), chip counts, search first |
| Search | "Search for a situation, e.g. *first-run screen*" | Previous results stay, dimmed | — | "Search is unavailable right now. This says nothing about what the library holds." | Top 20, then "Show more" |
| Dock | Hidden | Per-row stage labels | Per-row part counts and retry | Row explains, with a default action | Collapses to its summary line |
| Inbox | "Nothing needs you" | Card skeleton | — | Action failed → item restored, toast with retry | Grouped counts, bulk by document |
| Interview | No library yet → principles stay silent, with no empty-state noise | Never blocks a turn | Brief joins late | Soft failure; the receipt says "Principles unavailable this turn" | Budget of ~25 in play |

The tab is hidden entirely without `BUILDER_FIRST_PRINCIPLES`.

**Copy glossary**: internal words never reach the UI.

| Internal | UI |
|---|---|
| distil | extract principles |
| segment | part |
| source | document |
| band high / medium | Strong match / Good match |
| status `review` | Needs a look |
| superseded | Merged into FP-… |
| over_cap | Not kept: lower priority |
| platitude | Too generic |
| ungrounded | Not supported by the document |
| tension | Trade-off |
| probe | Question it raises |
| antiPattern | Warning sign |
| corroboration (`sourceCount`) | "from N documents" / "strengthened" |

**Accessibility**
- Every drag action has a button.
- Focus moves to the next Inbox card after an action and returns to the trigger when a sheet
  closes.
- Dock progress goes to a polite ARIA live region, throttled to one update every 10 seconds.
- Match strength, status and strength always pair an icon with a word.
- Shortcuts are listed in `?` and never the only way to act.
- Carbon tokens provide contrast.

**Motion** follows `builderMotion.ts`:
- Productive for rows, progress and card transitions.
- **Expressive only twice:** "Safe to close this tab" and the document-finished toast.
- Nothing animates while idle: a waiting document shows a still "Waiting", not a spinner.
- `prefers-reduced-motion` removes movement, never information.

**Speed targets** (first guesses)
- Library search updates < 300 ms after typing stops (fast pipeline, cached).
- The next Inbox card appears < 100 ms after an action (prefetched).
- Dock updates within 2 s of a server change (WebSocket).

### 10.10 Switches
- Feature toggle `BUILDER_FIRST_PRINCIPLES` (separate from `BUILDER`) shows or hides the whole
  tab.
- In **Builder settings**:
  - `principlesBrief`: off / shadow / on
  - `principlesProbes`: off / on
  - the active **search setup** (index version, re-rank, contextualisation, weights), which
    can only change by picking a setup that has a benchmark report, with the report's headline
    numbers shown next to each choice

## 11. Build order (chunks; each one ships and is tested on its own)

| # | Chunk | Done when |
|---|---|---|
| 1 | **Library core + retrieval pipeline + eval runner**: `fp_*` migrations; `FirstPrinciple_v1` (flat index, named vectors, BM25 boosts); ally-ai endpoints; outbox sync and reconciliation; `FirstPrinciplesRetrievalService` (three retrievers, RRF, soft filters, hydration, bands from RRF, MMR, logging, caches); manual add; the benchmark tables and `first-principles:eval` runner | Hand-added principles come back with per-retriever ranks logged; the eval runner produces a report on a small hand-labelled set; prod Weaviate version confirmed; tests and lint green in ally-be and ally-ai |
| 2 | **Server ingestion**: sources/check/segments API, Redis staging, queue worker, overview → distil (decontextualised, example queries) → gate (deterministic, verbatim, injection, platitude, critic with groundedness + standalone) → dedupe with adjudicator under a lock → consolidation (cap, relations), cost cap, re-distil, yield report | Posting several real documents' segments produces capped, grounded, standalone principles with yield reports, in queue order, with no cross-document duplicates; no segment text in Postgres; Redis keys gone afterwards |
| 3 | **Browser extraction + the First Principles tab**: multi-file drop and Add documents button, Web Worker extraction, normalisation, structure-first segmentation with context-only overlap; **upload dock** with exceptions-as-rows and the safe-to-close moment; WebSocket progress; **Library** (principles, documents, search with "How was this found?", principle sheet, new principle with live hints, first-run state); **Inbox** (keyboard triage, undo, same-or-different cards, grading tasks); copy glossary applied | The owner drops the seed documents **with no required clicks**, is told when it's safe to close the tab, and gets a "what you got" toast per document; 20 Inbox items triaged by keyboard in under 3 minutes; every surface has its §10.9 states; extraction-recall spot-check on 3 documents; a first **pooled, graded benchmark** of ~60 queries graded through the Inbox |
| 4 | **Re-rank + Builder swap**: graded re-ranker with fallback; benchmark it (on vs off); `principles_*` tools, principle cards, prompts, citation parsing, integrity check + verifier; **"Guided by" chips, citation chips, collapsed turn receipt**; brief in **shadow** mode | Benchmark report decides the re-rank default; an interview cites `[FP-…]`, invented codes are stripped, verified applications recorded; no principle code appears in the interviewer's prose; Stacks no longer called by Builder |
| 5 | **Guiding the admin**: context descriptor, brief + section focus within the budget, principle-led questions (one per turn), **Principles in play** in the session panel, outcome-worded trade-off cards with a recommendation, PRD check with **Preview fix** diffs and implicit feedback; **replay eval off vs on** | Test-split Recall@50 ≥ 0.9 and nDCG@8 ≥ 0.6, and the replay eval improves with no fixture regressing; then `principlesBrief` and `principlesProbes` go on by default |
| 6 | **Feedback loop + experiments + Insights**: thumbs, shipped linkage, calibrated LLM judge (κ check) on production samples, position-corrected effectiveness, in-band prior, exploration, curator; experiments from §7.4; **Insights** with the three answers first | Insights shows real numbers and each answer has a working action; each experiment has a report and an adopt/reject decision |
| 7 | **Copilots + MCP + Stacks removal**: Roadmap/Course Copilot swap, read-only keys + **Connect Claude Code** sheet with Test connection, `/mcp` endpoint, `.mcp.json` in every repo, delete `StacksClientService` + bridge + skill + `STACKS_*` config, docs/wiki rewrite | `grep -ri stacks` finds only history notes |

Chunks 1–4 make it usable; 5–6 make it good and prove it; 7 finishes the cutover. Stacks
stays wired for engineers until chunk 7. Every new prompt goes through the Skills Store, and
from chunk 5 on through a `prompt_gate` eval suite. Every retrieval change from chunk 1 on
comes with a benchmark report.

## 12. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Copyright: keeping the document's text | Browser parsing; text only in Redis with a 24h TTL, never in Postgres or backups; 8-word verbatim check; only location metadata stored |
| Principles not actually in the document (the LLM's own ideas) | Groundedness check against the segment at distil time; ungrounded rejected; groundedness rate in the yield report |
| Principles that only make sense next to their source | Decontextualisation rules, the critic's standalone check, unresolved-reference filter |
| Boundary loss and garbled extraction | Structure-first segmentation, atomic blocks, context-only overlap, column-aware reading order, normalisation, extraction warnings |
| Vocabulary mismatch between query and principle | Example queries, synonym keywords, BM25 + two vectors, optional HyDE |
| Noisy labels silently filtering out good principles | Soft filters by default, back-off on strict filters |
| Near-duplicates crowding results | Adjudicated dedupe at ingest, consolidation, MMR, `refines` collapse |
| Tuning to the benchmark instead of reality | Pooled judgments, frozen test split, production-sourced queries, calibrated LLM judge |
| Index drift or stale results | Outbox sync, nightly reconciliation, hydration from Postgres on every search, versioned collections |
| Embedding or template change breaks retrieval | Blue/green index versions, benchmark before the pointer flips |
| Bland, generic principles | Overview pass, critic, platitude anchors, density cap, sample rating, "surfaced, never applied" in Insights |
| Prompt injection via an uploaded document | Segment delimited as untrusted data; injection screen; cards framed as advisory data; read-only MCP keys |
| The agent games citations | Only surfaced codes count; invented codes stripped; verifier must pass |
| Position bias inflating early favourites | Position-corrected effectiveness from exploration slots; in-band prior only |
| Too much in context dilutes the interview | Card format, ~25-card budget, grouping and ordering rules, cached brief |
| A better prompt can't reach old documents | Re-distil by re-upload, keeping codes and history |
| A large drop overwhelms the browser or the queue | Web Worker, memory released per file, auto-queue, start-time warnings, batch cost cap |
| It doesn't actually improve PRDs | The replay eval gates the proactive features |
| Latency or cost creep | Per-stage latency logged, targets per stage, caches, re-rank fallback, experiments must earn their cost |
| The admin is interrupted or confused by a big drop | Defaults for every exception, exceptions as dock rows, plain-language stage labels, an explicit safe-to-close moment |
| The library becomes a chore to maintain | One Inbox with keyboard triage, undo instead of confirmations, bulk by document, implicit feedback, no notifications for Inbox items |
| Principles make the interview feel robotic | Natural questions with a quiet chip, one principle-led question per turn, outcome-worded trade-offs, nothing blocks the first token |
| Internal jargon confuses users | Copy glossary enforced in review; diagnostics only behind "How was this found?" |

## 13. Open questions

None blocking. Thresholds and weights (§3, §6.5, §6.6, §7.3, §8.4) are first guesses, to be
set on the benchmark's tuning split, not decided up front.
