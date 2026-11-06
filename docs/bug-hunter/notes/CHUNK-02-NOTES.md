# Chunk 02 notes: sandbox and tools

Branch `feat/bug-hunter-v2`, commits `1acb3d625`, `f5754a0f2`, `68067292d` and the
notes commit. `make lint` and `make test` pass (155 offline tests). The Docker
integration run passed for all five apps; numbers in "Sandbox timings" below.

## Code map

| Path | What |
|---|---|
| `bug-hunter/src/bug_hunter/safety/paths.py` | `PathPolicy`: resolve (``..`` and symlinks followed, must stay in the worktree), `check_read`, `check_write(path, app)`, `is_test_path`, `touches_risk`; `DENY_PATTERNS`, `LOCKFILE_PATTERNS`; `matches()` glob semantics shared with the config test |
| `bug-hunter/src/bug_hunter/safety/phi.py` | `scrub` (patterns + field values, for logs/issues/test output), `scrub_code` (patterns only, for source); `USER_FIELDS`, `SECRET_FIELDS`, `PATTERN_ONLY_FIELDS`; `classify_key`, `normalise_key` |
| `bug-hunter/src/bug_hunter/tools/git.py` | `Git`: `create_worktree`/`remove_worktree` under `runs/<run_id>/worktree`, `diff`, `changed_files`, `log`, `blame`, `create_branch` (`bughunter/<app>/<slug>`), `commit` (conventional message, explicit paths, bot identity), `push` (refuses non-`bughunter/` branches; only `open_pr` calls it) |
| `bug-hunter/src/bug_hunter/tools/fs.py` | `Workspace(worktree, config, app)`: `list_dir`, `glob`, `grep` (ripgrep, Python fallback), `read_file` (≤400 lines, numbered), `edit_file` (exactly one match), `write_test_file` (new file, test location, app-scoped) |
| `bug-hunter/src/bug_hunter/tools/sandbox.py` | `Sandbox`: image per app from `sandbox/<image>.Dockerfile` (tag = Dockerfile hash), dependency volumes per lockfile hash, `install()` with network, `exec()` with `--network none`, CPU/memory/pids/time limits, kill on timeout, `cleanup()`; `DockerRunner` interface; `docker_available()` |
| `bug-hunter/src/bug_hunter/tools/runner.py` | `Runner`: `run_tests(target, name)`, `run_lint`, `run_typecheck` → `RunResult` (passed = exit code, failing test names per framework, scrubbed tail excerpt); `single_test_command`, `nx_project` |
| `bug-hunter/src/bug_hunter/tools/lc.py` | `read_tools(workspace, git)`, `write_tools(workspace)`, `runner_tools(runner)` as `StructuredTool`s with Pydantic schemas; every exception returns as `error: …` text |
| `bug-hunter/sandbox/*.Dockerfile` | `node24` (ally-be), `node22` (ally-web), `python312` (ally-ai, ally-ai-learn), `flutter` (ally-mobile, SDK cloned at 3.47.7) |
| `bug-hunter/tests/fixtures/phi_fixtures.json` | Nine fake log lines, issue bodies, traces and payloads with the strings each must lose and keep |
| `bug-hunter/tests/integration/test_sandbox_apps.py` | `docker`-marked: one known-passing test file per app in the real sandbox; writes `runs/integration-timings.json` |

Config additions: `apps.yaml` gained `image`, `install`, `lockfile`, `cache_dirs`, `env`
per app and a `test_one` for ally-web (`{project}` derived from the file path);
`limits.yaml` sandbox memory is 8192 MB (ally-web's Vitest suites use a 5 GB Node heap
each) plus `install_timeout_s` and `pids_limit`. Root `.gitignore` now lists
`/bug-hunter/runs/`.

## What the brief assumed that the repo does not have

