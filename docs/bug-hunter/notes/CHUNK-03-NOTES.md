# Chunk 03 notes: context engine

Branch `feat/bug-hunter-v2`. `make lint`, `make test` (189 offline tests) and
`make test-slow` (map of the five real apps, three real-commit neighbourhoods) pass.

## Code map

| Path | What |
|---|---|
| `bug-hunter/src/bug_hunter/context/tokens.py` | `make_counter()`: tiktoken `o200k_base` when its encoding is cached, else an **overestimate** at 3 chars/token; `effective_budget()` applies the safety margin; `truncate_to_tokens()` cuts whole lines with a marker |
| `bug-hunter/src/bug_hunter/context/app_context.py` | `load_app_context(config, app, commit)`: the app's `AGENTS.md`, its row in the root `CLAUDE.md`, its Verified commands block (or the `apps.yaml` commands when the root file has none: ally-ai-learn, ally-mobile), its stack rules (incl. "never run dart format"), `apps.yaml` notes. Cached per (app, commit) |
| `bug-hunter/src/bug_hunter/context/repo_map.py` | tree-sitter index for TS/TSX/Python/Dart: symbols with ranges and decorators, imports (resolved in-app), call sites, class field types (NestJS constructor injection, Dart `final` fields). `RepoMap.outline / find_symbol / callers / callees / tests_for / neighbourhood(diff)`; `build_map()` with gzip cache per commit and incremental re-parse by git blob; `resolution_report()` |
| `bug-hunter/src/bug_hunter/context/contracts.py` | Routes from the Python apps' decorators + `APIRouter(prefix)` + `include_router(prefix)`; path literals from ally-be's integration dirs; suffix match with params wildcarded, exact beats parameter; SQS producers/consumers by queue name; `hints_for(app, file)` |
| `bug-hunter/src/bug_hunter/context/scratchpad.py` | `Scratchpad`: `append_note`, `read`, `tail(max_tokens)`, `compact(messages, budget)` |
| `bug-hunter/src/bug_hunter/context/builder.py` | `NODE_INPUTS` per node; `build_context()` with the fixed trimming order; `shrink()`; `BudgetError` |
| `bug-hunter/src/bug_hunter/runs.py` | `Run` context manager; `clean_orphans`, `clean_artefacts`, `cache_report`, `remove_docker_dep_volumes` |
| `bug-hunter/src/bug_hunter/tools/lc.py` | `map_tools(repo_map)`: `outline`, `find_symbol`, `callers`, `callees`, `tests_for` |
| `bug-hunter/src/bug_hunter/cli.py` | `map build [apps] [--contracts] [--no-cache]`, `map neighbourhood <app> <commit>`, `runs clean`, `cache size`, `cache clean [--max-age-days] [--max-size-mb] [--include-paused] [--repo-map] [--volumes]` |
| `bug-hunter/tests/fixtures/repo_map/projects.py` | One mini project per language, committed into a temp git repo for the map tests |
| `bug-hunter/tests/slow/test_real_repo_map.py` | `slow`-marked: builds all five real apps, writes `runs/cache/map-stats.json` and `neighbourhood-<app>-<commit>.md` |

New dependencies: `tree-sitter`, `tree-sitter-language-pack` (one wheel covers all four grammars, 5 MB), `tiktoken` (was transitive). `limits.yaml` gained `context` (`token_safety_margin: 0.15`, `chars_per_token_offline: 3`, `repo_map_keep_commits: 2`) and `artefacts` (`max_age_days: 30`, `max_size_mb: 500`).

## Repo map: build time, symbols, cache size (this Mac, 10 cores)

Cold build parses every file; a warm load at the same commit reads the gzip cache; a
build at a new commit re-parses only files whose git blob changed (tested on the
fixture: 1 of 5 files after a one-file commit).

