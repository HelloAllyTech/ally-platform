# Chunk 05 notes: graph v1 (diagnose)

Branch `feat/bug-hunter-v2`, merged from `origin/master` at chunk start (no rebase).
`make lint` and `make test` pass (257 offline tests). Results sections marked PENDING are
filled from the runs below.

## Code map

| Path | What |
|---|---|
| `bug-hunter/src/bug_hunter/graph/state.py` | `BugState` and sub-models from spec §4 (`Signal`, `Finding`, `Repro`, `Patch`, `Verification`, `Review`), plus `Budget`/`NodeUsage`, `mode`, `stop_reason`, `artefacts`, `trace_url` |
| `graph/build.py` | `build_graph(deps, checkpointer)`: intake → triage → investigate → reproduce → escalate/report; `run_graph(compiled, deps, signal, resume=False)`; `run_config` (thread id = run id, LangSmith tags) |
| `graph/deps.py` | `GraphDeps`: config, workspace, git, runner, repo map, app context, scratchpad, models per role, artefact writer, checkpointer; `for_run(config, run, app, mode, …)` |
| `graph/routing.py` | `after_triage`, `after_investigate`, `after_reproduce`: pure functions of the state |
| `graph/loop.py` | `ToolLoop`: a ReAct loop as a subgraph (`agent` ↔ `tools`) with *finish tools* whose validated arguments are the structured result; nudges plain text, one last finish-only call at the turn limit, budget check before every call, compaction into the scratchpad; `run_loop` resumes a loop cut off mid-way |
| `graph/nodes/intake.py` | Scrubs the signal, stamps `started_at`, writes `signal-diff.patch` in sweep mode |
| `graph/nodes/triage.py` | `TriageDecision` via `with_structured_output(include_raw=True)` on the cheap model; closes not-a-bug / question / feature request / duplicate |
| `graph/nodes/investigate.py` | Tool loop over `read_tools` + `map_tools`; finish tools `submit_finding(…)` / `report_no_bug(…)` |
| `graph/nodes/reproduce.py` | Tool loop over read tools + `write_test_file` + `run_tests(target)`; finish `submit_repro` / `cannot_reproduce`; **the claim is verified in code**: the named test is run again, classified (`failure.py`), and only a genuine failure is put to the model for the right-reason judgement |
| `graph/failure.py` | `classify_failure`: setup (import/compile/fixture/timeout/network) vs genuine vs passed vs no tests, per framework |
| `graph/nodes/escalate.py`, `nodes/report.py` | `escalation.md/json` (§13 header, root cause, why it stopped, ruled out) and `report.md/json` (cost per node, tool log) in the artefact folder |
| `graph/budget.py` | `charge` from `usage_metadata` priced by `models.yaml` `prices`; `exceeded` for tokens, cost, wall clock |
| `graph/llm.py` | `call_structured`: one retry on a validation failure, every attempt charged |
| `graph/checkpointer.py` | `PostgresSaver` in schema `bughunter` from `BUGHUNTER_CHECKPOINT_DB_URL` (default the compose container); `InMemorySaver` only with `--no-checkpoint` |
| `graph/tracing.py` | LangSmith on when `LANGSMITH_API_KEY` is set, project `ally-bug-hunter`; `trace_url(run_id)` |
| `graph/prompts.py`, `bug-hunter/prompts/*.v1.md` | Prompt files with an inputs header; `render` refuses missing/unknown inputs; active versions in `models.yaml` `prompts:` |
| `bug-hunter/compose.yaml` | `pgvector/pgvector:pg14` as `bughunter-pg` on 5433, volume `bughunter-pg-data`; `make db-up` / `db-down` |
| `evals/agents.py` `GraphAgent` | `--agent graph`: drives the graph on the case's run, maps the final state to `AgentResult` (found, escalated, repro file, tokens, cost, trace URL, status) |
| `evals/run_evals.py` | Per-eval-run cost cap (`limits.evals.max_cost_usd` = 10, `--max-cost-usd`), stops cleanly with cases done/remaining; `trace_url`, `status` per case |
| `evals/metrics.py` | Report columns tokens, cost, trace per case; cost-cap footer |
| `cli.py` | `run --app … --issue-text …` / `run --commit <sha>`, `replay <run_id> [--resume]`, `.env` loading + tracing at startup |
| `.github/workflows/bug-hunter-evals.yml` | Secrets (OpenAI, Gemini→`GOOGLE_API_KEY`, LangSmith), Postgres service, inputs `agent`, `max_cost_usd` |

