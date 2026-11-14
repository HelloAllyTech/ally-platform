---
name: registry-agent
description: How to define a prompt-only registry agent (route A, FR-53) that the debrief orchestrator could run, within the limits ally-be enforces on system-made agents.
---

# How to define a registry agent

## When to use
The debriefs keep missing a kind of finding that a focused, prompt-only analysis
could supply (for example checking the organisation's protocol), and no existing
step covers it. If it needs a new tool or data source, it is not yours: route B.

## The limits (ally-be refuses anything outside them)
- Prompt only: `tools` from the existing catalogue (`guidance_search`,
  `get_learner_history`, `get_live_detections`, `get_org_protocols`,
  `query_aggregates`), nothing new.
- `scopes` only from `session`, `learner_history`, `org_protocols`, `aggregates`,
  `guidance`. Ask for the fewest that do the job.
- At least 10 eval cases (`eval_cases`).
- It starts `experimental`; at most 10 experimental agents exist at once. Retired after
  8 weeks or 200 runs without a win.
- Returns the findings contract: `{agent, findings: [{kind, point, turnIndex, quote,
  importance, confidence, source}], reasoning}`.

## Today
System-made agents are stored as drafts the owner sees in the Console; the release
bundle can only enable agents the ally-ai build defines, so a draft is not tested
until system-made manifests can be loaded (spec A2). Prefer improving an existing
registry agent's prompt (the prompt-change skill) when that would do.

## Steps
1. `id` in snake_case; `description` says what it finds; `use_when` and `skip_when`
   are plain guidance for the planner.
2. Write the prompt in a scratch file first. It must say what to look for, what
   counts as evidence (turn index and exact quote), and when to return no findings.
3. `release_draft` with `kind: "registry_agent"`, the manifest, and the run ids behind
   it in `run_ids` (at least 10 learners in 3 organisations). A refusal names the
   limit you crossed.
