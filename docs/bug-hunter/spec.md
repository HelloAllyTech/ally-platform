# Bug Hunter v2: Technical Spec

Owner: @shubham · Nov 6, 2026 · Status: ready to build (chunk 01)

Read `CONTEXT.md` first. That file holds the non-negotiable rules; this one holds the design.

## 1. Scope

**In scope:** the five apps in `ally-platform` (`ally-be`, `ally-web`, `ally-ai`, `ally-ai-learn`, `ally-mobile`). Functional bugs: logic errors, crashes, unhandled errors, null handling, broken API contracts between apps, race conditions, security bugs in app code.

**Out of scope:** style or refactoring suggestions, performance tuning without a failing behaviour, dependency upgrades, infrastructure (`/infra` is a separate repo), CI workflow files, the wiki, `ally-mobile-flutter` (archived).

## 2. Architecture

One LangGraph `StateGraph`, one run per bug. A separate lightweight **dispatcher** turns raw signals into bug candidates and starts one graph run per candidate.

```
signals ──► dispatcher ──► [graph run per candidate]

intake ─► triage ─┬─► (duplicate / not a bug / known false alarm) ─► close
                  └─► investigate ─► reproduce ─┬─► (cannot reproduce) ─► escalate ─► report
                                                └─► risk_precheck ─┬─► (risky path) ─► escalate
                                                                   └─► fix ─► verify ─┬─► (fail, attempts < 3) ─► fix
                                                                                      ├─► (fail, attempts = 3) ─► escalate
                                                                                      └─► (pass) ─► review ─┬─► (rejected) ─► fix or escalate
                                                                                                            └─► (approved) ─► risk_gate ─► human_approval ─► open_pr ─► report
report ─► learn (writes long-term memory)
```

Conditional edges are pure functions of the state (no LLM calls on edges), so routing is testable without models.

Use subgraphs only where a node grows its own loop. `investigate` and `fix` are ReAct-style tool loops (`create_react_agent` or a hand-written tool loop) wrapped as single nodes; everything else is a plain function node.

## 3. Folder layout

```
bug-hunter/
  pyproject.toml            # Poetry, Python 3.12
  Makefile                  # install, test, lint, eval, run
  README.md
  AGENTS.md / CLAUDE.md     # how to work on the bug hunter itself
  config/
    models.yaml             # model per role (§10)
    apps.yaml               # the five apps: paths, commands, risk paths (§9)
    limits.yaml             # budgets, caps, attempts
  prompts/                  # versioned prompt files (§11)
    triage.v1.md  investigate.v1.md  reproduce.v1.md  fix.v1.md  review.v1.md  lens_*.v1.md
  src/bug_hunter/
    cli.py                  # `bug-hunter run|sweep|eval|replay`
    config.py               # loads + validates the YAML (Pydantic)
    models.py               # model factory (§10)
    graph/
      state.py              # BugState and sub-models (§4)
      build.py              # builds and compiles the graph
      routing.py            # conditional-edge functions
      nodes/                # one module per node
    tools/
      fs.py                 # list_dir, glob, grep, read_file, edit_file, write_test_file
      git.py                # worktree, diff, log, blame, branch, commit
      sandbox.py            # Docker runner
      runner.py             # run_tests, run_lint, run_typecheck per app
      logs.py               # CloudWatch error search (scrubbed)
      github.py             # issues, draft PRs, PR outcomes (GitHub App auth)
    context/
      repo_map.py           # tree-sitter symbol index + call graph
      app_context.py        # loads the app's AGENTS.md, conventions, commands
      builder.py            # assembles each node's context within budget
      scratchpad.py
    memory/
      store.py              # LangGraph Store namespaces (§8)
      feedback.py           # PR outcome → memory
    safety/
      phi.py                # PHI/secret scrubber
      paths.py              # deny paths and risk paths
    signals/
      dispatcher.py
      commit_sweep.py  ci_failures.py  error_logs.py  issues.py
    output/
      pr_body.py  escalation.py  run_report.py
  evals/
    golden/                 # cases (§14)
    run_evals.py
    metrics.py
  tests/                    # unit tests, all offline
docs/bug-hunter/            # this spec, chunk briefs, chunk notes
.github/workflows/bug-hunter-v2.yml   # added in chunk 08
```

## 4. State

`BugState` is a Pydantic model and the graph's state schema. Nodes return partial updates. Keep large artefacts (full logs, file contents) out of the state; store them in the run's artefact folder and keep the path plus a short summary in the state.

