# Chunk 02: Sandbox and tools

**Read first:** `CONTEXT.md`, `spec.md` §6, §9; each app's `AGENTS.md`, `compose.test.yaml` / docker-compose files, and its `.github/workflows/test-*.yml` (the sandbox must mirror CI).

## Goal
Safe, typed tools the agent will use: file system, git, sandboxed test runs, and the PHI scrubber. The safety rules are enforced in code here, not in prompts.

## Build
1. `safety/paths.py`: deny paths and risk paths from config; `check_read(path)`, `check_write(path, app)`, `touches_risk(paths, app)`. Path traversal and symlinks resolved before checking.
2. `safety/phi.py`: scrubber per spec §9. Reuse field names from `ally-ai/app/core/phi_logger.py` and `phi_events.py`. Fixtures of realistic fake log lines, issue bodies and stack traces; a leak in any fixture fails the test suite.
3. `tools/git.py`: create/remove worktree at a given ref under a runs directory; diff, log, blame (range), branch, commit. Push is a separate function only `open_pr` will call.
4. `tools/fs.py`: `list_dir`, `glob`, `grep` (ripgrep), `read_file` (ranges, max 400 lines, line numbers), `edit_file` (exact single match), `write_test_file` (new files in test locations only). All return compact, scrubbed text and go through `paths.py`.
5. `tools/sandbox.py`: start a container per run with the worktree mounted, per-app base images matching CI versions (Node 24 / Node 22 / Python 3.12 + Poetry / Flutter), resource and time limits, network limited to package registries. Bring up test services from the app's existing compose files where the tests need them.
6. `tools/runner.py`: `run_tests(app, target=None)`, `run_lint(app)`, `run_typecheck(app)` using `apps.yaml` commands; returns pass/fail, failing test names and a truncated, scrubbed excerpt.
7. Expose tools as LangChain tools with Pydantic arg schemas.

## Done when
- Unit tests: deny paths can't be read or written (including via `../` and symlinks); `edit_file` refuses zero or multiple matches; `write_test_file` refuses overwrites and non-test paths; scrubber fixtures pass.
- Integration test (marked, skipped in CI without Docker): for each app, the sandbox runs one known-passing existing test file and reports pass. Record the time each app takes in the notes.
- `CHUNK-02-NOTES.md` written, including any app whose tests could not run in the sandbox and why.

## Not in this chunk
Repo map, models, graph, GitHub, CloudWatch.