| App | Source files | Symbols | Calls kept | Cold build | Warm load | Cache on disk |
|---|---|---|---|---|---|---|
| ally-be | 4,211 | 19,875 | 93,987 | 4.0 s | 0.7 s | 1.5 MB |
| ally-web | 2,973 | 10,449 | 102,538 | 3.5 s | 0.5 s | 1.0 MB |
| ally-ai | 353 | 3,561 | 8,098 | 0.4 s | 0.03 s | 0.2 MB |
| ally-ai-learn | 403 | 5,493 | 14,737 | 0.5 s | 0.04 s | 0.3 MB |
| ally-mobile | 543 | 3,807 | 21,777 | 1.1 s | 0.06 s | 0.3 MB |
| **total** | | | | **9.5 s** | | **3.3 MB** |

The cache lives at `bug-hunter/runs/cache/repo-map/<app>/<commit>.json.gz` and keeps
the two newest commits per app, so the ceiling is about 7 MB. It stores files only
(symbols, imports, calls, field types); edges are recomputed on load in well under a
second. `bug-hunter cache size` prints the per-app figures. The whole `runs/` tree
is gitignored.

## Call resolution on ally-be, with and without NestJS injection

"Calls kept" excludes known framework and builtin calls (`expect`, `it`, `len`,
`setattr`, loggers, …), which can never point into the app. Of the remaining calls,
many still target libraries (TypeORM query builders, Nest decorators, RTK Query),
so two shares are reported: over all kept calls, and over *plausible* calls, i.e.
those whose name exists as a symbol somewhere in the app.

| ally-be | All kept calls | Plausible calls |
|---|---|---|
| Resolved, with DI | **46.4 %** | **63.6 %** |
| Resolved, without DI | 39.8 % | 54.5 % |
| Added by `this.<prop>.<method>()` through the constructor type | +6.6 points | +9.1 points |

By method (ally-be): unique 13,145 · same_file 10,037 · import 8,973 · **di 6,284** ·
self 4,503 · qualified 710 · unresolved 50,335. 1,518 ally-be classes have injected
fields. Other apps (all kept / plausible): ally-web 21 % / 67 %, ally-ai 48 % / 76 %,
ally-ai-learn 55 % / 78 %, ally-mobile 34 % / 73 % (Dart `final Api api;` fields give
it a small `di` share too). Resolution order and what each method means is in the
module docstring. "unique" never picks a symbol defined in a test file when the
caller is app code.

## `neighbourhood(diff)` on three real commits

Run with `bug-hunter map neighbourhood <app> <commit>`; full text under
`runs/cache/neighbourhood-*.md` after `make test-slow`.

- **ally-be `058f8d163`** (fix: existence-guard the AddChatbotAgentRuntime migration): one
  symbol, `AddChatbotAgentRuntime1980960000000.up` (lines 23–61), no callers or tests.
  Correct: migrations are leaves, and a reviewer should see exactly that.
- **ally-web `7299a25cd`** (fix: surface mic/speech errors): `IdeaCaptureLauncher`
  (IdeaCapture.tsx 60–510) with callees `hasFeature`, `useSpeechCapture`, `writeUnsent`,
  `readUnsent`, `formatClock`, `wordCount`; the `SpeechStatus` type; and
  `useSpeechCapture` (65–224) with its one caller `IdeaCaptureLauncher` line 92 and
  callee `getCtor`. No tests by convention or import for either file, which is itself
  a useful signal for `reproduce`.
- **ally-mobile `dba4d3e55`** (fix: battery-optimisation exemption once per install):
  `requestBatteryOptimizationExemptionOnce` (27–39) with its single caller
  `_ScribeRecordingScreenState._startStreaming` line 375; that method's callees
  `ForegroundRecordingService.start` and the new function; and eight
  `scribe_recording_screen_*_test.dart` files found through imports.

No Python fix commit exists in the last 80 on master; the Python path is covered by the
fixture tests (`self`, `import`, decorators, `tests/**/test_<stem>.py`).

## Cross-app contract hints