```python
class Signal(BaseModel):
    source: Literal["commit_sweep", "ci_failure", "error_log", "issue"]
    ref: str                      # commit SHA, workflow run id, log query id, issue number
    raw_summary: str              # already PHI-scrubbed
    reported_by: Literal["agent", "ci", "monitoring", "staff", "user"]

class Finding(BaseModel):
    app: AppName
    title: str
    category: Literal["logic", "crash", "error_handling", "null", "contract", "race", "security", "other"]
    severity: Literal["critical", "high", "medium", "low"]
    suspected_files: list[str]
    evidence: list[str]           # concrete observations with file:line
    hypothesis: str

class Repro(BaseModel):
    test_path: str
    test_name: str
    command: str
    failing_output_excerpt: str   # scrubbed, truncated
    fails_for_the_right_reason: bool   # judged in reproduce node

class Patch(BaseModel):
    branch: str
    diff_path: str                # artefact path
    files_changed: list[str]
    lines_changed: int
    rationale: str

class Verification(BaseModel):
    repro_passes: bool
    app_tests_pass: bool
    lint_pass: bool
    typecheck_pass: bool
    new_failures: list[str]

class Review(BaseModel):
    verdict: Literal["approve", "request_changes", "reject"]
    issues: list[str]
    regression_risks: list[str]

class BugState(BaseModel):
    run_id: str
    signal: Signal
    finding: Finding | None = None
    duplicate_of: str | None = None
    repro: Repro | None = None
    root_cause: str | None = None
    patch: Patch | None = None
    verification: Verification | None = None
    review: Review | None = None
    risk_level: Literal["low", "medium", "high", "human_only"] | None = None
    confidence: Literal["high", "medium", "low"] | None = None
    attempts: int = 0
    status: Literal["new", "triaged", "investigating", "reproduced", "fixing",
                    "verified", "reviewed", "awaiting_human", "pr_opened",
                    "escalated", "closed_not_bug", "closed_duplicate", "failed"] = "new"
    pr_url: str | None = None
    escalation_url: str | None = None
    scratchpad_path: str
    budget_used: Budget
```

## 5. Nodes

| Node | Job | Model role | Tools |
|------|-----|-----------|-------|
| `intake` | Normalise the signal, scrub it, create worktree and scratchpad | none | git, safety |
| `triage` | Pick the app, decide if it is a real bug candidate, set severity, check duplicates and known false alarms in memory | `triage` (cheap) | memory search, read-only fs |
| `investigate` | Trace the data flow and form a hypothesis with evidence (file:line) | `investigate` (strong) | fs read, grep, repo map, git log/blame, logs |
| `reproduce` | Write a minimal failing test in the app's own test framework and location; run it; confirm it fails for the hypothesised reason, not for setup errors | `fix` | `write_test_file`, run_tests |
| `risk_precheck` | If the likely fix touches a `risk_path`, route to escalate | none (rules) | paths |
| `fix` | Smallest diff that makes the repro test pass. Edits via exact string replace only | `fix` (strong) | fs read, `edit_file`, run single test |
| `verify` | Run the repro test, then the app's full unit suite, lint and typecheck, in the sandbox | none | runner |
| `review` | Independent critic. Sees only: finding, repro test, diff, verification. Hunts for regressions, scope creep, wrong root cause, missing cases | `review` (different model family) | fs read |
| `risk_gate` | Compute `risk_level` from paths touched, lines changed, app, severity, review; anything not `low` needs a named human reviewer | none (rules) | — |
| `human_approval` | Writes a pending approval (§13a) and calls LangGraph `interrupt()`. A super duper admin approves or rejects in the admin dashboard; the run resumes from the Postgres checkpoint | none | approvals table |
| `open_pr` | Push `bughunter/<app>/<slug>` and open a **draft** PR with the template (§13) *before* `human_approval`, so the approver can see the real diff and CI results. On approval: mark it ready for review and enable auto-merge. On rejection: close it with the reason | none | git, github |
| `escalate` | Open or update a GitHub issue with findings, evidence and why it stopped | none | github |
| `report` | Write the run report (JSON + markdown) to the artefact folder | none | — |
| `learn` | Write the run's outcome to long-term memory (§8) | `triage` | memory |

Verification is code, not judgement: `verify` and `risk_gate` never ask a model whether tests passed.

