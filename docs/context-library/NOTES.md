# Context Library — build notes

The Context Library as built, after phases 1–8 of [`PLAN.md`](PLAN.md). The plan says what and
why; this file says where it ended up, what changed on the way, and what is still unproven.

## Code map

| Piece | Where |
|---|---|
| Module, entities (`cl_*` tables), enums, DTOs | `ally-be/src/context-library/` (`entity/`, `enum/`, `dto/`); tables in `ally-be/DATA_SCHEMA.md` §3.22 |
| Collections (one profile each) | `ally-be/src/context-library/profiles/` — First Principles, Learning Design, Character Insights, Ally Guide Library, Debrief Guidance, Builder Lessons, Bug Hunter Notes, Content Catalogue |
| Use cases, grants, audience rule, locks | `ally-be/src/context-library/constants/context-use-cases.constants.ts`, `service/context-access.service.ts`; grants are rows in `cl_use_case_access` |
| Uploads: parse in memory, segment, stage in Redis | `service/context-upload.service.ts`, `service/context-staging.service.ts`, `util/segment.util.ts`; parsing reuses `ally-be/src/knowledge-base/extractor/` and `ally-be/src/knowledge-base/util/chunker.ts` |
| Worker: overview, extract, gate, critic, dedupe, consolidate | `service/context-worker.service.ts`, `service/context-extraction.service.ts`, `util/gate.util.ts`, `profiles/critic-checks.ts` |
| Written entries, bulk CSV/JSON, enrichment | `service/context-chunk.service.ts`, `util/bulk.util.ts` |
| Outbox and index | `service/context-index.service.ts` → ally-ai `/context-chunks` (`ally-ai/app/api/v1/endpoints/context_chunk.py`, `ally-ai/app/core/context_library/`) |
| Retrieval, fusion, re-rank, MMR, citations | `service/context-retrieval.service.ts`, `util/fusion.util.ts`, `service/context-citation.service.ts`, `service/context-tools.service.ts` |
| Learning loops, judge, tuning, gaps, agent curator | `service/context-loops.service.ts`, `context-judge.service.ts`, `context-tuning.service.ts`, `context-gaps.service.ts`, `context-learning.service.ts`, `context-agent-curator.service.ts`, `context-loop-actions.service.ts` |
| Agent-written chunks | `service/context-agent-chunk.service.ts` (Builder, Bug Hunter) |
| Content Catalogue sync | `service/context-catalogue-sync.service.ts`, `service/context-catalogue.subscriber.ts` |
| Old-corpus import, copy, smoke check, retire | `service/context-kb-import.service.ts`, `service/context-kb-copy.service.ts` |
| Engineers' MCP and read-only keys | `controller/context-library-mcp.controller.ts`, `service/context-reader-key.service.ts`; every repo's `.mcp.json` and `.claude/skills/context-library/SKILL.md` |
| Admin and organisation routes | `controller/context-library.controller.ts` (`v1/context-library`), `controller/context-library-org.controller.ts` (`v1/context-library/org`) |
| Prompts | `ally-be/src/prompts/context_library/*.txt`, contracts in `ally-be/src/prompt/contracts/prompt-contracts.ts`; AI task rows `context-library-*` in `ally-be/src/llm/constants/ai-task-registry.constants.ts` |
| Migrations | `ally-be/src/database/migrations/1981000000000` to `1981001200000` |
| Admin UI | `ally-web/apps/ally-admin-dashboard/src/pages/ContextLibrary/`, API slice `ally-web/apps/ally-admin-dashboard/src/api/contextLibrary.ts`, citation chips and collection links under `ally-web/apps/ally-admin-dashboard/src/components/` (`context-citation`, `context-collection-link`) |
| Callers | Builder (`ally-be/src/builder/`), Bug Hunter (`ally-be/src/bug-hunter/`), character interview, Course Copilot (`ally-be/src/course-copilot/`), Roadmap Copilot, the Ally guide (`ally-be/src/guide/knowledge/guide-library.service.ts`), Debrief |
| Knowledge Base (stays, WhatsApp Q&A only) | `ally-be/src/knowledge-base/`, ally-ai `KnowledgeChunk` and `/knowledge-agent` |

## Decisions that differ from or add to the plan

- **Retiring old data is a confirmed platform-admin action, never a migration.** Each old
  corpus (character, Ally guide, Debrief) is retired by `POST v1/context-library/migrations/<corpus>/retire`
  with an exact confirmation string, refused until its import or copy is complete. Migrations run
  on deploy, before anyone has checked the result. ally-ai drops only collections it lists as
  retired. Agent memory was different: its rows were copied and its tables dropped by migrations
  (`1981000500000`, then `1981000600000`, which refuses while any row lacks a copy).
- **Character corpus:** distilled through the normal worker from its stored passages (text staged
  in Redis only, `kb_migration` sources); the topic-boost pass went with it.
