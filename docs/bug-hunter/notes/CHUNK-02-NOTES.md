# Chunk 02 notes: sandbox and tools

Branch `feat/bug-hunter-v2`, commits `1acb3d625` + `f5754a0f2`. `make lint` and
`make test` pass (155 offline tests). The Docker integration run is recorded in
"Sandbox timings" below.

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

CI wall-clock from the last six green runs on master (install included) is the
reference: ally-be 4–7.5 min, ally-web 12–19 min, ally-ai 1.5–2 min, ally-ai-learn
2–2.7 min, ally-mobile 6–7.5 min.

Real sandbox numbers on this Mac (10 cores, 16 GB; Docker VM 10 CPU / 8 GB):

PENDING — the integration run needs Docker disk reclaimed first (5.5 GB free on the
host; `docker system df` showed 25.5 GB of images and 14 GB of build cache). This
section is filled in by `make test-docker`, which writes
`bug-hunter/runs/integration-timings.json`.

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
- Root `.pre-commit-config.yaml` still does not cover `bug-hunter/`.
