---
title: ally-mobile — Mobile App
tags: [repo, mobile, react-native, ios, android]
summary: React Native iOS/Android app for mental-health counsellors, covering live sessions with transcription, peer reviews, voice-based AI simulations, and Scribe voice-dictation notes.
last_reconciled: 2026-07-28
---

# ally-mobile — Mobile App

## Purpose

`ally-mobile` is the React Native app that counsellors use in the field. It supports three core workflows: joining and listening to live counselling sessions with real-time transcription and AI-assisted call summaries; reviewing and commenting on session/simulation transcripts (peer review); and running voice-based AI training simulations against a simulated client. Newer areas add Scribe voice-dictation notes, review read/unread management, simulation pause/resume, a first-login complete-profile gate, and multilingual (i18n) content parity. The app talks to `ally-be` over REST and Socket.IO, and to LiveKit rooms driven by `ally-ai-learn` for simulations.

> [!NOTE]
> For product conventions behind these surfaces — cross-surface consistency with the web apps, achievement/leaderboard rules, and the counsellor-in-the-field persona — search Stacks before you plan ([Planning with the Stacks MCP](../contributing/planning-with-stacks.md)). The former in-wiki pages ([UI & Interaction](../product/ui.md), [Gamification](../product/gamification.md), [User Personas](../product/user-personas.md)) are **deprecated** as of 2026-08-07 and kept for history.

## Tech Stack

Factual from `package.json` (app `version` 1.5.0):

- React Native 0.79.1, React 19.0.0, TypeScript ~5.0.4
- State: Redux Toolkit (`@reduxjs/toolkit` ^2.7.0) with RTK Query for all API access; `react-redux` ^9.2.0
- Navigation: React Navigation v7 (`native`, `native-stack`, `stack`, `bottom-tabs`, `drawer`)
- Realtime voice: `@livekit/react-native` ^2.9.1, `@livekit/react-native-webrtc` ^137.0.1, `livekit-client` ^2.15.2
- Sockets: `socket.io-client` ^4.8.1 (live-session audio streaming)
- Firebase: `@react-native-firebase/app` ^22.4.0, `@react-native-firebase/crashlytics`
- Auth: `@react-native-google-signin/google-signin`, `@invertase/react-native-apple-authentication`
- Audio: `react-native-live-audio-stream`, `react-native-audio-api`, `react-native-sound-player`, `react-native-fs`
- i18n: `i18next` ^25.1.3, `react-i18next` ^15.5.1
- Notifications: `@notifee/react-native`
- Charts/gamification UI: `@wuba/react-native-echarts` + `echarts`, `react-native-chart-kit`, `react-native-confetti-cannon`, `lottie-react-native`
- Config: `react-native-config` (env consumed via `src/config/env.ts`)
- Node engine: `>=18`

## Architecture & Feature Areas

Standard React Native layout under `src/`: `screens/`, `components/`, `services/` (RTK Query APIs), `store/` (slices), `hooks/`, `navigation/`, `localization/`, `constants/`, `types/`, `theme/`, `utils/`, `contexts/`.

Navigation is driven by `RootNavigator.tsx`, which switches the stack on `isAuthenticated`. The authenticated stack mounts a `DrawerNavigator` (which contains the tab navigator) plus stack screens for listening, call summary, simulations, courses, reviews, and the complete-profile gate.

**Live sessions & audio streaming.** `ListeningScreen` handles the active session. Audio is captured via `useLiveAudioStream` and streamed over Socket.IO. `RootNavigator` opens two socket connections through `useSocketConnection` — one on the microphone namespace and one on the cloud-telephony namespace — and reacts to `USER_JOINED` events (via `useCounselorChat` / `useNavigationAwareCounselorChat`) to route the counsellor into the live `ListeningScreen`. `useSocketConnection` buffers frames across a transient app background and flushes on resume.

**Transcription & summaries.** After a call, `CallSummaryScreen` shows the AI summary and transcript, backed by `callSummaryApi`, `callTranscriptApi`, and `settingsApi` (summary field definitions fetched via `useLazyGetSummaryFieldsQuery`). `CallLogScreen` lists past calls. Deep links to a specific call summary are resolved in `RootNavigator` using `utils/deeplink` (`getCallIdFromUrl`, `isSupportedDeepLink`, `navigateToCallSummaryOrLog`).

