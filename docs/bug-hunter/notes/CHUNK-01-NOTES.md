# Chunk 01 notes: scaffold, config, model factory

Branch `feat/bug-hunter-v2`. `make install && make lint && make test` and
`bug-hunter config check` all pass (69 tests, offline).

## Code map

| Path | What |
|---|---|
| `bug-hunter/pyproject.toml` | Poetry, `python >=3.12,<3.14`, `src/bug_hunter` layout, `bug-hunter` console script; Black/isort config copied from `ally-ai` |
| `bug-hunter/.flake8` | Same as `ally-ai/.flake8` |
| `bug-hunter/Makefile` | `install`, `test`, `lint` (flake8 + isort check + black check, as `ally-ai-learn`), `format`, `check` |
| `bug-hunter/config/apps.yaml` | Five apps: path, commands, test dirs, risk paths (corrections below) |
| `bug-hunter/config/models.yaml` | Spec §10 verbatim |
| `bug-hunter/config/limits.yaml` | Attempts, daily caps, per-run token and wall-clock budget, approval expiry, sandbox limits, per-node token budgets |
| `bug-hunter/src/bug_hunter/config.py` | Pydantic models (`extra="forbid"`, frozen) for the three files; `load_config()`; `ConfigError` naming file and field; `BUGHUNTER_MODEL_<ROLE>=provider:model`, `BUGHUNTER_REPO_ROOT`, `BUGHUNTER_CONFIG_DIR` |
| `bug-hunter/src/bug_hunter/models.py` | `get_model(role)` via `init_chat_model`; `get_embeddings()` via `init_embeddings`; `ChatModelWithFallbacks` |
| `bug-hunter/src/bug_hunter/cli.py` | Typer; `bug-hunter config check [--config-dir] [--repo-root] [--json]` |
| `bug-hunter/tests/` | `test_config.py`, `test_models.py`, `test_cli.py` |

## Corrections to the spec's `apps.yaml` (verified against CI workflows and package files)

- **ally-be**: dropped `test/` from `test_dirs`; it does not exist. Jest's `rootDir` is `src` with `testRegex .*\.spec\.ts$`, so tests are `src/**/test/` and `src/**/*.spec.ts`. (`package.json` still has a `test:e2e` script pointing at `./test/jest-e2e.json`, which is dangling; not ours to fix.)
- **ally-web**: `typecheck` now chains the three `tsc` runs CI does (admin, helpline, ui-shared), not only admin. `lint` is `npm run lint && npm run format:check && npm run lint:colors` as in `test-ally-web.yml`. The risk glob `**/*Auth*` also matched `agentAuthored.ts` and `useContentAuthoring.ts`; replaced by the real auth and permission files (`**/auth/**`, `**/api/auth.ts`, `**/types/auth.ts`, `PrivateRouteLayout`, `PermissionGuardedRoute`, `permission-guard/`, `constants/permissions.ts`, `utils/permission(s).ts`). Added `test_dirs`. No `test_one` yet: Vitest under Nx needs a per-project command, decided in chunk 02.
- **ally-ai-learn**: `test` is `poetry run python -m pytest tests/ -v` and `lint` is `poetry run flake8`, as CI runs them; the spec had a bare `poetry run pytest` and no lint. Note its `pytest.ini` adds `--cov`, so the full suite is slower than ally-ai's.
- **ally-ai**: added `app/core/transcriptions/utils/phi_events.py` to `risk_paths` (sibling of the listed `phi_logger.py`); added `test_dirs` and `test_one`.
- **ally-mobile**: unchanged; added `test_dirs` and `test_one`.
- A test (`test_every_risk_path_matches_tracked_files`) checks that every risk path, test dir and global risk path matches at least one git-tracked file, so a renamed directory fails the build instead of silently leaving a risk path unguarded. Glob semantics there (`*` crosses `/`, trailing `/` means the subtree) are what `safety/paths.py` must implement in chunk 02.

## Decisions

- **`langchain` package added.** `init_chat_model` and `init_embeddings` live in `langchain` (1.4.x), which neither Python app depends on; `langchain-core`, `langchain-openai` and `langchain-google-genai` match ally-ai's lock line. Resolved: langchain 1.4.9, langchain-core 1.7.6, langchain-openai 1.7.4, langchain-google-genai 4.4.3, pydantic 2.14.3, typer 0.28.0.
- **No `langgraph` yet.** First used in chunk 05; pin `^1.2` and `langgraph-checkpoint-postgres ^3.2` there, per CONTEXT.
- **Fallbacks keep the chat-model API.** `RunnableWithFallbacks` has no `with_structured_output` or `bind_tools`, so roles with fallbacks return `ChatModelWithFallbacks` (a subclass) whose two methods apply the call to the primary and every fallback and return a fallback chain again. Tests prove both calls reach the Gemini fallback and that a failing primary falls through to the fallback's structured output (with fake models, offline). Roles without fallbacks return the plain `BaseChatModel`.
- **`embeddings` is not a chat role.** `get_model("embeddings")` raises; `get_embeddings()` builds it with `init_embeddings`. Fallbacks for `embeddings` are rejected at config load.
- **Temperature on gpt-5.** `langchain-openai` drops `temperature` for reasoning models (the client field reads `None`); the factory still passes the configured value, which is asserted via a spy on `init_chat_model`. Gemini keeps `temperature=0`.
- **Config is frozen and strict.** Unknown keys, unknown apps or roles, missing apps or roles, bad ranges all raise `ConfigError` with `<file>: invalid config` plus `field.path: message` lines.
- **`typecheck`/`lint` are single shell strings** chained with `&&`, so the chunk 02 runner executes one command per check.
- **Prompt versions** (spec §11 says the active version per node is set in `models.yaml`) are not modelled yet; add the key in chunk 05 with the first prompts.

## How to test

```bash
cd bug-hunter
poetry env use "$(uv python find 3.12)"
make install && make lint && make test
poetry run bug-hunter config check            # or: make check
BUGHUNTER_MODEL_FIX=openai:gpt-5-mini poetry run bug-hunter config check --json
```

Tests set dummy `OPENAI_API_KEY`/`GOOGLE_API_KEY` so provider clients can be
constructed; nothing is invoked.

## Open questions and notes for later chunks

- Root `.pre-commit-config.yaml` scopes black/isort/flake8/pytest to the two Python apps; `bug-hunter/` is not hooked until a root-file change is in scope. CI for `bug-hunter/` arrives with the workflow in chunk 08.
- `ally-web` single-test command (chunk 02): likely `npx nx test <project> --testFile=<path> -t <name>`; needs the project derived from the file path.
- `google-genai` prints a `SyntaxWarning` on first import under Python 3.12 (upstream, cached after the first run). Harmless.
- `create_agent`/`create_react_agent` in chunk 05 expect a `BaseChatModel`; `ChatModelWithFallbacks` is a `RunnableWithFallbacks`. Either pass `primary_of(model)` plus a fallback at the loop level, or write the tool loop by hand (spec §2 allows both).