## 6. Tools

Every tool is a typed function with a Pydantic input model, runs inside the sandbox where it executes code, and enforces the path rules in `safety/paths.py` itself (not just in the prompt).

**File system (`tools/fs.py`)**
- `list_dir(path, depth=1)`, `glob(pattern)`, `grep(pattern, path, max_results=50)` (ripgrep).
- `read_file(path, start_line, end_line)` — max 400 lines per call; returns line numbers.
- `edit_file(path, old_str, new_str)` — `old_str` must match exactly once; no whole-file rewrites of existing files.
- `write_test_file(path, content)` — only under the app's test locations; can create, never overwrite an existing test.
- All reject deny paths: `.env*`, `**/env/**`, `docker.env`, `*.pem`, `*.key`, `/infra/**`, `.git/**`, `.github/**`, lockfiles (read allowed for lockfiles, write never).

**Git (`tools/git.py`)**: create worktree from `origin/master` (or the commit under test), `diff`, `log -n` for a path, `blame` for a line range, branch, commit with conventional message. No push except in `open_pr`.

**Sandbox (`tools/sandbox.py`)**: one container per run, built from per-app images that mirror CI (Node 24 for ally-be, Node 22 for ally-web, Python 3.12 + Poetry for the two Python apps, Flutter for mobile). Worktree mounted read-write; no network except package registries; CPU, memory and time limits from `limits.yaml`. Services the tests need (Postgres, Redis, LocalStack, Weaviate) come from the app's existing `compose.test.yaml` / docker-compose files where they exist.

**Runner (`tools/runner.py`)**: commands come from `apps.yaml`, which copies the root `CLAUDE.md` **Verified commands**. Supports running one test file or test name, and the full suite. Output is truncated and scrubbed before it reaches a prompt.

**Logs (`tools/logs.py`)**: CloudWatch Logs Insights queries for errors per service, read-only credentials, results scrubbed. Returns error signature + count + first/last seen, never raw request bodies.

**GitHub (`tools/github.py`)**: GitHub App auth (short-lived installation tokens). Read issues, create draft PRs, create/update escalation issues, read PR outcomes (merged, closed, review comments) for `learn`.

## 7. Context engineering

The goal: each model call sees the smallest set of tokens that lets it do its one job.

- **App context.** For the bug's app, load its `AGENTS.md` and the relevant section of the root `CLAUDE.md` (stack, verified commands). Cache them; include in every node prompt for that app.
- **Repo map.** `context/repo_map.py` builds a per-app symbol index with tree-sitter (TypeScript, Python, Dart): files, classes, functions, imports, and a callers/callees graph. Rebuilt incrementally per commit and cached. `investigate` starts from the map, not from file dumps.
- **Diff neighbourhood.** For a commit-sweep signal, context = the diff + for each changed function its callers, callees and existing tests (from the map), capped by budget.
- **Just-in-time reading.** Nodes read files through tools, in ranges, as needed. Never pre-load whole files into a prompt.
- **Scratchpad.** Each run has `scratchpad.md`. The investigate and fix loops write notes there ("checked X, ruled out Y because Z"). When a loop's message history passes its budget, older tool results are summarised into the scratchpad and dropped from history.
- **Per-node budgets** (in `limits.yaml`): each node declares which state fields it reads and its token budget. `review` is deliberately blind to the investigator's reasoning; it sees the claim and the evidence.
- **Memory recall.** Before `triage` and `fix`, retrieve at most 5 similar past cases from long-term memory (§8), summarised to a few lines each.

## 8. Memory

| Layer | What | Where |
|-------|------|-------|
| Working | Current run state, scratchpad, artefacts | `BugState`, `runs/<run_id>/` |
| Short-term | Full graph checkpoints, so runs survive restarts and pause for human approval | `langgraph-checkpoint-postgres` (`PostgresSaver`) |
| Long-term | Knowledge that outlives a run | LangGraph `PostgresStore`; semantic search with pgvector if the server has it (§15), otherwise lookup by error signature, app and file paths |

**Long-term namespaces** (per app):
- `(app, "bugs")` — past bugs: signature, root cause, fix summary, files, outcome. Used for dedupe and as fix examples.
- `(app, "false_alarms")` — findings humans rejected and **why**. Triage checks these first.
- `(app, "conventions")` — rules learned from review comments ("use `TenantScopedRepository`, not raw queries").
- `(app, "fragile_areas")` — files where fixes often get rejected or cause regressions; raises risk level.
- `("global", "run_stats")` — per-signal and per-lens precision, used to tune the sweep.

