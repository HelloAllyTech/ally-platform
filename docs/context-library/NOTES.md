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
| The automatic rollout after a release (drives the row above) | `service/context-library-rollout.service.ts`, `entity/cl-rollout-step.entity.ts` (`cl_rollout_steps`); admin view `ally-web/apps/ally-admin-dashboard/src/pages/ContextLibrary/ReleaseSteps.tsx` |
| Engineers' MCP and read-only keys | `controller/context-library-mcp.controller.ts`, `service/context-reader-key.service.ts`; every repo's `.mcp.json` and `.claude/skills/context-library/SKILL.md` |
| Admin and organisation routes | `controller/context-library.controller.ts` (`v1/context-library`), `controller/context-library-org.controller.ts` (`v1/context-library/org`) |
| Prompts | `ally-be/src/prompts/context_library/*.txt`, contracts in `ally-be/src/prompt/contracts/prompt-contracts.ts`; AI task rows `context-library-*` in `ally-be/src/llm/constants/ai-task-registry.constants.ts` |
| Migrations | `ally-be/src/database/migrations/1981000000000` to `1981001300000` |
| Admin UI | `ally-web/apps/ally-admin-dashboard/src/pages/ContextLibrary/`, API slice `ally-web/apps/ally-admin-dashboard/src/api/contextLibrary.ts`, citation chips and collection links under `ally-web/apps/ally-admin-dashboard/src/components/` (`context-citation`, `context-collection-link`) |
| Callers | Builder (`ally-be/src/builder/`), Bug Hunter (`ally-be/src/bug-hunter/`), character interview, Course Copilot (`ally-be/src/course-copilot/`), Roadmap Copilot, the Ally guide (`ally-be/src/guide/knowledge/guide-library.service.ts`), Debrief |
| Knowledge Base (stays, WhatsApp Q&A only) | `ally-be/src/knowledge-base/`, ally-ai `KnowledgeChunk` and `/knowledge-agent` |

## Decisions that differ from or add to the plan

