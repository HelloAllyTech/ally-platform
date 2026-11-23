---
name: builder-brief
description: How to brief Builder (route B) or report to Bug Hunter (route C) so a person can act on it, without any learner words or comment text.
---

# How to brief Builder

## When to use
Route B: the fix needs code (a new tool, a data source, a Console or app change).
Route C (Bug Hunter) uses the same rules for its summary.

## Never
Builder and Bug Hunter never see learner words, transcript lines or expert comment
text. Describe and count instead: "4 expert comments tagged `missed` on the
Practise-next card in Hindi sessions", not what they said. Quoted text is removed
before it leaves, and a brief that is mostly quotes arrives empty.

## The brief
- **problem**: what goes wrong for learners or reviewers, one paragraph.
- **evidence_summary**: metric names with values and n, comment counts by tag, run
  ids. Numbers, not anecdotes.
- **expected_effect**: the metric it should move, which way, roughly how much.
- **acceptance_checks**: two to five checks a reviewer can tick, each observable
  ("the Console Metrics tab shows X per language"), never "works well".

## Bug Hunter (route C)
`summary`: what is broken against what the product already intends, where, since
when if known; `run_ids` of affected debrief runs; `repo` when you know it.

A person approves both in the Console; nothing is filed until then.
