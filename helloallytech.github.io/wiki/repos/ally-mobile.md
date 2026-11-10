---
title: ally-mobile — Mobile App
tags: [repo, mobile, flutter, ios, android]
summary: Flutter iOS/Android app for counsellors and community health workers, covering Scribe (recorded sessions with transcription and AI summaries), peer reviews, voice-based AI simulations, courses, and gamification.
last_reconciled: 2026-11-10
---

# ally-mobile — Mobile App

## Purpose

`ally-mobile` is the Flutter app that counsellors and community health workers use in the field. It supports three core workflows: recording or joining live counselling sessions with real-time transcription and AI-assisted call summaries (Scribe); reviewing and commenting on session/simulation transcripts (peer review); and running voice-based AI training simulations against a simulated client. Courses (Track 2.0), analytics, achievements and the leaderboard sit around those. The app talks to `ally-be` over REST and Socket.IO, and to LiveKit rooms driven by `ally-ai-learn` for simulations.

It **replaced the original React Native app** in both stores as an update to the same listings (same bundle id, same Apple team, same Android upload key). The React Native code was deleted outright in the 2026-11 rename; use git history before that date if you need it. Where the Flutter code says it "mirrors" or "ports" an RN file, that is provenance only — the RN file no longer exists. `ally-mobile/docs/PARITY_LEDGER.md` records what was audited against RN at cutover.

> [!NOTE]
> For product conventions behind these surfaces — cross-surface consistency with the web apps, achievement/leaderboard rules, and the counsellor-in-the-field persona — search the Context Library before you plan ([Working with the Context Library](../contributing/planning-with-context-library.md)). The former in-wiki pages ([UI & Interaction](../product/ui.md), [Gamification](../product/gamification.md), [User Personas](../product/user-personas.md)) are **deprecated** as of 2026-08-07 and kept for history. `ally-mobile` commits the `context-library` server (`.mcp.json`) and skill like every other app, so a session there calls its tools directly.

## Tech Stack

Factual from `pubspec.yaml` (marketing version 2.0.1, Dart SDK `^3.13.5`):

- Flutter / Dart, `flutter_lints`
- State: Riverpod (`flutter_riverpod`); providers live beside the feature they serve, with cross-feature state in `lib/core/providers/`
- Navigation: `go_router`, with an auth-gated redirect (`lib/core/routing/app_router.dart`)
- HTTP: `dio`, one client for all API access (`lib/core/network/api_client.dart`, routes in `api_routes.dart`)
- Realtime voice: `livekit_client`
- Sockets: `socket_io_client` (live-session audio streaming)
- Audio: `record`, `audioplayers`, `flutter_foreground_task` (keeps a recording alive in the background), `wakelock_plus`
- Firebase: `firebase_core`, `firebase_messaging` (push), `firebase_crashlytics`
- Auth: `google_sign_in`, `sign_in_with_apple`; tokens in `flutter_secure_storage` (Keychain/Keystore)
- Notifications: `flutter_local_notifications`
- Deep links: `app_links`
- Content: `webview_flutter` (course games), `video_player`, `flutter_markdown_plus`, `lottie`, `confetti`
- i18n: `intl` plus a dynamic CDN translation sync (see below) — not `gen-l10n`/ARB
- Config: `--dart-define-from-file` at build time, read through `AppConfig` (`lib/core/config/app_config.dart`)

## Architecture & Feature Areas

Layout under `lib/`: `main.dart` is the entry point; `core/` holds cross-cutting code (`network/`, `routing/`, `navigation/`, `auth/`, `config/`, `localization/`, `theme/`, `push/`, `deeplink/`, `migration/`, `branding/`, `permissions/`, `realtime/`, `app_update/`, `errors/`, `providers/`, `settings/`, `widgets/`); `features/` has one directory per feature, each typically split into `data/` and `presentation/`. Tests under `test/` mirror that split.

Navigation: go_router's `redirect` re-evaluates whenever auth state changes, so signed-out users land on login and signed-in users on the shell. The authenticated shell (`lib/core/navigation/`) is a drawer plus a permission-gated bottom tab bar (`tab_config.dart`); the first visible tab is computed from the user's permissions. Listening, call summary, simulation, course and review screens are pushed on top.

**Scribe: live sessions & audio streaming.** `scribe_recording_screen.dart` handles a recorded session and `conference_listening_screen.dart` the cloud-telephony conference mode. Audio is captured with `record` and streamed over Socket.IO by `lib/core/realtime/socket_service.dart`, on the microphone namespace for in-app recording and the cloud-telephony namespace for conference calls. `foreground_recording_service.dart` keeps recording alive when the app is backgrounded, and `keep_awake.dart` and `connectivity.dart` cover screen-lock and offline handling.