- **Ally guide and Debrief:** passages copied word for word by migration (`1981000800000`), keyed by
  `sync_key`; unsigned clinical Debrief documents arrive archived; enrichment is a separate admin
  action that never touches the body. Organisation admins get a scoped Library under the guide
  library's existing gate (`ally_guide_org` toggle); the platform Library is platform-only.
- **Agent lessons:** agents write candidates that are never retrieved until the hourly curator
  (fast tier, at most 10 changes a pass, never touching pinned or person-written chunks) accepts
  them. Builder's lessons block is frozen per session so the prompt cache holds.
- **Content Catalogue:** kept in step by a debounced TypeORM subscriber plus a nightly two-way
  reconciliation that also does the first backfill. Synced items cannot be edited or archived by
  hand. `search_library` kept its name and parameters.
- **Roadmap Copilot** moved in phase 2 with Builder, not phase 7. Briefs filed before that cite
  `stacks`; the enum value stays so they still read, filed under principles.
- **The judge** (ally-ai's RAG-quality judge) takes a caller-supplied corpus purpose, so a new
  collection needs no ally-ai change.
- **Phase 8 sweep** (this change): dropped `kb_documents.character_topics`,
  `kb_documents.owner_tenant_id` and `kb_retrievals.character_topics` (`1981001100000`, refused
  while a served Ally guide passage lacks its copy); removed the two retired curator prompts
  from the Skills Store (`1981001200000`, and sync refuses to recreate them); removed the
  Knowledge Base's admin retrieval preview and chunk-list routes (ally-be and ally-ai) and their
  unused web hooks, since no screen called them after phase 4; the Knowledge Base, its admin UI
  and its corpus picker now serve only WhatsApp Q&A. `extractor/` and `util/chunker.ts` stay in
  `knowledge-base/` because both systems use them.

## How to test locally

```bash
cd ally-be && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/context-library src/knowledge-base --forceExit
cd ally-be && npm run migration:run          # applies 1981000000000 onwards
cd ally-ai && poetry run pytest tests/core/context_library tests/api/v1/endpoints -q
cd ally-web/apps/ally-admin-dashboard && npx vitest run src/pages/ContextLibrary
```

With the stack up (`./infra/dev_env.sh`), turn on the `context_library` toggle for a platform
admin, open **Context Library** in the admin dashboard, drop a PDF, and watch its parts move
through the worker. **Connect Claude Code** creates a read-only key; **Test connection** pings the
MCP endpoint with it.

## After deploy, in order

1. **Run migrations** (`npm run migration:run`). The drop migrations refuse, with a count, if a
   copy is missing; re-run the named copy migration first.
2. **Let reconciliation backfill the catalogue**: the nightly run does it, or start it with
   `POST v1/context-library/migrations/content-catalogue/sync` and check
   `GET v1/context-library/migrations/content-catalogue`.
3. **Character library import:** `POST v1/context-library/migrations/character-library/import`,
   then poll `GET v1/context-library/migrations/character-library` until it reports complete.
4. **Guide and Debrief enrichment:** `POST v1/context-library/migrations/ally-guide-library/enrich`
   and `POST v1/context-library/migrations/debrief-knowledge/enrich`.
5. **Smoke checks:** `GET v1/context-library/migrations/ally-guide-library/smoke-check` and
   `GET v1/context-library/migrations/debrief-knowledge/smoke-check` (counts and gap labels only,
   never query text).
6. **Retire, once each is confirmed:** `POST …/character-library/retire`,
   `…/ally-guide-library/retire`, `…/debrief-knowledge/retire`, each with its
   `{ "confirm": "retire <corpus>" }` body. This deletes the old documents, passages, stored
   files, retrieval logs and Weaviate collection.
7. **Builder workflow:** set the GitHub variable `ALLY_CONTEXT_LIBRARY_URL` and the secret
   `ALLY_CONTEXT_LIBRARY_KEY` (a read-only key from Connect Claude Code) where Builder's
   workflow runs; both `.github/workflows/builder-session.yml` and
   `ally-be/.github/workflows/builder-session.yml` read them. Without them Builder phases run with no
   principles.

## Open questions and unverified items

- **Real Weaviate behaviour, not yet run against a production cluster:** upsert by UUID replacing
  the whole object (properties and both named vectors); objects with two self-provided named
  vectors on a flat index; `contains_all` filters on text-array facet fields.
- **Cost per real document** has been estimated, not measured on a full-size upload.
- **No load test** of retrieval (three retrievers, fusion, re-rank) or of the worker under
  concurrent uploads.
- The RAG-quality judge still splits its batch between `whatsapp_bot` and `admin_preview`
  (`ally-be/src/analytics/service/rag-quality-judge.service.ts`); `admin_preview` gets no new
  rows now, so half of each batch's budget goes unused. Left as is: changing it changes the
  judge's sampling, which wants its own review.