**Feedback loop (`memory/feedback.py`).** A daily job reads every bug-hunter PR and escalation: merged unchanged, merged with edits, closed, review comments. It writes the outcome into the namespaces above. Closed PRs require a reason; the PR template asks reviewers for one (§13).

Store only scrubbed text. No user data, no log payloads, no secrets in memory.

## 9. Safety

**`config/apps.yaml`** (starting values; Claude Code verifies each path exists in chunk 01):

```yaml
apps:
  ally-be:
    path: ally-be
    lang: typescript
    test: "npm test -- --forceExit --detectOpenHandles"
    test_one: "npx jest {file} -t {name} --forceExit"
    lint: "npm run lint"
    typecheck: "npm run typecheck"
    test_dirs: ["src/**/test/", "src/**/*.spec.ts", "test/"]
    risk_paths: [src/auth/, src/authorization/, src/tenant/, src/user/, src/audit/,
                 src/database/migrations/, src/config/, src/rate-limit/,
                 src/conversational-guardrails/]
  ally-web:
    path: ally-web
    lang: typescript
    test: "npm test"
    lint: "npm run lint"
    typecheck: "npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json"
    risk_paths: ["**/auth/**", "**/*Auth*", "**/permissions/**"]
  ally-ai:
    path: ally-ai
    lang: python
    test: "poetry run pytest tests/ -v"
    lint: "poetry run flake8"
    risk_paths: [app/core/phi_logger.py, app/core/phi_events.py, app/core/config.py,
                 app/migrations/, app/middleware.py, app/core/transcriptions/utils/phi_logger.py]
  ally-ai-learn:
    path: ally-ai-learn
    lang: python
    test: "poetry run pytest"
    risk_paths: [app/core/config.py, app/middleware.py, app/core/emergency_finalize.py]
  ally-mobile:
    path: ally-mobile
    lang: dart
    test: "flutter test"
    lint: "flutter analyze"
    risk_paths: [lib/core/auth/, lib/core/network/, lib/core/config/, ios/, android/]
    notes: "Never run dart format on this app."
global_risk_paths: ["**/package.json", "**/pyproject.toml", "**/pubspec.yaml",
                    "**/Dockerfile*", "**/*compose*.y*ml", ".github/**"]
```

