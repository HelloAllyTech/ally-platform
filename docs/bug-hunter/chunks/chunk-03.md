# Chunk 03: Context engine

**Read first:** `CONTEXT.md`, `spec.md` §7.

## Goal
Give every future node the smallest useful context: app knowledge, a navigable map of the code, a scratchpad, and enforced token budgets.

## Build
1. `context/app_context.py`: for an app, load its `AGENTS.md` and the matching parts of the root `CLAUDE.md` (stack, verified commands, gotchas such as "never run dart format"). Cache per commit.
2. `context/repo_map.py`: tree-sitter index for TypeScript/TSX, Python and Dart. Per file: symbols (classes, functions, methods, exported constants) with line ranges and imports. Build a callers/callees graph (best-effort name resolution is fine; record unresolved calls). Incremental rebuild for changed files; cache on disk keyed by commit.
   - API: `outline(file)`, `find_symbol(name)`, `callers(symbol)`, `callees(symbol)`, `tests_for(file_or_symbol)`, `neighbourhood(diff)`.
   - Expose `outline`, `find_symbol`, `callers`, `callees` as agent tools.
3. Cross-app contract hints: map ally-be HTTP clients/queue producers to the ally-ai / ally-ai-learn routes and consumers they call (from route decorators and the SQS queue names in the root `CLAUDE.md`). Best-effort; used by the `api_contract` lens later.
4. `context/scratchpad.py`: per-run markdown file with `append_note`, `read`, and `compact(messages, budget)` that summarises old tool results into the scratchpad and returns trimmed history.
5. `context/builder.py`: `build_context(node, state)` returns the prompt inputs for a node from its declared state fields, app context and memory recall slot, enforcing the node's token budget from `limits.yaml` (count with `tiktoken` or the provider's counter).

## Done when
- Map builds for all five apps; record build time and symbol counts in the notes.
- Tests on small fixture projects (one per language) for symbols, callers/callees and `tests_for`.
- `neighbourhood(diff)` on three real recent commits returns sensible results (show them in the notes).
- Budget enforcement test: oversized inputs are trimmed in a defined order, never silently cut mid-file.
- `CHUNK-03-NOTES.md` written.

## Not in this chunk
Embedding the codebase or vector search over code. The map plus grep is the retrieval strategy; revisit only if evals show it is the bottleneck.
