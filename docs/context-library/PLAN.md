# Context Library — plan (revision 5)

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> One central system that turns uploaded documentation into retrieval-ready **chunks**,
> organised into **collections**, each readable only by the **use cases** allowed to read it.
> Replaces the third-party **Stacks** MCP everywhere it is used, and the Knowledge Base's
> `character_library` corpus.

## Revision history

| Rev | What changed |
|---|---|
| 1 | First plan: browser-parsed documents distilled into principles for the Builder PRD interview, replacing Stacks |
| 2 | Success measures, Redis staging, re-distil by re-upload, probes and decision cards, critic and platitude gate, overview pass, shadow mode |
| 2a | Documentation, not other kinds of upload; no author or publisher names; drop and queue many documents |
| 3 | RAG design review: decontextualised chunks, groundedness check, structure-first segmentation, doc2query, three retrievers with RRF, graded re-rank, MMR, versioned flat indexes, pooled benchmark |
| 4 | UX review: Library / Inbox / Insights, upload dock, keyboard Inbox, natural principle-led questions, states, copy, accessibility and motion |
| **5** | **Context Library**: the engine becomes general. **Collections** (First Principles, Learning Design, Character Insights) each define their own chunk type; **use cases** get access per collection. Studio's Course Copilot and the Character Library interview move onto it. The Knowledge Base `character_library` corpus is retired once the new collection matches it. Build steps are now called **phases** |

## 0. The idea in one paragraph

An admin drops PDF or EPUB documentation into the **Context Library** and picks which
**collection** it feeds. The browser cleans each document and splits it by its structure into
segments. ally-be writes an overview of the document, then each target collection's own
**extractor** distils the segments into **chunks**: short, self-contained, grounded units in
our own words. In First Principles and Learning Design a chunk is a *principle*; in Character
Insights it is an *insight*. The documents and their text are **never kept**. Every chunk is
indexed in its collection and searched by one retrieval pipeline: three retrievers, fusion,
graded re-rank and diversification. A **use case** (the Builder interview, the character
interview, Studio's Course Copilot, Roadmap Copilot, engineers' Claude Code) can only search
the collections it has been granted. Every search, hit and verified use is logged per use case
and collection. A pooled, graded benchmark per collection proves each change helps before it
ships.

## 1. Decisions already made

| Question | Decision |
|---|---|
| Name | **Context Library**: one centralised system that builds chunks. Product-facing collections keep their own names (First Principles, Learning Design, Character Insights) |
| Access | **Different chunks for different use cases.** Each use case may read only the collections granted to it (§2.3) |
| Character interview | **Moves fully onto distilled Character Insights** (option 1). The `character_library` Knowledge Base corpus is retired after the new collection matches it (§9.2) |
| Studio | Simulation Studio's **Course Copilot** reads a **Learning Design** collection instead of Stacks |
| Review gate | **Auto-publish + spot-check**, set per collection. Sensitive character insights always get a look (§2.2) |
| Processing | **Background on the server.** The browser parses and uploads, then can close |
| Uploading | **Drop many documents at once and keep adding while it runs**; each drop chooses one or more target collections |
| Replace Stacks in | All four places: Builder interview (+ research + PRD review), Roadmap Copilot, Course Copilot, engineers' Claude Code (our own MCP endpoint replaces `stacks-bridge.mjs`) |
| Seeding | The owner has the documents that seeded Stacks and will upload them. The character collection is seeded from the existing corpus's stored text, with no re-upload |
| House rules | **Uploaded documents only.** No import of the deprecated `wiki/product/` pages. Hand-adding a chunk stays available |
| Distillation model | **Builder's configured model.** Smaller models only for the high-volume judging steps (re-rank, adjudication, citation check, relevance judge) |
| Engineer access | **Separate read-only keys**, scoped to what the `mcp_dev` use case may read |
| What gets uploaded | **Documentation** (PDF, EPUB) of any length |
| Naming | Code, schema, prompts and code documentation say **document** (or **source** for its database record), **segment** for the piece sent to an extractor, **chunk** for what is stored and retrieved, **collection** and **use case**, and no other terms for these. The UI uses each collection's own noun (principle, insight). Build steps are **phases** |
| Source metadata | **Title, version and year only.** No author, publisher or contributor names are stored, sent to the server, or written into chunks or overviews |
| Tenancy | Platform-global and Ally-curated, like today's character corpus. Organisation-owned collections are out of scope for now (§13) |

## 2. Concepts

### 2.1 Terms

| Term | Meaning |
|---|---|
| **Document** | An uploaded PDF or EPUB. Never stored; only its title, version, year and hash are kept |
| **Segment** | A structure-aware piece of a document (~2,500 tokens) sent to an extractor. Lives in Redis for at most 24h |
| **Chunk** | The stored, retrievable unit: short, self-contained, grounded in its segment, written in our own words |
| **Collection** | A named set of chunks of **one chunk type**, with its own extraction profile, index, benchmark and review policy |
| **Profile** | The code that defines a collection's chunk type (§2.4) |
| **Use case** | A caller of the retrieval service (e.g. `builder_interview`), with its own access grants, defaults and logs |

### 2.2 Collections at launch

| Collection | Chunk noun · code | What a chunk is | Review policy | Read by (default) |
|---|---|---|---|---|
| **First Principles** | principle · `FP-0142` | A product, UX or engineering rule, heuristic, anti-pattern or trade-off | Auto-publish + spot-check | Builder interview, research, PRD review, Roadmap Copilot, engineers |
| **Learning Design** | principle · `LD-0031` | An instructional-design principle: outcomes, sequencing, practice, assessment, feedback, difficulty | Auto-publish + spot-check | Course Copilot, engineers |
| **Character Insights** | insight · `CI-0207` | A specific observation about how people in a situation present, think, talk, live and cope, written so a character can be built from it | Auto-publish + spot-check; **every `sensitive` insight goes to review** | Character Library interview |

New collections are added by writing a profile and a migration. No engine changes are needed.

### 2.3 Use cases and access
- Use cases are defined in code (`CONTEXT_USE_CASES`): id, label, default collections, default
  limit, re-rank, context budget, and whether queries are sensitive.
- **Grants are data** (`cl_use_case_access`), so a platform admin can change them in **Context
  Library → Settings → Use cases** without a deploy. Every change is logged.
- The retrieval service **requires** a use case on every call. It searches only that use
  case's granted collections, and a request naming any other collection is **refused, not
  filtered**. This follows the Knowledge Base rule: "a filter can be forgotten; a required
  argument cannot."
- Some grants are **locked** in code and cannot be switched on in the UI. Character Insights
  (clinical and lived-experience material) can never be granted to `mcp_dev`.

Default grants (✓ granted, — not granted, 🔒 locked off):

