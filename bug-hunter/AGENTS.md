# bug-hunter — start here

This package is Bug Hunter v2: a LangGraph agent that finds and fixes bugs in the five
apps of `ally-platform`. It lives beside the apps and is **not** one of them: it has no
service, no deploy, and must not depend on the app it is fixing.

**Before any work here, read `docs/bug-hunter/CONTEXT.md` (the non-negotiable rules and
how to work), then `docs/bug-hunter/spec.md`, then the current chunk brief named at the
top of `CONTEXT.md`.** Work only on the current chunk.

## Run

```bash
cd bug-hunter
poetry env use "$(uv python find 3.12)"   # once
make install && make lint && make test
poetry run bug-hunter config check
make test-docker                          # real sandbox, one test file per app (needs Docker)
make test-slow                            # repo map of the five real apps; writes runs/cache/map-stats.json
poetry run bug-hunter map build --contracts   # refresh the repo map + cross-app hints at HEAD
poetry run bug-hunter cache size          # what the bug hunter keeps on this machine
poetry run bug-hunter cache clean         # prune kept artefacts by age (30 d) and size (500 MB)
poetry run bug-hunter runs clean          # sweep what a crashed run left behind
```

Python 3.12, Poetry, pytest + pytest-asyncio, Black (88), isort, flake8, matching
`ally-ai` and `ally-ai-learn`. `make lint` and `make test` must pass before anything is
called done. Unit tests never hit the network or a real model.

## Where things are

| Path | What |
|---|---|
| `config/apps.yaml` | The five apps: path, test/lint/typecheck commands (copied from the root `CLAUDE.md` "Verified commands"), test dirs, risk paths |
| `config/models.yaml` | Model per role; `BUGHUNTER_MODEL_<ROLE>=provider:model` overrides |
| `config/limits.yaml` | Attempts, daily caps, budgets, sandbox limits |
| `src/bug_hunter/config.py` | Loads + validates the YAML; `ConfigError` with file and field |
| `src/bug_hunter/models.py` | `get_model(role)`, `get_embeddings()`; the only module that touches provider SDKs |
| `src/bug_hunter/cli.py` | Typer CLI; `bug-hunter config check` |
| `src/bug_hunter/safety/paths.py` | Deny paths, lockfiles, app-scoped writes, risk paths; every tool resolves through it |
| `src/bug_hunter/safety/phi.py` | PHI/secret scrubber: `scrub` (data) and `scrub_code` (source); field lists at the top |
| `src/bug_hunter/tools/fs.py` | `Workspace`: list_dir, glob, grep, read_file, edit_file, write_test_file |
| `src/bug_hunter/tools/git.py` | `Git`: worktrees, diff/log/blame, branch, commit; `push` only for open_pr |
| `src/bug_hunter/tools/sandbox.py` | `Sandbox`: per-app Docker image, dependency volumes, offline command runs |
| `src/bug_hunter/tools/runner.py` | `Runner`: run_tests/run_lint/run_typecheck from apps.yaml, parsed results |
| `src/bug_hunter/tools/lc.py` | The above as LangChain `StructuredTool`s: `read_tools`, `write_tools`, `runner_tools` |
| `sandbox/*.Dockerfile` | Test images per app, versions mirroring `.github/workflows/test-*.yml` |
| `src/bug_hunter/runs.py` | `Run` lifecycle: worktree + containers always cleaned, artefacts always kept under `runs/artefacts/<run_id>/`; `clean_orphans`, `clean_artefacts`, `cache_report` |
| `src/bug_hunter/context/app_context.py` | Per-app knowledge: `AGENTS.md` + the app's parts of the root `CLAUDE.md` |
| `src/bug_hunter/context/repo_map.py` | tree-sitter symbol index + best-effort call graph (NestJS DI aware); `outline`, `find_symbol`, `callers`, `callees`, `tests_for`, `neighbourhood(diff)`; gzip cache per commit under `runs/cache/repo-map/` |
| `src/bug_hunter/context/contracts.py` | Cross-app hints: ally-be client literals ↔ ally-ai / ally-ai-learn routes, SQS producers ↔ consumers |
| `src/bug_hunter/context/scratchpad.py` | Per-run notes file; `compact()` folds old tool turns into it |
| `src/bug_hunter/context/builder.py` | `build_context(node, state)`: declared fields + app context + recall + scratchpad within the node's budget, fixed trimming order |
| `src/bug_hunter/context/tokens.py` | tiktoken when cached, else an overestimate (3 chars/token); budgets enforced at (1 − safety margin) |
| `runs/` | Live runs, kept artefacts (`runs/artefacts/`), caches (`runs/cache/`); all gitignored |
| `docs/bug-hunter/notes/CHUNK-NN-NOTES.md` | Per-chunk code map, decisions, open questions |

## Rules that apply to this code (short form; `CONTEXT.md` is canonical)

- Every external call (LLM, GitHub, CloudWatch, Docker) goes through an interface tests can fake.
- Only `models.py` imports provider packages.
- Never read `.env*`, `env/`, `docker.env`, secrets or `/infra/`; never print env values.
- Don't touch anything outside `bug-hunter/` and `docs/bug-hunter/` unless the chunk says so.