**Transcription & summaries.** After a call, `call_summary_screen.dart` shows the AI summary and transcript, and `call_log_screen.dart` lists past calls (`lib/features/calllog/`). Deep links to a specific call summary are resolved by `lib/core/deeplink/`.

**Reviews (incl. read/unread management).** Peer review lives in `lib/features/reviews/`, backed by `reviews_repository.dart` and a parallel Scribe review flow in `scribe_reviews_repository.dart`. It covers threaded comments, general comments, comment visibility/edit/delete, review status, and explicit read/unread management with an unread badge. Reactions are a separate feature (`lib/features/reactions/`).

**Simulations (incl. pause/resume).** Browsing and detail screens are under `lib/features/simulations/`. The live voice session is `lib/features/roleplay/presentation/roleplay_voice_screen.dart`, which connects to a LiveKit room (`lib/core/realtime/livekit_room_service.dart`) with an agent served by `ally-ai-learn`. Pause/resume runs over a LiveKit data channel: the client sends `pause`/`resume` and the agent acks with `paused`/`resumed` (`pause_resume_state.dart`). Paused spans are excluded from the displayed timer and goal time limit; authoritative billing/leaderboard paused time is tracked server-side (`scenario_sessions.totalPausedMs`).

**Courses (Track 2.0).** `lib/features/courses/` runs off `courses_repository.dart` against ally-be's `v1/learn/tracks` learner API: track list and detail, next-item resolution, enrolment, per-item start, and the completion call for each item type. A course opens in `course_detail_screen.dart` and is taken in `course_item_player_screen.dart`, a single screen that swaps the inner player on item type rather than pushing a screen per item. Advancing is computed client-side from item completion status or a same-session completed set, as there is no server `canAdvance`. Item players cover article, video, journal, roleplay, case, quiz (all six question types, in `presentation/quiz/`), game, branching and bucket-sort. An article may carry inline single-select questions: `splitArticleHtml` in `presentation/article/article_player.dart` splits the body on the `<div data-ally-question="<id>">` placeholders ally-be anchors them with, and an `ArticleQuestionCard` renders in each gap. The answer is final (the server refuses a second one), so selecting an option does not submit it — the learner picks, then confirms. Those questions are the article's completion rule when present: the server completes the item on the last answer and refuses mark-as-read while any are outstanding. Roleplay and case items hand off to the simulation flow and detect return through the active-track context held in `course_item_player_screen.dart`, since those completions are reported out-of-band by the simulation subsystem. A game is a self-contained HTML bundle rendered in a webview and talking to the app only over `postMessage`; ally-be completes game items on open.

**Scribe notes with voice dictation.** The call log can create manual Scribe notes and dictate into them. `lib/features/calllog/presentation/voice_note_recorder.dart` and `voice_note_section.dart` drive recording (start/pause/resume/stop, elapsed time excluding paused spans), upload the audio for server-side transcription and field extraction (processed in memory, never stored), and save the dictation transcript separately so it shows in the note's Transcript view. Availability is gated by `scribeNoteCreationEnabledProvider` and `scribeVoiceNoteEnabledProvider` in `lib/core/settings/settings_repository.dart`; the backend also enforces the per-tenant toggle and returns 403 otherwise.

**Complete-profile gate.** Accounts created in bulk by an admin have no name on first login. When `user.profileCompleted` is false, the app routes to `lib/features/account/presentation/complete_profile_screen.dart`; submitting flips it server-side and re-runs auth routing.

**Auth.** `lib/features/auth/` supports OTP, Google Sign-In and Apple Sign-In. `lib/core/network/auth_interceptor.dart` injects the bearer token and the `v1`/`v2` path prefix on every request (v2 only for an explicit allowlist of endpoints), and on a 401 attempts exactly one refresh-and-retry before logging the user out. The refresh token is single-use, so concurrent 401s share one refresh call. Tokens live in secure storage (`token_storage.dart`). On the first launch after the store update, `lib/core/migration/` carries the old React Native sign-in and preferences into this app's storage so nobody is signed out.

**Analytics & gamification.** `lib/features/analytics/`, `achievements/`, `leaderboard/`, `community/` and `progress/` cover the user analytics, badges, leaderboard and community screens. Weekly leaderboard reminders are scheduled locally via `flutter_local_notifications` (`lib/core/push/leaderboard_notification.dart`), gated on the `VIEW_COMMUNITY_LEADERBOARD` permission. FCM push handling is in `lib/core/push/`.

