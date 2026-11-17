# Chunk R2 — Review and refactor: LangGraph done right, code anyone can read

> Brief for Claude Code. Read `CONTEXT.md`, `EPIC-6B-R2.md`, `CHUNK-06B-NOTES.md`, `CHUNK-A1-NOTES.md`, `CHUNK-01-NOTES.md`, `CHUNK-03A-NOTES.md`, `CHUNK-03R-EVAL.md` (how 3r ran the last review), `CHUNK-03C-NOTES.md`, `CHUNK-03B-NOTES.md`, `CHUNK-06-NOTES.md` and `CHUNK-08A-NOTES.md`, then this file. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-r2`, from master after 6b's PR is merged (or from `feat/agents-v2-6b` if it isn't yet; say which). Tag commits `[R2]`. Repos: ally-ai mainly; ally-be's agent-facing modules; ally-web's assistant home where it's tangled.
> **No behaviour change.** Like 3r: every eval and checkup gives the same results before and after. A behaviour fix found along the way is listed, not made.
> **One stop for Shehbaz, early:** the findings and the proposed changes, before refactoring. About 2 days.

## Why

Since 3r, eight chunks have added to the agent runtime: streaming, the gateway, generated list tools, the time check, memory, summaries, purpose variants, the personal-reply check. Each was built fast and tested, but nobody has looked at the whole since. Before 4a (which reshapes how the prompt is assembled), 14a (which needs pauses and resumes) and sprint 3 (outside APIs and MCP tools), the core must be easy to read, change and upgrade.

## Part 1 — Review (then the stop)

Write `docs/agents-v2/R2-REVIEW.md`: every finding with its file and line, why it matters, the proposed change, its risk, and an estimate. Group them as below. Check LangGraph against **its current documentation and release notes** (look them up; don't rely on memory), and note the version in use against the latest stable.

### A. Are we using LangGraph well?

- **The graph:** is it one clear `StateGraph` with named nodes and conditional edges matching the design (`load_context → … → agent ⇄ tools → check → finalize`)? Or has logic moved into big nodes and helper calls that hide the flow?
- **State:** a typed state with reducers where lists accumulate (messages, passages, steps, memory writes), versus fields mutated by hand; run-scoped versus persisted keys (`RUN_SCOPED_KEYS`) made explicit in the schema.
- **The checkpointer:** production sets no checkpoint database, and ally-be sends history every run. Decide plainly: do we need checkpointing at all now, and what does 14a (interrupt and resume) need? Recommend one path and remove the half-used one.
- **Interrupts:** is the graph ready for `interrupt()` and resume (14a's Ask me first), or would it need restructuring? What would change?
- **Streaming:** are steps streamed with LangGraph's stream modes (`updates`, `custom`) or a parallel mechanism? 6b's live steps should ride on one clean path.
- **Tools:** our gateway tools, generated tools and `remember` step field against LangGraph's tool patterns (`ToolNode`, tool calling, structured output). Keep what's deliberately ours (the gateway, the 4-step cap), but say why in code.
- **Limits and failures:** the 4-step cap, timeouts, retries (`RetryPolicy` on nodes, versus our own loops), the run deadline and the v1 fallback: one place each.
- **Tracing:** one trace per run (LangSmith or Langfuse, as three-stage-plan decided to choose), linked from Try it later (16c).
- **Upgrades:** pinned versions, deprecated APIs in use, what an upgrade to the latest stable would take.

### B. Is the code readable?

- **Map:** module boundaries in `ally-ai/app/core/agent_runtime/` (and `memory_lines`, `check`, `tools`): what each owns; anything in the wrong place; circular imports.
- **Size:** files over about 400 lines and functions over about 60, with a proposed split.
- **Duplication:** checks, prompt assembly, date and time parsing, passage formatting done in more than one place.
- **Dead code:** v1 parity paths, the removed designs, flags that are always on or off, unused prompts.
- **Names and types:** names that no longer match what they do; missing type hints; mypy (or pyright) on the runtime package.
- **Prompt assembly:** one clear function per section, the order in one place, every variable documented (4a will build on it).
- **Tests:** structure that mirrors the code; slow or flaky tests; fixtures shared rather than copied.
- **ally-be's agent side:** `engine`, the runner, the gateway, list tools, memory: the same questions, briefly. **ally-web:** the assistant home's sections, only where a file has grown hard to follow.

### C. Is it easy to extend?

Walk through, on paper, adding each of these and list what's in the way:
- a new gateway tool (sprint 3's HTTP or MCP tool);
- a new purpose;
- a new prompt section;
- a pause for approval (14a);
- a new channel showing live steps.

### D. Unwanted and repeated calls (Shehbaz saw several, 16 Nov)

Shehbaz noticed many unwanted API calls, and that **when one thing changes, the screen calls every API again**. Measure it, find every cause, fix it.

- **Measure first, in ally-web, with Playwright's network log:** for each of these, count the requests, list duplicates (same URL and body within 2 s) and anything fetched that the screen doesn't show:
  - opening the assistant home, and switching between each section;
  - saving one setting (a switch in How it works, a never-store line);
  - Tools: opening a list, adding an entry, Repeat weekly, changing an ability;
  - the Inbox: opening a chat, the memory panel, forgetting a line, a new message arriving;
  - Try it: one message;
  - the bot page and the bubble: loading, sending one message, a booking.
  Record the table in `R2-REVIEW.md` (before) and in the notes (after).
- **The usual causes to check:**
  - **RTK Query tags too broad:** one mutation invalidating a tag every query shares (for example the whole chatbot), so every section refetches. Give each query narrow tags (per list, per entry, per contact, per setting) and invalidate only what changed; update the cache from the mutation's response where it returns the new data.
  - **The same data fetched by several components** under different hooks or arguments (`{id}` versus `{id, extra}`) so the cache can't share it.
  - **Effects that refetch** on every render (unstable objects or functions in dependencies), refetch on focus or reconnect where it isn't needed, polling that keeps running on hidden tabs or closed panels.
  - **React StrictMode double calls** in development: separate them from real duplicates, and never count them as fixed.
  - **Saves that fire on every keystroke** without a debounce.
- **ally-be, per request and per run:** the same chatbot, settings, abilities or definitions loaded several times in one request or one run (load once and pass it down, or a per-request cache); N+1 queries in lists, the Inbox and the home; the run's request building doing work twice.
- **ally-ai, per run:** prompts fetched from the Skills Store on every run instead of cached by version; the same gateway definitions or context requested twice; model calls that could be skipped (a check or a send-back that runs when it can't change anything).
- **Targets:** no duplicate requests for one action; a single save refetches only what it changed; opening a section makes only the requests that section shows. Report the counts before and after.

### E. Error tracking (small, behaviour-free)

- **Turn on error tracking in ally-ai and ally-be** with whatever the team already uses (check the repos and infrastructure first; if nothing, Sentry). Unhandled errors, failed agent runs and v1 fallbacks reported with the run id, assistant id and route, **never message text, memory or personal data** (scrub them).
- Off when its key is empty, so local and tests are unchanged. One line in `LAUNCH-CHECKLIST.md` for the production key.
- About an hour; it goes in Part 2 whatever else is chosen at the stop.

**The stop:** send `R2-REVIEW.md` with a short list: what you propose to change now (must be behaviour-free and fit about a day), what to leave for later chunks (named), and anything that would change behaviour (listed only). Shehbaz picks. Keep reviewing ally-be and ally-web while waiting.

## Part 2 — Refactor (what Shehbaz approved)

- **Small commits,** one concern each, each with tests green.
- **Before and after, the same:** the 3a conversation eval, basics, 6's action cases, 8a's memory cases, the Sunrise and fixture checkups, the onboarding eval. Same passes, same hard fails (0), latency no worse.
- **Prompts byte-identical** for every bot: a test renders the full prompt for each fixture bot before and after.
- **Fewer calls is the one allowed change in what the system does:** the same data, fetched less. Each fix gets a test that counts requests (Playwright's network log, or a spy on the API client).
- **LangGraph upgrade** only if the review shows it's small and safe; otherwise a plan in the notes.

## Part 3 — Make it understandable

- **`ally-ai/ARCHITECTURE.md`:** the graph as a diagram (Mermaid), each node in one paragraph, the state and its reducers, how a run flows from ally-be's request to the reply, where checks happen, how tools and the gateway work, how streaming and the steps work, how to add a tool, a purpose or a prompt section. Short enough to read in 15 minutes.
- **Docstrings** on every node and every public function in the runtime: what, not how.
- **A "where things live" table** in `CONTEXT.md` for the three repos' agent code.

## Tests

- Full suites, lint, typecheck (new: mypy on the runtime package) in all three apps, with the commit hook (never `--no-verify`).
- The before-and-after evals above, in the notes as a table.

## Done when

- [ ] `R2-REVIEW.md` reviewed at the stop; the approved changes made
- [ ] Every eval and checkup the same before and after; prompts byte-identical
- [ ] `ally-ai/ARCHITECTURE.md`; docstrings; the "where things live" table
- [ ] The checkpointer decision made and the unused path removed
- [ ] Error tracking on in ally-ai and ally-be (off without a key), with no personal data in reports
- [ ] The request counts before and after for every action in D, with no duplicate requests left and each save refetching only what it changed
- [ ] `CHUNK-R2-NOTES.md` and `PR-R2.md`, with the before-and-after table, what was left for later and why; the Progress row <!-- docs-path-lint: planned -->