- **`ally-ai/app/core/phi_logger.py` and `phi_events.py` hold no PHI field lists.** The
  logger is a CloudWatch audit writer; the events file is a five-value enum. What they do
  define, and what the scrubber reuses: the audit record keys (`chat_id`, `audit_id`,
  `ip`, `location`, `user_agent`, `request_id`) and the `details` keys callers pass
  (`audio_url`, `file_path`, `segment_path`, `wav_file_path`, `input_path`). The email
  and phone regexes are ported from ally-be's `bug-hunter/util/redact-pii.util.ts` and
  `guide/safety/redaction.ts`. Token, API-key and IP patterns are new.
- **No CI job starts a database or queue.** All five `test-*.yml` workflows run unit tests
  with no services, so the sandbox has no sidecars. `ally-be/compose.test.yaml` serves the
  e2e suite only, which is out of scope.
- **No public Docker image ships Flutter 3.47.7** (cirruslabs stops at 3.44.0), so
  `sandbox/flutter.Dockerfile` clones the SDK at that tag, as the CI action does.
- **`ally-web/Dockerfile.deps` pins Node 20**; CI uses 22, so the sandbox uses 22.

## The scrubber's user-field set (final)

Matching is case- and style-insensitive: a key is lowercased with `_`, `-`, `.` and
spaces removed before lookup, so `first_name`, `firstName`, `FirstName` and
`First Name` all hit `firstname`.

| Group | Keys (as written in `USER_FIELDS`) | Source |
|---|---|---|
| Identity | `name`, `first_name`, `last_name`, `full_name`, `display_name`, `username`, `verified_name`, `author_name`, `counselor_name`, `learner_name`, `speaker`, `age`, `gender`, `gender_identity`, `date_of_birth`, `dob` | ally-be entity columns (`name`, `displayName`, `username`, `verifiedName`, `authorName`, `age`, `gender`, `genderIdentity`); ally-ai/learn schemas (`counselor_name`, `learner_name`, `speaker`); DOB added by request |
| Contact | `email`, `source_email`, `source_email_lower`, `phone`, `phone_number`, `mobile`, `whatsapp`, `whatsapp_number`, `wa_id`, `wa_contact_id`, `display_phone_number`, `contact_id`, `supervisor_contact`, `address`, `city`, `location`, `current_location` | ally-be (`email`, `sourceEmail`, `phone`, `displayPhoneNumber`, `waContactId`, `contactId`, `supervisorContact`, `city`, `location`, `currentLocation`); WhatsApp webhook `wa_id`; address added by request |
| Request metadata | `ip`, `ip_address`, `ip_hash`, `user_agent`, `request_id` | ally-ai PHI audit DTO; ally-be `ipAddress`, `ipHash`, `userAgent` |
| User-tied ids | `user_id`, `chat_id`, `audit_id`, `client_id`, `caller_id`, `counselor_id`, `learner_id` | ally-ai PHI audit DTO and callers |
| Conversation and clinical content | `transcript`, `transcription`, `interview_transcript`, `message_content`, `chat_message`, `counselor_message`, `agent_message`, `user_content`, `summary`, `summary_md`, `session_summary`, `rolling_summary`, `previous_summary`, `note`, `notes`, `session_notes`, `case_notes`, `progress_note`, `supervisor_note`, `guide_notes`, `team_notes`, `review_note`, `decision_note`, `outcome_note`, `resolution_note` | ally-be (`transcript`, `interviewTranscript`, `messageContent`, `summary`, `summaryMd`, `note`, `notes`, `guideNotes`, `teamNotes`, `reviewNote`, `decisionNote`, `outcomeNote`, `resolutionNote`); ally-ai/learn (`transcription`, `chat_message`, `counselor_message`, `agent_message`, `user_content`, `session_summary`, `rolling_summary`, `previous_summary`, `progress_note`, `supervisor_note`); session/case notes added by request |
| Audit `details` paths | `audio_url`, `file_path`, `segment_path`, `wav_file_path`, `input_path` | ally-ai PHI logger callers (S3 paths embed chat ids) |

