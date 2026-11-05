# ally-mobile — start here

React Native app for counsellors and community health workers: the client for Scribe
(recorded sessions and summaries) and for practice simulations.

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

## Get Stacks context whenever a product judgement comes up

Not only while planning. Stacks is the team's vetted knowledge library. Call its `search_chunks`
tool yourself, incorporate relevant returned guidance, and cite chunk titles:

- **before writing an implementation plan** — the original rule, and still the one that matters
  most;
- **while implementing**, at each point you would otherwise invent the answer: an empty, loading,
  edge or failure state; a user-facing label, button or error message; what a view shows and what
  it omits; a threshold, limit, cadence or reward rule;
- **while reviewing**, for how a change behaves rather than how it reads.

**Search on your own initiative** — you don't need to be asked. Trivial mechanical changes (rename,
dependency bump, typo) are exempt. Setup is zero (a committed bridge mints your own key from `gh`).
Query technique, citation format and the `/stacks:planning_context` human entry point are at
[Planning with Stacks](https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md) —
read that rather than a copy here, which would only go stale.

## What am I doing?

| Task                                 | Read first                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Any screen or user-facing flow       | `src/screens/` — one directory per flow; check `src/navigation/` for how it's reached                                                     |
| Calling the backend                  | `src/services/` — all API access lives here, nowhere else                                                                                 |
| Shared UI                            | `src/components/`, with tokens from `src/theme/` — never hardcode colours or spacing                                                      |
| App state                            | `src/store/`, plus `src/contexts/` for cross-screen state                                                                                 |
| Translations, or a new language      | `src/localization/` — and read the fonts gotcha below                                                                                     |
| Anything that must survive a restart | `src/config/`, `src/constants/`                                                                                                           |
| Releasing                            | [`CONTRIBUTING.md`](CONTRIBUTING.md), then the shared [release process](https://tech.helloally.ai/#/wiki/contributing/release-process.md) |
| What the backend actually returns    | ally-be's `DATA_SCHEMA.md` — the app is a client, the schema is not defined here                                                          |
| Anything else                        | [the wiki routing index](https://tech.helloally.ai/#/wiki/ROUTING.md) — one line per page, so you can pick one before spending a fetch    |

## Repo shape

- `src/screens/` — screens. `src/navigation/` — the navigator tree.
- `src/components/` — shared UI. `src/theme/` — tokens.
- `src/services/` — API clients. `src/store/`, `src/contexts/` — state.
- `src/localization/` — i18n resources. `src/hooks/`, `src/utils/`, `src/types/`.
- `android/`, `ios/` — native projects. `patches/` — patch-package overrides, read before upgrading a dep.
- `src/__tests__/` — Jest.

## Gotchas that change what you write

- **Two app IDs.** Dev is `com.helloally.app.dev`, production is `com.helloally.app`. They
  install side by side; check which one you are looking at before believing a bug reproduced.
- **Bundled fonts carry no Indic glyphs.** Text in Malayalam, Tamil or Kannada can render as
  nothing at all on some Android ROMs rather than falling back — a language picker whose rows
  are invisible looks exactly like a broken build. Test a non-Latin language on a real device.
- **Released builds are frozen contracts.** Users stay on old versions for a long time. A
  backend value the app parses strictly will lock those users out when it changes — that has
  cost us a login outage. Be lenient about values that can only narrow a match.
- **Section-level permission flags are not field-level.** Gating an edit control on the
  section's flag silently makes fields uneditable that the web app allows. Check both.
- **Native changes need a rebuild, not a reload.** Metro will happily serve you stale native
  behaviour; when something native looks impossible, rebuild before debugging further.
- **Version bumps are part of the release**, not an afterthought — Android build number and
  iOS build number both move.
- **An `act(...)` warning fails the test, it doesn't just print.** `jest.setup.ts` collects
  React's "not wrapped in act" warnings and throws in an `afterEach`. Wrap whatever drives the
  update — `jest.advanceTimersByTime`, a `rerender`, a `fireEvent` that starts a promise — in
  `act(...)`; use `await act(async () => ...)` when a promise chain has to settle. Timers
  drained in a test file's own `afterEach` count too.
- **iOS under Xcode 26 needs the fmt/consteval Podfile patch.** fmt 11.0.2's consteval format
  strings fail to compile otherwise. The `post_install` hook needs both the `-DFMT_USE_CONSTEVAL=0`
  define _and_ an `#ifndef` guard on `base.h`, which otherwise re-defines the macro from its own
  compiler sniffing. `Pods/` is gitignored, so the header patch lives in the hook, not a commit.

## Commands

```bash
npm start                    # Metro, cache reset
npm run android:dev          # dev flavour on device/emulator
npm run ios
npm test                     # Jest
npm run lint
npm run build:prod           # release APK
```

## When your change outdates a doc

[`.docs-map.yml`](.docs-map.yml) declares which docs cover which code, and CI enforces it.
Touching `src/navigation/**` or `src/services/**` needs the wiki's repo page updated — either
do it, or apply the `docs:skip` label with a reason. Backticked file paths in any doc are checked too: `node scripts/docs-path-lint.mjs` fails on one that no longer exists — fix it, or mark a deliberate one `<!-- docs-path-lint: planned -->`.

Pushing straight to `master`? The same check runs before the push (this repo ships the hook
in `.husky/pre-push`, so you already have it), and the escape hatches move to the commit
message: `Wiki-PR: <url>`, `Wiki-PR: none — <reason>`, or `Docs-Skip: <reason>`.

Wiki edits do **not** need a hand-rolled second PR:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of this PR>"     # or: .wiki-tmp/scripts/wiki-pr.sh HEAD
```

`.wiki-tmp/` is gitignored. The wiki PR merges when this change lands.

## Canonical docs

The [Ally Developer Wiki](https://tech.helloally.ai) is the source of truth for platform
architecture and SDLC rules (product practice now comes from Stacks) —
[this repo's page](https://tech.helloally.ai/#/wiki/repos/ally-mobile.md) ·
[architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md) ·
[how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
