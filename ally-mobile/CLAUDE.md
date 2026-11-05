# ally-mobile — start here

Flutter app for counsellors and community health workers: the client for Scribe (recorded
sessions and summaries) and for practice simulations. Replaces the React Native app, now
archived, read-only, at `ally-platform/ally-mobile-rn-archive/` (see that folder's own
CLAUDE.md and `docs/RELEASE.md`'s Rollback section before touching it).

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

> **Stacks is not wired up in this repo yet** (no `.mcp.json`/`.claude/skills/stacks`,
> unlike every other service here — `ally-be/.mcp.json`, `ally-web/.mcp.json`, etc.). Until
> it is, get product-judgement context the way the RN app's own CLAUDE.md describes
> (`ally-mobile-rn-archive/CLAUDE.md`) by asking in conversation rather than via the
> `search_chunks` tool other repos use directly.

## What am I doing?

| Task | Read first |
|---|---|
| Any screen or user-facing flow | `lib/features/<feature>/` — one directory per feature (`scribe`, `roleplay`, `courses`, `calllog`, `reviews`, `auth`, …); each typically has its own `presentation/`, `data/`, `domain/` split |
| App start, navigation, routing | `lib/main.dart`, `lib/core/routing/app_router.dart` (go_router), `lib/core/navigation/` |
| Calling the backend | `lib/core/network/api_client.dart` (dio) and `api_routes.dart` — all API access lives here, nowhere else |
| State management | Riverpod — providers live beside the feature they serve (`lib/features/*/`) or in `lib/core/providers/` for cross-feature state |
| Build flavors, environment values, release/CI | [`docs/RELEASE.md`](docs/RELEASE.md) — the canonical doc for `dev`/`prod` identities, env files, and every CI workflow |
| RN → Flutter feature parity | [`docs/PARITY_LEDGER.md`](docs/PARITY_LEDGER.md) |
| Translations | `lib/core/localization/` and `assets/locales/*.json` — these are a zero-delay offline fallback; the real source is a dynamic CDN sync at runtime, not `gen-l10n`/ARB |
| Auth, token storage, sign-in migration from RN | `lib/core/auth/`, `lib/core/network/auth_interceptor.dart`, `lib/core/network/token_storage.dart`, `lib/core/migration/` |
| Push notifications | `lib/core/push/` |
| Deep links | `lib/core/deeplink/` |
| Tenant branding | `lib/core/branding/` |
| What the backend actually returns | ally-be's `DATA_SCHEMA.md` — this app is a client, the schema is not defined here |
| Anything else | [the wiki routing index](https://tech.helloally.ai/#/wiki/ROUTING.md) — one line per page |

## Repo shape

- `lib/main.dart` — entry point.
- `lib/features/` — one directory per feature (`scribe`, `roleplay`, `courses`, `calllog`,
  `reviews`, `account`, `auth`, `community`, `leaderboard`, `progress`, `search`,
  `simulations`, `achievements`, `notifications`, `boxbreathing`, `bugreport`,
  `analytics`, `reactions`, `suspended`).
- `lib/core/` — cross-cutting: `network/` (dio client, routes, interceptors), `routing/`
  (go_router), `navigation/` (`ScreenFocusListener`, the RN `useFocusEffect` port), `auth/`,
  `config/` (`app_config.dart` — flavor/env), `localization/`, `theme/`, `push/`,
  `deeplink/`, `migration/` (RN sign-in migration), `branding/`, `permissions/`,
  `realtime/` (LiveKit/socket.io), `app_update/`, `errors/`, `providers/`, `widgets/`.
- `android/`, `ios/` — native projects. `ios/Flutter/{dev,prod}.xcconfig` carry the
  per-flavor bundle id/display name.
- `assets/` — icons, images, animations, fonts, locale JSON, HTML5 course-item games —
  all ported verbatim from the RN app for exact-match UI parity.
- `test/` — `flutter test`, mirrors `lib/`'s `core/`/`features/` split; `test/support/`
  has the shared fakes (platform-channel fakes for `record`/`path_provider`/
  `permission_handler`/`video_player`/`url_launcher`, which don't exist under `flutter test`).

## Gotchas that change what you write

- **Never run `dart format` on this repo.** It isn't dart-formatted; running it reformats
  far more than intended. Edit by hand, matching surrounding style.
- **Two store identities, and they're not RN's.** `prod` flavor is `com.helloally.app`
  (the real app, same identity RN used) — but `dev` flavor is deliberately
  `com.helloally.ally_mobile_flutter` / `com.helloally.allyMobileFlutter`, NOT RN's
  `com.helloally.app.dev`, so a dev install never collides with either RN build. See
  `docs/RELEASE.md`'s "Identities (build flavors)" table before assuming an id.
- **`pubspec.yaml`'s `default-flavor: dev`** means plain `flutter run`/`flutter build`
  never builds the store identity by accident — you must pass `--flavor prod`.
- **Marketing version (`pubspec.yaml`'s `version:`) drives both platforms** —
  `CFBundleShortVersionString` and `versionName` both read it. The real Android
  `versionCode` used in a release is computed per-build by CI
  (`build-android-production.yml`), not committed to source — there's no single file
  that holds "the current versionCode" the way RN's `build.gradle` used to.
- **Released builds are frozen contracts** — same reasoning as the RN app's own gotcha:
  users stay on old versions for a long time, so be lenient about values that can only
  narrow a match.
- **`ScreenFocusListener` is not the same as `WidgetsBindingObserver`.** The former
  (`lib/core/navigation/screen_focus_listener.dart`) is this app's port of RN's
  `useFocusEffect` — in-app navigation only. It does **not** fire when the OS
  backgrounds/foregrounds the whole app; that needs a `WidgetsBindingObserver` +
  `didChangeAppLifecycleState` (see `review_details_screen.dart` or
  `call_log_screen.dart` for the pattern) — the two are complementary, not redundant.
- **Bundled locale JSON carries no runtime updates on its own** — it's the offline
  fallback only; don't assume editing `assets/locales/*.json` changes what a device shows
  without the CDN sync, and see the i18n gotcha doc (`docs/i18n-machine-translated.md`)
  before touching machine-translated strings.

## Commands

```bash
flutter pub get
flutter run --dart-define-from-file=env/local.env                # dev identity
flutter run --flavor prod --dart-define-from-file=env/local.env  # store identity
flutter test
flutter analyze
dart run flutter_launcher_icons   # after changing assets/icon/icon.png
```

## When your change outdates a doc

The root [`.docs-map.yml`](../.docs-map.yml) enforces that this file and `AGENTS.md` stay
byte-identical, and that touching `lib/**` (the Flutter equivalent of the rules' still-RN-shaped
`src/navigation/**`/`src/services/**`/`android/app/build.gradle` globs) keeps the wiki repo page
and `README.md`/`CONTRIBUTING.md` in sync — update `docs/RELEASE.md`/`docs/PARITY_LEDGER.md` by
hand too when a change affects what they describe (flavors, env values, CI workflows, or
RN/Flutter parity status), since nothing enforces those two yet.

## Canonical docs

The [Ally Developer Wiki](https://tech.helloally.ai) covers platform-wide architecture and
SDLC rules — [architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md). No
`wiki/repos/ally-mobile.md` page describing the Flutter app exists yet — the existing one
describes the archived RN app; this is a known gap.

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