`SECRET_FIELDS` (value → `[secret]`): `password`, `password_hash`, `secret`, `token`,
`access_token`, `refresh_token`, `id_token`, `api_key`, `authorization`,
`aws_secret_access_key`, `aws_access_key_id`, `private_key`, `client_secret`,
`jwt_secret`, `cookie`, `set_cookie`.

`PATTERN_ONLY_FIELDS` (pattern layer only, value kept): `error`, `message`, `msg`,
`stack`, `trace`.

Patterns, in order: JWT, `Bearer …`, Deepgram `Token <40 hex>`, OpenAI `sk-…`, AWS
`AKIA`/`ASIA…`, Google `AIza…`, GitHub `ghp_`/`github_pat_…`, secret query params
(`token=`, `key=`, `signature=`, …), email, phones (`+…` international, Indian 10-digit
mobiles with optional `0`/`91`/`+91`, US `nnn-nnn-nnnn`), IPv4 (except `127.0.0.1` and
`0.0.0.0`). Dates, timestamps and epoch values are left alone; a test pins that.

Known limit: PHI written as prose ("the client said she felt hopeless") is not caught.
Only field values and recognisable patterns are. A model-based redactor is out of scope.

## Decisions

- **Two scrub modes.** `scrub` (fields + patterns) for anything data-shaped; `scrub_code`
  (patterns only) for `read_file`, `grep`, `diff`, `blame` output, because redacting every
  `name:` in source would blind the agent. Test output goes through `scrub`.
- **Dependencies install into Docker volumes keyed on the lockfile hash**, not into the
  worktree, so a second run on the same lockfile skips `npm ci` / `poetry install`. A
  failed install deletes the volume so the next run retries.
- **Network: install on, everything else `--network none`.** Docker has no registry
  allowlist; splitting install from run gives the spec's "package registries only"
  without a proxy, and keeps tests from reaching real APIs.
- **Hosts never run repo code.** `grep` and `glob` read files on the host but execute
  nothing; git runs on the host because git is not repo code.
- **`Workspace` paths are app-relative first.** The agent says `src/user/x.ts`; a path
  that exists only at worktree level (`ally-ai/app/x.py`) also resolves, for reads.
  Writes must be inside the app.
- **`write_test_file` is create-only** and checks `test_dirs` after resolving symlinks.
- **ally-web single test** = `npx nx test <project> --testFile=<file> -t <name>`, with
  the project derived from `apps/<p>/…` or `libs/<p>/…`.
- **Tool errors are text.** Every `StructuredTool` wraps its function so `PathDenied`,
  `FsError`, `RunnerError` reach the model as `error: …` rather than aborting the node.

## Sandbox timings

Measured on this Mac (10 cores, 16 GB; Docker Desktop VM 10 CPU / 8 GB) with
`make test-docker` and `BUGHUNTER_IT_FULL=1`. "Image" is the one-time `docker build`;
"install" is the one-time dependency install into the lockfile-hash volume (network
on); the test columns are warm-volume runs with `--network none`. CI wall-clock from
the last six green master runs (install included) is in the last column for reference.

| App | Image | Install | One test file | Full suite | Full suite result | CI reference |
|---|---|---|---|---|---|---|
| ally-be | 84 s | 73 s (`npm ci`) | 2.5 s | 190 s | pass | 4–7.5 min |
| ally-web | 43 s | 176 s (`npm ci`) | 6.6 s | 548 s | pass | 12–19 min |
| ally-ai | 74 s | 28 s (poetry) | 4.5 s | 49 s | pass | 1.5–2 min |
| ally-ai-learn | (shared) | 68 s (poetry) | 13 s | 306 s | 4 failures, see below | 2–2.7 min |
| ally-mobile | 27 s build after a ~6 min SDK clone | 30 s (`pub get`) | 12–15 s | **not measured locally** | — | 6–7.5 min |

