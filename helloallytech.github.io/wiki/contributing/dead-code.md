---
title: Dead Code Tracking
tags: [contributing, quality, cleanup, ci]
summary: How Ally finds unused code, why new dead code fails a PR, and what to do when the tool is wrong.
last_reconciled: 2026-11-20
---

# Dead Code Tracking

Unused code costs every reader, human or agent, who has to work out whether it matters. `scripts/dead_code.py` finds it and stops more from piling up.

## How it works

1. **Scan.** One scanner per repo, tuned to that repo's frameworks. Only deletable things are reported: functions, classes, methods, imports (Python); files, exports, types (TypeScript). Never variables.
2. **Ratchet.** `scripts/dead-code-baseline.json` lists today's known dead code. A finding not in it is new, and fails the PR check. Old debt never blocks anyone.
3. **Publish.** Every Monday the `Dead code` workflow groups the findings by module and sends them to the PM Agent (`POST /v1/pm-agent/signals/dead-code`, platform service key). The PM Agent's `code_health` lane can turn a module into a card, and an admin accepting the card files the roadmap ticket: one ticket per module. The roadmap is the cleanup queue. Nothing is filed automatically, and nothing is filed while the PM Agent is off.

## Commands

```bash
pip install 'vulture==2.14'
python3 scripts/dead_code.py --repo ally-ai            # report
python3 scripts/dead_code.py --check                   # what CI runs
python3 scripts/dead_code.py --update-baseline         # after a cleanup, commit the smaller file
python3 scripts/dead_code.py --publish                 # what the weekly job runs (needs ALLY_BE_API_URL and ALLY_BE_API_KEY)
```

## When a finding is wrong

A finding is a candidate, not a verdict. Dynamic dispatch (`getattr`, decorators, string-based DI) hides real use. Don't delete on the tool's word: check for callers, then either delete it or add an `ignore` entry in `scripts/dead-code.config.json`. Every ignore needs a `why`.

## Coverage today

| Repo | Scanner | Blocks PRs |
|---|---|---|
| ally-ai, ally-ai-learn | vulture | yes |
| ally-be, ally-web | knip (wired, not yet enabled: needs knip as a pinned devDependency and a tuned config) | no |
| ally-mobile | not wired (Dart) | no |
| ally-archiver | not wired (Go, `deadcode`) | no |

Static analysis cannot see which endpoints or features real users hit. Pairing this with production usage data is the next step for deciding what is safe to remove.