| Use case | First Principles | Learning Design | Character Insights |
|---|---|---|---|
| `builder_interview` · `builder_research` · `builder_prd_review` · `builder_brief` | ✓ | — | — |
| `roadmap_copilot` | ✓ | — | — |
| `course_copilot` | — | ✓ | — |
| `character_interview` | — | — | ✓ |
| `mcp_dev` (engineers' Claude Code) | ✓ | ✓ | 🔒 |
| `admin_preview` · `eval` | ✓ | ✓ | ✓ |

When a use case searches more than one collection, each is searched separately and the
results are fused by rank (§8.3), because scores are not comparable across collections.

### 2.4 What a collection profile defines
A profile is code (`src/context-library/profiles/<collection>.profile.ts`) plus Skills Store
prompts:
- **Chunk fields**: the shared core (§6) plus a typed `attributes` schema, validated on every
  write
- **Facets**: the attributes that are filterable, mirrored to the index
- **Controlled vocabularies**: domains, aspects, themes
- **Extractor prompt** and **critic rubric**, including the profile's extra gate checks
- **Card template**: how a chunk is shown to a model (§8.4)
- **Index template**: the text behind each vector and the BM25 field boosts
- **Density cap** and **review policy** defaults
- **Retrieval defaults**: retriever weights, re-rank on or off, MMR λ
- **Copy**: the chunk noun, UI labels for each attribute, and empty states

## 3. What exists today (and what we reuse)

| Existing piece | Where | How we use it |
|---|---|---|
| `StacksClientService` (JSON-RPC to Stacks) | `ally-be/src/llm-agent/service/stacks-client.service.ts` | **Deleted** at the end. Its soft-failure messaging carries over. Per its own header, Builder has never reached Stacks in production |
| Builder tools `stacks_search` / `stacks_get` | `ally-be/src/builder/service/builder-interview-tools.service.ts`, evidence log, turn receipt, `interviewer_system.txt`, `research_system.txt` | Replaced by `principles_search` / `principles_get` over the `builder_*` use cases |
| Course Copilot `design_guidance_search` / `design_guidance_get` | `ally-be/src/course-copilot/service/course-copilot-tools.service.ts` | Same tool names, backed by the `course_copilot` use case (Learning Design) |
| Roadmap Copilot Stacks tools | `ally-be/src/product-roadmap/service/roadmap-copilot-tools.service.ts` | Backed by the `roadmap_copilot` use case |
| **Character interview `search_corpus`** (KB `character_library`, 800-token verbatim passages, topic boost, served-chunk tracking, honest empty and failure messages) | `ally-be/src/scenario-character/service/character-interview-tools.service.ts` | **Same tool name and `topics` parameter**, backed by the `character_interview` use case (Character Insights). Served-chunk tracking switches to codes |
| Character topics (`identity`, `life_context`, `inner_life`, `history_and_presenting_concern`, `speech_and_language`) | `ally-be/src/knowledge-base/enum/knowledge-base.enum.ts`, `ally-web/apps/ally-admin-dashboard/src/components/character-corpus/characterTopics.ts` | Become Character Insights' `aspect` vocabulary, so the interviewer's prompt and topic boost keep working |
| Character corpus admin panel | `ally-web/apps/ally-admin-dashboard/src/components/character-corpus/CharacterCorpusPanel.tsx` | Replaced by a summary card linking to the Context Library (§10.2) |
| Knowledge Base pattern: Postgres as system of record, a derived Weaviate index per corpus, `embeddingStatus` / `textHash` / reconciliation | `ally-be/src/knowledge-base/`, `ally-be/src/product-roadmap/service/roadmap-vector.service.ts`, `ally-ai/app/core/knowledge_base/` | Same pattern, **one Weaviate collection per Context Library collection**, for the KB's reason: a score threshold only means something within one distribution. **No pgvector** |
| Retrieval log tables and judge | `ally-be/src/knowledge-base/entity/`, `ally-ai/app/core/rag_quality/` | Models for `cl_retrievals` / `cl_retrieval_hits` / `cl_judgments`; the RAG-quality judge is reused with a rubric per collection |
| Builder replay eval and `prompt_gate` suites | `ally-be/src/builder/eval/` | End-to-end measure for Builder; gate on Builder-facing prompt changes |
| Decision cards, PRD review, `Sheet`, `CommandPalette`, `DiffBlock`, `TurnReceipt`, `SessionPanel`, `builderMotion.ts` | `ally-be/src/builder/`, `ally-web/apps/ally-admin-dashboard/src/components/builder/`, `ally-web/apps/ally-admin-dashboard/src/pages/Builder/` | Interview experience and house UI conventions (§10) |
| Lesson usage loop and curator | `builder-knowledge.service.ts`, `builder-lesson-curator.service.ts` | Same loop for chunks |
| Builder outcomes | `builder-outcome.service.ts` | Links "chunk applied" to "PRD shipped" |
| Skills Store prompts | `ally-be/docs/adding-a-prompt.md` | Every new prompt, per collection where it differs |
| Skills Store personal keys | `ally-be/src/prompt/service/skills-store-key.service.ts` | Pattern only, for read-only Context Library keys |
| Redis, `@nestjs/schedule`, Builder WebSocket gateway | ally-be | Segment staging with a TTL, caches, rate limits, background worker, live progress |
| AI task registry | `ally-be/src/llm/constants/ai-task-registry.constants.ts` | **Every new LLM call gets a row in the same PR** (CI enforces it) |

Gaps found in ally-ai: no BM25 query with property boosts, no named vectors, and no flat
index config (existing collections all use HNSW). Weaviate 1.28 (the local image) supports
all three; **phase 1 confirms the production server version**.

## 4. Success measures

Measurement comes before the features it judges, **per collection**. Thresholds are first
guesses to revise from real numbers.

### 4.1 Retrieval benchmark (one per collection)
- **Queries**, stratified by facet:
  1. admin-written situations;
  2. real queries from `cl_retrievals` for the collection's use cases. For Character
     Insights these come from day one: the existing `kb_retrievals` rows logged by the
     character interview;
  3. **synthetic queries** from a separate prompt, never indexed, so they can't leak into
     chunks' example queries.

  Some queries deliberately have no answer, to test abstention.
- **Pooled, graded judgments**: the union of the top 20 from BM25-only, each vector, fused,
  and fused + re-rank, each hit graded 0–3. The admin grades through Inbox grading tasks; the
  LLM judge (with that collection's rubric) is used only after **Cohen's κ ≥ 0.6** against the
  admin on a shared sample.
- **Splits**: tuning and frozen test, starting at ~60 queries and growing past 150.
- **Metrics by stage**: Recall@50 (candidates), nDCG@8 / precision@8 / MRR (final),
  abstention, diversity, latency and cost.
- **Runner**: `context-library:eval --collection <id> --config <name>` stores a report. It
  runs on every retrieval, index or retrieval-prompt change, and nightly. **Bars:** test-split
  Recall@50 ≥ 0.9 and nDCG@8 ≥ 0.6 before proactive features go on for that collection. No
  change ships if it lowers test-split nDCG@8.

### 4.2 Extraction quality (per document, per collection)
- **Yield report**:
  - candidates → kept / merged / reviewed / rejected, by reason
  - groundedness and standalone rates
  - review rate
  - a 20-chunk sample the admin rates 1–5
  - extraction-recall spot-check on three reference documents per collection
- **Bars:** review rate ≤ 20% (Character Insights excludes sensitive items from this rate,
  because they are reviewed by policy); sample rating ≥ 3.5; groundedness ≥ 95%.

### 4.3 Outcomes per use case
- **Builder**: the replay eval with the context off vs on, scored against human-written
  checklists. Proactive features go on by default only if it improves with no fixture
  regressing.
- **Character interview**: **parity before retirement** (§9.2). On the logged interview
  queries, the benchmark must match or beat the old corpus. Then in a blind side-by-side on 10
  recorded interviews, characters drafted with Character Insights must be preferred or tied in
  at least 7.
- **Course Copilot**: benchmark bars, plus a blind side-by-side on 5 course blueprints with
  and without Learning Design.

### 4.4 Online signals (Insights)
Per collection and use case: zero-result rate, low-band-only rate, re-rank drop rate, p95
latency, cost per session, cache hit rate. `admin_preview` and `eval` traffic is excluded
from usage stats and effectiveness.

## 5. Architecture

```
 Admin browser (ally-admin-dashboard → Context Library)
   drop many PDF / EPUB files, choose target collection(s) → browser queue
   Web Worker, 2 at a time: SHA-256 → extract → normalise → structure-first segments
        │  POST /context-library/sources/check        (all hashes + titles of the drop)
        │  POST /context-library/sources              (per document: metadata, hash, targets)
        │  POST /context-library/sources/:id/segments (batched segment text + context)
        ▼
 ally-be  ── context-library module ───────────────────────────────────────────
   Redis  cl:segment:{id}  (text + context-only overlap, TTL 24h,
                            deleted once every target collection has extracted it)
   Postgres cl_sources + cl_ingest_segments + cl_segment_runs (one per segment × collection)
        │  worker (FOR UPDATE SKIP LOCKED, by queuePosition then ordinal, concurrency N)
        ▼
   OVERVIEW (once per document, shared by every target collection)
   EXTRACT per segment × collection, using that collection's PROFILE
     → deterministic gate → CRITIC (grounded, standalone, profile checks) → platitude check
     → dedupe within the collection: merge | ADJUDICATE | publish
   CONSOLIDATE per document × collection: cluster, density cap, relations
        ▼
   cl_chunks (system of record) ──outbox──► ally-ai Weaviate, one versioned flat index per
                                            collection: Ctx<Collection>_v{N}
                                            (vectors: statement, situations; BM25 boosts)
   ContextLibraryRetrievalService.search({ useCase, … })
     access check (use case → granted collections) → per collection: contextualise →
     3 retrievers → RRF → soft facets → top 50 → fuse across collections by rank →
     graded re-rank → hydrate from Postgres → bands → MMR → in-band prior → exploration →
     cards (per-collection template)
        ◄── builder_* · roadmap_copilot      (First Principles)
        ◄── course_copilot                  (Learning Design)
        ◄── character_interview             (Character Insights)
        ◄── mcp_dev via /context-library/mcp (First Principles, Learning Design)
   logs: cl_retrievals, cl_retrieval_hits; citations → verifier → cl_usage_events
   eval: per-collection pooled benchmark runner → reports
```

## 6. Data model (ally-be Postgres, platform-global, `BaseWithoutTenantEntity`)

All tables are prefixed `cl_`. **No document file and no source text is stored in
Postgres**, so none of it can reach a database backup.

### `cl_collections`
`id` (slug: `first_principles`, `learning_design`, `character_insights`), `name`,
`chunkNoun`, `codePrefix`, `profileVersion`, `reviewPolicy` (`auto_spot_check` ·
`sensitive_to_review` · `review_all`), `densityCap` jsonb, `retrievalDefaults` jsonb,
`activeIndexVersion`, `status` (`active` · `retiring`), timestamps. Profiles themselves live
in code; this row holds the settings an admin can tune.

### `cl_use_case_access`
`useCase`, `collectionId`, `enabled`, `weight` (fusion weight when a use case reads several
collections), `updatedBy`, `updatedAt`; history in `cl_use_case_access_log`. Locked
combinations are enforced in code, whatever the table says.

### `cl_sources`: one row per uploaded document
`id`, `title`, `docVersion`, `year`, `kind` (`pdf` | `epub` | `kb_migration`), `language`,
`fileHash`, `titleKey`, `overview` (≤ 150 words, no people or organisations named),
`targetCollections` `text[]`, `pageCount`, `segmentCount`, `extractionWarnings` jsonb,
`status` (`uploading` | `queued` | `extracting` | `consolidating` | `paused` | `complete` |
`failed` | `cancelled` | `archived`), `batchId`, `queuePosition`, `queuedAt`, `pausedAt`,
`estimatedStartAt`, `yield` jsonb (per collection), `distillModel`, `promptVersions` jsonb,
`inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`, `costCapUsd`, `generation`,
`uploadedBy`, timestamps.

### `cl_ingest_segments` and `cl_segment_runs` (no text)
- **Segment:** `id`, `sourceId`, `ordinal`, `sectionPath`, `pageFrom`, `pageTo`, `textHash`,
  `tokenCount`, `blockTypes`, `status` (`pending` | `done` | `failed` | `skipped` |
  `expired`).
- **Segment run** (one per segment × target collection): `segmentId`, `collectionId`,
  `status` (`pending` | `claimed` | `done` | `failed`), `attempts`, `claimedAt`, `error`,
  `candidatesFound`, `candidatesKept`.
- The segment's Redis text is deleted when its last run completes.

### `cl_chunks`: the library (the retrieval unit)
**Shared core**, the same for every collection:

| Field | Purpose |
|---|---|
| `collectionId`, `code` | `FP-0142` / `LD-0031` / `CI-0207`. A per-collection sequence, never reused |
| `statement` | The chunk's main sentence, **decontextualised**. ≤ 160 chars for principles, ≤ 220 for insights |
| `situations` `text[]` | 1–4 situations it applies to (First Principles' "applies when") |
| `exampleQueries` `text[]` | 3–5 searches it should answer (doc2query). Indexed, never shown |
| `keywords` `text[]` | Exact terms for BM25, including synonyms and variants |
| `topics` `text[]` | Free-form, normalised |
| `facets` jsonb | The profile's filterable attributes (e.g. `domain`, `prdSections`, `aspect`, `themes`), GIN-indexed and mirrored to the index |
| `attributes` jsonb | The profile's other typed fields (§6.1), validated against its schema |
| `quality` jsonb | Critic results: `grounded`, `standalone`, scores, the profile's extra checks, platitude similarity, gate verdict and reasons |
| `status` | `active` · `review` · `archived` · `superseded` (`supersededById`; old codes redirect) |
| `origin` | `distilled` · `manual` · `kb_migration` |
| `sourceCount`, `distillPromptVersion` | Corroboration count, and which extractor version wrote the current wording |
| `embeddingStatus`, `embeddingAttempts`, `embeddedAt`, `textHash`, `indexVersion` | Index outbox |
| usage counters (nightly; eval and preview excluded) | `timesRetrieved`, `timesSurfaced`, `timesRead`, `timesProbed`, `timesAppliedVerified`, `timesHelpful`, `timesUnhelpful`, `timesInShippedPrd`, `lastRetrievedAt`, `lastAppliedAt`, `effectiveness` |
| `version`, `createdBy`, `editedBy` | Edits versioned in `cl_chunk_versions` |

### 6.1 Profile attributes

**First Principles** (`principle`)

| Attribute | Purpose |
|---|---|
| `rationale` | Why it holds, ≤ 300 chars |
| `probe` | The question an interviewer asks to test whether a PRD honours it |
| `antiPattern` | What breaking it looks like |
| `kind` | `rule` · `heuristic` · `anti_pattern` · `trade_off` · `checklist_item` |
| `strength` | `must` · `should` · `consider` |
| facet `domain` | `product_strategy`, `discovery`, `ux_ui`, `interaction`, `content_copy`, `data_viz`, `accessibility`, `architecture`, `backend`, `data`, `ai_llm`, `security_privacy`, `reliability`, `performance`, `testing`, `delivery`, `metrics_analytics`, `growth` |
| facet `prdSections` | `problem`, `users`, `goals_metrics`, `scope`, `ux_states`, `requirements`, `architecture`, `data_model`, `api`, `rollout`, `risks`, `testing` |
| facet `lifecycleStage` | `discovery` · `definition` · `design` · `build` · `launch` · `iterate` |

**Learning Design** (`principle`): the same shape as First Principles, except:
- facet `domain` is replaced by `outcomes`, `sequencing`, `practice`, `assessment`,
  `feedback`, `difficulty`, `motivation`, `accessibility`, `facilitation`
- facet `prdSections` is replaced by facet `courseStage`: `brief`, `blueprint`, `content`,
  `assessment`, `review`
- `probe` is a question for the trainer

**Character Insights** (`insight`)

| Attribute | Purpose |
|---|---|
| facet `aspect` | The interviewer's existing topics: `identity` · `life_context` · `inner_life` · `history_and_presenting_concern` · `speech_and_language` |
| facet `themes` | Controlled and editable: e.g. `anxiety`, `low_mood`, `grief`, `trauma`, `substance_use`, `self_harm_risk`, `relationships`, `work_and_money`, `caregiving`, `identity_and_culture`, `help_seeking` |
| facet `basis` | `clinical_description` · `lived_experience` · `practice_observation` |
| facet `sensitivity` | `standard` · `sensitive` (self-harm, abuse, suicidality and similar) |
| `voiceSamples` `text[]` | 0–3 short lines **written fresh** in the style the source describes. Never quoted; the verbatim check applies |
| `avoid` | The cliché or stereotype to steer clear of (the analogue of `antiPattern`) |
| `handlingNote` | For `sensitive` insights: how to portray it safely in a training character |

The `statement` uses **hedged frequency language** ("many people…", "some describe…"), never
"people with X always…".

### Other tables
- **`cl_chunk_sources`**: `chunkId`, `sourceId`, `generation`, `sectionPath`, `pageFrom`,
  `pageTo`, `confidence`. The location only, never the text.
- **`cl_chunk_relations`**: `fromId`, `toId`, `type` (`tension` · `refines` ·
  `prerequisite` · `related`), `note`, `origin`, `confidence`. Relations stay within a
  collection.
- **`cl_retrievals`**: as revision 4's `fp_retrievals`, plus `useCase` (replacing
  `consumer`), `collectionsSearched` `text[]`, `deniedCollections` `text[]` (a request for a
  collection the use case can't read: logged and refused), and `querySensitive` (true for
  `character_interview`, which may carry an admin's description of a person).
- **`cl_retrieval_hits`**: as before, plus `collectionId`.
- **`cl_judgments`**, **`cl_benchmark_queries`**, **`cl_eval_reports`**: as before, plus
  `collectionId`. Queries also carry `useCase`.
- **`cl_usage_events`**: as before, plus `useCase` and `collectionId`.
- **`cl_reader_keys`**: as before. Scope is whatever `mcp_dev` is granted.

## 7. Ingestion

### 7.1 Browser: the upload queue
The experience is in §10.3. The admin drops **any number of `.pdf` / `.epub` files** and
chooses one or more **target collections** for the drop. One upload feeds every target;
each collection extracts its own chunk type from the same segments.

`hashing → checking → parsing → ready → uploading → queued on server → extracting → complete`

1. **Hash** each file and `POST /sources/check` with all the hashes, titles and targets.
   Duplicates are caught within the drop and against the library, **per collection**:
   - the same file already extracted into a target collection → skip that target by default,
     or re-extract (§7.7)
   - the same file twice in one drop → the second copy is removed
   - the same title with a different file → flagged; default skip
2. **Parse** in a Web Worker, two files at a time (§7.2). A file that fails is marked and the
   queue carries on.
3. **Ready**: auto-queue with default skips and a cost cap of 1.5× the estimate (×
   collections), unless "Review before adding" was chosen. A running batch total shows
   documents, segments, estimated cost and finish, with an optional batch cost cap.
4. **Upload**: `POST /sources` (with `batchId` and targets), then
   `POST /sources/:id/segments` in batches (≤ 1 MB), one document at a time. Memory is
   released per file.
5. **The tab only has to stay open until the last file is uploaded.** The dock says so, then
   says when it is safe to close.
6. Progress after upload comes over Builder's WebSocket gateway, with polling as a fallback.

New ally-web dependencies: `pdfjs-dist`, `jszip` (new, not upgrades).

### 7.2 Extraction and segmentation (in the Web Worker)
Shared by every collection. Structure first, size second.

**Extract**
- **PDF** (`pdfjs-dist`): text items with positions.
  - Reading order is rebuilt from coordinates, with column detection.
  - Running headers and footers and page numbers are removed.
  - Headings come from `getOutline()`, then font-size and weight heuristics, then 8-page
    windows (with an extraction warning).
- **EPUB** (`jszip` + `DOMParser`): OPF spine, `nav.xhtml` / NCX, and real heading, list,
  table, pre and figcaption elements.
- **Metadata:** only the title is read. Author, creator, publisher and contributor fields are
  ignored and never sent.

**Normalise**
- Unicode NFKC; ligatures; join words hyphenated across a line break; collapse whitespace.
- Footnote text is appended to the paragraph that cites it.
- Tables become one line per row; figures are reduced to captions; code blocks are flagged.
- Detect the language. Chunks are always written in English.

**Segment**
- Default-skip boilerplate: table of contents, index, legal or licence notices, copyright,
  revision history, about the authors or contributors (the last cannot be re-enabled).
- Split at heading boundaries; pack siblings to **~2,500 tokens** (max ~4,000). Merge
  sections under ~400 tokens; split oversized ones at sub-headings, then paragraphs.
- **Never split** a list, a table, a code block, or a heading from its first paragraph.
- **Context-only overlap**: the `sectionPath`, the last ~150 tokens of the previous segment
  and the next heading, marked "for understanding only, do not extract".
- Token counts are approximate with a 10% margin. The opening and closing segments are marked
  for the overview pass.

### 7.3 Staging without retention
- Segment text and its overlap go to Redis (`cl:segment:{id}`, **24h TTL**) and are deleted
  once every target collection has extracted the segment.
- An expired key marks the segment `expired`; dropping the file again re-sends only what is
  missing.
- `estimatedStartAt` warns before queueing anything that would wait past ~20h.
- Postgres and its backups never see the text.

### 7.4 Background worker and extraction
- A `@nestjs/schedule` interval claims pending **segment runs** with `FOR UPDATE SKIP
  LOCKED`, by `queuePosition` then `ordinal`.
  - Global concurrency cap (start at 3); 3-attempt retry with backoff.
  - Pause and cancel per document; cancel deletes the Redis text at once.
  - Failures never block the queue. A batch-complete notification goes out at the end.
- **Overview pass, once per document**, shared by every target collection
  (`context_library_overview`): a ≤ 150-word overview, key terms with definitions, and which
  sections are reference material, narrative or filler. Skipped for documents of one or two
  segments.
- **Extract per segment × collection**, with that collection's extractor prompt
  (`context_library_extract_<collection>`).
  - **Cached prefix** (identical across one document and collection): rules, the profile's
    vocabularies, the overview.
  - **Then:** the segment, delimited as untrusted data, and its context-only overlap.
  - **Output:** up to 8 candidates for principle collections, or up to 12 for Character
    Insights (observational detail is denser). Each names the paragraph that supports it.
- **Shared extraction rules** (every profile):
  - own words only; no quotes
  - no examples or case studies lifted from the document
  - **no attributions or names** of people or organisations
  - **decontextualise**: name the subject; no "this approach", "the above", "the document"
  - one idea per chunk
  - synonym-rich `keywords`; `exampleQueries` phrased the way the use case would search
  - "0 chunks" is a valid answer
- **Profile rules** add the rest. Principles: prefer the specific and non-obvious; give
  `probe` and `antiPattern`. Character Insights: concrete and observable over abstract; use
  hedged frequency language; never identify a real person (case vignettes are generalised,
  with no names, places, dates or unique events); give `avoid`, and `handlingNote` when
  sensitive; mark `basis`.
- Stop a document if `costUsd` reaches `costCapUsd`; the admin can raise the cap and resume.

### 7.5 Quality gate
In order, cheapest first. Every outcome is counted by reason in the yield report.
1. **Deterministic**: lengths, required fields, the profile's schema and vocabularies, no
   attribution phrasing, no unresolved references.
2. **Verbatim check**: reject any chunk text field (statement, rationale, probe,
   `voiceSamples`, …) sharing an 8-word run with its segment.
3. **Injection screen**: reject anything addressing an AI or carrying instructions, URLs,
   code or tool names.
4. **Platitude check**: similarity ≥ 0.85 to the collection's platitude anchors → reject.
   Each collection keeps its own anchor list.
5. **Critic pass** (`context_library_critic`, with the profile's rubric and **the segment
   text**):
   - **Grounded?** Supported / partial / unsupported. Unsupported is rejected; partial goes to
     review.
   - **Standalone?** One automatic rewrite, then review.
   - Specificity and actionability 1–5; < 3 → review.
   - Names flagged → review.
   - **Profile checks.** Character Insights: **stereotype** (an overgeneralisation about a
     group, or missing hedging → review); **identifiability** (anything that could point to a
     real person → reject); **clinical plausibility** (contradicts the segment or reads as
     clinically doubtful → review).
6. **Review policy**: `sensitive` character insights always go to review, whatever their
   scores.
7. **Dedupe within the collection**, on the statement vector and under a per-collection
   advisory lock:
   - ≥ 0.93 → merge as corroboration
   - 0.80–0.93 → **adjudicator** decides same / refines / conflicts / different / unsure
   - < 0.80 → publish

   Thresholds are calibrated per collection from review decisions. Chunks in different
   collections never merge, even if they say similar things.

### 7.6 Consolidation (per document × collection)
- Cluster and merge into the sharpest standalone statement; the rest become `superseded`.
- **Density cap** from the collection's settings:
  - principle collections: ~1 per 2 segments (at least 3, at most 80)
  - Character Insights: ~1 per segment (at least 5, at most 150)

  The rest are archived as `over_cap` and stay recoverable.
- A relation pass against the nearest neighbours **in the same collection**.
- Queue the kept chunks for indexing; the yield report is finalised.

### 7.7 Re-extracting and archiving
- The text is gone after extraction, so a better extractor reaches an old document only when
  the file is dropped again. It runs as `generation + 1` for the chosen collections, keeping
  codes and history for matches and flagging what disappeared.
- A document can also be **added to another collection later** by dropping it again with the
  new target. Only that collection runs.
- Archiving a source archives, in each collection, the chunks whose only source it is.

### 7.8 Review
Held chunks, adjudicator "unsure" cases, curator proposals and sensitive insights all land in
the **Inbox** (§10.5), tagged by collection.

## 8. Retrieval

### 8.1 What is indexed
One Weaviate collection per Context Library collection, **`Ctx<Collection>_v{N}`**
(`CtxFirstPrinciples_v1`, `CtxLearningDesign_v1`, `CtxCharacterInsights_v1`), all with the
same layout:

| Retriever | Text | Why |
|---|---|---|
| **BM25** (field-boosted) | `statement^2`, `keywords^2`, `exampleQueries^1.5`, `situations^1`, `topics^1` | Exact terms and jargon |
| **`statement` vector** | the profile's template, e.g. `"{domain}: {statement} {rationale}"` or `"{aspect} · {themes}: {statement}"` | Queries phrased like the chunk |
| **`situations` vector** | `"{facet}: {situations…} {exampleQueries…} {probe or voiceSamples}"` | Situation-style queries, which is how the interviews ask |

- Filterable properties: `chunk_id`, `code`, `status`, and the profile's facets.
- Embeddings: OpenAI `text-embedding-3-small` (`-large` is a later experiment).
- **Flat (exact) vector index**, because each collection holds thousands of chunks, not
  millions. Switch to `dynamic` past ~10k.
- BM25 uses `word` tokenisation, lowercased.

### 8.2 ally-ai changes and index lifecycle
- **New in ally-ai:** `bm25_search` with property boosts and filters; `near_vector_search` on
  a named vector; an embed-only endpoint; bulk upsert, delete, and list IDs with hashes.
- **Migrations** create one collection per Context Library collection.
- **Blue/green versions per collection:** build `_v{N+1}` from Postgres, run that
  collection's benchmark against both versions, flip `cl_collections.activeIndexVersion`,
  then drop the old version after a day.
- **Outbox sync** with nightly two-way reconciliation.

### 8.3 `ContextLibraryRetrievalService.search()` (ally-be)
**Input:** `useCase` (**required**), `collections?` (must be a subset of the use case's
grants), `queries[]` (1–6, near-duplicates collapsed), `facets` (soft unless `strict`),
`limit`, `sessionId`, `contextDescriptor?`, `excludeCodes`, `shadow`.

1. **Access**: resolve the granted collections. Any requested collection outside them →
   refused with a clear error, and logged.
2. **Cache**: query embeddings, plus a per-session result cache (10 min).
3. **Contextualise** (vector side only), when the use case has a context descriptor, e.g. the
   product idea for Builder or the character-so-far for the character interview. Adopted only
   on a benchmark gain.
4. **Per collection**: BM25 top 30, statement vector top 30, situations vector top 30;
   **RRF** (`Σ 1/(60 + rank)`, with the profile's retriever weights); soft facet bonuses, or
   strict filters with back-off; top 50.
5. **Across collections** (when a use case reads more than one): fuse by rank, using the use
   case's per-collection `weight`.
6. **Graded re-rank** (small model, listwise, 0–3) with the collection's rubric. On by default
   where its benchmark shows a gain. Falls back to fused order on timeout (> 2.5 s).
7. **Hydrate from Postgres**: drop anything not `active`; resolve superseded codes.
8. **Bands**: 3 → `high`, 2 → `medium`, ≤ 1 → dropped. An explicit **"no confident match"**
   when nothing reaches `medium`.
9. **MMR** (λ = 0.7) and `refines` collapse.
10. **In-band prior** (effectiveness and corroboration, ±10% max, never across bands) and an
    **exploration** slot.
11. **Cards** in each collection's template (§8.4).
12. **Log** every candidate, with per-stage latency.
13. **Soft failure**: "retrieval failed, which says nothing about what the library holds".

Latency targets (first guesses): p95 < 800 ms without re-rank, < 2.5 s with.

### 8.4 Cards (what a model sees)
Wrapped in a delimited reference block marked as advisory data, grouped by facet, ordered by
band then score, ~40–70 tokens each:
```
[FP-0142 · must · ux_states · high] Design a list view's empty state before its populated state.
  When: a list or feed can have zero items, especially on first use.

[CI-0207 · inner_life · lived experience · high] Many people with panic attacks describe the
  first one as certain they were dying, then avoid the place it happened.
  Voice: "I just knew something was wrong with my heart."   Avoid: portraying panic as calm worry.
```

### 8.5 Experiments, not defaults
Each is adopted only on a test-split gain for that collection: HyDE; `text-embedding-3-large`;
retriever weights and RRF `k`; contextualised vector queries.

## 9. Use cases

### 9.1 Builder interview (`builder_interview`, `builder_research`, `builder_prd_review`, `builder_brief`)
**Tools** (replacing `stacks_search` / `stacks_get`):
- `principles_search({ queries[], domain?, prdSection?, strict?, limit? })` returns First
  Principles cards.
- `principles_get({ codes })` returns rationale, probe, anti-pattern, relations, and "inspired
  by *<document title>*, § <section>".
- The evidence log, turn receipt and prompts are updated to match.

**Proactive retrieval**, within a ~25-card budget:
1. **Session start:** the query planner turns the idea into a context descriptor plus 8–12
   queries. Up to 15 cards, grouped by PRD section, go into a cached **Guiding principles**
   block.
2. **Each turn:** 2–3 queries for the PRD section in focus, added after the cache breakpoint.
3. **Before sign-off:** a **PRD check** retrieves principles per section using the section's
   text as the query, matches them against `antiPattern`, and offers fixes as previewable
   diffs.

**Guiding the admin:** principle-led natural questions (at most one per turn), **Principles
in play** in the session panel, outcome-worded trade-off decision cards, and coverage per
section (§10.7).

**Tracking honestly**
- Citations are `[FP-…]`. Codes never surfaced in this session are stripped. A verifier must
  pass before anything counts as `applied_verified`.
- Feedback is mostly implicit (accept, dismiss, "not relevant").
- `shipped` comes from `builder-outcome`.
- Effectiveness is **position-corrected** using exploration slots, Bayesian-smoothed, and only
  feeds the in-band prior and Insights.
- A nightly curator proposes archives, merges and relations to the Inbox.

### 9.2 Character Library interview (`character_interview`)
**Tool:** `search_corpus` keeps its **name, description shape and `topics` parameter**, so the
interviewer prompt changes little. Its backend moves from the Knowledge Base corpus to
`ContextLibraryRetrievalService` with `useCase: character_interview`. `topics` map to the
`aspect` facet as **soft boosts**, which matches the existing "boosts without hiding anything
else" behaviour.

**What carries over**
- An empty result stays `ok: true` with the existing honest note.
- A retrieval failure keeps the existing "this is NOT evidence the corpus lacks the material"
  message.
- Served tracking switches from chunk IDs to codes. An insight already served in the session
  comes back as a reference, not its full text, so the transcript doesn't grow every turn.

**What changes**
- The model receives **insight cards**: a statement, voice samples, what to avoid, and a
  handling note when sensitive. It no longer gets 800-token passages, which also shrinks every
  turn's context.
- The context descriptor is the character-so-far (age band, situation, presenting concern),
  built from the session's draft.

**Migration** (phase 7):
1. **Seed without re-upload.** A server-side job reads each `character_library` Knowledge
   Base document's stored chunk text (`kb_document_chunks`), in order, and feeds it to the
   Character Insights extractor as segments (`kind: kb_migration`). The chunks' existing
   overlap is harmless, because dedupe merges repeats. The text exists only in that job's
   memory and Redis, as with any upload.
2. **Parity**: the Character Insights benchmark, built from the interview's logged queries
   (`kb_retrievals` with consumer `interview_agent`), graded against both the old passages
   and the new insights. Then the blind side-by-side on 10 recorded interviews (§4.3).
3. **Switch** behind a setting, `characterContextSource` (`kb_corpus` → `context_library`),
   for one week of live use, with an instant way back.
4. **Retire**, as an explicit, confirmed platform-admin action once parity holds and the week
   is clean:
   - delete the `character_library` Knowledge Base documents, chunks, stored files and
     Weaviate collection
   - remove `KbCorpus.CHARACTER_LIBRARY` and its chunk profile
   - replace `CharacterCorpusPanel` with a link to the Context Library

   The source text then stops being retained anywhere except ageing backups.
- New character material is uploaded through the Context Library from the start of phase 7.

### 9.3 Studio: Course Copilot (`course_copilot`)
- `design_guidance_search` / `design_guidance_get` keep their names and shapes, backed by the
  `course_copilot` use case (Learning Design).
- The context descriptor is the course brief (purpose, learners, outcome).
- The copilot's "an empty result does not mean the library lacks guidance" note carries over.
- Cards cite `LD-` codes in the blueprint notes, with the same verified-citation tracking as
  Builder.

### 9.4 Roadmap Copilot (`roadmap_copilot`)
Its `stacks_*` tools move to `principles_search` / `principles_get` on First Principles, with
the opportunity description as the context descriptor.

### 9.5 Engineers' Claude Code (`mcp_dev`)
- ally-be exposes `POST /context-library/mcp`: `search_context` (with an optional
  `collection`), `get_chunks`, `list_collections` (only what `mcp_dev` may read), plus a
  `planning_context` prompt.
- Auth uses read-only keys (`cl_reader_keys`), rate-limited, with `lastUsedAt`.
- Each repo's `.mcp.json` points at it. Then `stacks-bridge.mjs` and the `stacks` skill are
  deleted (replaced by a `context-library` skill), every `CLAUDE.md` / `AGENTS.md` is updated,
  and `wiki/contributing/planning-with-stacks.md` is rewritten as
  `planning-with-context-library.md`.
- Character Insights is locked out of this use case.

## 10. Experience design

### 10.1 What it must feel like
1. **Drop and walk away.** No click is required between dropping files and finding chunks in
   the library. Exceptions are quiet rows with defaults, never dialogs.
2. **Show the payoff, not the pipeline.** Diagnostics hide behind "How was this found?".
3. **Each product speaks its own language.** The Builder interview says *principles*, the
   character interview says *insights*; nobody sees the word "chunk" outside Settings.
4. **One place for everything that needs you.** One Inbox across collections.
5. **Fast, and keyboard all the way.** Optimistic actions with undo, instant search, live
   progress.

House rules: Carbon, Tailwind, lucide; extend existing components; `builderMotion.ts`;
states before styling (§10.9).

### 10.2 Where it lives
**Context Library** is a top-level page in the admin navigation, because it serves Builder,
Studio and the Character Library. It is gated by `CONTEXT_LIBRARY` and limited to platform
admins. Its four views are deep-linkable with `?view=`:

| View | Job | Primary action |
|---|---|---|
| **Library** (default) | Browse and search chunks; see each document's results | **Add documents** |
| **Inbox** (count badge) | Everything that needs a person, across collections | Work the next item |
| **Insights** | Per collection: is it helping, what's missing, what's noise | Act on the top suggestion |
| **Settings** | Collections (review policy, density cap, active index) and **Use cases** (the access matrix) | Change a grant |

A **collection switcher** (All · First Principles · Learning Design · Character Insights)
sits at the top of Library, Inbox and Insights. It is remembered per admin and in the URL.

**Where each product links in**
- **Builder room**: no new tab. A "Context Library" link sits in the room header, and
  sessions show **Principles in play** (§10.7).
- **Character Library**: `CharacterCorpusPanel` becomes a summary card ("Character Insights ·
  312 insights · 4 need a look → Manage in Context Library"), opening the Library filtered to
  that collection.
- **Simulation Studio**: Course Copilot's guidance results link to their `LD-` codes in the
  Context Library.

Also available:
- the upload dock (§10.3)
- the chunk sheet (`?chunk=FP-0142`), openable anywhere a code appears
- the **Connect Claude Code** sheet, from the page's overflow menu
- command palette entries: "Add documents", "Search context", "Open Inbox", "Go to code…"

### 10.3 Adding documents
**Entry points**
- Drop anywhere on the page. The overlay asks where the files should go: **"Drop to add 4
  documents to First Principles ▾"**, a multi-select defaulting to the current collection
  filter, or the admin's last choice when the filter is "All".
- The **Add documents** button (file picker; keyboard and screen-reader accessible), whose
  menu offers "Review before adding".
- The command palette.

**Upload dock**: bottom-right, collapsible, persists across the admin dashboard.
- **Header:** "Adding 12 documents · about 4 min left".
- **Rows:** title, collection chips, one progress bar across all stages, a plain stage label,
  time left.
- **Stage labels:** Reading → Uploading → Waiting (3rd in line) → Extracting (14 of 31 parts)
  → Finishing up → **23 principles added** (or "41 insights added"; or both when a document
  feeds two collections).
- **Row actions:** pause, cancel (with undo), move up. The browser tab title shows progress.
- **Safe to close:** "Keep this tab open · 2 still uploading" until the last upload lands,
  then **"✓ Safe to close this tab. We'll let you know when it's done."**

**Exceptions** appear as rows with the default applied:

| Situation | Row says | Actions (default first) |
|---|---|---|
| Already in this collection | "Already in First Principles" | **Skip** · Re-extract |
| Same title, different file | "Looks like the PDF added on 3 Oct" | **Skip** · Add anyway |
| Scanned PDF | "No text to read: this looks like a scanned PDF. Export a text-based PDF and drop it again." | **Remove** |
| Cost cap reached | "Paused at the $4.10 limit" | **Continue** · Stop here |
| Would wait past 24h | "Would start in ~22h, after its text expires" | **Add later** · Add anyway |
| Some parts failed | "22 of 24 parts done" | **Retry 2 parts** |

**Payoff:** the bell and a toast say "**Clinical presentations guide: 41 insights added**
to Character Insights, 6 strengthened, 9 need a look → See what's new". That opens the
Library filtered to that document and collection, with new rows highlighted.

### 10.4 Library
**Top of the view:** collection switcher; search (`/` focuses it; updates as you type, fast
pipeline); facet chips with counts (driven by the profile); sort; **Chunks | Documents**
segmented control (labelled "Principles", "Insights" or "Items" when "All" is selected).

**A row:** the statement as the hero, plus one muted line of the profile's key facets
(First Principles: domain · strength · "from 2 documents" · "used in 6 PRDs"; Character
Insights: aspect · themes · basis · a "Sensitive" tag). The code sits right-aligned in mono.
Search results add a "Strong match" / "Good match" label with an icon.

**Chunk sheet:** sections come from the profile's copy.
- **First Principles:** Why · When it applies · Question it raises · Warning sign
- **Character Insights:** What it's like · Voice samples · Avoid · Handling note · Basis

Both then show Related · Where it came from (title and section, never names) · Usage ·
History. Actions: inline Edit (undo), Archive (undo), Copy code.

**"How was this found?"** adds per-row diagnostics: retriever ranks, grade, why dropped.
**Documents view:** the yield report as sentences, per collection, plus Re-extract, Add to
another collection, and Archive. **New chunk** opens a form generated from the profile, with
live hints from the deterministic checks.

### 10.5 Inbox
- **One queue across collections**, with collection chips to filter: held chunks, "same or
  different?" decisions, curator suggestions, **sensitive insights awaiting a look**, failed
  documents, grading tasks.
- **Ordered by impact:** sensitive insights and anything holding up a document first,
  grading last.
- **One focused card at a time**, with the reason first. Keys: `A` approve · `E` edit · `R`
  reject · `M` merge · `S` skip · `J`/`K` · `?`. Every key also has a button.
- **Same-or-different** cards use a side-by-side `DiffBlock`.
- **Sensitive insight** cards show the handling note and the stereotype and identifiability
  results prominently, with **Approve** · **Edit** · **Reject**. Bulk approve is not offered
  for sensitive items.
- **Optimistic actions** with a 6-second undo and no confirm dialogs. The next three cards are
  prefetched.
- **Grading tasks** per collection: "Grade 8 results for: *how someone describes a panic
  attack*", keys 0–3, stop any time.
- **Empty state:** "Nothing needs you." Attention is a badge only; no notifications.

### 10.6 Insights
For the selected collection, three answers each with one action:
- **Is it helping?** Builder: the replay eval delta. Characters: the parity result and
  preference rate. Course Copilot: the blueprint side-by-side.
- **What's missing?** Gap clusters → Add documents (with that collection preselected).
- **What's noise?** Surfaced often, never used → review.

Below the fold: Carbon charts by facet, use case, split and latency.

### 10.7 Inside the products
- **Builder interview**: principle-led natural questions with a quiet "Guided by" chip (at
  most one per turn); **Principles in play** in `SessionPanel` (Applied ✓ · Open ○ · Trade-off
  ⚠); outcome-worded trade-off `DecisionCard`s with a recommendation and "Decide later"; PRD
  check findings with **Preview fix** (`DiffBlock`) and implicit feedback; citation chips in
  the PRD and footnotes on export; a collapsed turn receipt; nothing blocks the first token.
- **Character interview**: the interviewer's questions get more specific without changing
  shape. A quiet "Drawing on 3 insights" line in the turn receipt opens the cards. Sensitive
  insights show their handling note to the admin when used.
- **Course Copilot**: guidance used in a blueprint shows as `LD-` chips with the statement on
  hover.

### 10.8 Connect Claude Code (engineers)
Three steps: create a key (shown once) → copy the pre-filled `.mcp.json` snippet → **Test
connection** ("Connected: 8 results for 'empty state' from First Principles and Learning
Design"). Keys are listed with last used and revoke (with undo). The sheet states which
collections engineers can read.

### 10.9 States, copy, accessibility and motion
**States**

| Surface | First run / empty | Loading | Partial | Error | Saturated |
|---|---|---|---|---|---|
| Library | Hero drop zone with a collection picker: "Drop documentation. We extract what matters and delete the text." A three-step strip. Privacy line: "Files are never stored. Text is deleted as soon as it is extracted, within 24 hours at most." | Skeletons; "Still loading…" after 3 s | — | Inline retry with the reason | Virtualised list, facet counts |
| Search | "Search for a situation, e.g. *first-run screen*" (text depends on the collection) | Previous results dimmed | — | "Search is unavailable right now. This says nothing about what the library holds." | Top 20, then "Show more" |
| Dock | Hidden | Stage labels | Part counts and retry | Row with a default | Collapses to its summary |
| Inbox | "Nothing needs you" | Card skeleton | — | Item restored, retry toast | Grouped counts, bulk (not for sensitive items) |
| Settings → Use cases | Every use case listed with its defaults | — | — | A grant change failed → reverted, with the reason | — |
| Builder / character interview | An empty collection stays silent | Never blocks a turn | Brief joins late | Receipt: "Context unavailable this turn" | Budget caps |

**Copy glossary**: internal words never reach the UI.

| Internal | UI |
|---|---|
| chunk | principle / insight (the collection's noun); "item" when mixed |
| distil / extract | extract |
| segment | part |
| source | document |
| use case | "Used by" (Settings shows product names: Builder interview, Character interview, Course Copilot, Roadmap Copilot, Claude Code) |
| band high / medium | Strong match / Good match |
| status `review` | Needs a look |
| superseded | Merged into … |
| over_cap | Not kept: lower priority |
| platitude | Too generic |
| ungrounded | Not supported by the document |
| tension | Trade-off |
| probe | Question it raises |
| antiPattern / avoid | Warning sign / Avoid |
| sensitivity `sensitive` | Sensitive |

**Accessibility:** a button for every drag action; focus management in the Inbox and sheets;
a polite, throttled live region for dock progress; icon + word for every status; shortcuts
never the only path; Carbon contrast tokens.

**Motion:** productive by default; **expressive only twice** ("Safe to close" and the
document-finished toast); nothing animates while idle; reduced motion removes movement, never
information.

**Speed targets:** Library search < 300 ms after typing stops; the next Inbox card < 100 ms;
dock updates within 2 s.

### 10.10 Switches
- Feature toggle `CONTEXT_LIBRARY` (page and engine).
- **Builder settings:** `principlesBrief` (off / shadow / on), `principlesProbes` (off / on).
- **Character Library setting:** `characterContextSource` (`kb_corpus` / `context_library`)
  until retirement.
- **Per collection** (Context Library → Settings): review policy, density cap, and the active
  **search setup** (index version, re-rank, contextualisation, weights). The search setup can
  only change to one with a benchmark report, with its headline numbers shown.

## 11. Build phases (each ships and is tested on its own)

| # | Phase | Done when |
|---|---|---|
| 1 | **Context Library core**: `cl_*` migrations; collections and the profile registry (First Principles first); use-case registry, the access table and **enforced grants**; `Ctx<Collection>_v1` index per collection (flat, named vectors, BM25 boosts); ally-ai endpoints; outbox and reconciliation; `ContextLibraryRetrievalService` (access check, three retrievers, RRF, soft facets, cross-collection fusion, hydration, bands, MMR, logging, caches); manual add; benchmark tables and the `context-library:eval` runner | Hand-added chunks come back with per-retriever ranks; a use case asking for an ungranted collection is refused and logged; the eval runner reports on a small labelled set; prod Weaviate version confirmed; tests and lint green in ally-be and ally-ai |
| 2 | **Extraction engine**, driven by profiles: sources / check / segments API with targets, Redis staging, segment runs per collection, overview, extract, gate (deterministic, verbatim, injection, platitude, critic with groundedness, standalone and profile checks), adjudicated dedupe under a per-collection lock, consolidation, cost cap, re-extract, yield report, AI-registry rows | Several real documents extracted into First Principles produce capped, grounded, standalone chunks with yield reports, in queue order, with no duplicates; no segment text in Postgres; Redis keys gone afterwards |
| 3 | **Context Library page**: browser extraction and segmentation; upload dock with the collection picker, exceptions as rows, safe-to-close and WebSocket progress; Library (switcher, search, sheet, documents, new chunk); Inbox (keyboard triage, undo, grading tasks); Settings (use cases matrix, collections); states and copy glossary | The owner drops the seed documents into First Principles with no required clicks; 20 Inbox items triaged by keyboard in under 3 minutes; first pooled benchmark of ~60 queries for First Principles |
| 4 | **Re-rank + Builder swap**: graded re-ranker with fallback, benchmarked; `principles_*` tools on `builder_*` use cases; cards; citation parsing, integrity and verifier; "Guided by" and citation chips; brief in shadow | Benchmark decides the re-rank default; verified applications recorded; no code in the interviewer's prose; Stacks no longer called by Builder |
| 5 | **Guiding the admin (Builder)**: context descriptor, brief and section focus within the budget, principle-led questions, Principles in play, trade-off cards, PRD check with Preview fix; **replay eval off vs on** | First Principles test split at Recall@50 ≥ 0.9 and nDCG@8 ≥ 0.6, replay eval improves with no regression; then `principlesBrief` and `principlesProbes` go on |
| 6 | **Learning Design + Studio**: Learning Design profile; the owner uploads instructional-design documents; Course Copilot's `design_guidance_*` backed by the `course_copilot` use case; `LD-` chips | Learning Design benchmark bars met; blueprint side-by-side preferred or tied in ≥ 4 of 5; Course Copilot no longer calls Stacks |
| 7 | **Character Insights**: profile with stereotype, identifiability and clinical-plausibility checks and the sensitive review policy; seed from the `character_library` Knowledge Base text; benchmark from logged interview queries; `search_corpus` backed by the `character_interview` use case behind `characterContextSource`; summary card in the Character Library; then retirement of the Knowledge Base corpus | Parity met (benchmark ≥ old corpus; blind side-by-side preferred or tied in ≥ 7 of 10); one clean week on `context_library`; corpus retired by a confirmed admin action |
| 8 | **Feedback loop, experiments and Insights**: implicit feedback, shipped linkage, calibrated LLM judge per collection, position-corrected effectiveness, in-band prior, exploration, curator, §8.5 experiments, the Insights view | Insights shows real numbers per collection; each experiment has a report and a decision |
| 9 | **Roadmap Copilot + engineers + Stacks removal**: Roadmap Copilot swap; read-only keys, the Connect Claude Code sheet and `/context-library/mcp`; `.mcp.json` in every repo; delete `StacksClientService`, the bridge, the skill and `STACKS_*` config; docs and wiki rewrite | `grep -ri stacks` finds only history notes |

Phases 1–4 make it usable for Builder; 5 proves it there; 6–7 bring Studio and the Character
Library onto the same engine; 8 makes it self-improving; 9 finishes the cutover. Stacks stays
wired for engineers until phase 9. Every new prompt goes through the Skills Store and gets an
AI-registry row. Every retrieval change comes with a benchmark report for each affected
collection.

## 12. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Copyright: keeping the document's text | Browser parsing; text only in Redis with a 24h TTL; 8-word verbatim check on every text field; location metadata only |
| A use case reads chunks it shouldn't (e.g. clinical material in an engineer's editor) | Required `useCase`, grants enforced server-side, requests outside them refused and logged, locked grants in code |
| One collection's tuning harms another | One index, benchmark, thresholds, platitude list and review policy per collection; no cross-collection merges |
| Character insights become stereotypes or clichés | Hedged frequency language, the critic's stereotype check, an `avoid` field, sensitive items always reviewed |
| A real person is identifiable from a case vignette | Generalisation rule in the extractor; the identifiability check rejects; no names stored anywhere |
| Character interviews get worse after the move | Parity benchmark and blind side-by-side before switching; a one-week switch with instant rollback; retirement only after both |
| Losing the vividness of verbatim passages | Voice samples written fresh, concrete observable detail favoured, denser extraction cap, and the side-by-side catches any loss |
| Chunks not actually in the document | Groundedness check at extraction; ungrounded rejected |
| Chunks that only make sense next to their source | Decontextualisation, the standalone check, the unresolved-reference filter |
| Boundary loss and garbled extraction | Structure-first segments, atomic blocks, context-only overlap, column-aware order, normalisation |
| Vocabulary mismatch | Example queries, synonym keywords, BM25 + two vectors |
| Noisy facets silently filtering good chunks | Soft facets by default, back-off on strict filters |
| Near-duplicates crowding results | Adjudicated dedupe, consolidation, MMR, `refines` collapse |
| Tuning to the benchmark instead of reality | Pooled judgments, frozen test splits, production queries, a calibrated judge |
| Index drift, stale results, risky model changes | Outbox, reconciliation, Postgres hydration, blue/green versions per collection |
| Prompt injection via a document | Untrusted-data delimiting, injection screen, advisory framing, read-only keys |
| The agent games citations | Surfaced-only codes, stripped inventions, the verifier |
| Position bias | Position-corrected effectiveness; in-band prior only |
| Too much in context | Card templates, budgets, ordering, cached brief, served-reference tracking in the character interview |
| A large drop overwhelms the browser or the queue | Web Worker, memory released per file, auto-queue, start-time warnings, cost caps |
| The library becomes a chore | One Inbox, keyboard triage, undo, implicit feedback, bulk (except sensitive), no notifications |
| Internal jargon confuses users | Copy glossary; each product uses its own noun; diagnostics behind a toggle |
| It doesn't actually improve the products | Replay eval (Builder), parity and side-by-side (characters), blueprint side-by-side (Studio) gate each switch |
| Latency or cost creep | Per-stage latency, targets, caches, re-rank fallback, experiments must earn their cost |

## 13. Open questions

None blocking.
- **Organisation-owned collections** (e.g. an organisation's own character material) are out
  of scope. The `cl_collections` row would gain an owner, and grants would become per tenant.
  This is not built now.
- The WhatsApp Q&A, Ally guide and Debrief Knowledge Base corpora are **unchanged**. They
  answer people directly with cited passages and organisation-specific protocols, where
  verbatim grounding is the point. Moving them would be a separate decision.
- Thresholds and weights (§4, §7.5, §7.6, §8.3) are first guesses, to be set on each
  collection's tuning split.