Also human-only regardless of path: any change to crisis, safety or guardrail behaviour (detected by the finding's category plus a keyword check on changed code: `crisis`, `self_harm`, `suicid`, `guardrail`, `emergency`). On a mental-health platform those are never auto-fixed.

**PHI scrubber (`safety/phi.py`).** Runs on every string entering a prompt or memory. Redacts emails, phone numbers (including Indian formats), JWTs and bearer tokens, API keys (OpenAI, AWS, Deepgram patterns), IP addresses, UUIDs tied to user fields, and known PHI field names from ally-ai's `phi_logger.py` and `phi_events.py` (reuse their field lists rather than inventing new ones). Unit-tested with fixtures; a test fails the build if a fixture leaks.

**Sandbox.** Code from the repo runs only inside the container. The host process never executes repo code.

## 10. Models

All model access goes through `models.py`, which reads `config/models.yaml` and calls LangChain's `init_chat_model`. Nothing else imports a provider SDK.

```yaml
# Models the platform already uses (ally-ai / ally-ai-learn config), so the API keys exist.
defaults: { temperature: 0, timeout_s: 120, max_retries: 2 }
roles:
  triage:      { provider: openai,        model: gpt-5-mini }
  investigate: { provider: openai,        model: gpt-5 }
  fix:         { provider: openai,        model: gpt-5 }
  review:      { provider: google_genai,  model: gemini-2.5-pro }   # different family on purpose
  embeddings:  { provider: openai,        model: text-embedding-3-small }
fallbacks:
  investigate: [{ provider: google_genai, model: gemini-2.5-pro }]
  fix:         [{ provider: google_genai, model: gemini-2.5-pro }]
```

- OpenAI is the default because the rest of the platform uses it; `langchain-google-genai` is already used in the Python apps, which makes Gemini the easy second family for `review`. Anthropic can be added the same way.
- Override any role with env vars (`BUGHUNTER_MODEL_FIX=provider:model`) for evals.
- Every structured output uses `.with_structured_output(PydanticModel)`; retry once on validation failure, then fail the node cleanly.
- Log tokens and cost per node per run.

## 11. Prompts

- Plain files under `prompts/`, named `<node>.v<N>.md`, with a header listing the input variables. The active version per node is set in `config/models.yaml` so evals can compare versions.
- Each prompt has four parts: role and single job; Ally context (injected: app context, memory recall); rules (from `CONTEXT.md`, written for the model); output schema and two or three short examples of a good result and a bad one.
- Every finding-producing prompt says explicitly that "no bug found" is a correct, valued answer and that unproven findings are worse than none.
- Confidence rubric, used by triage, investigate and review:
  - **high** — failing test reproduces it and the data flow is traced end to end.
  - **medium** — data flow traced, test not yet written.
  - **low** — pattern match or suspicion only. Low never becomes a PR.
- Prompts are not stored in the Skills Store; that store serves product prompts, and the bug hunter must not depend on the app it is fixing.

## 12. Signals and detection

| Source | Trigger | How a candidate is made |
|--------|---------|-------------------------|
| Commit sweep | New commits on `master` (daily batch) | Multi-lens review of the diff neighbourhood (below) |
| CI failure | A `test-*.yml` run fails on `master` | Failing test names + scrubbed output; the failing test is the repro |
| Error logs | Daily CloudWatch query per service | New or spiking error signatures with stack frames in app code |
| Issues | Issue opened or labelled `bug` by staff or users | Issue title/body (scrubbed) + any steps to reproduce |

Staff and user reports are first-class: an issue labelled `bug` goes through the same graph, and the agent comments on the issue with its result (PR link or findings).

**Commit sweep in detail.** Precision matters most here, so it uses narrow passes and a falsifier:
1. For each changed app, run five narrow lens prompts over the diff neighbourhood: `logic`, `error_handling_and_null`, `security_and_data_exposure`, `async_and_race`, `api_contract` (the last checks calls between apps: ally-be ↔ ally-ai, ally-be ↔ ally-ai-learn, web/mobile ↔ ally-be).
2. A falsifier prompt receives each finding and tries to prove it wrong with the code. Only findings that survive with at least medium confidence become candidates.
3. Dedupe against open bug-hunter PRs, open issues and `(app, "bugs")` memory.
4. Rank by severity × confidence. Start at most `max_runs_per_day` graph runs (default 5) and open at most `max_prs_per_day` (default 3).

## 13. Outputs

**Draft PR body** (generated from state, never free-written by a model):

```
## Bug
<one-line title> · app: <app> · severity: <severity> · source: <signal source + link>

## Root cause
<root_cause, 2–4 sentences, with file:line references>

## Reproduction
Test: `<test_path>::<test_name>` — failed before this change, passes after.

## Fix
<rationale> · <files_changed> · <lines_changed> lines

## Verification
- [x] repro test  - [x] app test suite  - [x] lint  - [x] typecheck

## Risk
<risk_level> · reviewer verdict: <verdict> · confidence: <confidence>

## Approval
Approve or reject in the Ally admin dashboard → Bug Hunter → Approvals (super duper admins only).
Rejecting asks for a one-line reason; the bug hunter learns from it.
```

**13a. Approval flow (UI)**

1. The graph opens the draft PR, waits for its CI checks, then `human_approval` writes a row to `approvals` in the `bughunter` database: run ID, app, title, severity, risk level, confidence, root cause, repro test, files changed, PR link, CI status, status `pending`. Then `interrupt()`; the run sleeps in the checkpoint.
2. The admin dashboard shows pending approvals to users with `UserRole.SUPER_DUPER_ADMIN` only: the summary, the diff (fetched from the PR) and test evidence, with **Approve** and **Reject** (reason required).
3. `ally-be` checks the role, records the decision with the user's ID and time, writes an entry through the existing audit module, then triggers `bug-hunter-v2.yml` with `workflow_dispatch` (inputs: `run_id`, `decision`, `reason`) using the existing `ally-be/src/github` service.
4. The workflow resumes the graph with `Command(resume=...)`. Approved: mark the PR ready and enable auto-merge, so GitHub merges it only after every required check passes. Rejected: close the PR, and `learn` stores the reason in `false_alarms`.
5. Pending approvals expire after 7 days (default): the PR is closed as stale and nothing merges.

Branch protection on `master` keeps all required status checks. Because the approval happens in the Ally UI, PRs from `bughunter/*` branches by the bug-hunter GitHub App do not need a separate GitHub review; the audit log is the review record. Every other PR keeps the existing review rules.

**Escalation issue**: the same header and root-cause sections, plus "Why the agent stopped" (could not reproduce / risky path / 3 failed attempts / review rejected) and everything it ruled out (from the scratchpad).

**Run report**: JSON + markdown per run in the artefact folder, and a daily summary posted as a comment on a pinned tracking issue: candidates found, PRs opened, escalations, tokens and cost.

## 14. Evals and observability

**Golden set (`evals/golden/`).** Built in chunk 04 from this repo's history:
- 20+ **real bugs**: `fix:` commits on `master` where the fix is small and came with a test. Each case = the parent commit (bug present), the app, a short scrubbed description as an issue would state it, and the fix's test as the hidden oracle.
- 20+ **clean diffs**: `feat:`/`chore:` commits that were never followed by a fix to the same lines within 30 days.
- Spread across all five apps, weighted to where bugs actually happen.

**Metrics** (`evals/metrics.py`):
- Detection rate on real bugs (sweep and issue modes separately).
- False-alarm rate on clean diffs.
- Reproduction rate: valid failing test written.
- Fix pass rate: hidden oracle test passes on the agent's patch.
- Escalation correctness: risky cases escalated, not patched.
- Cost and wall-clock per case.

`make eval` runs it; results are saved per prompt/model version so changes can be compared. Every chunk from 05 on reports its numbers in its chunk notes.

**Tracing.** LangSmith, the same tool `ally-ai` already uses (`LangSmithSettings` in `ally-ai/app/core/config.py`), in its own project `ally-bug-hunter`. Tracing records every step of a run (each prompt, model answer, tool call and its result, tokens, time), so when the agent does something odd you can see exactly why. Run IDs link traces, PRs and memory entries. Traces contain only scrubbed text.

## 15. Infrastructure

- **Runs in GitHub Actions** (chunk 08), on a schedule and on issue/CI events, using Docker on the runner for the sandbox. Flutter is fine there: `test-ally-mobile.yml` already runs `flutter test` on `ubuntu-22.04` with Flutter 3.47.7 (30-minute timeout); the mobile sandbox uses the same version. Only unit and widget tests run; no iOS/Android builds.
- **Approvers**: users with Ally's `SUPER_DUPER_ADMIN` role, approving in the admin dashboard (§13a). No GitHub usernames needed.
- **Access between the two databases**: the bug hunter's role cannot read ally-be's database. ally-be gets a second, limited connection to the `bughunter` database: read on approvals and run summaries, update on the approval decision columns only.
- **Postgres**: the same Postgres server ally-be uses, but a **separate database** `bughunter` with its **own role** that has no access to ally-be's database. Ally-be's data contains PHI, so the agent's credentials must not be able to read it. The checkpointer and store create their own tables there (`.setup()`).
  - pgvector: ally-be's images are `postgres:14-alpine` and its migrations deliberately avoid pgvector, so the extension is probably not installed. Ask whoever runs infra whether `CREATE EXTENSION vector` can be enabled in the `bughunter` database only. Until then, the store runs without vector search (§8); at this scale that is fine.
  - Local dev uses a `pgvector/pgvector:pg14` container from `bug-hunter/compose.yaml`.
- **GitHub App** "Ally Bug Hunter", installed only on `ally-platform`: Contents read/write, Pull requests read/write, Issues read/write, Checks read, Metadata read. No Administration, no Workflows. Branch protection on `master` requires review and passing CI.
- **Secrets** (repo secrets, never in code): GitHub App ID and private key, model API keys, Postgres URL, read-only CloudWatch credentials.

## 16. Decisions

| Question | Decision |
|----------|----------|
| Database | Same Postgres server as ally-be; separate `bughunter` database and role (§15) |
| Approvers | `SUPER_DUPER_ADMIN` users, in the admin dashboard (§13a) |
| Tracing | LangSmith, project `ally-bug-hunter`, as ally-ai already does |
| Flutter in Actions | Yes; already runs in `test-ally-mobile.yml` |
| Models | gpt-5 / gpt-5-mini / gemini-2.5-pro / text-embedding-3-small (§10) |

Still to confirm: whether pgvector can be enabled on the `bughunter` database (chunk 07; not blocking), and the branch-protection change for `bughunter/*` PRs (§13a; before enabling auto-merge in chunk 09).
