# Context Library — plan (revision 7)

> Status: **plan, not built.** Owner decisions recorded 2026-11-09 (see §1).
> One central system for the context Ally's agents retrieve. Chunks come in three ways:
> **distilled** from uploaded documents (no text kept), **authored** by admins (typed or
> bulk-uploaded, stored exactly as written), and **written by agents** (Builder and Bug Hunter
> lessons). Chunks live in **collections**, and each **use case** reads only the collections
> granted to it. Quality improves from **usage, not from people**.
> Replaces the Knowledge Base's character, Ally guide and Debrief corpora, the agent
> memory notes, Builder lessons, and Course Copilot's catalogue search, **and deletes the
> code they leave behind**.

## Revision history

| Rev | What changed |
|---|---|
| 1–2 | Principles for the Builder PRD interview; success measures; staging without retention; probes and decision cards |
| 3 | RAG design review: decontextualised, grounded chunks; structure-first segmentation; three retrievers with RRF; graded re-rank; MMR; versioned flat indexes |
| 4 | UX review: upload dock, Library, natural principle-led questions, states, copy, accessibility |
| 5 | Context Library: profile-driven collections, use-case access, Studio and Character Library |
| 6 | Lean and self-improving: server parsing with the existing extractors, Builder first, learning loops driven by usage, no review queue, five phases |
| **7** | **Everything retrieval-shaped moves in.** Three origins (distilled, authored, agent-written) plus catalogue sync; **organisation-owned chunks** with audience scoping; the Ally guide library, Debrief guidance, Bug Hunter's notes, Builder lessons and Course Copilot's catalogue search migrate; clinical sign-off dropped; existing Ally guide and Debrief passages imported word for word; **a deletion list for every replaced system**, plus a final dead-code sweep |

## 0. The idea in one paragraph