**i18n / language-code injection.** Localization is in `lib/core/localization/`, with bundled `en`, `hi`, `kn`, `mr` and `ta` JSON under `assets/locales/` as a zero-delay offline fallback; the real source is a dynamic CDN sync at runtime, so editing the bundled JSON alone does not change what a device shows (see `docs/i18n-machine-translated.md` before touching machine-translated strings). For content endpoints that return backend-generated user-facing text, `lib/core/network/language_code_interceptor.dart` injects the active UI language: an allowlist of endpoint entries (method plus path) adds a bare ISO `languageCode` into GET params or mutation bodies, so the server returns localized scenarios, cases, reviews, badges, leaderboard, etc. Auth/OTP/upload endpoints are intentionally excluded. The language selector and dynamic translation sync are gated by `LANGUAGE_SELECTOR_FLAG`, with the CDN at `I18N_BASE_URL`.

**Other platform pieces.** Tenant branding (`lib/core/branding/`), force-update (`lib/core/app_update/`), an error boundary with Crashlytics reporting (`lib/core/errors/`), and account suspension (`lib/features/suspended/`).

## Integration Points

- **ally-be (REST):** `API_BASE_URL` is the host root (no `/api`); `auth_interceptor.dart` adds the `v1`/`v2` prefix per endpoint. All API access goes through the single dio client in `lib/core/network/`.
- **ally-be (Socket.IO):** two namespaces from config — `/microphone-chat` (`MICROPHONE_SOCKET_PATH`) for in-app microphone streaming and `/cloud-telephony-chat` (`CLOUD_TELEPHONY_PATH`) for conference/telephony audio.
- **LiveKit / ally-ai-learn:** `roleplay_voice_screen.dart` joins a LiveKit room for the voice simulation; the conversational agent (with pause/resume acks) is served by `ally-ai-learn`.
- **ally-web (deep linking):** `ALLY_WEB_URL` is used for sharing links; inbound links (App Links on Android, universal links on iOS) are parsed and routed by `lib/core/deeplink/`.
- **Required env values** (`env/example.env`, read by `AppConfig`): `ENVIRONMENT`, `API_BASE_URL`, `ALLY_WEB_URL`, `MICROPHONE_SOCKET_PATH`, `CLOUD_TELEPHONY_PATH`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `NOTIFICATION_SCHEDULE_DAY` / `_HOUR` / `_MINUTE`, `LANGUAGE_SELECTOR_FLAG`, `I18N_BASE_URL`. `API_VERSION` is ignored. Release CI feeds the same keys from the `ENV_VALUES_*` secrets; see `ally-mobile/docs/RELEASE.md`.

## Local Setup

Prerequisites: a Flutter SDK matching `pubspec.yaml`, Xcode (iOS), Android Studio.

```bash
flutter pub get
cp env/example.env env/local.env   # git-ignored; fill in values
```

Firebase config is git-excluded: `ios/Runner/GoogleService-Info.plist` and `android/app/src/<flavor>/google-services.json`. Without them the app still builds and runs with Firebase off (no push, no Crashlytics). Android release signing needs a local keystore (never commit keystores).

Run:

```bash
flutter run --dart-define-from-file=env/local.env                # dev identity
flutter run --flavor prod --dart-define-from-file=env/local.env  # store identity
```

There are two flavors with deliberately different store identities: `prod` is `com.helloally.app` (the real app) and `dev` is `com.helloally.ally_mobile_flutter` (Android) / `com.helloally.allyMobileFlutter` (iOS), so a dev install never replaces the real app. `pubspec.yaml` sets `default-flavor: dev`, so a plain `flutter run` never builds the store identity by accident. The marketing `version:` in `pubspec.yaml` drives both platforms; the Android `versionCode` is computed per build by CI.

## Testing & Code Quality

- **Tests:** `flutter test`, with `mocktail`. `test/` mirrors `lib/`'s `core/`/`features/` split, and `test/support/` holds the shared fakes for platform channels that don't exist under `flutter test` (`record`, `path_provider`, `permission_handler`, `video_player`, `url_launcher`).
- **Lint:** `flutter analyze` (`flutter_lints`, configured in `analysis_options.yaml`).
- **Never run `dart format` on this repo.** It isn't dart-formatted, and running it reformats far more than intended. Edit by hand, matching surrounding style.
- **CI:** GitHub Actions workflows under `.github/workflows/` build the debug APK, the iOS simulator app, and the develop and production Android/iOS releases.

## Key Documentation

- `README.md` — short pointer to the release doc.
- `CLAUDE.md` and `AGENTS.md` — the agent/contributor router for this repo (kept byte-identical).
- `docs/RELEASE.md` — canonical for flavors, identities, env values, Firebase files, versioning, CI workflows, rollback.
- `docs/PARITY_LEDGER.md` — the audit of RN-to-Flutter feature parity at cutover.
- `docs/i18n-machine-translated.md` — the machine-translated strings gotcha.

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [Scribe Summary Writes](../platform/scribe-summary-writes.md), [ally-be](ally-be.md), [ally-web](ally-web.md).*