**Reviews (incl. read/unread management).** Peer review lives in `ReviewScreen`, `ReviewDetailsScreen`, and `ShareForReviewScreen`, plus a parallel Scribe review flow (`ScribeReviewDetailsScreen`) served by `scribeReviewsApi` / `scribeReviewThreadsApi` / `scribeGeneralCommentsApi` / `scribeReactionsApi`. `reviewsApi.ts` provides threaded comments, general comments, comment visibility/edit/delete, and review status updates. Read/unread management is explicit: `getReviews` accepts `sortBy` and `readFilter` params, `markSimulationReviewAsRead` (PATCH) marks a review read, and `getUnreadSimulationReviewCount` feeds an unread badge (cached under the `UnreadReviewCount` tag). A `ReviewApiContext` (`src/contexts/`) lets shared review components target either the standard or Scribe API set. Hooks: `useReviews`, `useToggleReviewPrivacy`, `useHideReviewDetails`, `useReactions`, `usePaginatedComments`, `useCommentActions`.

**Simulations (incl. pause/resume).** Simulation browsing and detail screens (`SimulationsScreen`, `SimulationDetailsScreen`, `SimulationPathDetailsScreen`, `CaseDetailsScreen`) run off `simulationsApi.ts`, which covers scenarios, scenario paths, cases, sessions, upcoming-scenario polling, event checklists, skills, and credits. The live voice session is `SimulationAssistantScreen`, which connects to a LiveKit `Room` (`@livekit/react-native` + `livekit-client`) with an agent served by `ally-ai-learn`. Pause/resume is implemented over a LiveKit control channel: the client sends `pause`/`resume` and the agent acks with `paused`/`resumed` (with an ack timeout fallback). Paused spans are excluded from the displayed timer and scenario time limit via an accumulated `pausedOffsetMs`; authoritative billing/leaderboard paused time is tracked server-side (`scenario_sessions.totalPausedMs`). Session transitions across path/case flows are orchestrated by `useSimulationTransition` (polling for the next scenario, retry, 429 retry modal), with supporting hooks `useStartSimulation`, `useSimulationCredits`, `useSimulationTranscriptDetails`, and `useSimulationSessionRecordingUrl`. Post-session feedback is captured in `SimulationFeedbackScreen`.

**Courses (Track 2.0).** The Learn tab strip (`SimulationsScreen`) renders Courses, Cases, Simulations, Learning Pathways in that order, and drops any tab whose query returns zero items rather than showing an empty grid — so a tenant with no cases has no Cases tab. Courses run off `coursesApi.ts` against ally-be's `v1/learn/tracks` learner API: track list, track detail, next-item resolution, enrolment, per-item start, and the completion calls for each item type. A course opens in `CourseOverviewScreen` (sections, per-item status, progress ring) and is taken in `CourseItemPlayerScreen`, a single stack screen mounted with gestures disabled that swaps the inner player on item type rather than pushing a screen per item. Current-item state and prev/next gating live in `useTrackPlayerNavigation`; advancing is computed client-side from `TrackItemStatus.COMPLETED` or a same-session completed set, as there is no server `canAdvance`. Item players cover article, video, journal, roleplay, case, quiz (all six question types, in `players/quiz/widgets/`), and game. An article may carry inline single-select questions: `utils/articleSegments.ts` splits the body on the `<div data-ally-question="<id>">` placeholders ally-be anchors them with and an `ArticleQuestionCard` renders in each gap, so the question is met where the author placed it. A plain string split, not a DOM walk — React Native has no `DOMParser`, and `RichText` tolerates unclosed tags, so a placeholder that ends up wrapped degrades to a split mid-element rather than becoming unreachable. The answer is final (the server refuses a second one), which is why selecting an option does not submit it — the learner picks, then confirms. Those questions are the article's completion rule when present: the server completes the item on the last answer and refuses mark-as-read while any are outstanding, and the player blocks and relabels the footer to match. It counts only the questions it actually rendered, so a translated body that lost a placeholder drops that question instead of holding the footer shut. A type this binary has no player for renders `UnsupportedItemCard` rather than nothing — courses are authored on the web, so the builder can be a component type ahead of a shipped app, and the previous `default: return null` left a blank body under a live top bar with Next disabled. The card does not force Next open: advancing still keys off item status, so a game passes through while an ungraded exercise correctly holds. Roleplay and case items hand off to the existing simulation/case flow and detect return via `utils/activeTrackContext.ts` (AsyncStorage), since those completions are reported out-of-band by the simulation subsystem. `reportVideoProgress` patches the cached track detail optimistically and only invalidates on completion; `saveJournalDraft` invalidates nothing, being a debounced autosave. `recordGameResult` likewise invalidates nothing — a game component is already complete by the time a score arrives, so the call only records a personal best. `submitArticleQuestionAnswer` invalidates only when its response says the answer completed the article, since answering mid-article moves nothing the outline shows and the call fires per question. Game items never gate progression at all: ally-be completes them on open and returns the completion in the start payload, which `GamePlayer` reports on mount. The game itself is a self-contained HTML bundle rendered in a `react-native-webview`, inlined at `players/games/` from the copy ally-web serves, and it talks to the app only over postMessage. Known v1 gaps: ordering questions reorder by arrow button only, and YouTube/Vimeo/Loom sources fall back to a thumbnail plus open-externally card instead of native SDK playback.