- **Retiring old data is never a migration.** Migrations run on deploy, before anyone has checked
  the result. Each old corpus (character, Ally guide, Debrief) is retired by the rollout service
  after a release (below), only once its smoke check is done and a grace period has passed, or by
  hand with `POST v1/context-library/migrations/<corpus>/retire` and an exact confirmation string.
  Both paths are refused until the corpus's import or copy is complete. ally-ai drops only
  collections it lists as retired. Agent memory was different: its rows were copied and its tables dropped by migrations
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
- **Every step after a release is automatic** (the owner's decision, 2026-11-10).
  `ContextLibraryRolloutService` replaces the manual after-deploy steps: progress in `cl_rollout_steps`, the
  same service methods the admin routes call, retirement only through the import service's own
  guards (the confirmation phrase is the one thing it skips — it exists for a person at a screen),
  and a 24-hour default grace period so a release rolled back within a day still has the old
  data. The character corpus gets a smoke check too (`smokeCheckDistilled`, replaying the
  character interview's searches with no audience, as it searches live); its migration record
  gained `useCase: character_interview` for it.
- **Builder reaches the MCP with the service key.** The MCP endpoint accepts ally-be's
  `API_KEY` in `x-api-key` (compared in constant time) in place of a reader key, as the `mcp_dev`
  use case with session id `mcp:service`, so Builder's design workflow needs no Context Library
  setting. A request carrying a bearer key is judged on that key alone. Engineers keep reader keys.
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

Nothing here needs a person. What happens by itself, in order:

1. **Migrations** run on start-up (ally-be's `docker-entrypoint.sh` runs `npm run migration:run`;
   ally-ai's image runs `scripts/migrate.py all`). The drop migrations refuse, with a count, if a
   copy is missing; re-run the named copy migration first.
2. **The Content Catalogue backfills itself**: its reconciliation runs shortly after boot while
   the collection is empty, then nightly.
3. **The rollout** (`ContextLibraryRolloutService`) starts about two minutes after boot and then
   ticks every five minutes, on one replica at a time. Per old corpus, each step starts only once
   the one before it is done:
   - **Character library** (`character_library` → Character Insights): start the import (it
     skips documents already queued) → wait for the worker to report every document complete,
     retrying failed parts once nothing else is moving → **smoke check** (the character
     interview's last 30 days of searches replayed against Character Insights) → retire.
   - **Ally guide's library** and **Debrief's guidance** (copied word for word by migration
     `1981000800000`): start enrichment of the copied passages in the background, restarting it
     whenever the pending count stops falling → wait until none is pending → **smoke check** →
     retire.
   - **Retire** runs only when all of these hold, otherwise it waits for a later tick: the import
     or copy is complete (the import service's own guard), the corpus's smoke check in this
     rollout is done (it must come first: retiring deletes the `kb_retrievals` it replays), the
     new collection has at least one active chunk, and the **grace period** has passed since that
     smoke check. It deletes the old documents, passages, stored files, retrieval logs and
     Weaviate collection.
   - A corpus with no old documents is marked **skipped**; one already retired by hand (an earlier
     copy or import exists) is marked **done**.

**Grace period:** `CONTEXT_LIBRARY_RETIRE_AFTER_HOURS`, default `24`, `0` allowed. It exists so a
release rolled back within a day still finds the old data.

**Failures:** a failed action is retried on later ticks with backoff (5 minutes, doubling, at most
6 hours), up to 8 attempts, logged with its reason (counts and our own wording, never a search's
text). After the eighth it waits for a person; every tick still reads the real state, so a step
finished by hand is picked up as done.

**Kill switch:** `CONTEXT_LIBRARY_AUTO_ROLLOUT=off` on ally-be stops the rollout entirely; every
step stays manual through the routes below.

**Watching progress:** the admin dashboard's **Context Library → Settings → Release steps**
(platform admins), or `GET v1/context-library/rollout`. Each step shows its status, attempts,
times and counts; the rows are `cl_rollout_steps`. ally-be's logs carry one line per step started,
done or failed, prefixed `Context Library rollout:`.

**Builder:** nothing to configure. Builder's design workflow reaches the Context Library's MCP
endpoint on `ALLY_BE_API_URL` with the `ALLY_BE_API_KEY` it already has. Setting
`ALLY_CONTEXT_LIBRARY_URL` and `ALLY_CONTEXT_LIBRARY_KEY` in its environment is only an override.

### Doing a step by hand

The admin routes stay, for when the rollout is switched off or a step has stopped trying (platform
admins, `v1/context-library/…`):

| Step | Route |
|---|---|
| Content Catalogue backfill | `POST migrations/content-catalogue/sync`; status `GET migrations/content-catalogue` |
| Character import | `POST migrations/character-library/import`; status `GET migrations/character-library`; failed parts: `POST sources/:id/retry` |
| Enrichment | `POST migrations/ally-guide-library/enrich`, `POST migrations/debrief-knowledge/enrich` (re-run to retry) |
| Smoke check | `GET migrations/character-library/smoke-check`, `GET migrations/ally-guide-library/smoke-check`, `GET migrations/debrief-knowledge/smoke-check` (counts and gap labels only) |
| Retire | `POST migrations/<corpus>/retire` with `{ "confirm": "retire <corpus>" }` — run the smoke check first |

A corpus retired by hand is marked done by the next tick.

## Open questions and unverified items

- **Real Weaviate behaviour, not yet run against a production cluster:** upsert by UUID replacing
  the whole object (properties and both named vectors); objects with two self-provided named
  vectors on a flat index; `contains_all` filters on text-array facet fields.
- **Cost per real document** has been estimated, not measured on a full-size upload.
- **No load test** of retrieval (three retrievers, fusion, re-rank) or of the worker under
  concurrent uploads.
- The Knowledge Base's RAG-quality judge (`ally-be/src/analytics/service/rag-quality-judge.service.ts`)
  now gives its whole batch to `whatsapp_bot`, the only consumer still writing retrievals. It
  used to split the batch with `admin_preview`, which no longer writes, so half of every batch
  went unjudged. If another consumer starts writing again, add it to that list.
