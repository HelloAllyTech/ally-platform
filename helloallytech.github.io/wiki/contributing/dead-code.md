---
title: Dead Code Tracking
tags: [contributing, quality, cleanup, ci]
summary: How Ally finds unused code in the Python and TypeScript repos, why new dead code fails a PR, and what to do when the tool is wrong.
last_reconciled: 2026-11-21
---

# Dead Code Tracking

Unused code costs every reader, human or agent, who has to work out whether it matters. `scripts/dead_code.py` finds it and stops more from piling up.

## How it works

1. **Scan.** One scanner per repo, tuned to that repo's frameworks. Only deletable things are reported: functions, classes, methods, imports (Python); files, exports, types (TypeScript). Never variables, enum members, duplicate exports or dependency lists.
2. **Ratchet.** `scripts/dead-code-baseline.json` lists today's known dead code. A finding not in it is new, and fails the PR check. Old debt never blocks anyone.
3. **Publish.** Every Monday the `Dead code` workflow groups the findings by module and sends them to the PM Agent (`POST /v1/pm-agent/signals/dead-code`, platform service key). The PM Agent's `code_health` lane can turn a module into a card, and an admin accepting the card files the roadmap ticket: one ticket per module. The roadmap is the cleanup queue. Nothing is filed automatically, and nothing is filed while the PM Agent is off.

## Commands

```bash
pip install 'vulture==2.14'                            # Python repos
(cd ally-be && npm ci)                                 # TypeScript repos: knip is a pinned devDependency
python3 scripts/dead_code.py --repo ally-ai            # report
python3 scripts/dead_code.py --repo ally-web           # report (knip; needs `npm ci` in ally-web first)
python3 scripts/dead_code.py --check                   # what CI runs
python3 scripts/dead_code.py --update-baseline         # after a cleanup, commit the smaller file
python3 scripts/dead_code.py --publish                 # what the weekly job runs (needs ALLY_BE_API_URL and ALLY_BE_API_KEY)
```

## How the TypeScript scan is tuned

`knip` runs from each repo's own `knip.json` (never `npx -y`; the script runs `npx --no-install knip`). Raw knip on these repos reports hundreds of false positives, because most of what loads code is not an `import`. The configs fix that at the source:

- **ally-be**: entry points are `src/main.ts`, TypeORM's `data-source.ts`, every migration, entity (`*/entity/*.entity.ts`, loaded by glob), seed, backfill and `scripts/` file (run by name from `package.json`), the chatbot `basics` CLI, and `*.e2e-spec.ts`. Specs are entries too, so an export used only by a test counts as used.
- **ally-web**: the admin dashboard has no `package.json`, so knip does not see it as a workspace. It is folded into the root workspace with its own entries (`main.tsx`, the widget loader, the bot page's `botPage/main.tsx`, Playwright `e2e/`, `*.config.*`) and its `@src`/`@components`/... path aliases are repeated in `paths`. The helpline app and `ui-shared` are real workspaces.
- **Both**: `ignoreExportsUsedInFile` (an export used only inside its own file needs the `export` removed, not the code deleted), and in ally-web barrel (`index.ts`) re-exports are not reported (a re-export line is not dead code; an unused barrel *file* still is). Unused-dependency, unlisted and unresolved reports are switched off.

False-positive patterns seen while tuning: code loaded by glob or by name (migrations, entities, `ts-node` scripts, CLIs documented as `npx ts-node ...`), a Vite app with a second HTML entry, path aliases that only the app's own tsconfig defines, vitest setup files, and generated contracts. A symbol that only appears as a key in a `vi.mock(...)` factory is *not* a use; knip is right to flag it.

## When a finding is wrong

A finding is a candidate, not a verdict. Dynamic dispatch (`getattr`, decorators, string-based DI) hides real use. Don't delete on the tool's word: check for callers, then either delete it or add an `ignore` entry in `scripts/dead-code.config.json`. Every ignore needs a `why`.

## Coverage today

| Repo | Scanner | Blocks PRs |
|---|---|---|
| ally-ai, ally-ai-learn | vulture | yes |
| ally-be, ally-web | knip | yes |
| ally-mobile | not wired (Dart) | no |
| ally-archiver | not wired (Go, `deadcode`) | no |

Findings are grouped per module for publishing: an ally-be module (`ally-be/src/<module>`), an ally-web feature folder (`group_depth` per repo in the config). Moving a dead file or symbol changes its id, so it shows as new once; re-baseline in the same PR if you move known dead code.

Static analysis cannot see which endpoints or features real users hit. Pairing this with production usage data is the next step for deciding what is safe to remove.
