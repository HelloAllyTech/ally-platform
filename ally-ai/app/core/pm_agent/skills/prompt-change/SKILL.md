---
name: prompt-change
description: How to write a prompt change (route A) for one of the Debrief agent's step prompts, as a find/replace that release_draft accepts and the quick test can judge.
---

# How to write a prompt change

## When to use
An idea on route A whose fix is wording in a step prompt: the Analyst, Progress
reader, Writer or Reviser, and, while the live release runs the orchestrator, the
planner and the prompt-only registry agents (protocol check, history deep, language
specialist). The editable prompts and their live text are in your inputs
(`editable_prompts`). Every other prompt is pinned (the rubric, the Safety
reader, the judge, your own instructions): ally-be refuses edits to them.

## Steps
1. Find the exact passage that causes the problem. Copy it character for character
   from `editable_prompts`; `find` must appear in the live text exactly once.
2. Change as little as you can. One behaviour per edit, so the quick test says
   whether that behaviour helped.
3. Say the rule positively and concretely ("Quote the learner's exact words for every
   Done-well point") rather than adding a list of don'ts.
4. Keep every `{variable}` in the passage. Adding or removing a variable needs code;
   that is route B.
5. Never weaken a safety rule, the quote checks, the evaluation or the risk-cue path,
   even to make another number move.
6. Write the draft in a scratch file (e.g. `/drafts/<idea>.md`) when it is long, then
   call `release_draft` with `kind: "prompt_edit"`, `prompt_code`, `find`, `replace`.
7. If ally-be says the passage is not in the prompt, re-read the live text and copy
   it again; do not guess.
8. Then `ladder_start_quick_test`. Name the metric you expect to move in the idea,
   not in the prompt.