Everything an Ally agent looks up before it speaks lives in one **Context Library**. Admins
drop documentation that is parsed in memory, distilled into short, grounded chunks, and never
kept. Or they type and bulk-upload chunks that must keep their exact wording, such as an
organisation's crisis protocol. Agents write their own lessons into it as they work. Course
Copilot's catalogue of roleplays, cases, characters and templates is synced into it. Each
**collection** holds one kind of chunk, and each **use case** (Builder, Bug Hunter, the
character interview, Course Copilot, Roadmap Copilot, the Ally guide, Debrief, engineers'
Claude Code) reads only what it is granted. Learners see only global chunks and their own
organisation's. One retrieval pipeline serves them all: three retrievers, fusion, graded
re-rank and diversification. Nightly **learning loops** grade samples of real searches, tune
the settings, teach chunks how people actually search, and prune what never helps. When a
system has moved, its old code, tables, indexes and screens are deleted.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Name and shape | **Context Library**: one system; **collections** hold one chunk type each; each **use case** reads only its granted collections |
| 2 | Ways in | **Distilled** (documents parsed in memory and discarded; no text kept) · **authored** (typed or bulk-uploaded; stored exactly as written, not distilled) · **agent-written** (lessons from Builder and Bug Hunter) · **synced** (Course Copilot's catalogue, kept in step with its source tables) |
| 3 | Parsing | **On the server, in memory**, with the existing Knowledge Base extractors and chunker |
| 4 | First use case | **Builder PRD interview**, with engineers' Claude Code alongside |
| 5 | Learning | **Driven by usage, not users.** No thumbs, no human grading |
| 6 | Search quality | **Fully automatic**: an LLM judge grades samples, the benchmark builds itself, tuning promotes or rolls back within guardrails |
| 7 | Review | **Fully automatic, no queue.** Admins can still edit or archive anything |
| 8 | Clinical sign-off | **Dropped.** Clinical chunks go live through the same automatic checks as everything else |
| 9 | Models | Builder's model **extracts**; a small model **checks** (critic, adjudicator, re-ranker, enrichment, citation verifier); the existing Gemini RAG-quality judge **grades** |
| 10 | Builder behaviour | **Proactive from day one**, switchable per session |
| 11 | Engineers | **In v1 with Builder**, through `/context-library/mcp` |
| 12 | Character interview | **Switch straight away**, seeded from the existing corpus text; then retire the old corpus |
| 13 | Ally guide and Debrief migration | **Import their existing passages word for word as authored chunks**, keeping citations and ownership; then delete the old corpora |
| 14 | Organisations | **Organisation-owned chunks.** In collections that allow it, an organisation's admins add chunks only their learners see. Every search carries the asker's audience, enforced server-side |
| 15 | Moved systems | Ally guide library, Debrief guidance, Bug Hunter's notes, Builder lessons, Course Copilot's catalogue search, the character corpus |
| 16 | Dead code | **Deleted in the same phase each system moves**, plus a final sweep (§12) |
| 17 | Rights | No upload check; rights are the uploader's responsibility |
| 18 | Naming | Code, schema, prompts and code docs say **document** (or **source** for its record), **segment**, **chunk**, **collection**, **use case**, **origin**, and no other terms for these. The UI uses each collection's noun. Build steps are **phases** |
| 19 | Source metadata | **Title, version and year only.** No author, publisher or contributor names are stored or written into chunks or overviews |
| 20 | Stays where it is | The **WhatsApp Q&A** corpus (answers health workers inside ally-ai), **reference document search** (opens whole documents for people), **roadmap duplicate detection**, **live counselling nudges**, and the voice agent's **scenario knowledge** (§14) |

## 2. Concepts

### 2.1 Terms

| Term | Meaning |
|---|---|
| **Document** | An uploaded PDF or EPUB. Held in memory only while it is parsed |
| **Segment** | A heading-bounded piece of a document (~2,500 tokens), in Redis for at most 24h |
| **Chunk** | The stored, retrievable unit |
| **Origin** | How a chunk got here: `distilled` · `authored` · `agent` · `synced` · `imported` (authored, carried over from the Knowledge Base) |
| **Collection** | A set of chunks of one type, defined by a **profile** |
| **Use case** | A caller of the retrieval service, with grants, defaults, an audience rule and logs |
| **Audience** | Who may see a chunk: global, or a list of organisations. Owned chunks are managed by one organisation's admins |

### 2.2 Collections

| Collection | Noun · code | Origins | Org-owned? | Granted to |
|---|---|---|---|---|
| **First Principles** | principle · `FP-` | distilled, authored | no | `builder_*`, `roadmap_copilot`, `mcp_dev` |
| **Learning Design** | principle · `LD-` | distilled, authored | no | `course_copilot`, `mcp_dev` |
| **Character Insights** | insight · `CI-` | distilled, authored | no | `character_interview` 🔒 |
| **Ally Guide Library** | entry · `AG-` | authored, imported, distilled | **yes** | `ally_guide` 🔒 |
| **Debrief Guidance** | guideline · `DG-` | authored, imported, distilled | targeted to organisations | `debrief` 🔒 |
| **Builder Lessons** | lesson · `BL-` | agent, authored | no | `builder_*`, `builder_build`, `mcp_dev` |
| **Bug Hunter Notes** | note · `BN-` | agent, authored | no | `bug_hunter`, `mcp_dev` |
| **Content Catalogue** | item · `CC-` | synced | yes (follows each item's tenant) | `course_copilot` 🔒 |

🔒 means `mcp_dev` can never be granted it: learner-facing, clinical, organisation or tenant
content stays out of engineers' editors. `admin_preview` and `eval` can read everything, still
scoped by audience.

### 2.3 Use cases

| Use case | Audience rule | Query sensitive | Reads |
|---|---|---|---|
| `builder_interview` · `builder_research` · `builder_prd_review` · `builder_brief` | platform | no | First Principles, Builder Lessons |
| `builder_build` | platform | no | Builder Lessons |
| `bug_hunter` | platform | no | Bug Hunter Notes |
| `roadmap_copilot` | platform | no | First Principles |
| `course_copilot` | **the trainer's organisation** | no | Learning Design, Content Catalogue |
| `character_interview` | platform | yes (an admin describing a person) | Character Insights |
| `ally_guide` | **the learner's organisation**, or global only for anonymous visitors | **yes** (a learner's own words) | Ally Guide Library |
| `debrief` | **the learner's organisation** | **yes** | Debrief Guidance |
| `mcp_dev` | platform | no | First Principles, Learning Design, Builder Lessons, Bug Hunter Notes |

- `useCase` is **required** on every search, and so is `audience` for organisation-scoped use
  cases. Following the guide library's existing rule, there is no safe default: "everything"
  leaks other organisations' protocols, and "global only" silently hides a learner's own.
- Grants are data (`cl_use_case_access`), editable in Settings. Locks are code.

### 2.4 What a profile defines
- the chunk's typed attributes and facets
- vocabularies
- which origins it accepts
- whether it allows organisation chunks
- the extractor prompt and critic rubric (for distilled chunks)
- the enrichment prompt (for authored, imported, agent and synced chunks)
- the card template
- the index template and BM25 boosts
- the density cap
- retrieval defaults

A new collection is a profile plus a migration.

## 3. What we reuse

| Existing piece | Where | Use |
|---|---|---|
| Document extractors and the section-respecting chunker | `ally-be/src/knowledge-base/extractor/`, `ally-be/src/knowledge-base/util/chunker.ts` | Parse uploads in memory; segment them. **Move into `context-library/` when the Knowledge Base no longer needs them** (WhatsApp still does, so they stay shared) |
| Audience model (`is_global`, `tenant_ids`, `owner_tenant_id`; Weaviate pre-filtering) and the "audience is required" rule | `ally-be/src/knowledge-base/service/knowledge-base.service.ts` (`searchForAudience`), `ally-be/src/guide/knowledge/guide-library.service.ts`, `ally-ai/app/core/knowledge_base/knowledge_chunk_service.py` | The same model on `cl_chunks`, moved over rather than reinvented |
| Knowledge Base pattern (Postgres as truth, derived index, outbox, reconciliation) | `ally-be/src/knowledge-base/`, `ally-be/src/product-roadmap/service/roadmap-vector.service.ts` | The same, one index per collection |
| Gemini RAG-quality judge; retrieval logs; sensitive-query handling | `ally-ai/app/core/rag_quality/`, `ally-be/src/knowledge-base/entity/kb-retrieval.entity.ts` | The judge for every collection; sensitive queries withheld from every read surface |
| **ExpeL-style curator** (AGREE / EDIT / ADD / REMOVE with code guardrails; pins respected) | Builder's lesson curator and the agent-memory curator (both deleted in phase 5) | **Generalised into the agent-chunk curator** (§6.3); both originals are deleted |
| Agent memory writes and semantic search, `appliedLessonIds` | The agent-memory module (deleted in phase 5), `ally-be/src/builder/service/builder-knowledge.service.ts` | Replaced by `writeAgentChunk()` and retrieval; applied IDs become usage events |
| Content access rules | `ally-be/src/authorization/service/content-access.service.ts` | Rechecked at hydration for catalogue items |
| Character `search_corpus`, character topics, Builder UI pieces, replay eval, outcomes, Skills Store, AI task registry, `DATA_SCHEMA.md`, Redis, scheduler, WebSocket gateway | As in revision 6 | As in revision 6 |

**Facts to confirm in phase 1:** the production Weaviate version (named vectors, flat index,
BM25 boosts), Redis headroom, the extractor size cap, and **the cost of extracting one real
document**.

## 4. Architecture

```
  Ways in                                    ally-be ── context-library module
  ─────────────────────────────────────────  ────────────────────────────────────────────
  Admin drops PDF/EPUB ─► POST /uploads ────► extract in memory → segments (Redis, 24h)
                                               → OVERVIEW → EXTRACT (Builder's model)
                                               → GATE (critic: small model) → dedupe → consolidate
  Admin types / bulk-uploads ─► POST /chunks ► GATE-lite (schema, injection, audience)
                                               → ENRICH metadata (small model; text untouched)
  Agents (Builder, Bug Hunter) ─► writeAgentChunk() ► candidate → AGENT CURATOR
                                               (AGREE/EDIT/ADD/REMOVE) → active
  Catalogue tables ─► sync subscriber + nightly reconcile ► one chunk per active item
  Knowledge Base corpora ─► one-off import jobs (character: distil; guide/debrief: import as is)
                                                │
                       cl_chunks (system of record, audience, origin) ──outbox──► ally-ai
                       Weaviate Ctx<Collection>_v{N} (flat; statement + situations vectors;
                       BM25; audience properties pre-filtered)
                                                │
  ContextLibraryRetrievalService.search({ useCase, audience, … })
    grants + audience → 3 retrievers → RRF → soft facets → top 50 → re-rank → hydrate
    (status, audience, content access) → bands → MMR → usage prior → cards
      ◄ builder_* · builder_build · bug_hunter · mcp_dev · roadmap_copilot
      ◄ character_interview · course_copilot · ally_guide · debrief
                                                │
  NIGHTLY LEARNING LOOPS: judge samples → self-building benchmark → tune/promote/rollback
  → query learning (never from sensitive queries) → curator (never edits authored or synced text)
```

## 5. Data model (ally-be Postgres)

All tables are prefixed `cl_`. **No uploaded file and no document text is stored.** Authored
and imported chunk text is stored, because that text *is* the chunk.

| Table | Holds |
|---|---|
| `cl_collections` | `id`, `name`, `chunkNoun`, `codePrefix`, `profileVersion`, `allowedOrigins`, `allowsOrgChunks`, `densityCap`, `activeSearchSetup`, `status` |
| `cl_use_case_access` (+ `_log`) | `useCase`, `collectionId`, `enabled`, `weight`; history |
| `cl_sources` | Uploaded documents: `title`, `docVersion`, `year`, `kind` (`pdf` · `epub` · `kb_migration`), `language`, `fileHash`, `titleKey`, `overview`, `targetCollections`, counts, `status`, queue fields, `yield`, `promptVersions`, tokens, `costUsd`, `costCapUsd`, `generation`, `uploadedBy`, `ownerTenantId` |
| `cl_ingest_segments` / `cl_segment_runs` | Segment metadata and per-collection runs (no text) |
| `cl_chunks` | See below |
| `cl_chunk_sources` | Location of distilled chunks in their documents (title, section, pages) |
| `cl_chunk_relations` | `tension` · `refines` · `prerequisite` · `related`, within a collection |
| `cl_bulk_uploads` | Bulk-upload batches: file name, row count, created / updated / rejected rows with reasons, `uploadedBy`, `ownerTenantId`. Rows are applied, not stored as a file |
| `cl_retrievals` / `cl_retrieval_hits` | Every search and every candidate, with `useCase`, `audience`, `collectionsSearched`, `deniedCollections`, `querySensitive`, per-retriever ranks, grade, band, final rank |
| `cl_judgments`, `cl_benchmark_queries`, `cl_eval_reports` | Judge grades on samples; the self-built benchmark (`learn` / `holdout`); tuning reports |
| `cl_usage_events` | `retrieved` · `surfaced` · `read` · `probed` · `cited` · `applied_verified` · `cite_rejected` · `unused` · `shipped` · `agent_applied` / `agent_contradicted` (Builder and Bug Hunter report which lessons changed what they did, or turned out wrong) |
| `cl_loop_actions` | Everything the learning loops changed, with evidence, reversible |
| `cl_reader_keys` | Engineers' read-only MCP keys |

### `cl_chunks`
**Core** (every collection):
- `collectionId`, `code`
- `origin` (`distilled` · `authored` · `imported` · `agent` · `synced`)
- `statement` (one decontextualised sentence; for authored and imported chunks, a short
  summary)
- `body` (optional, ≤ ~1,000 tokens: the exact text of an authored or imported chunk, never
  rewritten by any loop)
- `situations[]`, `exampleQueries[]` (`extracted` · `enriched` · `learned`), `keywords[]`,
  `topics[]`, `facets`, `attributes`
- `citation` (for imported chunks: original document title, section, pages)
- **audience**: `isGlobal`, `tenantIds[]`, `ownerTenantId`
- `pinned` (protected from curator edits, as with Builder lessons today)
- `confidence` (`standard` · `low`), `status` (`candidate` · `active` · `archived` ·
  `superseded`), `quality`, `sourceCount`, `distillPromptVersion`
- `syncKey` (synced chunks: the source table and row ID)
- outbox fields, usage counters, `effectiveness`, `version`, `createdBy`, `editedBy`

**Profile attributes** (facets in *italics*):

| Collection | Attributes |
|---|---|
| First Principles | `rationale`, `probe`, `antiPattern`, `kind`, `strength`, *domain*, *prdSections*, *lifecycleStage* |
| Learning Design | The same shape; *domain* (outcomes · sequencing · practice · assessment · feedback · difficulty · motivation · accessibility · facilitation), *courseStage* |
| Character Insights | *aspect* (identity · life_context · inner_life · history_and_presenting_concern · speech_and_language), *themes*, *basis*, *sensitivity*, `voiceSamples`, `avoid`, `handlingNote` |
| Ally Guide Library | *topic* (from the guide's existing curation), *kind* (`material` · `protocol`), `body`, `citation` |
| Debrief Guidance | *kind* (practice guideline · style guide · level guide · protocol), *level*, *clinical* (bool, informational now that sign-off is dropped), `body`, `citation` |
| Builder Lessons | *category* (the existing lesson categories), *repos*, `sourceCount` (agreements), `pinned` |
| Bug Hunter Notes | *tags* (open tags, as today, so kinds of note can emerge), *repos*, `pinned`, `runId` / `findingId` evidence |
| Content Catalogue | *itemKind* (roleplay · case · character · template), *competencies*, *difficulty*, *languages*, `syncKey`; audience follows the item's tenant |

## 6. Ways in

### 6.1 Distilled from documents
As in revision 6:
1. **Upload:** `POST /context-library/uploads` takes multipart files with memory storage and a
   size limit. Each file is hashed, checked for duplicates per collection, extracted with
   `extractDocument()` and segmented with `chunkDocument()`. Segments are staged in Redis
   (24h, with the previous segment's tail as context only), and **the buffer is dropped**.
2. **Extraction:** an overview once per document, then extraction per segment × collection
   (Builder's model, cached prefix, up to 8 principles or 12 insights). The shared rules
   apply: own words, no quotes, no names, decontextualised, one idea each, synonym-rich
   keywords, example queries.
3. **Automated gate:** deterministic → verbatim (8 words) → injection → platitude → critic
   (small model, with the segment: grounded, standalone, specific, profile checks such as
   stereotype, identifiability and clinical plausibility for insights).
   - pass → publish
   - borderline → publish at `confidence: low`
   - sensitive insight in doubt → reject
4. **Dedupe** (adjudicator) and **consolidation** (density cap, relations).

Re-uploading re-extracts as a new generation, keeping codes.

An organisation admin can upload documents into an org-owned collection. The chunks are then
owned by that organisation.

### 6.2 Authored: typed or bulk-uploaded
- **Typed:** in the Library, **New entry** opens a form generated from the profile: statement
  or title, body, facets, audience, pinned. Live hints come from the deterministic checks.
- **Bulk upload** (`POST /context-library/chunks/bulk`): **CSV or JSON**, one row per chunk,
  with columns from the profile (a downloadable template per collection). An optional `code`
  column updates existing chunks; rows without one are created.
  - **Dry run first:** "38 to create, 4 to update, 2 rejected (row 7: body too long; row 19:
    unknown topic)", then apply.
  - Rows are applied; the file is not stored. The batch is recorded in `cl_bulk_uploads`.
- **Stored exactly as written.** No distillation, no verbatim check (the text is the point),
  and no loop ever rewrites `statement` or `body`.
- **Gate-lite:** schema and vocabularies, lengths, injection screen, audience valid for the
  uploader (an organisation admin can only target their own organisation).
- **Enrichment** (`context_library_enrich`, small model) adds retrieval metadata **without
  touching the text**: `situations`, `exampleQueries`, `keywords`, missing facets and, for
  long bodies, a one-line `statement` when none was typed. Admin-typed values always win.
- **Dedupe warns, never merges:** a near-duplicate of an existing chunk is shown ("looks like
  AG-0112") in the form and the dry run. Authored text belongs to its author.

### 6.3 Agent-written (Builder, Bug Hunter)
- `ContextLibraryService.writeAgentChunk({ collection, agent, statement, body?, facets,
  repos, evidence })` replaces `AgentMemoryService` writes and Builder's lesson writes. Chunks
  land as `candidate`.
- **Agent curator** (hourly, small model): the existing ExpeL operations, AGREE / EDIT / ADD /
  REMOVE against the active set, generalised from `builder-lesson-curator` and
  `agent-memory-curator`, with their code guardrails:
  - never touches pinned chunks
  - bounded edits per pass
  - agreement counts become `sourceCount`
- Agents report which chunks changed what they did. Builder's `appliedLessonIds` and Bug
  Hunter's equivalent become `agent_applied` usage events, which feed effectiveness and
  pruning like any other use.
- Humans can add, edit and pin lessons in the Library, as today.

### 6.4 Synced (Course Copilot's catalogue)
- One chunk per **active** roleplay, case, character and component template:
  - `statement`: the title and its one line
  - facets: kind, competencies, difficulty, languages
  - `syncKey`: the source table and row ID
  - audience: the item's tenant (global when Ally-owned)
- **Kept in step** by a subscriber on create, update, archive and delete, plus a nightly
  reconciliation. Enrichment adds example queries. Loops may learn queries but never edit the
  synced text (the source table owns it).
- At hydration, every hit is **rechecked against `content-access.service`**, so a trainer only
  ever sees items they could open.

### 6.5 One-off migrations
| From | How | Then delete |
|---|---|---|
| Character corpus (`character_library`) | Stored chunk text **distilled** into Character Insights (phase 4) | §12, phase 4 |
| Ally guide library (`ally_guide_library`) | Each stored passage **imported word for word** as an `imported` chunk: `body` = the passage, `citation` = document title, section and pages, audience and owner copied (global or the owning organisation); enrichment adds retrieval metadata | §12, phase 6 |
| Debrief guidance (`debrief_knowledge`) | Imported the same way; the `clinical` flag is copied as information; targeted organisations become `tenantIds` | §12, phase 6 |
| Bug Hunter notes (`agent_memories`, agent `bug_hunter`) | Rows copied as `agent` chunks with status, pins, tags and counts preserved; `times_applied` and `times_contradicted` become usage history | §12, phase 5 |
| Builder lessons (`builder_lessons` + `agent_memories` agent `builder`) | Rows copied as `agent` chunks into Builder Lessons; duplicates across the two tables merged by the curator | §12, phase 5 |

Each migration ends with a smoke check: every logged query from the last 30 days for that use
case returns at least one good-or-better result from the judge, or appears in the gap list.
Then the use case is switched, and the old system is deleted as a confirmed platform-admin
action.

## 7. Retrieval

### 7.1 Index
One Weaviate collection per Context Library collection, **`Ctx<Collection>_v{N}`**: a flat
index with two named vectors and BM25.
- **statement vector**: the profile template
- **situations vector**: situations + example queries + probe, voice samples or body opening
- **BM25**: `statement^2`, `keywords^2`, `exampleQueries^1.5`, `situations`, `topics`, and
  `body` for authored chunks

Audience properties (`is_global`, `tenant_ids`) are **pre-filtered inside the query**, as the
guide library does today. Blue/green versions, an outbox, and nightly reconciliation.

### 7.2 `ContextLibraryRetrievalService.search()`
**Input:** `useCase` (required), `audience` (required for organisation-scoped use cases),
`collections?`, `queries[]`, `facets`, `limit`, `sessionId`, `contextDescriptor?`,
`excludeCodes`.

1. **Grants and audience**: refuse and log anything outside the grants; build the audience
   filter.
2. **Per collection**: BM25 + statement + situations (top 30 each) → RRF → soft facet bonus →
   top 50.
3. **Across collections**: fuse by rank with each grant's weight.
4. **Re-rank**: small model, graded 0–3; falls back to fused order after 2.5 s.
5. **Hydrate from Postgres**: drop anything not `active`; re-check the audience; re-check
   content access for catalogue items; resolve superseded codes.
6. **Bands**: strong, good, or an explicit "no confident match".
7. **MMR**, then `refines` collapse.
8. **Usage prior within a band**, plus an exploration slot.
9. **Cards** in the profile template. Authored and imported chunks carry their `body` and
   citation, so "cite the protocol" still works for the Ally guide and Debrief.
10. **Log everything.** For sensitive use cases the query text is stored but withheld from
    every read surface, the same rule as `kb_retrievals`.
11. **Soft failure**: "retrieval failed, which says nothing about what the library holds".
    The guide keeps its existing behaviour of telling "unavailable" apart from "nothing".

## 8. Learning loops (usage, not users)

Nightly, per collection, every action logged in `cl_loop_actions` and reversible.

| Loop | What it does | Guardrails |
|---|---|---|
| **Judge** | The Gemini judge grades a sample of live searches (start at 20%, pooled top 20, 0–3) | Different model family from the re-ranker; versioned rubric |
| **Self-building benchmark** | Judged queries split by hash into learn (80%) and holdout (20%) | Holdout never feeds any other loop |
| **Tuning** | Tries retriever weights, RRF `k`, MMR λ, re-rank on/off, contextualisation, new index versions; promotes the best | Holdout nDCG@8 +0.02 and Recall@50 not down; at most weekly; auto-rollback if live precision drops ≥ 0.05 over 3 days; at least 100 judged queries first |
| **Query learning** | Adds a missed query (judged ≥ 2, ranked below 20) to that chunk's learned example queries | **Never from sensitive queries** (learners' or admins' own words); at most 10 per chunk; learn split only |
| **Effectiveness** | Position-normalised, smoothed use rate per use case → an in-band prior (±10%) | Exploration slots; per-use-case counts |
| **Curator: distilled chunks** | Archive if never useful (≥ 30 surfacings, judged ≤ 1 on ≥ 60%); demote if relevant but never used; merge co-surfacing near-duplicates; promote low-confidence chunks that get used | Recoverable; platitude anchors grow from archives |
| **Curator: authored, imported, synced chunks** | **Never edits or archives them.** Ranks them by usage and lists "never useful" ones in Insights for their owners | The text belongs to its author or source table |
| **Curator: agent chunks** | The ExpeL curator plus usage: lessons never applied after N surfacings, or contradicted more often than applied, are retired | Pins respected |
| **Gaps** | Clusters zero-result and low-band queries into topics: "add documents" (platform) or "add entries" (organisation) | Sensitive queries appear only as an LLM-written topic label, never their text |

**One-off check:** Builder's replay eval with principles off vs on, before proactive mode
finishes rolling out.

## 9. Use cases

### 9.1 Builder (phase 2, lessons in phase 5)
- **Interview:** `principles_search` / `principles_get`. Proactive mode from day one:
  - a guiding-principles brief at session start
  - a search for the PRD section in focus each turn
  - principle-led questions with "Guided by" chips
  - Principles in play
  - trade-off cards
  - a PRD check with Preview fix
  - verified `[FP-…]` citations
- **Lessons (phase 5):** the "newest 20 lessons" block in `builder-knowledge.service` becomes
  a **retrieved** block. Pinned lessons are always included, then the lessons most relevant to
  this interview or build (`builder_*`, `builder_build`). Builds keep reporting applied
  lessons, now as `agent_applied` events.

### 9.2 Engineers' Claude Code (phase 2)
`/context-library/mcp` (`search_context`, `get_chunks`, `list_collections`,
`planning_context`), with read-only keys and a Connect Claude Code sheet with Test
connection. Every repo's `.mcp.json` declares it. Builder Lessons and the Bug Hunter Notes join the engineer grants in
phase 5.

### 9.3 Character interview (phase 4)
`search_corpus` keeps its name, `topics` parameter (soft boosts on `aspect`), honest empty and
failure messages, and served tracking by code. It returns insight cards. Switch straight
away, then retire the old corpus.

### 9.4 Bug Hunter (phase 5)
- The dossier, Verifier brief, feature map and wrong-fix services
  (`bug-hunter-knowledge.service`, `bug-hunter-dossier.service`,
  `bug-hunter-feature-map.service`, `bug-hunter-wrong-fix.service`) search the `bug_hunter`
  use case instead of `AgentMemoryService`.
- Writes go through `writeAgentChunk`.
- `bug-hunter-memory-retirement.service` is replaced by the agent curator's usage-based
  retirement.

### 9.5 Course Copilot (phase 7; Learning Design earlier)
- `design_guidance_search` / `_get` read Learning Design.
- **`search_library` keeps its name and parameters** (`kind`, `query`, `competencyIds`,
  `limit`), now backed by the Content Catalogue: a meaning-based search instead of `ILike`,
  scoped to the trainer's organisation, with content access rechecked. Results stay compact
  (id, title, one line, competencies, difficulty, languages).

### 9.6 Ally guide (phase 6)
- `guide-library.service` calls `search({ useCase: 'ally_guide', audience })`; `audience`
  stays required (a learner's organisation, or `null` for anonymous visitors, meaning global
  only).
- Cards carry the body and citation.
- "Unavailable" still throws, so the guide can say something different from "nothing found".
- Organisation admins manage their organisation's entries in the Context Library, which
  replaces the guide library admin endpoints and `LibraryPanel`.

### 9.7 Debrief (phase 6)
- `debrief-runner.service` and `debrief-reply.service` search `debrief` with the learner's
  audience. Cards carry the body and citation.
- No sign-off gate: the `clinical` flag is information only.
- The Debrief console's Knowledge tab is replaced by a link to the Context Library filtered to
  Debrief Guidance.

### 9.8 Roadmap Copilot (phase 7)
`principles_search` / `principles_get` on First Principles.

## 10. Experience

### 10.1 Principles
- **Drop, type or bulk-upload, then walk away.**
- **Show the payoff, not the pipeline.**
- **Each product uses its own word** (principle, insight, entry, guideline, lesson, note,
  item); "chunk" appears only in Settings.
- **The system tells you what it changed, never asks you to grade.**
- **Authored text is sacred**: shown and searched exactly as written.
- **Fast, keyboard-friendly, accessible.**

### 10.2 Where it lives
**Context Library** is a top-level admin page with three views:
- **Library** (default): browse, search, add
- **Insights**: is it helping, what's missing, what changed
- **Settings** (platform admins): use-case grants, collections, search setups

A **collection switcher** sits at the top. Who sees what:
- **Platform admins** see every collection.
- **Organisation admins** see only collections that allow organisation entries (today, Ally
  Guide Library). Within it they see **their organisation's entries** (editable) and the
  global ones (read-only, so they can avoid duplicating Ally's material). They see no Settings
  and no other organisation's content.

Products link in:
- Builder room header → First Principles and Builder Lessons
- Bug Hunter → its Notes
- Character Library → summary card
- Debrief console → Debrief Guidance
- Ally guide admin → Ally Guide Library
- Course Copilot → `LD-` and `CC-` chips

### 10.3 Adding content
**One "Add" button with three choices:**
- **Upload documents** (PDF/EPUB): the drop zone and upload dock from revision 6.
- **New entry**: the profile form, with live checks and a near-duplicate warning.
- **Bulk upload** (CSV/JSON): template download → drop → dry-run table (create / update /
  reject, with the reason per row) → **Apply**. Uses the same dock. The toast says "Ally Guide
  Library: 38 entries added, 4 updated, 2 skipped".

Which collections can be targeted depends on the profile's allowed origins. For example,
Content Catalogue accepts no manual entries: "Synced from Studio — edit the item there".

### 10.4 Library
- Search as you type; facet chips; filters for origin, audience (Global · My organisation ·
  per organisation, for platform admins), low confidence, and "changed by the system".
- **A row:** the statement or title, key facets, an origin badge (Distilled · Written ·
  Imported · Agent · Synced), an audience badge, and the code.
- **The sheet** shows the profile's sections; the **body shown verbatim** with its citation
  for written and imported entries; Usage; What the system did (learned queries, rank
  changes; never text edits for written ones); History.
- **Actions:** edit (written and agent chunks), pin, archive, restore, copy code, all with
  undo. Synced items link to Studio instead of offering edit.

### 10.5 Insights
Per collection:
- **Is it helping?**
- **What's missing?** Gap topics → "Upload documents" or "Add entries", depending on origin
  and audience.
- **What changed?** The loop actions feed, with Undo.
- **For owners:** "never useful" written entries, so organisation admins can decide what to
  rewrite (the loops never do).

### 10.6 States, copy, accessibility
As in revision 6, plus:
- **Copy:** the dry-run table's row errors are plain-language and fixable in the file.
- **Copy:** the empty organisation library says "Add your organisation's protocols so your
  learners' guide can use them".
- **Copy glossary additions:** origin `authored` → "Written"; `imported` → "Imported";
  `agent` → "Agent"; `synced` → "Synced from Studio".
- **Accessibility:** audience badges always pair an icon with a word.

## 11. Build phases

| # | Phase | Done when |
|---|---|---|
| 1 | **Engine + First Principles ingestion**: `cl_*` tables (with audience, origin, body) and `DATA_SCHEMA.md`; profile and use-case registries; enforced grants **and audience**; upload endpoint (memory, existing extractors and chunker); Redis staging; worker; overview, extract, gate, dedupe, consolidation; **authored entries (typed + bulk CSV/JSON with dry run) and enrichment**; `CtxFirstPrinciples_v1`; ally-ai endpoints; outbox; AI-registry rows; minimal Context Library page | Seed documents extracted with no clicks; an entry typed and a bulk file applied; no file or document text in Postgres or S3; cost per document reported; prod Weaviate confirmed |
| 2 | **Retrieval + Builder interview + engineers**: `ContextLibraryRetrievalService`; Builder tools and proactive mode; `/context-library/mcp`, keys and the Connect sheet; `.mcp.json` everywhere; replay eval check | Builder uses principles end to end with verified citations; engineers connected |
| 3 | **Learning loops + Insights + Settings** | A week of loops on real usage; actions visible and undoable |
| 4 | **Character Insights**: profile, distil from the old corpus, smoke check, switch `search_corpus` | **Delete:** `KbCorpus.CHARACTER_LIBRARY`, its chunk profile and floor, the `CharacterChunk` Weaviate collection and its ally-ai corpus entry, the corpus's documents, chunks and stored files, `CharacterCorpusPanel` and `characterTopics.ts` (vocabulary moved to the profile), and `KbRetrievalConsumer.INTERVIEW_AGENT` |
| 5 | **Agent lessons**: Builder Lessons and Bug Hunter Notes profiles; `writeAgentChunk`; the generalised agent curator; migration of `builder_lessons` and `agent_memories`; Builder's retrieved lessons block; Bug Hunter services switched; `agent_applied` events | **Delete:** the `agent-memory` module (entity, repository, services, curator, enums), the `agent_memories` and `builder_lessons` tables (by migration), `builder-lesson-curator.service`, `bug-hunter-memory-retirement.service`, lesson repository code and `renderLessonLine` / `BUILDER_LESSONS_IN_CONTEXT`, `aiService.upsertAgentMemory` / `findSimilarAgentMemories`, ally-ai `agent_memory` core, endpoint and the `AgentMemory` Weaviate collection, and the lessons part of `BuilderKnowledge.tsx` |
| 6 | **Organisations + Ally guide + Debrief**: organisation-admin access and the scoped Library; Ally Guide Library and Debrief Guidance profiles; passages imported word for word with citations and audiences; `guide-library.service` and the Debrief services switched; smoke checks | **Delete:** `KbCorpus.ALLY_GUIDE_LIBRARY` and `DEBRIEF_KNOWLEDGE`, their chunk profiles and floors; `searchForAudience`, the owned-document methods (`createOwned`, `createOwnedUploadUrl`, `listOwned`, `archiveOwned`, `KbOwner`, `KB_OWNED_CORPORA`); the `guide-library-admin.controller` endpoints; **clinical sign-off** (`needs_clinical_sign_off`, `clinical_signed_off_*` columns by migration, and the code that checks them); `debrief-knowledge.service` (if only the corpus uses it); the `GuideLibraryChunk` and `DebriefKnowledgeChunk` Weaviate collections and their ally-ai corpus entries; the old documents, chunks and stored files; `LibraryPanel.tsx`, the Debrief `KnowledgeTab.tsx` and their API slices and types; `KbRetrievalConsumer.ALLY_GUIDE` / `DEBRIEF` |
| 7 | **Studio + Roadmap + catalogue**: Learning Design profile and documents; Course Copilot `design_guidance_*`; Content Catalogue sync, reconciliation and content-access rechecks; `search_library` switched; Roadmap Copilot switched | **Delete:** the `ILike` library queries in `course-copilot-library.service` (the competencies, languages, trigger warnings and cover images parts stay) |
| 8 | **Dead-code sweep** (§12) | The sweep's report is empty or every remaining item is justified; `DATA_SCHEMA.md`, `.docs-map.yml`, the wiki and every `CLAUDE.md` / `AGENTS.md` are current |

Builder works end to end in phase 2. Each phase deletes what it replaced **in the same PR
set**, so nothing lingers half-migrated.

## 12. Removing dead code

**Per phase:** the deletion lists in §11. A phase is not done while its replaced code still
compiles.

**After phase 7, a sweep across all repos:**
- **TypeScript (ally-be, ally-web):** run `knip` once via `npx` (not added as a dependency)
  for unused files, exports, dependencies and types.
- **Python (ally-ai, ally-ai-learn):** run `vulture` once via `uvx`.
- **Unused things the tools can't see:**
  - **Weaviate:** collections not referenced by any code (list them in ally-ai and diff
    against the code)
  - **Postgres:** tables and columns no entity maps (diff the schema against `DATA_SCHEMA.md`)
  - **Skills Store:** prompts with no caller
  - **Settings:** feature toggles and preferences nobody reads
  - **Permissions:** permission rows for removed endpoints
  - **AI task registry:** rows for deleted calls
  - **Config:** env vars in `.env.example` that no code reads
- **The Knowledge Base after the moves** serves only the WhatsApp Q&A corpus (and its
  retrieval log and judge). Keep `extractor/` and `util/chunker.ts` shared with the Context
  Library. Narrow `KnowledgeBaseService` and the KB admin UI to WhatsApp, and remove any
  method or screen with no remaining caller.
- **Review each finding before deleting.** Dynamic references (Nest DI tokens, string-keyed
  prompts, migrations) produce false positives. Merged migrations are never edited; removals
  are new migrations.
- Each deletion PR runs the repo's full test, lint, typecheck and build, and updates
  `DATA_SCHEMA.md`, the AI task registry and the docs map in the same PR.

## 13. Risks

| Risk | Mitigation |
|---|---|
| One organisation sees another's protocols | `audience` required for organisation use cases; pre-filtered in Weaviate and rechecked at hydration; owner-scoped writes; tests that try every cross-organisation path |
| Clinical guidance served without a person signing it off (sign-off dropped) | Recorded as the owner's decision; imported Debrief passages are copied as already published; new clinical chunks pass the automated checks; admins can archive instantly; the `clinical` flag stays visible in the Library |
| Learners' or admins' own words leak into chunks or screens | Query learning never uses sensitive queries; gap topics are LLM-written labels; sensitive query text withheld from every read surface |
| Loops damage text that must stay exact | Loops never edit or archive authored, imported or synced chunks; enrichment never touches `statement` or `body` |
| Catalogue results show items a trainer can't open | Audience from the item's tenant plus a content-access recheck on every hit; nightly reconciliation |
| Agent lessons drift or bloat | The ExpeL curator with code guardrails; pins respected; usage-based retirement |
| Character interview worse after the immediate switch | Smoke check first; judge watching from day one; gaps surfaced |
| Automatic judging drifts | Different judge and re-ranker families; versioned rubric; untouched holdout; margins, weekly cap, auto-rollback; undo |
| Loops act on too little data | Minimum sample sizes; smoothing; exploration |
| Deleting code that is still used | Per-phase smoke checks before deletion; sweep findings reviewed by hand; full test, lint and build per deletion PR; migrations for schema removals |
| Document text retained | Memory-only parsing; Redis TTL; verbatim check; location metadata only |
| Cost | One-document measurement first; prompt caching; small models for checks; caps |

## 14. Staying where it is
- **WhatsApp Q&A** (Knowledge Base `whatsapp_qa`): answers health workers with cited passages,
  retrieving inside ally-ai in one call with PHI-adjacent queries. It keeps the Knowledge Base
  pipeline. Moving it later would need a Context Library path inside ally-ai.
- **Reference document search**: counsellors open whole documents mid-call; nothing is fed to
  a model.
- **Roadmap duplicate detection**: de-duplicating product data, not knowledge.
- **Live counselling nudges** (ally-ai `Conversation` collection): a single closest example on
  the real-time path, where re-ranking is too slow.
- **Voice agent scenario knowledge** (ally-ai-learn): trainer-written entries per scenario,
  selected from a short list, with knowledge locks. Scenario setup, not a library.