**Scribe notes with voice dictation.** `scribeNoteApi.ts` creates manual Scribe notes (an empty DICTATION chat), transcribes dictated audio, and extracts structured field values. `generateNoteFromAudio` uploads the recorded WAV as multipart/form-data (`audio`, a JSON `fields` spec, optional `languageHint`); the audio is processed server-side in memory and never stored. The dictation transcript is persisted separately via `saveNoteTranscript` so it appears in the note's Transcript view. Recording is handled by `useVoiceNoteRecorder` (idle/recording/paused/stopped with start/pause/resume/stop and elapsed-time tracking that excludes paused spans). The UI lives in `CallSummaryScreen/components/VoiceNotePanel/` (`VoiceNotePanel`, `VoiceNoteSection`). Availability is gated by two permission-guarded settings hooks: `useScribeNoteCreationEnabled` and `useScribeVoiceNoteEnabled` (both skip their request unless the user holds `COUNSELOR_ACCESS`; the backend also enforces the per-tenant toggle and returns 403 otherwise).

**Complete-profile gate.** Accounts created in bulk by an admin have no name on first login. `SplashScreen` checks `userData.profileCompleted === false` and redirects to `CompleteProfileScreen` (mounted with gestures disabled). Submitting `useCompleteProfileMutation` (`authApi`) flips `profileCompleted` server-side and re-runs auth routing.

**Auth.** `authApi.ts` supports OTP (`generateOtp` / `verifyOtp`, versioned to v2), Google Sign-In (`useGoogleLogin`), and Apple Sign-In (`useAppleLogin`), with token refresh handled centrally in `services/api.ts` (`baseQueryWithReauth` retries once on 401 using the stored refresh token, else logs out). Tokens live in AsyncStorage; user/permission state is in `userSlice`.

**Analytics & gamification.** `UserAnalyticsScreen`, `AchievementsScreen`, `LeaderboardScreen`, `CommunityScreen`, and `ReactionsScreen` are backed by `analyticsApi`, `badgesApi`, `leaderboardApi`, and `reactionsApi`. Weekly leaderboard reminders are scheduled through `notificationService` + `@notifee/react-native`, gated on the `VIEW_COMMUNITY_LEADERBOARD` permission.

**i18n / language-code injection.** Localization is in `src/localization/` (`i18n.ts`, `dynamic.ts`, and `locales/` bundles for `en`, `hi`, `kn`, `mr`, `ta`). For content endpoints that return backend-generated user-facing text, `services/api.ts` injects the active UI language into the request: the allowlist in `languageCodeEndpoints.ts` (`LANGUAGE_CODE_ENDPOINTS`) drives a `baseQuery` that adds a bare ISO `languageCode` (from `i18n.resolvedLanguage`) into GET params or mutation bodies, so the server returns localized scenarios, cases, reviews, badges, leaderboard, etc. Auth/OTP/upload endpoints are intentionally excluded. An in-app language selector (drawer) plus dynamic remote translations are gated by `LANGUAGE_SELECTOR_FLAG` / `I18N_BASE_URL`. Hooks: `useLanguageDropdown`, `useTranslate`.