Every app runs one known-passing test file in the sandbox and reports pass; that is
the chunk's acceptance test. Notes per app:

- **ally-ai-learn offline failures (4 of the full suite).** Two need the network and
  will always fail under `--network none`: `test_download_files.py::test_download_required_files_uses_default_threshold`
  (loads the Silero VAD from Hugging Face) and `test_openai_embeddings.py::…::test_token_count_matches_tiktoken_for_the_model`
  (tiktoken downloads its BPE file). One needs git inside the container:
  `test_delivery_openers.py::TestSessionCatalog::test_the_catalog_file_ships` runs
  `git check-ignore`, and a worktree's `.git` is a pointer to the host's `.git/worktrees/…`
  path that does not exist in the container. One is order-dependent:
  `test_main.py::TestMain::test_health_endpoint_returns_ok_and_trace_id_header` fails in
  the full run but passes alone in the same sandbox. Also, its `pytest.ini` turns on
  coverage for every run, which is why a 1-test file takes 13 s here against 4.5 s for
  ally-ai. Chunk 06's `verify` must compare against a baseline run of the same suite
  rather than expecting zero failures, or ally-ai-learn fixes can never verify.
- **ally-mobile** runs on linux/arm64 in the custom Flutter 3.47.7 image (Dart 3.13.5,
  the version `pubspec.yaml` pins), so the arm64 question is settled: it works. The full
  suite was **not measured**: `flutter test` compiles every test into `.dart_tool`, and
  with the host at under 3 GB free the disk guard killed the run after 31 s. Marked
  blocked locally for the full suite only; it will run on the GitHub runner in chunk 08.
  `--no-pub` is required on `flutter test`/`flutter analyze`: without it Flutter
  re-resolves packages and, offline, fails on `pub.dev`.
- **ally-web** single-file runs need the file as a positional Vitest filter after `--`;
  `TESTING.md`'s `--testFile` is not a Vitest 3 option and crashes the CLI.
- **Disk.** The dependency volumes total about 4 GB (ally-web 1.3 GB, ally-be 1 GB,
  ally-ai-learn 1.2 GB, ally-ai 0.4 GB, mobile 0.3 GB) and the four images 5.1 GB. Each
  image build also leaves its layers in Docker's build cache (5 GB for the four), so run
  `docker builder prune` after building. The host was at 5.5 GB free when this chunk
  started and hit 0 twice during the runs; the sandbox is usable here only with care.

## How to test

```bash
cd bug-hunter
make lint && make test                       # offline, ~2 s
make test-docker                             # real sandbox, one test file per app
BUGHUNTER_IT_APPS=ally-ai,ally-be make test-docker   # a subset
BUGHUNTER_IT_FULL=1 make test-docker         # also the full suite per app (slow)
```

## Open questions and notes for later chunks

- The sandbox mounts the whole worktree at `/work` but only the app's directory is the
  working dir; cross-app tests (none in CI today) would need their own services.
- `touches_risk` reports the pattern that fired; the crisis/safety keyword rule from spec
  §9 (category + `crisis`, `self_harm`, `suicid`, `guardrail`, `emergency` in changed
  code) belongs to `risk_precheck` in chunk 05 and is not here.
- `Runner` parses Jest, Vitest, pytest and `flutter test` output by regex; a JSON
  reporter per framework would be more robust and is worth doing when a parse misses.
- Tests that shell out to `git` fail in the container (worktree `.git` pointer). If more
  turn up, mount the main repo's `.git` read-only at the same absolute path, or
  `git worktree repair` inside the container.
- Network-dependent tests (Hugging Face, tiktoken) mean "full suite passes" is not a
  usable gate for ally-ai-learn offline; `verify` needs a baseline (chunk 06).
- Root `.pre-commit-config.yaml` still does not cover `bug-hunter/`.