58 routes found in ally-ai and ally-ai-learn; 52 ally-be path literals matched to a
route (almost all from `src/ai/constants/endpoints.constants.ts`), 26 unmatched (for
example `api/v1/transcription/transcribe-and-summarize` and
`api/v1/roadmap-opportunities`, whose routes are mounted under prefixes the regex does
not compose). **Queues: none matched on the real repo.** The four SQS names appear in
ally-be and the Python apps only in tests or config, not next to a send/receive call,
because queue URLs come from env vars. Chunk 08's `api_contract` lens should match on
the env-var names (`SQS_*_QUEUE_URL`, `QUEUE__*`) instead; noted as open.

## Decisions

- **Artefacts are never deleted by a run.** On exit, by return, exception or SIGTERM,
  `Run.finish()` kills the run's containers, removes the worktree and moves
  `runs/<run_id>/artefacts/` to `runs/artefacts/<run_id>/` with a `status.json`
  (`completed` / `failed` + error / `paused`). Crashed runs are swept by
  `clean_orphans()` at the next `Run.start()` and by `bug-hunter runs clean`; their
  artefacts are kept the same way with status `failed`.
- **Paused runs keep what resume needs.** `run.pause(resume)` writes `resume.json`
  (branch, head, PR url, checkpoint id) and marks the run `paused`; `cache clean`
  skips paused artefacts by age and by size unless `--include-paused`. The worktree is
  still removed: resume recreates one from the pushed `bughunter/<app>/<slug>` branch
  (chunk 06), and the graph state comes back from the Postgres checkpoint (chunk 05).
- **Shared caches are not per-run.** Dependency volumes (keyed by lockfile hash) and the
  repo-map cache (keyed by commit) outlive runs on purpose; `cache clean --volumes`
  and `--repo-map` remove them explicitly. `cache size` reports artefacts, repo map
  per app, tiktoken and the `bughunter-deps-*` volumes.
- **Tokens overestimate offline.** Without tiktoken's encoding file (never downloaded
  implicitly; `BUGHUNTER_TIKTOKEN_DOWNLOAD=1` allows it, cached under
  `runs/cache/tiktoken`) the count is `ceil(chars / 3)`, above the ~4 chars/token of
  English and code. All budgets are enforced at `budget × (1 − 0.15)` because Gemini
  counts differently from tiktoken.
- **Trimming order is fixed and tested**: memory recall → scratchpad (half, last 10
  lines, gone) → app context to its short form → state lists lose whole items from the
  end with an "N more omitted" marker → long state strings cut at a line boundary with a
  marker → `BudgetError`. `review` never receives the scratchpad (spec §7).
- **`NODE_INPUTS` is a dict in `builder.py`** until `BugState` exists (chunk 05); the
  builder takes any mapping, so it works with a dict today and a Pydantic model later.
- **Noise filter at parse time.** Test-framework and builtin calls are dropped before
  resolution so callee lists in prompts stay about app code.
- **`find_symbol` falls back to file names**, so `find_symbol("phi_logger")` returns the
  top-level symbols of `app/core/phi_logger.py`.

## How to test

```bash
cd bug-hunter
make lint && make test            # offline, ~3 s
make test-slow                    # five real apps + three real commits, ~15 s
poetry run bug-hunter map build --contracts
poetry run bug-hunter map neighbourhood ally-mobile dba4d3e55
poetry run bug-hunter cache size
```

## Open questions and notes for later chunks

- Queue contracts via env-var names (see above). HTTP route composition misses routers
  mounted two levels deep; the 26 unmatched literals list what to look at.
- `tests_for` on Python relies on `tests/**/test_<stem>.py` and imports; ally-ai tests
  that patch modules by string path (`patch("app.core.x.y")`) are not linked.
- Dart call extraction is positional (`identifier` + `selector` siblings) and misses
  cascades (`..method()`) and calls on `this.`; good enough for callers/callees of named
  functions, which is what `neighbourhood` uses.
- The Flutter widget tree (`Text(...)`, `Padding(...)`) dominates ally-mobile's
  unresolved calls; a Flutter-widget noise list would raise its raw share, but the
  plausible share already ignores them.
- `compact()` uses a deterministic summariser; chunk 05 can inject a model-backed one
  (the signature is `Callable[[ToolMessage], str]`).