Config: `models.yaml` gained `prompts:` and `prices:` (every role and fallback model must
be priced, validated); `limits.yaml` `run.max_cost_usd: 1.50`, `run.max_tool_turns: 30`,
`evals.max_cost_usd: 10`. Dependencies: `langgraph ^1.2`,
`langgraph-checkpoint-postgres ^3.2` (ally-ai's pins), `python-dotenv`.

## Decisions

- **Finish tools instead of a final free-text answer.** The loops end when the model
  calls `submit_*` / `report_no_bug` / `cannot_reproduce`; the arguments are validated
  against a Pydantic schema and *are* the result. One model, one tool list, no second
  "now format your answer" call. Single-shot nodes (triage, the right-reason judgement)
  use `with_structured_output(include_raw=True)` so usage is still charged.
- **Reproduction is verified in code.** The agent's claim (`submit_repro`) triggers a
  real run of exactly that test; import/compile/fixture/timeout failures, passes and
  empty runs are "could not reproduce" without asking a model. Only a genuine failure
  gets the right-reason judgement, and the code can veto the model, never the reverse.
- **Budget on every edge.** Nodes check `exceeded()` before any model call and set
  `stop_reason`; routing reads the state only. Three caps per run: tokens, wall clock,
  cost ($1.50). Cost per node is in the report; the eval harness adds a per-run cap of
  $10 that stops the batch cleanly and reports how far it got.
- **Out of turns without a conclusion = not a bug, not an escalation.** Escalation needs
  a finding; an investigation that ran out of tool turns has nothing a human can act
  on, so it closes with `no_bug_reason: inconclusive`. Budget stops do escalate.
- **Resume granularity is the tool turn.** The loop is a subgraph invoked with the
  parent's config, so its steps are checkpointed under the parent's namespace;
  `run_loop` checks for a mid-loop checkpoint and continues it. Tested at loop and graph
  level with `InMemorySaver`, and against the real Postgres (`tests/integration`).
- **Old-layout cases run with the app at the worktree root.** `Workspace(app_root=…)`
  and `PathPolicy(app_roots=…)` make app-relative paths and the test-location check
  work when the app's files are not under `ally-be/`.
- **Never sweep the database.** `Run.start`'s orphan sweep matched every `bughunter-*`
  container and took `bughunter-pg` down the first time the graph ran; it now matches
  `bughunter-run-*` only.

## Prompt examples: provenance

The user's rule: no example from an accepted golden case, from any candidate touching
the same files as an accepted case, or from the dropped near-duplicates
(`ally-be-e4b33dc8`, `c2d5c1f8`, `a6fb0071`). I also excluded every shortlisted-but-not-
accepted candidate. The filter (`evals/golden/candidates/candidates.json` minus
`cases.yaml` files minus `shortlist-ids.txt`) leaves 1017 eligible candidates; from them:

| Example | Prompt(s) | Source | Why |
|---|---|---|---|
| Raise-budget dialog submits `budgetUsd: 0` when the field is cleared (`Number("")` is 0) | triage (good bug), investigate (good finding), reproduce (good vitest) | `ally-web-a4cc6436`, human fix 2026-08-31, `RaiseBudgetDialog.tsx` | Tiny, one-line root cause, real test in the same commit |
| Scan-now button never re-enables after a watched scan stalls | investigate (good finding) | `ally-web-520d8159`, human fix 2026-09-03, `UxSignalsPanel.tsx` | Effect/state bug with a traceable flow |
| "ready for the next step" claim regex | investigate (good no-bug: intentional and tested), reproduce (good jest table row) | `ally-be-898a2726`, human fix 2026-10-23, `builder-turn-claims.util.ts` | Shows reading the spec table before deciding |
| Impersonation app URL question | triage (good not-a-bug: question) | `ally-web-568b03be`, clean feat 2026-04-15 | A config question, not a defect |
| Changelog tagline "looks different" | triage (bad: no wrong behaviour) | `ally-web-192d5fd0`, clean feat 2026-10-01 | Intentional copy change |
| Spec importing `PLATFORM_TIER_ROLES` fails to compile | reproduce (bad: setup failure) | Pattern from the chunk 04 oracle run, no case file named | The exact trap the classifier catches |

None of these files appear in any accepted case.

## Prices used (`models.yaml`, USD per 1M tokens, 2026-11-09)

| Model | input | cached input | output |
|---|---|---|---|
| openai:gpt-5 | 1.25 | 0.125 | 10.00 |
| openai:gpt-5-mini | 0.25 | 0.025 | 2.00 |
| google_genai:gemini-2.5-pro | 1.25 | 0.31 | 10.00 |
| openai:text-embedding-3-small | 0.02 | 0.02 | 0 |

Please confirm against the providers' current price pages; a wrong row only skews the
cost column and the caps, never correctness.

## Local smoke run

`make eval AGENT=graph CASES=ally-be-89d8e055` (issue mode, Postgres checkpoints, real
models), run `run-20261109-110348-6a4770`:

| Node | Calls | Input tokens (cached) | Output | Cost | Time |
|---|---|---|---|---|---|
| triage | 1 | 3 235 (0) | 610 | $0.002 | 11 s |
| investigate | 18 | 283 997 (255 488) | 13 018 | $0.198 | 153 s |
| reproduce | 10 | 94 904 (81 280) | 6 467 | $0.092 | 80 s |
| **run** | 29 | 382 136 (336 768) | 20 095 | **$0.29** | 321 s |

- Triage: bug candidate, medium. Investigate: 8 `read_file`, 6 `grep`, 1 `glob`, then
  `submit_finding`: *"Token guard rejects visually intact {placeholders} and [tags] when
  Unicode bidi/zero-width marks are present"*, root cause at
  `translation-token-guard.util.ts:18-19`. **That is the real fix** (commit `89d8e055`
  widens both regexes to accept `\u200B` around the token), found from the symptom-only
  description alone.
- Reproduce wrote three test files (3 `write_test_file`, 1 `run_tests`) and then the run
  hit the **400k token cap**: every loop turn re-sends the history, so 28 calls on a
  ~15k-token context bill ~380k input tokens even though 88 % were cached and the cost
  was $0.29. The token cap was the binding limit, not cost. Changed
  `run.max_tokens` to 1 500 000; the $1.50 cost cap is the one that matters, and the
  budget stop in `reproduce` is now reported as a budget stop rather than as "could not
  reproduce".
- No trace link: the local `.env` has an empty `LANGSMITH_API_KEY` (tracing stays off
  without a key; nothing crashes).

Clean case `ally-be-b29aa1be` in issue mode: triage closed it as a feature request
("expose the review and approve switches on the settings API" is the mined commit
message, which is what a clean case's issue text is) in 6 s for $0.001. Issue-mode
clean cases mostly test triage; sweep mode, where the investigator sees the diff, is
the real false-alarm test.

## First eval run on GitHub (10-case subset)

PENDING

## How to test

```bash
cd bug-hunter
make lint && make test                      # 257 offline tests
make db-up                                  # Postgres for checkpoints (compose.yaml)
make test-docker                            # includes the real checkpointer round trip
poetry run bug-hunter run --app ally-be --issue-text "…"     # issue mode
poetry run bug-hunter run --commit <sha>                     # sweep mode
poetry run bug-hunter replay <run_id>                        # checkpoints; --resume continues
make eval AGENT=graph CASES=<id>            # one golden case through the real graph
```

Full runs: Actions → "Bug Hunter v2 evals" → `what=baseline`, `agent=graph`, `cases=…`
(the workflow's "baseline" steps run whichever agent is chosen). Both modes run, each
under the cost cap.

## Open questions and notes for later chunks

- Chunk 06 (fix): `after_reproduce` routes a reproduced bug to `report`; the
  `risk_precheck → fix → verify → review → risk_gate → human_approval → open_pr` chain
  slots in there. `Patch`, `Verification`, `Review` models exist already.
- Long-term memory (chunk 07): triage's prompt has the memory slot; `GraphDeps` has no
  store yet. Duplicate detection currently relies on the model's `duplicate_of`, which
  it cannot know; it is effectively off.
- Sweep mode gives the investigator the diff's head (6 000 chars) plus the repo-map
  neighbourhood; large diffs rely on `signal-diff.patch` being readable through
  `read_file` (artefacts are outside the worktree, so they are not: fix in chunk 08 by
  mounting or by passing the diff in chunks).
- The right-reason judgement uses the `fix` model (gpt-5). A cheaper judge may do;
  compare on the golden set once there are enough reproduced cases.
