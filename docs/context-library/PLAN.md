# Context Library — plan (revision 6)

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> One central system that turns uploaded documentation into retrieval-ready **chunks**,
> organised into **collections**, each readable only by the **use cases** granted to it.
> It **learns from usage, not from people**: quality is judged, tuned and pruned automatically
> from how chunks are actually retrieved and used.
> Replaces the third-party **Stacks** MCP and the Knowledge Base's `character_library` corpus.

## Revision history

| Rev | What changed |
|---|---|
| 1–2 | Principles for the Builder PRD interview, replacing Stacks; success measures, staging without retention, re-extraction, probes and decision cards |
| 3 | RAG design review: decontextualised, grounded chunks; structure-first segmentation; three retrievers with RRF; graded re-rank; MMR; versioned flat indexes |
| 4 | UX review: upload dock, Library, natural principle-led questions, states, copy, accessibility |
| 5 | Context Library: profile-driven collections, use-case access, Studio and Character Library on the same engine |
| **6** | **Lean and self-improving.** Server parsing with the existing extractors; Builder first, then engineers; learning loops driven by usage with no human grading or review queue; proactive from day one; character interview switched straight away; nine phases cut to five, with Builder working end to end in phase 2 |

## 0. The idea in one paragraph

An admin drops PDF or EPUB documentation into the **Context Library** and picks the
**collections** it should feed. ally-be parses each file **in memory** with the extractors it
already has, then discards the file. The text is split by its headings into segments that
live in Redis for at most a day. For each target collection, an extractor distils the segments
into **chunks**: short, self-contained, grounded units in our own words (a *principle* in First
Principles and Learning Design, an *insight* in Character Insights). Automated checks decide
what is published. **Use cases** (the Builder interview, engineers' Claude Code, the character
interview, Studio's Course Copilot, Roadmap Copilot) search only the collections granted to
them. The Builder interview searches proactively from the first turn. Every search and every
use is logged, and nightly **learning loops** grade samples of real searches with an LLM judge,
tune search settings, teach chunks the phrasings people really use, and prune what never helps.
None of this waits on a person.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Name and shape | **Context Library**: one system that builds chunks; **collections** hold one chunk type each; each **use case** reads only its granted collections |
| 2 | Where documents are parsed | **On the server, in memory**, with the existing extractors. The file is never written to disk, S3 or the database, and is discarded once parsed |
| 3 | First use case | **Builder PRD interview**, then engineers' Claude Code alongside it |
| 4 | Learning loops | **Driven by usage, not users.** No thumbs, no human grading, no review queue. Signals come from what the agents and engineers actually retrieve, read, cite and ship |
| 5 | Search quality | **Fully automatic.** An LLM judge grades samples of live searches; the benchmark builds itself from real queries; tuning promotes or rolls back search settings within guardrails (§8.1) |
| 6 | Review | **Fully automatic, no queue.** Chunks that pass the gate are published; borderline ones are published at lower rank or rejected (sensitive ones are always rejected when in doubt); usage prunes the rest. Admins can still edit or archive anything in the Library |
| 7 | Models | **Builder's model extracts**; a small, fast model checks (critic, adjudicator, re-ranker); the existing Gemini RAG-quality judge grades. The judge is deliberately a different model from the re-ranker, so the loop can't grade its own homework |
| 8 | Builder behaviour | **Proactive from day one**: guiding principles at session start, a search per PRD section each turn, principle-led questions, and a PRD check. Switchable per session |
| 9 | Engineers | **In v1 with Builder.** The `/context-library/mcp` endpoint replaces `stacks-bridge.mjs` as soon as First Principles has content |
| 10 | Character interview | **Switch straight away.** Seed Character Insights from the existing corpus's stored text, point `search_corpus` at it, then retire the old corpus |
| 11 | Rights | **No upload check.** Rights are the uploader's responsibility outside the tool |
| 12 | Studio | Course Copilot reads a **Learning Design** collection |
| 13 | Uploading | Drop many documents at once and keep adding; each drop picks its target collections |
| 14 | Naming | Code, schema, prompts and code docs say **document** (or **source** for its record), **segment**, **chunk**, **collection**, **use case**, and no other terms for these. The UI uses each collection's noun (principle, insight). Build steps are **phases** |
| 15 | Source metadata | **Title, version and year only.** No author, publisher or contributor names are stored, sent, or written into chunks or overviews |
| 16 | Tenancy | Platform-global and Ally-curated; the Context Library page is for platform admins. Organisation-owned collections are out of scope |
| 17 | Kept from earlier revisions | Stacks replaced everywhere; documents only; seeding from the documents that fed Stacks; no import of `wiki/product/` |

## 2. Concepts

| Term | Meaning |
|---|---|
| **Document** | An uploaded PDF or EPUB. Held in memory only while it is parsed; afterwards only its title, version, year and hash remain |
| **Segment** | A heading-bounded piece of a document (~2,500 tokens) sent to an extractor. Lives in Redis for at most 24h |
| **Chunk** | The stored, retrievable unit: short, self-contained, grounded in its segment, in our own words |
| **Collection** | A set of chunks of one type, defined by a **profile** (§2.2), with its own index and its own learning loops |
| **Use case** | A caller of the retrieval service, with its own grants, defaults and logs |

### 2.1 Collections and access

| Collection | Chunk · code | What a chunk is | Granted to |
|---|---|---|---|
| **First Principles** | principle · `FP-0142` | A product, UX or engineering rule, heuristic, anti-pattern or trade-off | `builder_*`, `roadmap_copilot`, `mcp_dev` |
| **Learning Design** | principle · `LD-0031` | An instructional-design principle | `course_copilot`, `mcp_dev` |
| **Character Insights** | insight · `CI-0207` | A specific observation about how people in a situation present, think, talk, live and cope | `character_interview` (🔒 never `mcp_dev`) |

`admin_preview` and `eval` can read all three. Grants live in `cl_use_case_access` and can be
changed in **Settings**. `useCase` is **required** on every search; a request for a collection
outside the grants is refused and logged; locked grants are enforced in code.

### 2.2 What a profile defines
A profile is code (`src/context-library/profiles/`) plus Skills Store prompts:
- the chunk's typed attributes and facets
- vocabularies
- the extractor prompt and critic rubric, including profile-specific checks
- the card template shown to models
- the index template and BM25 boosts
- the density cap
- retrieval defaults

A new collection is a new profile and a migration. No engine changes are needed.

## 3. What we reuse

| Existing piece | Where | Use |
|---|---|---|
| **Document extractors** (pdfjs page by page, EPUB, DOCX; text + page spans + heading paths; size cap; scanned-PDF detection) | `ally-be/src/knowledge-base/extractor/` | Parse uploads in memory. **No new parser** |
| **Section-respecting chunker** (document → section → paragraph → sentence, with profiles) | `ally-be/src/knowledge-base/util/chunker.ts` | Segmentation, with a Context Library profile (target ~2,500, max ~4,000 tokens, no inline overlap; the previous segment's tail is passed separately as context only) |
| Knowledge Base pattern (Postgres as truth, a derived Weaviate index per corpus, outbox, reconciliation) | `ally-be/src/knowledge-base/`, `ally-ai/app/core/knowledge_base/` | The same, one index per collection |
| Retrieval logs + **Gemini RAG-quality judge** (per-passage grades, versioned rubric, judges empty results) | `ally-be/src/knowledge-base/entity/`, `ally-ai/app/core/rag_quality/` | The judge for every collection's sampled live searches |
| Stacks client and tools | `ally-be/src/llm-agent/service/stacks-client.service.ts` and the Builder, Course Copilot and Roadmap Copilot tool services | Replaced, then deleted |
| Character interview `search_corpus` | `ally-be/src/scenario-character/service/character-interview-tools.service.ts` | Same tool and `topics`, new backend |
| Character topics | `ally-be/src/knowledge-base/enum/knowledge-base.enum.ts` | Character Insights' `aspect` vocabulary |
| Builder decision cards, PRD review, `SessionPanel`, `TurnReceipt`, `DiffBlock`, `Sheet`, `CommandPalette`, `builderMotion.ts` | `ally-be/src/builder/`, `ally-web/apps/ally-admin-dashboard/src/components/builder/`, `ally-web/apps/ally-admin-dashboard/src/pages/Builder/` | Interview experience and house UI conventions |
| Builder replay eval | `ally-be/src/builder/eval/` | A one-off check that proactive principles improve PRDs (§8.4) |
| Builder outcomes | `builder-outcome.service.ts` | The `shipped` usage signal |
| Skills Store prompts and personal-key pattern | `ally-be/docs/adding-a-prompt.md`, `ally-be/src/prompt/service/skills-store-key.service.ts` | Every new prompt; read-only MCP keys |
| AI task registry | `ally-be/src/llm/constants/ai-task-registry.constants.ts` | A row for every new LLM call, in the same PR |
| `DATA_SCHEMA.md` | `ally-be/DATA_SCHEMA.md` | Updated with every new entity (CI enforces it) |
| Redis, `@nestjs/schedule`, Builder WebSocket gateway | ally-be | Staging with a TTL, caches and rate limits, the worker, live progress |

**Facts to confirm in phase 1:**
- the production Weaviate version (named vectors, flat index, BM25 property boosts; the local
  image, 1.28, has all three)
- Redis memory headroom and persistence
- the extractors' size cap against long manuals
- **the cost of extracting one real document**, measured before anything is scaled

## 4. Architecture

```
 Admin (Context Library page) ── drop PDF/EPUB files, choose collections
        │  POST /context-library/uploads   (multipart, memory storage, size-limited)
        ▼
 ally-be ── context-library module ────────────────────────────────────────────
   extractDocument(buffer) → chunkDocument(profile) → segments      (file buffer dropped here)
   Redis cl:segment:{id} (text + previous tail as context, TTL 24h)
   Postgres cl_sources · cl_ingest_segments · cl_segment_runs (no text)
        │  worker (SKIP LOCKED, queue order, concurrency N)
        ▼
   OVERVIEW once per document ─► EXTRACT per segment × collection (Builder's model)
     ─► GATE: deterministic · verbatim · injection · platitude · CRITIC (small model:
        grounded, standalone, specific, profile checks) ─► publish | publish low-confidence | reject
     ─► DEDUPE within collection (adjudicator) ─► CONSOLIDATE (density cap, relations)
        ▼
   cl_chunks ──outbox──► ally-ai Weaviate Ctx<Collection>_v{N} (flat; statement + situations
                         vectors; BM25 boosts)
   ContextLibraryRetrievalService.search({ useCase, … })
     grants → 3 retrievers → RRF → soft facets → top 50 → re-rank (small model) → hydrate
     → bands → MMR → usage prior → cards
        ◄── builder_* (proactive + tools)   ◄── mcp_dev (/context-library/mcp)
        ◄── character_interview             ◄── course_copilot · roadmap_copilot
   usage: cl_retrievals · cl_retrieval_hits · cl_usage_events
        ▼
   NIGHTLY LEARNING LOOPS (§8): judge samples (Gemini) → auto-benchmark → tune & promote
   / roll back → query learning → curator (merge · demote · archive) → effectiveness
```

## 5. Data model (ally-be Postgres, platform-global)

All tables are prefixed `cl_`. **No file and no document text is stored in Postgres.**

| Table | Holds |
|---|---|
| `cl_collections` | `id`, `name`, `chunkNoun`, `codePrefix`, `profileVersion`, `densityCap`, `activeSearchSetup` (index version, retriever weights, re-rank, MMR λ, contextualisation), `status` |
| `cl_use_case_access` (+ `_log`) | `useCase`, `collectionId`, `enabled`, `weight`, who changed it and when |
| `cl_sources` | `title`, `docVersion`, `year`, `kind` (`pdf` · `epub` · `kb_migration`), `language`, `fileHash`, `titleKey`, `overview` (≤ 150 words, no names), `targetCollections`, `pageCount`, `segmentCount`, `extractionWarnings`, `status`, `batchId`, `queuePosition`, `yield` (per collection), `distillModel`, `promptVersions`, tokens, `costUsd`, `costCapUsd`, `generation`, `uploadedBy` |
| `cl_ingest_segments` / `cl_segment_runs` | Segment metadata (`sectionPath`, pages, `textHash`, tokens); one run per segment × collection with status, attempts and candidate counts |
| `cl_chunks` | **Core:** `collectionId`, `code`, `statement` (decontextualised), `situations[]`, `exampleQueries[]` (with `origin`: `extracted` · `learned`), `keywords[]`, `topics[]`, `facets` jsonb, `attributes` jsonb (profile-typed), `quality` jsonb (critic results), `confidence` (`standard` · `low`), `status` (`active` · `archived` · `superseded`), `origin` (`distilled` · `manual` · `kb_migration`), `sourceCount`, `distillPromptVersion`, index outbox fields, usage counters, `effectiveness`, `version` |
| `cl_chunk_sources` | `chunkId`, `sourceId`, `generation`, `sectionPath`, pages. Location only |
| `cl_chunk_relations` | `tension` · `refines` · `prerequisite` · `related`, within a collection |
| `cl_retrievals` | `useCase`, `collectionsSearched`, `deniedCollections`, `sessionId`, `turnIndex`, `queries[]`, `queryOrigin` (`agent_tool` · `planner` · `section_focus` · `prd_review` · `mcp`), `contextDescriptor`, `facets`, `searchSetup`, counts, `topBand`, per-stage latency, `failed`, `cacheHit`, `querySensitive` |
| `cl_retrieval_hits` | Every candidate: per-retriever ranks, RRF score, re-rank grade, band, final rank, surfaced, exploration slot |
| `cl_judgments` | Judge grades (0–3) on sampled hits: `judgeModel`, `rubricVersion`, `split` (`learn` · `holdout`) |
| `cl_benchmark_queries` / `cl_eval_reports` | Auto-built per collection from judged live queries; reports for every candidate search setup |
| `cl_usage_events` | `retrieved` · `surfaced` · `read` · `probed` · `cited` · `applied_verified` · `cite_rejected` · `unused` · `shipped`, with `useCase`, `collectionId`, rank, session |
| `cl_loop_actions` | **Everything the learning loops changed**: setup promotions and rollbacks, learned queries, merges, demotions, archives, with before/after and the evidence |
| `cl_reader_keys` | Engineers' read-only MCP keys |

**Profile attributes**
- **First Principles:**
  - attributes: `rationale`, `probe`, `antiPattern`, `kind`, `strength`
  - facets: `domain`, `prdSections`, `lifecycleStage`
- **Learning Design:** the same shape, with facets `domain` (`outcomes` · `sequencing` ·
  `practice` · `assessment` · `feedback` · `difficulty` · `motivation` · `accessibility` ·
  `facilitation`) and `courseStage`.
- **Character Insights:**
  - facets: `aspect` (`identity` · `life_context` · `inner_life` ·
    `history_and_presenting_concern` · `speech_and_language`), `themes`, `basis`
    (`clinical_description` · `lived_experience` · `practice_observation`), `sensitivity`
    (`standard` · `sensitive`)
  - attributes: `voiceSamples` (written fresh, never quoted), `avoid` (the cliché to steer
    clear of), `handlingNote` (required when sensitive)

## 6. Ingestion

### 6.1 Upload (server, in memory)
- **Endpoint:** `POST /context-library/uploads` takes multipart files with memory storage and
  a size limit (start at 150 MB per file), plus the target collections.
- **Per file, in the request:**
  1. hash it
  2. check for duplicates per collection (default: skip, with "Re-extract" offered)
  3. `extractDocument({ sourceType, buffer })`
  4. `chunkDocument()` with the Context Library profile
  5. stage the segments in Redis
  6. **drop the buffer**

  The response returns the source rows.
- **Only the title is kept from file metadata.** Author, creator, publisher and contributor
  fields are discarded at extraction.
- **Default skips:** boilerplate segments by heading (table of contents, index, legal or
  licence notices, copyright, revision history, about the authors or contributors).
- **Failures** (scanned PDFs, encrypted files, oversized text) are reported per file with the
  extractor's existing messages. The rest of the drop carries on.
- **The tab can close as soon as the upload finishes.** Nothing after that depends on the
  browser.

### 6.2 Staging without retention
- Segments sit in Redis (`cl:segment:{id}`, **24h TTL**) together with the previous segment's
  last ~150 tokens and the next heading, marked **context only**.
- They are deleted once every target collection has extracted the segment.
- Expired segments are marked so; dropping the file again re-sends only what is missing.
- `estimatedStartAt` warns before queueing work that would outlive the TTL.

### 6.3 Worker and extraction
- **Worker:** claims segment runs with `FOR UPDATE SKIP LOCKED` in queue order (concurrency
  starts at 3), retries 3 times, never blocks the queue, supports pause and cancel, and stops
  a document at its cost cap.
- **Overview, once per document** (`context_library_overview`, Builder's model): ≤ 150 words,
  key terms, and which sections are filler. Shared by every target collection.
- **Extract per segment × collection** (`context_library_extract_<collection>`, Builder's
  model).
  - **Cached prefix:** rules, vocabularies, the overview.
  - **Input:** the segment, delimited as untrusted data, plus its context-only lead-in.
  - **Output:** up to 8 principles or 12 insights, each naming the paragraph that supports it.
- **Shared extraction rules:**
  - own words; no quotes; no examples lifted from the document
  - **no names or attributions**
  - **decontextualise**: name the subject; no "this approach" or "the above"
  - one idea per chunk
  - synonym-rich keywords; `exampleQueries` phrased the way the use case searches
  - zero chunks is a valid answer
- **Profile rules**:
  - principles: specific and non-obvious, with `probe` and `antiPattern`
  - insights: concrete and observable; hedged frequency language ("many people…"); case
    vignettes generalised so no real person can be identified; `avoid`, `basis`, and
    `handlingNote` when sensitive

### 6.4 Automated gate (no human queue)
In order, cheapest first. Every outcome is counted by reason in the source's yield report.
1. **Deterministic**: schema and vocabularies, lengths, no attribution phrasing, no unresolved
   references.
2. **Verbatim**: reject any text field sharing an 8-word run with its segment.
3. **Injection**: reject anything addressing an AI or carrying instructions, URLs or code.
4. **Platitude**: similarity ≥ 0.85 to the collection's platitude anchors → reject. Anchors
   grow automatically from chunks the curator archives as "surfaced often, judged irrelevant".
5. **Critic** (`context_library_critic`, small model, **with the segment text**):
   - grounded (supported / partial / unsupported)
   - standalone
   - specificity and actionability
   - names
   - profile checks: for insights, stereotype, identifiability and clinical plausibility
6. **Decision**

   | Result | Standard chunk | Sensitive insight |
   |---|---|---|
   | Everything passes | Publish | Publish |
   | Partial grounding, low specificity, or not standalone after one automatic rewrite | Publish with `confidence: low` (ranked lower; first in line for pruning) | **Reject** |
   | Unsupported, identifiable, injected, verbatim, stereotyping, or names after rewrite | Reject | Reject |

7. **Dedupe within the collection** (statement vector, per-collection advisory lock):
   - ≥ 0.93 → merge as corroboration
   - 0.80–0.93 → the **adjudicator** (small model) decides same / refines / conflicts /
     different
   - "unsure" → publish as `confidence: low`, and the curator settles it from usage
8. **Consolidate** per document × collection:
   - cluster and sharpen
   - **density cap**: principles ~1 per 2 segments (3–80); insights ~1 per segment (5–150).
     The rest are archived as `over_cap`
   - relations within the collection

### 6.5 Re-extracting and archiving
- **Re-extract:** dropping a file again re-extracts it as `generation + 1` for the chosen
  collections, keeping codes and usage history for matching chunks.
- **Add a collection later:** dropping it with a new target runs only that collection.
- **Archive a source:** archives chunks whose only source it is.

## 7. Retrieval

### 7.1 Index (one per collection)
**`Ctx<Collection>_v{N}`**, using a **flat (exact) index**, which suits thousands of chunks:

| Retriever | Text |
|---|---|
| **BM25** | `statement^2`, `keywords^2`, `exampleQueries^1.5`, `situations`, `topics` |
| **statement vector** | the profile template, e.g. `"{domain}: {statement} {rationale}"` |
| **situations vector** | `"{facet}: {situations} {exampleQueries} {probe / voiceSamples}"` |

- Embeddings: `text-embedding-3-small`.
- Index versions are blue/green: a new version is built from Postgres, judged on the
  collection's benchmark, then switched by pointer (§8.1).
- Sync is an outbox, plus nightly two-way reconciliation.

### 7.2 `ContextLibraryRetrievalService.search()`
**Input:** `useCase` (required), `collections?` (must be granted), `queries[]` (1–6),
`facets` (soft unless `strict`), `limit`, `sessionId`, `contextDescriptor?`, `excludeCodes`.

1. **Grants** check (refuse and log anything outside them); caches.
2. **Per collection:** BM25 + statement + situations, top 30 each → **RRF** with the active
   setup's weights → soft facet bonus (strict filters back off) → top 50.
3. **Across collections**, fuse by rank using each grant's weight.
4. **Re-rank**: a small model grades each candidate 0–3 for this situation, falling back to
   fused order after 2.5 s.
5. **Hydrate from Postgres** (only `active`; superseded codes resolved). **Bands**: 3 →
   strong, 2 → good, ≤ 1 → dropped. An explicit **"no confident match"** when nothing is good.
6. **MMR** (λ from the setup), and collapse `refines` pairs.
7. **Usage prior within a band** (§8.3), one exploration slot in 8, and `confidence: low`
   chunks ranked last within their band.
8. **Cards** in the profile's template. Log every candidate. Soft-fail with "this says nothing
   about what the library holds".

**Card examples:**
```
[FP-0142 · must · ux_states · strong] Design a list view's empty state before its populated state.
  When: a list or feed can have zero items, especially on first use.
[CI-0207 · inner_life · lived experience · strong] Many people describe their first panic attack
  as certain they were dying, then avoid the place it happened.
  Voice: "I just knew something was wrong with my heart."  Avoid: portraying panic as mild worry.
```

## 8. Learning loops (usage, not users)

Proactive retrieval in Builder and engineers' searches give every collection a steady flow of
real queries without anyone grading anything. All loops run nightly per collection, record
every change in `cl_loop_actions` with its evidence, and are visible in Insights.

### 8.1 Judge → benchmark → tuning
- **Judge:** the existing Gemini RAG-quality judge grades a sample of live searches (start at
  20% of searches, every candidate in the pooled top 20, scores 0–3) with the collection's
  rubric. A different model family from the re-ranker keeps the loop from grading its own
  output.
- **Benchmark builds itself:** judged queries become benchmark queries, split
  deterministically by query hash into **learn** (80%) and **holdout** (20%). Holdout queries
  are **never** used by any other loop, so the numbers stay honest.
- **Tuning:** each night, candidate setups are generated from the current one: retriever
  weights, RRF `k`, MMR λ, re-rank on/off, contextualisation on/off, and a new index version
  when one exists. Each is evaluated on the learn split, and the best one is checked on
  holdout.
- **Promotion guardrails:**
  - Promote only if holdout nDCG@8 improves by ≥ 0.02 and Recall@50 doesn't drop.
  - At most one promotion per collection per week.
  - **Automatic rollback** if live judged precision@8 falls by ≥ 0.05 over 3 days after a
    promotion.
  - A collection with fewer than 100 judged queries doesn't auto-tune yet.

### 8.2 Query learning (chunks learn how they are searched for)
- When the judge grades a chunk **≥ 2** for a live query but it ranked below the top 20, that
  is a retrieval miss.
- The loop adds the query, normalised, as a **learned example query** on that chunk and
  re-embeds it. Learned queries are capped at 10 per chunk and tagged `learned`.
- Only **learn-split** queries are used, so holdout stays clean.
- The chunk then becomes findable the way people actually phrase things.

### 8.3 Usage signals → effectiveness
- **Signals** (no people involved):
  - **surfaced** in context
  - **read** (`principles_get` / `get_chunks`)
  - **probed** (turned into an interview question)
  - **cited**, then **applied_verified** by the citation verifier (small model)
  - **unused** (surfaced but never touched by session end)
  - **shipped** (from `builder-outcome`)
  - the judge's grade when sampled
- **Effectiveness** is position-normalised (expected use at that rank is learned from
  exploration slots), Bayesian-smoothed, and computed per use case. It feeds only the
  **in-band prior** (±10%, never across bands).

### 8.4 Curator (pruning and merging)
| Evidence | Action |
|---|---|
| Surfaced ≥ 30 times, judged ≤ 1 on ≥ 60% of samples | **Archive** (recoverable) and add it to the platitude anchors |
| Surfaced ≥ 30 times, judged relevant, never used | **Demote** to `confidence: low` (relevant but not useful as written); after 30 more, archive |
| Two chunks repeatedly surfaced together and judged alike | **Adjudicate**, then merge or relate |
| `confidence: low` chunk later used and verified | **Promote** to `standard` |
| A source whose chunks are mostly archived | Flag it in Insights as a low-value document |

Every action is logged and reversible from the Library.

### 8.5 Gaps
Zero-result and low-band queries are clustered per collection into **gap topics** ("offline
sync: 6 sessions found nothing"). This is the one place the loop asks for people: Insights
suggests what documentation to upload next.

### 8.6 Proving the proactive interview helps (one-off)
Before the Builder rollout finishes, Builder's replay eval runs its fixtures with principles
off vs on. If PRDs don't improve, proactive mode is switched off and the loop data is used to
find out why. It is a check on the decision, not a recurring human step.

## 9. Use cases

### 9.1 Builder PRD interview (phase 2)
- **Tools:** `principles_search` / `principles_get` over the `builder_*` use cases, replacing
  `stacks_search` / `stacks_get`. The evidence log, turn receipt and prompts are updated.
- **Proactive, from day one** (Builder setting `principlesProactive`, on by default,
  switchable per session):
  - **Session start:** a query planner turns the idea into a context descriptor plus 8–12
    situational queries, and up to 15 cards grouped by PRD section go into a cached **Guiding
    principles** block.
  - **Each turn:** 2–3 queries for the PRD section in focus, added after the cache
    breakpoint.
  - **Budget:** ~25 cards at once, dropping used or unused ones first.
  - **Before sign-off:** a **PRD check** retrieves per section and matches against
    `antiPattern`, offering **Preview fix** diffs.
  - The first token is never delayed: the brief joins from turn two if it is late.
- **Guiding the admin:** principle-led natural questions with a quiet "Guided by" chip (at
  most one per turn); **Principles in play** in `SessionPanel` (Applied ✓ · Open ○ ·
  Trade-off ⚠); trade-off `DecisionCard`s worded as outcomes, with a recommendation and
  "Decide later".
- **Citations:** `[FP-…]` chips in the PRD. Codes never surfaced in the session are
  stripped; the verifier decides `applied_verified`; exports get footnotes.

### 9.2 Engineers' Claude Code (phase 2)
- `POST /context-library/mcp`: `search_context`, `get_chunks`, `list_collections` (only what
  `mcp_dev` may read), and a `planning_context` prompt.
- Read-only keys (`cl_reader_keys`), rate-limited, created in a **Connect Claude Code**
  sheet: key shown once, a pre-filled `.mcp.json` snippet, and **Test connection**.
- Every repo's `.mcp.json` switches over; `stacks-bridge.mjs` and the `stacks` skill are
  removed (replaced by a `context-library` skill); `CLAUDE.md` / `AGENTS.md` and
  `wiki/contributing/planning-with-stacks.md` are rewritten.
- Engineers' searches and reads feed the loops as `mcp_dev` usage.

### 9.3 Character Library interview (phase 4)
- `search_corpus` keeps its name, description shape, `topics` parameter (mapped to `aspect` as
  soft boosts), its honest empty and failure messages, and served tracking (now by code).
- It returns insight cards instead of 800-token passages, which also shrinks every turn.
- **Switch straight away:**
  1. A server job feeds each `character_library` Knowledge Base document's stored chunk text
     (`kb_document_chunks`) to the Character Insights extractor as segments (`kind:
     kb_migration`); dedupe absorbs the old overlaps.
  2. A smoke check: every logged interview query returns at least one good-or-better insight
     from the judge, or appears in the gap list.
  3. `search_corpus` points at the `character_interview` use case.
  4. **Retire the old corpus** with a platform-admin action confirmed once: delete its
     documents, chunks, stored files and Weaviate collection; remove
     `KbCorpus.CHARACTER_LIBRARY`.

  After retirement there is no switching back. New character material arrives through the
  Context Library.
- `CharacterCorpusPanel` becomes a summary card linking to the Library filtered to Character
  Insights.

### 9.4 Studio Course Copilot and Roadmap Copilot (phase 5)
- Course Copilot's `design_guidance_search` / `design_guidance_get` are backed by
  `course_copilot` (Learning Design), with the course brief as the context descriptor and
  `LD-` chips in blueprints.
- Roadmap Copilot uses `principles_search` / `principles_get` on First Principles.

## 10. Experience

### 10.1 Principles
- **Drop and walk away.**
- **Show the payoff, not the pipeline.**
- **Each product uses its own word** (principle, insight); "chunk" appears only in Settings.
- **The system tells you what it changed, never asks you to grade.**
- **Fast, and keyboard-friendly.**
- House rules: Carbon, Tailwind, lucide; extend existing components; `builderMotion.ts`.

### 10.2 Where it lives
**Context Library** is a top-level admin page (`CONTEXT_LIBRARY` toggle, platform admins),
with three views deep-linked by `?view=`:

| View | Job | Primary action |
|---|---|---|
| **Library** (default) | Browse and search chunks and documents | **Add documents** |
| **Insights** | Per collection: is it helping, what's missing, **what the system changed** | Act on the top suggestion |
| **Settings** | Use-case access matrix; collections (density cap, active search setup, history) | Change a grant |

- A collection switcher (All · First Principles · Learning Design · Character Insights) sits
  at the top of each view.
- The Builder room header links here. The Character Library shows a summary card. Course
  Copilot's chips link to `LD-` codes.
- The command palette offers "Add documents", "Search context" and "Go to code…".

### 10.3 Adding documents
- **Drop anywhere**, or use the **Add documents** button. The overlay asks where the files go:
  "Drop to add 4 documents to **First Principles ▾**" (multi-select, remembering the last
  choice).
- **Upload dock** (bottom-right, persists across the admin dashboard):
  - one row per document with collection chips and **one progress bar**
  - stage labels: Uploading → Reading → Waiting (3rd) → Extracting (14 of 31 parts) →
    Finishing up → **23 principles added**
  - the browser tab title shows progress
  - **"✓ Safe to close this tab"** appears as soon as the uploads finish
- **Exceptions are rows with defaults applied:** already in the collection → **Skip** ·
  Re-extract; scanned PDF → **Remove** (with the reason); cost cap → **Continue** · Stop;
  would outlive 24h → **Add later**; parts failed → **Retry**.
- **Payoff:** a toast and the bell say "**Design systems guide: 23 principles added**, 6
  strengthened existing ones, 3 published at low confidence → See what's new". That opens the
  Library filtered to that document, with new rows highlighted.

### 10.4 Library
- Search updates as you type; facet chips with counts; filters for `confidence: low` and
  "changed by the system".
- **A row:** the statement as the hero, plus key facets in one muted line and a mono code.
- **Chunk sheet:** sections from the profile (Why · When it applies · Question it raises ·
  Warning sign; or What it's like · Voice · Avoid · Handling note), then Related · Where it
  came from · Usage · **What the system did to it** (learned queries, demotions, merges) ·
  History.
- **Actions:** inline edit, archive, restore, copy code, all with undo.
- **Documents view:** the yield report written as sentences, per collection.
- **"How was this found?"** shows per-retriever ranks, grade, and why anything was dropped.

### 10.5 Insights
Per collection, the top of the page answers:
- **Is it helping?** Judged precision trend, the verified-use rate and, for Builder, the
  replay eval result.
- **What's missing?** Gap topics → **Add documents**.
- **What changed?** The `cl_loop_actions` feed: "Search setup promoted (+0.03 nDCG on
  holdout)", "12 chunks learned new phrasings", "4 archived as never useful", each with an
  **Undo**.

Charts below: usage by use case, quality over time, latency, cost per document.

### 10.6 Inside the products
- **Builder:** as in §9.1. There is a collapsed turn receipt ("Consulted 6 principles · used
  2"), and nothing blocks the first token.
- **Character interview:** the turn receipt shows "Drawing on 3 insights"; sensitive insights
  show their handling note to the admin when used.
- **Course Copilot:** `LD-` chips with hover cards.

### 10.7 States, copy, accessibility
- **First run:** a hero drop zone with a collection picker, a three-step strip, and the
  privacy line "Files are never stored: they're read in memory and discarded, and their text
  is deleted once extracted, within 24 hours at most."
- **Loading:** skeletons. **Errors:** inline, with the reason. **Large libraries:**
  virtualised lists. **Empty search:** "No confident match. This says nothing about what the
  library holds."
- **Copy glossary:** chunk → principle / insight; segment → part; source → document; band →
  Strong match / Good match; `confidence: low` → Low confidence; superseded → Merged into…;
  over_cap → Not kept; tension → Trade-off; probe → Question it raises; antiPattern / avoid →
  Warning sign / Avoid.
- **Accessibility:** a button for every drag action; icon + word for every status; focus
  management in sheets; a polite, throttled live region for the dock; reduced motion keeps the
  information.
- **Motion:** expressive only for "Safe to close" and the document-finished toast.

## 11. Build phases

| # | Phase | Done when |
|---|---|---|
| 1 | **Engine and First Principles ingestion**: `cl_*` migrations and `DATA_SCHEMA.md`; profile registry (First Principles); use-case registry and enforced grants; upload endpoint (memory, existing extractors and chunker); Redis staging; worker; overview, extract, automated gate, dedupe, consolidation; `CtxFirstPrinciples_v1` (flat, named vectors, BM25 boosts) and ally-ai endpoints; outbox; AI-registry rows; **minimal Context Library page** (drop + dock + Library list) | The seed documents are dropped in one go and extracted with no clicks; no file or text in Postgres or S3; Redis empty afterwards; **cost per document measured and reported**; prod Weaviate version confirmed; tests and lint green |
| 2 | **Retrieval + Builder + engineers**: `ContextLibraryRetrievalService` (grants, three retrievers, RRF, re-rank, hydrate, bands, MMR, cards, logging); Builder tools and **proactive mode** (brief, section focus, principle-led questions, Principles in play, trade-off cards, PRD check with Preview fix, citation verification); the `/context-library/mcp` endpoint, read-only keys and Connect sheet; `.mcp.json` switched in every repo; Stacks removed from Builder and engineers; the replay eval check | A Builder interview uses principles end to end with verified citations; engineers connected and searching; the replay eval shows PRDs improve with principles on; `stacks-bridge.mjs` gone |
| 3 | **Learning loops**: judge sampling, the self-building benchmark with learn/holdout split, nightly tuning with promotion guardrails and rollback, query learning, effectiveness and in-band prior with exploration, curator, gap clustering, `cl_loop_actions`; **Insights** and **Settings** views; the full Library sheet | Loops have run for a week on real usage; at least one promotion or a recorded "no better setup"; every action visible and undoable in Insights |
| 4 | **Character Insights**: profile with strict sensitive rules; seed from the Knowledge Base text; smoke check; `search_corpus` switched; the old corpus retired; summary card | Character interviews run on insights; the old corpus and its stored text are deleted; loops running for the collection |
| 5 | **Learning Design + Studio + Roadmap**: Learning Design profile; the owner uploads instructional-design documents; Course Copilot and Roadmap Copilot switched; `StacksClientService`, `STACKS_*` config and the remaining docs removed | No code calls Stacks; `grep -ri stacks` finds only history notes |

Builder works end to end in **phase 2** (it was phase 5 in revision 5), and engineers move off
Stacks at the same time. Every new prompt goes through the Skills Store with an AI-registry
row.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Automatic judging drifts from what people would call relevant | Different model families for judge and re-ranker; rubric versioned; holdout never used by other loops; promotion margins, a weekly cap and automatic rollback; every change visible and undoable |
| Loops act on too little data | Minimum sample sizes before tuning or pruning (100 judged queries; 30 surfacings); Bayesian smoothing; exploration slots |
| Sensitive character material published without a person looking | Strict gate for sensitive insights (reject when in doubt; handling note required; stereotype, identifiability and clinical checks must all pass); sensitive cards carry their handling note to the interviewer and admin; admins can archive from the Library at any time |
| The character interview gets worse after the immediate switch, with no way back once the corpus is retired | The smoke check before switching; the judge watching live quality from day one; gaps surfaced for upload; the decision to retire straight away is recorded as the owner's choice |
| A use case reads chunks it shouldn't | Required `useCase`, server-enforced grants, refusals logged, locked grants in code |
| Document text retained | Files parsed in memory and dropped; text only in Redis with a TTL; verbatim check; location metadata only. The LLM providers still receive the text during extraction |
| Rights to uploaded material | The owner's decision: no check in the tool; responsibility sits with the uploader |
| Chunks not in the document, or not standalone | The critic's groundedness and standalone checks, with the segment text |
| Near-duplicates and bloat | Adjudicated dedupe, consolidation, density caps, the curator |
| Vocabulary mismatch | Example queries, query learning, BM25 + two vectors |
| Cost | Measured on one document in phase 1; prompt caching; small models for checks; per-document and batch caps |
| Proactive principles don't actually help Builder | The replay eval check in phase 2; the per-session switch; usage-based effectiveness |
| Large drops | Size limits, per-file failures, queue order, TTL warnings |

## 13. Out of scope (for now)
- Organisation-owned collections.
- Moving the WhatsApp Q&A, Ally guide or Debrief Knowledge Base corpora. They answer people
  with cited passages, where keeping the text is the point.
- DOCX and URL sources. The extractors already support them, so adding them later is a small
  change if wanted.