## Integration Points

- **ally-be (REST):** base URL is `API_BASE_URL + /api/` with a `v1`/`v2` version prefix chosen per-endpoint in `services/api.ts`. All feature APIs are RTK Query slices injected into a single `api` instance.
- **ally-be (Socket.IO):** two namespaces consumed from env — `/microphone-chat` (`MICROPHONE_SOCKET_PATH`) for in-app microphone streaming and `/cloud-telephony-chat` (`CLOUD_TELEPHONY_PATH`) for conference/telephony audio.
- **LiveKit / ally-ai-learn:** `SimulationAssistantScreen` joins a LiveKit `Room` for the voice simulation; the conversational agent (with pause/resume acks) is served by `ally-ai-learn`.
- **ally-web (deep linking):** `ALLY_WEB_URL` is used for sharing/deep links; inbound call-summary deep links are parsed and routed in `RootNavigator`.
- **Required env vars** (`env/.env.example`, typed in `src/config/env.ts`): `ENVIRONMENT`, `API_BASE_URL`, `API_VERSION`, `ALLY_WEB_URL`, `MICROPHONE_SOCKET_PATH`, `CLOUD_TELEPHONY_PATH`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `NOTIFICATION_SCHEDULE_DAY` / `_HOUR` / `_MINUTE`, `LANGUAGE_SELECTOR_FLAG`, `I18N_BASE_URL`. Most are asserted required at startup.

## Local Setup

Prerequisites: Node.js >= 18, Ruby + CocoaPods (iOS), Xcode, Android Studio.

```bash
npm install                 # installs deps; postinstall runs patch-package
# iOS native deps
bundle install
bundle exec pod install     # from ios/ via bundler
# Environment
cp env/.env.example .env     # fill in values; consumed via react-native-config
```

Platform secrets (git-excluded, provide your own):
- iOS Firebase: `ios/GoogleService-Info.plist`
- Android Firebase: `android/app/google-services.json`
- Android release signing: local keystore + signing config (never commit keystores)

Run:

```bash
npm start                   # Metro (with --reset-cache)
npm run ios                 # iOS simulator/device
npm run android:dev         # Android dev flavor (appId com.helloally.app.dev)
npm run android:prod        # Android prod flavor (appId com.helloally.app)
```

Release bundles: `npm run build:dev` / `npm run build:prod` (Android gradle), `npm run bundle:ios` / `npm run bundle:android`.

## Testing & Code Quality

- **Tests:** Jest (`npm test`, `npm run test:coverage`) with `@testing-library/react-native`; `jest.config.js` + `jest.setup.ts`, colocated `__tests__/` folders across `services/`, `hooks/`, `store/`, `screens/`, and `localization/`.
- **Lint/format:** ESLint (`npm run lint`, RN 0.79 config) and Prettier (`npm run format`), with strict import grouping/sorting via `@ianvs/prettier-plugin-sort-imports`.
- **Git hooks:** Husky pre-commit runs `lint-staged` (`eslint --fix` + Prettier on staged `src/**/*.{js,jsx,ts,tsx}`); Commitlint enforces Conventional Commits (`commitlint.config.js`).
- **TypeScript:** `tsconfig.json` with `@/` path aliases (also wired in `babel.config.js`/`metro.config.js`).

## Key Documentation

- `README.md` — features, tech stack, project structure, setup, import conventions, and commit rules.
- `CONTRIBUTING.md` — branch naming and Conventional Commit conventions.
- `CLAUDE.md` — points to the canonical Ally Developer Wiki and warns against committing secrets.
- `AGENTS.md` — agent/contributor working notes for this repo.
- `SECURITY.md` — vulnerability disclosure process.
- `CODE_OF_CONDUCT.md` — contributor code of conduct.
- `.github/ISSUE_TEMPLATE/` — bug report and feature request templates.

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [Scribe Summary Writes](../platform/scribe-summary-writes.md), [ally-be](ally-be.md), [ally-web](ally-web.md).*
