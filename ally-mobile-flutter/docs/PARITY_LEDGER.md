# RN → Flutter PARITY LEDGER v3 (ally-mobile → ally-mobile-flutter)

Re-audit date: 2026-10-28. Read-only: nothing was built, run or edited in either repo, and every verdict comes from reading code.

- **RN (source of truth):** `ally-platform/ally-mobile` at `7a8ce0c19`, which includes "Single-attempt assessment mode for roleplay items".
- **Flutter:** `f770200` on `parity/ledger`. It is 56 commits past v2's `227db3a` and covers waves 3–6: force update, error boundary, deep links, token migration, i18n, telephony socket, keep-awake, connectivity, Scribe/Conference, call summary header and icons, toasts and `getErrorDetails`, course players and assessment mode, reviews, shell/drawer, splash, and the deletion of 26 dead assets (`81622e1`).
- **Method:**
  - Every v2 row not marked PRESENT/N/A, and every numbered v2 gap item, was re-read in current code.
  - **About 385 PRESENT rows were spot-checked** across all sections (42 §1/§2 account, 82 Scribe, 40+ Learn, 62 Reviews/§3, 34 §4/§6, 55 §5, about 70 §8–§11).
  - Discovery diffs were run for routes, rendered components, endpoints (`endpoints.py`, fresh), translation keys (848 RN-used keys), assets (135 RN-rendered files), iOS/Android native config, and RN `7a8ce0c19`.
  - Rows changed in v3 carry **"v3:"** in their Notes.

## Status key

- **PRESENT**: the same behaviour exists, possibly built differently. The row names the Flutter file.
- **PARTIAL / MISSING**: a **true code gap** in this repo. The Notes say what is missing.
- **BLOCKED-EXTERNAL**: the code and config in this repo are done, but the feature needs credentials, CI secrets, console registration or web-host files.
- **DEVICE-CHECK**: the code exists, but the behaviour can only be proven on a physical device (sign-in, links opening, push, audio routing, background audio).
- **N/A**: RN dead code, dev-only tooling, or a framework concern. **DEAD**: an RN endpoint that is defined but never called.
- MERGED was retired in v2.

## Totals per section (v3; v2 in brackets)

| § | Section | Rows | PRESENT | PARTIAL | MISSING | BLOCKED-EXT | DEVICE-CHECK | N/A |
|---|---|---|---|---|---|---|---|---|
| 1 | Navigation | 52 (47) | 45 (40) | 2 (3) | 0 (1) | 0 | 1 | 4 (3) |
| 2 | Screens: account/shell | 211 (211) | 183 (166) | 1 (20) | 0 (0) | 1 | 1 | 25 (25) |
| 2 | Screens: Scribe | 158 (156) | 140 (134) | 2 (4) | 0 (2) | 0 | 0 | 16 (16) |
| 2 | Screens: Learn | 238 (237) | 215 (208) | 3 (9) | 0 (1) | 0 | 2 | 18 (19) |
| 2 | Screens: Reviews + review hooks | 77 (77) | 72 (69) | 3 (5) | 0 (1) | 0 | 0 | 2 (2) |
| 3 | Shared components | 72 (72) | 63 (59) | 0 (7) | 0 (0) | 2 | 1 | 6 (6) |
| 4 | Hooks | 53 (53) | 42 (43) | 1 (2) | 0 (0) | 1 | 1 | 8 (8) |
| 4b | App shell / services / utils | 79 (62) | 65 (48) | 0 (4) | 0 (5) | 4 | 4 | 6 (5) |
| 5 | Backend endpoints called by RN | 150 (150) | 150 (148) | 0 (2) | 0 (0) | 0 | 0 | 25 dead (separate) |
| 6 | Store | 29 (28) | 25 (24) | 1 (2) | 0 (0) | 0 | 0 | 3 (2) |
| 7 | Translations | 12 (9) | 9 (6) | 1 (2) | 0 (0) | 0 | 0 | 2 (1) |
| 8 | Assets (files + 7 fonts) | 168 (168) | 142 (123) | 0 (19) | 0 (0) | 0 | 0 | 26 (26) |
| 9 | Config / env / flags | 17 (15) | 12 (7) | 0 (5) | 0 (2) | 4 | 0 | 1 (1) |
| 10 | Native / platform | 100 (83) | 63 (49) | 5 (8) | 0 (8) | 7 | 3 | 22 (18) |
| 11 | Analytics / telemetry | 5 (4) | 2 (2) | 1 (1) | 0 (0) | 1 | 0 | 1 (1) |
| | **Total** | **1,421 (1,372)** | **1,228 (1,126)** | **20 (93)** | **0 (20)** | **20** | **13** | **140** |

Notes on the table:
- The §5 transport, realtime and cache sub-tables are counted separately, as in v2: 33 rows, 29 PRESENT, 1 DEVICE-CHECK (RN session carry-over), 3 divergent by design.
- §8b, the icon sweep, is also separate: 33 of 33 sites are now PRESENT.
- Some gaps appear in more than one section. The 20 PARTIAL rows reduce to the **17 distinct code gaps** listed below.
- Google sign-in is classed BLOCKED-EXTERNAL everywhere because the Dart-side client ids come from the missing `ENV_VALUES_*` CI secret. After that it still needs a device check.

---

## Remaining code gaps: the work list to reach zero (v3, deduplicated)

These are true code gaps only. They're grouped so fix waves don't overlap on files. Where two groups touch the same file, the overlap is noted.

### W1. Navigation / back behaviour
1. **Conference Listening back exits the app** (§1 N2).
   - RN: `navigation/RootNavigator.tsx:115-133` resets to [CallLog, Listening]; see also `ListeningScreen/hooks/useListeningCommon.ts:179-182`.
   - Flutter: `core/chat/active_chat_discovery.dart:77` reaches the screen with `router.go`, and `features/scribe/presentation/conference_listening_screen.dart` has no `PopScope`.
   - Missing: a `PopScope` that clears the current chat and calls `goToHomeTab(kTabCallLog)`. Use the same pattern as `scribe_recording_screen.dart:532-545`.
2. **iOS swipe-back isn't disabled where RN sets `gestureEnabled:false`** (§1 N3).
   - RN: `RootNavigator.tsx:441-465`.
   - Flutter:
     - `course_item_player_screen.dart` (no `PopScope`)
     - `roleplay_voice_screen.dart:741-742` (idle state)
     - `simulation_feedback_screen.dart:497-499` (plain entry)
   - Missing: `PopScope(canPop:false)` routed through each screen's existing back handler. Low impact.
   - Overlaps W4 on `roleplay_voice_screen.dart`.
3. **Login status bar style** (§2.1).
   - RN: `SplashScreen.tsx:236-239` sets `dark-content`.
   - Flutter: `login_screen.dart:450-451` sets `SystemUiOverlayStyle.light`.
   - Either port it or confirm the choice is deliberate; `main.dart:144-147` hints that it is.

### W2. Call summary (Scribe)
4. **A failed summary fetch wipes loaded data and dead-ends the screen** (Scribe S-N1).
   - RN: `CallSummaryScreen.tsx:351-403` keeps the data, or falls through to the progress view with "See if ready" and "Check later".
   - Flutter: `call_summary_screen.dart:1156-1169`. `AsyncValue.when` takes the error branch even when a previous value exists and renders bare text.
   - Missing: `skipError: true`, or render from `.value`, plus the progress fallback on a first-load error that isn't a 403.
5. **Voice-note setting is fetched for non-counsellors** (Scribe S-N2).
   - RN: `hooks/useScribeVoiceNoteEnabled.ts:13-22` uses `skip: !isCounsellor`.
   - Flutter: `voice_note_section.dart:258-262` makes the call anyway and gets a harmless 403.

### W3. Share for review
6. **Re-share opens in edit-note mode** (Reviews A4.1, A4.8).
   - RN: `isEditNote` is true only from the review-details screens (`SimulationReviewDetailsScreen.tsx:99-114`, `ScribeReviewDetailsScreen.tsx:96-110`).
   - Flutter: `core/routing/app_router.dart:364` derives `isEditNote` from `reviewId != null`.
   - Result: when a review already exists, sharing from Call summary or Sim feedback shows "Edit note"/"Save" and the edit-note success toast (`share_for_review_screen.dart:145`).
   - Missing: an explicit `isEditNote` field in `ShareForReviewArgs`, set only by `review_details_screen.dart` `_editNote`.
7. **The scribe share card shows Duration "-"** (A4.3).
   - RN: `CallSummaryScreen.tsx:178`.
   - Flutter: the duration is formatted twice, at `call_summary_screen.dart:382` and `share_for_review_screen.dart:166`.
   - Fix: pass raw seconds. Overlaps W2 on `call_summary_screen.dart`.
8. **Scribe edit-note title fallback** (A4.3 nit).
   - RN: `ScribeReviewDetailsScreen.tsx:100` falls back to "Session Review".
   - Flutter: renders "-" (`review_details_screen.dart:293` → `simulation_details_card.dart:143`).

### W4. Learn players
9. **Live role-play errors are inline, not toasts** (Learn §8).
   - RN: `SimulationAssistantScreen.tsx:379,571,580,612,638,654` call `showErrorToast` with `getErrorDetails`.
   - Flutter: `roleplay_voice_screen.dart:453,479,488,498,669` set `_error`, which renders as a persistent red line at `:825-832`.
   - Fix: `showToast(..., ToastType.error)`.
10. **Branching and bucket-sort screen-reader labels are unused** (Learn §5 a11y = §7 row 11).
    - RN: `BranchingScenarioPlayer.tsx:285` (`recapLabel`), `:386` (`trailLabel`); `BucketSortPlayer.tsx:176-182` (`bucketA11y`).
    - Flutter: `branching/branching_scenario_player.dart` and `bucket_sort/bucket_sort_player.dart` have no `Semantics`.
    - The keys already exist in all 5 locales.
11. **Course video has no fullscreen and no time readout** (Learn L-N1).
    - RN: `players/VideoPlayer.tsx:40-49` uses native `controls`.
    - Flutter: `video/video_player_widget.dart:140-185` has only play/pause and a scrub bar.

### W5. Native / build config (no Dart overlap)
12. **`NSCameraUsageDescription` is missing** (§10 r5).
    - RN: `ios/ally/Info.plist`.
    - Flutter: `ios/Runner/Info.plist`.
    - LiveKit/WebRTC link camera APIs, so an App Store upload can be rejected (ITMS-90683).
13. **The iOS launch screen is white; RN's is dark** (§10 r84).
    - RN: `ios/ally/LaunchScreen.storyboard`.
    - Flutter: `ios/Runner/Base.lproj/LaunchScreen.storyboard`.
    - The white flash shows before the dark Lottie splash.
14. **The Android launch theme is white; RN's is #021922** (§10 r85).
    - RN: `res/values/styles.xml` `LaunchTheme`.
    - Flutter: `res/drawable{,-v21}/launch_background.xml` and `res/values{,-night}/styles.xml`.
15. **Android `BLUETOOTH`/`BLUETOOTH_ADMIN` permissions are missing** (§10 r88).
    - RN gets them merged from the `@livekit/react-native` manifest.
    - Flutter: `android/app/src/main/AndroidManifest.xml:15-25`.
    - Needed for Bluetooth routing on Android ≤11; add them with `maxSdkVersion=30`.
16. **Android round launcher icon is missing** (§10 r86, low).
    - RN: `AndroidManifest.xml:16` `roundIcon`.
    - Flutter: `AndroidManifest.xml:30` sets only `icon`.
17. **No Crashlytics symbol upload** (§11 r5).
    - RN: `ios/ally.xcodeproj/project.pbxproj:309` (`FirebaseCrashlytics/run`); `android/build.gradle:19`, `android/app/build.gradle:6`.
    - Flutter: none in `ios/Runner.xcodeproj/project.pbxproj`, `android/build.gradle.kts` or `android/app/build.gradle.kts`.
    - Without it, native crashes are unreadable.

### Deliberate divergences recorded in code (need sign-off, not counted as gaps)
- **Launch auth:** launch logs out only on a 401. RN logs out on any `/users/me` failure (`hooks/useUser.ts:44-63`). Flutter documents this choice at `core/routing/app_router.dart:89-95` and `app_shell_screen.dart:99-117`, where a permissions failure gets a Retry. This is the PARTIAL in §4 useUser and §6 checkAuth.
- **Scribe notification prompt:** Scribe start calls `Permission.notification.request()` every time (`scribe_recording_screen.dart:336`). RN never prompts there. It is tied to the Android foreground recording service.
- **HTTP timeout:** `receiveTimeout` is 90 s (`core/network/api_client.dart:27`); RN has none. Slow LLM endpoints could fail in Flutter.
- **Cosmetic, kept PRESENT:**
  - LevelIndicator uses a Material spinner with no 1200 ms ease (`core/widgets/level_indicator.dart:59`).
  - The InfoTooltip bubble is a Material `Tooltip` (`info_tooltip_icon.dart:23`).
  - `checkForActiveChat` has no in-flight guard (`active_chat_discovery.dart:47`).
  - The deep-link summary reset keeps the last-selected tab (`deep_link_binding.dart:73-79`).
  - `/leaderboard`, `/community`, `/search` and `/reviews` are registered but have no callers (`app_router.dart:266-330`).
  - The dev flavor's `I18N_BASE_URL` fallback points at the retired `.dev` host (`app_config.dart:64`).

### Needs a backend or product decision (not a Flutter change)
- **v2 #47:** does anything consume `SCRIBE_START_DIAGNOSTIC`? Flutter emits it, as RN does.
- **v2 #48:** is `enableRecommendations` still honoured?
- **v2 #49, rest:** these unused client methods could be deleted:
  - `getTrackLanguages`
  - `getModeratorTenants`
  - `NotificationsRepository.unreadCount`
  - `CallLogRepository.getCallLogItem`

  The `/preferences` route was removed in `9b76a8a`.
- **v2 #50:** keep the delete-summary code? It is wired, as in RN.

---

## BLOCKED-EXTERNAL (code done; needs credentials, console or secrets)

1. **The Flutter repo has no CI secrets.** `gh secret list -R HelloAllyTech/ally-mobile-flutter` returns nothing, while RN's repo has 28. Copy across:
   - `ENV_VALUES_PRODUCTION/DEVELOP`
   - `*_GOOGLE_SERVICES_S3_URI_*` and the AWS OIDC trust
   - the Android keystore
   - `PROVISION_PROFILES_BASE64` and `BUILD_CERTIFICATE_BASE64`
   - the App Store keys

   This one blocker covers:
   - **Firebase:** push registration, deregistration on logout, `displayRemoteMessage`, the background handler, and Crashlytics (§4b, §10 r20/r22/r49, §11 r2, §3 ErrorBoundary).
   - **Google sign-in client ids:** §2.1, §3 GoogleLoginButton, §4 useGoogleLogin, §9 r7/r8, §10e r51.
   - **Release signing:** §9 r15/r16, §10 r91/r92.
2. **The "Ally AppStore Distribution" provisioning profile** must carry push, Sign in with Apple and associated domains (§10 r92). RN's profile already does if it's unchanged.
3. **Dev-flavor ids** (`com.helloally.ally_mobile_flutter` / `com.helloally.allyMobileFlutter`) have no Firebase app, OAuth client or AASA/assetlinks entry (§10 r99). Low: this affects test builds only.

The release identity is decided. The prod flavor uses RN's `com.helloally.app` on both platforms, RN's team and keystore, and `TARGETED_DEVICE_FAMILY = 1`. Prod AASA (`W3ZL4N9N9J.com.helloally.app`) and `assetlinks.json` are already hosted.

## DEVICE-CHECK (code exists; prove on hardware)

1. **Universal/App Links** `/summary/:id` and `/course/:uuid`, cold and warm, on iOS and Android (§1 r42, §4b, §10c r23/r24). Code: `core/deeplink/*`, `Runner.entitlements`, `AndroidManifest.xml:36,60-65`.
2. **Sign-in:** Apple sign-in (§2.1, §3, §4, §10e r43), and Google sign-in once item 1 above is unblocked.
3. **Push delivery and notification taps**, after Firebase is unblocked (§10e r49).
4. **RN → Flutter store upgrade:** the user stays signed in and keeps their language and leaderboard toggle (§4b B63, §5.2). Code: `core/migration/legacy_session_migration.dart`, `MainActivity.kt:40-75`.
5. **Role-play audio routing:** speaker by default, with Bluetooth or a wired headset taking over (Learn §8; `roleplay_audio_session.dart:29-51`). Bluetooth on Android ≤11 also needs code gap 15.
6. **Background audio** while the app is backgrounded (Learn §8; Scribe L5/L38):
   - iOS `UIBackgroundModes: audio`
   - Android foreground service of type `microphone` on Android 14+

   Flutter declares more here than RN does.
7. **Scribe:**
   - 16 kHz pcm16 mic stream and waveform gain
   - voice-note 24 MB auto-stop (about 13 min) and mic interruption
   - summary export to Android Downloads (API 28/29/30+) and to iOS Files › Ally
   - breath-sound mixing and mute
   - keep-awake during long sessions

---

## Changed since v2

- **Status changes:** about 200 rows changed status, and about 50 rows were added. The added rows are §1 N1–N5, Scribe S-N1/S-N2, Learn L-N1, §4b B63–B79, §5 assessment contract plus RN session carry-over, §7 rows 10–12, §9 r16/r17, §10 r84–r100, and §11 r5.
- **v2 gap items now closed in code:**
  - 3 (entitlements)
  - 4 (release identity = RN's ids; force-update URLs are now correct)
  - 5 (iPhone-only)
  - 7–10, 12–29 (13 = `_CurrentUserGate`)
  - 31–46 (40 = `core/network/error_details.dart`, 41 = toast host, 44 = socket retry timer)
  - the `/preferences` half of 49
  - the voice-note 403 minor finding stays open as gap 5
- **v2 items moved out of the code list:**
  - 1 and 2 are now BLOCKED-EXTERNAL (CI secrets).
  - 6 (deep links) and 30 (audio routing) are now DEVICE-CHECK.
  - 11 is closed except the logout-on-any-failure point, which is now a recorded divergence.
- **C6 corrected:** RN's call-log date filters are free-text `LineTextInput`s (`CallLogFilterSheet.tsx:108-136`), so Flutter matches. An emptied box is no longer sent (`call_log_repository.dart:460-471`).
- **§8 assets:**
  - All 135 RN-rendered asset files are referenced.
  - All 33 §8b icon sites draw RN's asset, and `lib/` contains no `Icons.*`.
  - The 26 dead assets were deleted in `81622e1` with no remaining references. Their rows stay N/A.
- **§7 translations:**
  - All 848 RN-used keys are present in every locale (en, hi, kn, mr, ta), with zero value drift.
  - The 7a8ce0c19 assessment keys are ported.
- **RN 7a8ce0c19 assessment mode:**
  - It matches RN line by line: warning, lock, report still viewable, and payload fields (`start_item_payload.dart:623-624`, `roleplay_case_player.dart:56-173`).
  - All 6 HTML5 game bundles are byte-identical to RN's.
- **§5 endpoints:** a fresh endpoint diff found no new RN endpoint, and all 150 endpoint rows are PRESENT.
- **Regressions:** none in about 385 PRESENT spot-checks. The new gaps 1–17 are earlier audit misses or new discovery rows, not regressions. Two rows were reclassified because the v3 audit was stricter:
  - role-play error toasts: PRESENT → PARTIAL
  - branching/bucket a11y: N/A → PARTIAL

---

## §1 Navigation — routes, params, tabs, drawer

RN: `src/navigation/{RootNavigator,DrawerNavigator,TabNavigator,types}.tsx`, `src/constants/{navigation,tabs}.ts*`. Flutter: `lib/core/routing/app_router.dart` (go_router), `lib/core/navigation/{app_shell_screen,app_bottom_tab_bar,app_drawer,tab_config}.dart`.

**v3 tally (HEAD f770200): 52 rows: 45 PRESENT / 2 PARTIAL / 0 MISSING / 0 BLOCKED-EXTERNAL / 1 DEVICE-CHECK / 4 N/A** [v2 (227db3a): 47 rows: 40 PRESENT / 3 PARTIAL / 1 MISSING / 3 N/A] (v1: 32 / 9 / 3 / 3).

RN layout: a native stack with two branches. Signed out: Splash, SuspendedAccount. Signed in: Drawer → BottomTabs plus 26 stack screens (incl. a signed-in Splash). Flutter layout: a flat go_router list with a `computeRedirect` gate (`/splash` plays the Lottie on every cold start, then → `/login` | `/complete-profile` | `/home`; `/suspended` allowed while signed out). v3: `/preferences` removed (9b76a8a).

| # | RN route (params; options) | Flutter route / file | Status | Notes |
|---|---|---|---|---|
| 1 | Drawer `BottomTabs {hideTabBar?}` (DrawerNavigator) | `/home` → `AppShellScreen` + `app_drawer.dart` | PRESENT | Drawer items, gating and version label are detailed in §2 account, sections 4–5. |
| 2 | `Splash` (signed-out branch; login lives inside it) | `/splash` (`_LaunchScreen`, blank until the session is restored) + `/login` (`login_screen.dart`) | PRESENT | |
| 3 | `SuspendedAccount` (signed-out branch) | `/suspended` → `suspended_account_screen.dart` | PRESENT | |
| 4 | `CompleteProfile` (`gestureEnabled:false`) | `/complete-profile`, forced by `computeRedirect` | PRESENT | |
| 5 | `Listening {isMicrophoneMode:true}` | `/scribe` → `ScribeRecordingScreen` | PRESENT | v3: `dev-user` fallback gone — `_CurrentUserGate` shows a spinner until `/users/me` resolves (app_router.dart:185-188, 416-435). |
| 6 | `Listening {isMicrophoneMode:false}` (conference) | `/conference-listening/:chatId` → `ConferenceListeningScreen` | PRESENT | v3: route also wrapped in `_CurrentUserGate` (app_router.dart:189-197). Back behaviour see N2. |
| 7 | `CallSummary {callId?, fromLogs?}` (`gestureEnabled:false`) | `/call-log/:id` → `CallSummaryScreen(log: extra?, fromLogs: ?live!=1)` (app_router.dart:285-293), `/call-summary` (live, app_router.dart:297) | PRESENT | v2: the `CallLogItem` extra is optional, so open-by-id works; `fromLogs` is modelled by `?live=1`. |
| 8 | `CallLog` (stack copy of the tab) | `/call-log` → `CallLogScreen` | PRESENT | |
| 9 | `Breathing` (post-call box breathing) | `/box-breathing?chatId=` | PRESENT | Exit target after a live session differs from RN (§2 Scribe). |
| 10 | `BreathingExercise {config, itemId, trackId}` (`animation:'fade'`) | `/breathing-exercise` (extra `BreathingExerciseContent`) | PRESENT | `itemId`/`trackId` aren't needed: completion happens in the player on mount, as in RN (§2 Learn, section 7). |
| 11 | `Simulations` | `/simulations` → `SimulationsScreen` | PRESENT | |
| 12 | `SimulationDetails {scenario}` | `/simulations/:scenarioId` (extra `Scenario?`) | PRESENT | Can also load by id. |
| 13 | `SimulationPathDetails {pathId}` | `/simulation-paths/:pathId` | PRESENT | |
| 14 | `CaseDetails {caseId}` | `/cases/:caseId` | PRESENT | |
| 15 | `CourseOverview {trackId}` | `/courses/:trackId` → `CourseDetailScreen` | PRESENT | |
| 16 | `CourseItemPlayer {trackId, itemId, highlightPostId?}` (`gestureEnabled:false`) | `/courses/item/:itemId` (extra `CourseItemPlayerArgs{trackId,item?,highlightPostId}` or legacy record; app_router.dart:182-197) | PRESENT | v2: opens by id with `highlightPostId` (course_item_player_screen.dart:48-77). |
| 17 | `CourseProgress {trackId}` | `/courses/:trackId/progress` | PRESENT | |
| 18 | `SimulationAssistant {sessionData, scenario?, pathId?, caseId?, languageId?}` (`gestureEnabled:false`) | `/roleplay` (extra map incl. `pathId`, `caseId`, `languageId`; app_router.dart:204-219) | PRESENT | v2: ids threaded (c29e765). |
| 19 | `SimulationFeedback {scenarioSessionId?, fromLogs?, pathId?, caseId?, languageId?}` (`gestureEnabled:false`) | `/simulations/feedback/:sessionId?fromLogs=&pathId=&caseId=&languageId=` (app_router.dart:260-267) | PRESENT | v3: back → path/case details on top of the Learn tab, logs → pop, else Learn tab (simulation_feedback_screen.dart:243-265). |
| 20 | `Achievements` (stack; also a tab) | `/achievements` + tab `kTabAchievements` | PRESENT | |
| 21 | `Progress` | `/progress` | PRESENT | |
| 22 | `ProfileSettings` | `/profile` | PRESENT | |
| 23 | `BugReport` | `/bug-report` (extra `screenName`) | PRESENT | |
| 24 | `Reactions {reviewId, reviewType?}` | `/reactions/:reviewId` (extra `ReviewType`) | PRESENT | |
| 25 | `ReviewDetails {reviewId, isPrivate?}` | `/reviews/:reviewId` (extra `ReviewType.simulation`) | PRESENT | v2: `isPrivate` is read from the fetched review (`review.isPrivate`, review_details_screen.dart:317) rather than passed, which is equivalent. |
| 26 | `ScribeReviewDetails {reviewId, isPrivate?}` | `/reviews/:reviewId` (extra `ReviewType.scribe`) | PRESENT | Same as row 25. |
| 27 | `ShareCallLog {reviewId?, scribeSessionId, sessionData, isEditNote?, note?}` | `/share-for-review/:id` (extra `ShareForReviewArgs{isScribe:true,…}`) | PRESENT | The screen behaviour itself is MERGED from parity/reviews (§2 Reviews A4). |
| 28 | `ShareSimulation {reviewId?, scenarioSessionId, scenarioData, isEditNote?, note?}` | `/share-for-review/:scenarioSessionId` | PRESENT | `isEditNote` is derived from `reviewId != null`. |
| 29 | `Notifications` | `/notifications` | PRESENT | |
| 30 | `LiveKitTest` (declared in `types.ts` / `SCREEN_NAMES`, never registered) | — | N/A | RN dead route. |
| 31 | Tab `Learn` (perm `EDIT_SCENARIO_SESSION`) → SimulationsScreen | `tab_config.dart` `kTabLearn` | PRESENT | |
| 32 | Tab `CallLog` (`VIEW_CALL_LOGS` or `VIEW_SCENARIO_SESSION`) | `kTabCallLog` | PRESENT | |
| 33 | Tab `Review` (`VIEW_SIMULATION_REVIEWS` or `VIEW_SCRIBE_REVIEWS`) + unread dot | `kTabReview`, `app_bottom_tab_bar.dart`, `unreadReviewCountProvider` (reviews_repository.dart:131-148) | PRESENT | v3: invalidated after mark-read (review_details_screen.dart:89-93) and on every Review-list refocus (review_screen.dart:274-277); sum of sim + scribe counts (reviews_repository.dart:131-148). |
| 34 | Tab `UserAnalytics` (`VIEW_ANALYTICS_DASHBOARD`) | `kTabUserAnalytics` | PRESENT | |
| 35 | Tab `Leaderboard` (`VIEW_COMMUNITY_LEADERBOARD`) | `kTabLeaderboard` | PRESENT | v2: reminder tap selects the tab. v3: Progress rank link now `goToHomeTab(kTabLeaderboard)`, no-op without permission (progress_screen.dart:86-90). |
| 36 | Tab `Achievements` (`VIEW_USER_BADGES`; reviewer-only layout via `isReviewerOnly`) | `kTabAchievements`, `isReviewerOnly()` | PRESENT | |
| 37 | Tab `Search` (`VIEW_REFERENCE_DOCUMENT`) | `kTabSearch` | PRESENT | |
| 38 | Tab `Community` (`VIEW_COMMUNITY`; opens external link) | `kTabCommunity` → `community_screen.dart` | PRESENT | v3: every tap calls `openCommunity()` and reselects the first tab, as RN `goBack()` + `Linking.openURL` on focus (app_shell_screen.dart:80-89, community_screen.dart:15-21). |
| 39 | Tab permission OR-semantics + `getFirstVisibleTab` initial tab | `tab_config.dart` `_hasAnyPermission`, `app_shell_screen.dart` | PRESENT | |
| 40 | Android hardware back on a tab root → first visible tab (`useTabBackToHomeHandler`, `useHardwareBackPressHandler`) | `app_shell_screen.dart:150-160` (`PopScope`: back on a non-first tab → first visible tab; on the first tab → exit; closes the badge popup first) | PRESENT | v2: landed in 557dc55. |
| 41 | "Reset to tab" exits (end of flow → Learn tab / CallLog tab via `navigation.reset`) | `core/navigation/home_tab_navigation.dart` (`goToHomeTab`), used by call_summary_screen.dart:487 and box_breathing_screen.dart:191 | PRESENT | v3: all exits use `goToHomeTab` — simulation_feedback_screen.dart:254,264; course_item_player_screen.dart:292; scribe_recording_screen.dart:543; learning_path_widgets.dart:304; call_summary_screen.dart:503; box_breathing_screen.dart:191. |
| 42 | Universal-link routes `https://{ALLY_WEB_URL}/summary/:id` → [CallLog, CallSummary], `/course/:uuid` → CourseOverview (pending until auth/profile) | none | DEVICE-CHECK | v3: ported (c536efa). core/deeplink/deep_link.dart:58-108 (parse), deep_link_coordinator.dart:65-114 (hold until auth + summary fields; course waits past /splash,/login,/complete-profile; dropped on listening), deep_link_binding.dart:21-84, main.dart:64-69,121 (`AppLinks().uriLinkStream`). Native: Runner.entitlements:14-18 `applinks:`, AndroidManifest.xml:36 `singleTask`, :60-65 `autoVerify` with `${appLinkHost}` (build.gradle.kts:56,62). Only device confirmation of the OS opening links remains. |
| 43 | Notification-tap routing by push type (`RootNavigator` + `pushNotificationService`) | `core/push/notification_navigation.dart` | PRESENT | v2: leaderboard reminder selects the tab (notification_navigation.dart:50, push_notification_service.dart:126). RN's push-tap handler never routes COURSE_DISCUSSION_REPLY either; the in-app Notifications list does (section 8). |
| 44 | Auth-gated stack split (signed-out branch shows only Splash/Suspended) | `computeRedirect` in `app_router.dart` | PRESENT | v3: splash now waits for `/users/me` to settle (app_router.dart:93-95); only a 401 logs out — documented team decision (app_router.dart:88-92, app_shell_screen.dart:99-101). |
| 45 | Drawer content (`CustomDrawerContent`, menu items, LogoutModal) | `app_drawer.dart`, logout modal | PRESENT | v2: logout now deregisters the device token (auth_state.dart:70-78). |
| 46 | In-screen modals/sheets (CallLogFilterSheet, CourseProgressSheet, LanguageSelectorSheet, comment/thread sheets, start-simulation modals) | per-feature `showModalBottomSheet` | N/A | Not routes in RN either. Each is mapped in §2/§3. |
| 47 | Flutter-only routes with no RN stack equivalent: `/preferences`, `/reviews`, `/leaderboard`, `/community`, `/search` as standalone pushes | `app_router.dart` | N/A | v3: `/preferences` + features/preferences deleted (9b76a8a). `/leaderboard`, `/community`, `/search`, `/reviews` stay registered (app_router.dart:266-330) but nothing navigates to them — dead, harmless; remove at will. |
| N1 | Active-chat auto-route: launch, foreground and cloud-telephony `USER_JOINED` → `checkCounselorChat` → reset [CallLog, Listening] unless already on Listening (RootNavigator.tsx:115-171) | main.dart:102-104,126-134; core/chat/active_chat_discovery.dart:47-78,103-106; cloud_telephony_listener.dart | PRESENT | v3 new row. Uses `router.go(target)` (no CallLog underneath); Scribe falls back to the CallLog tab (scribe_recording_screen.dart:537-544), conference does not (N2). |
| N2 | Conference `Listening` back (Android hardware back / iOS swipe) → CallLog under it (stack reset [CallLog, Listening]; `gestureEnabled: !isMicrophoneMode`, useListeningCommon.ts:280) | conference_listening_screen.dart (no `PopScope`/back handler); reached only via `router.go` (active_chat_discovery.dart:77) | PARTIAL | v3 new row: the route is the only page on the stack, so Android back leaves the app and iOS has nothing to swipe to. Needs a `PopScope` that clears the current chat and `goToHomeTab(kTabCallLog)` (as scribe_recording_screen.dart:532-545). |
| N3 | `gestureEnabled:false` (iOS swipe-back disabled) on CallSummary, CourseItemPlayer, SimulationAssistant, SimulationFeedback, CompleteProfile (RootNavigator.tsx:407-465) | call_summary_screen.dart:615-616 (`canPop:false`) ✓; course_item_player_screen.dart (no `PopScope`); roleplay_voice_screen.dart:741-742 (`canPop: !_isConnected`); simulation_feedback_screen.dart:497-499 (`canPop` true for a plain session) | PARTIAL | v3 new row. iOS edge-swipe still pops CourseItemPlayer, an idle Roleplay and plain SimulationFeedback. Low impact (same target as their back buttons). |
| N4 | ErrorBoundary "reset" re-mounts the navigator (App.tsx:26-28) → Splash routes from the current auth state | main.dart:155-158 (`AppErrorBoundary(onReset: () => router.go('/splash'))`), core/errors/error_boundary.dart | PRESENT | v3 new row. |
| N5 | Dev-env `NetworkLogs` floating overlay (App.tsx:31, components/NetworkLogs; `react-native-network-logger`) | — | N/A | v3 new row: developer tooling shown only when `ENVIRONMENT === "development"`; not user-facing. Port only if the team wants it in the dev flavor. |


---

## §2 Screens

The four sub-parts below were each written by a separate auditor, and each keeps its own tallies and top-gaps list.

### Parity ledger — account / shell screens

Scope: SplashScreen (login), CompleteProfile, SuspendedAccount, Drawer (DrawerNavigator + CustomDrawerContent), LogoutModal, ProfileSettings, BugReport, Notifications, Achievements, Progress, UserAnalytics, Leaderboard, Community, Search, Reactions, TabNavigator.

- RN root: `ally-platform/ally-mobile/src/` (paths below are relative to it)
- Flutter root: `ally-mobile-flutter/lib/` on `master` (paths below are relative to it). Branches `parity/reviews` and `parity/feedback` were diffed against their merge base. Neither touches anything in this scope except `core/navigation/app_drawer.dart` (refactor only on parity/feedback, no behaviour change) and the Reactions entry point (moved into `review_widgets.dart` on parity/reviews). No row is IN PROGRESS.
- **v2 re-audit (2026-10-28, master 227db3a):** every PARTIAL/MISSING row re-read on master; ~20 PRESENT rows spot-checked. No regressions found.
- **v3 re-audit (2026-10-28, HEAD f770200):** every non-PRESENT row re-read against current code; 40+ PRESENT rows spot-checked (splash, shell/drawer, logout, tabs, toasts, notifications, leaderboard, reactions). Notes prefixed "v3:" changed. No regressions found.

#### Overall tally

**v3 (HEAD f770200): 211 rows: 183 PRESENT / 1 PARTIAL / 0 MISSING / 1 BLOCKED-EXTERNAL / 1 DEVICE-CHECK / 25 N/A** [v2 (227db3a): 166 / 20 / 0 / 0 IN PROGRESS / 25 N/A] (v1: 151 / 26 / 9 / 0 / 25)

(v2: the "Android back on a tab root" gap, listed once each under UserAnalytics, Community, Search and TabNavigator, is fixed by the shell `PopScope` in 557dc55.)

**Analytics and tracking:** RN has no product analytics in this scope. Grepping all of `src/` for posthog, logEvent, trackEvent, `.capture(`, mixpanel, amplitude and `analytics()` finds nothing. The only telemetry is Crashlytics in the global `components/ErrorBoundary`. So each screen's analytics row is N/A, with no event names to list.

---

#### 1. SplashScreen (login) — `screens/SplashScreen/**`
Tally v3: 35 present / 1 partial / 0 missing / 1 blocked-external / 1 device-check / 1 n-a [v2: 32 / 6 / 0 / 0 / 1]

Note: RN has no carousel in this folder. The 17 files are SplashScreen, EmailLogin, OtpVerification, OtpInput, TermsAndAgreementModal, plus their styles, types and tests. Google and Apple login live in `hooks/useGoogleLogin.ts`, `hooks/useAppleLogin.ts` and `components/Button/*LoginButton`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Lottie splash plays frames 0→200, then freezes at 0.99 | SplashScreen.tsx | features/auth/presentation/login_screen.dart | PRESENT | Same frame math. |
| Status bar hidden during the animation; dark-content 1s after it ends | SplashScreen.tsx | login_screen.dart (`SystemUiOverlayStyle.light`) | PARTIAL | v3: hiding now ported — `hideStatusBarForSplash` on /splash and on a sign-out replay (launch_splash.dart:20-31,88-92; login_screen.dart:184-187). Remaining: login wraps itself in `SystemUiOverlayStyle.light` (login_screen.dart:450-451) where RN sets `dark-content` 1s after the animation (SplashScreen.tsx:236-239). |
| Signed-in user still sees the Lottie, then is routed | SplashScreen.tsx | core/routing/app_router.dart (`_LaunchScreen`, `computeRedirect`) | PRESENT | v3: `/splash` plays the Lottie on every cold start (launch_splash.dart:72-110) and the router holds it until `finished` and `/users/me` settles (app_router.dart:93-95) (e063d45). |
| `checkAuth()` on launch: GET /users/me + /authorization/permissions; any failure → logout | hooks/useUser.ts | core/auth/auth_state.dart (`_restore`), features/account/data/account_repository.dart (`currentUserProvider`), core/permissions/permissions_repository.dart | PRESENT | v3: splash waits for `/users/me` (app_router.dart:93-95, 149). Only a 401 logs out; other failures keep the session — documented team decision (app_router.dart:88-92; app_shell_screen.dart:99-101 offers retry for permissions). |
| Sheet slides up 60% and greeting fades in ("greetingLine1", "welcome" + appName) | SplashScreen.tsx | login_screen.dart (`_buildSheet`, `_buildTitle`) | PRESENT | |
| Gradient behind the sheet once it is fully open | SplashScreen.tsx | login_screen.dart (`_buildHeroGradient`) | PRESENT | |
| **Force-update modal** (`useForceUpdate`: minimumSupportedVersion > app version → blocking `ForceUpdateModal`, "Update" opens the store, all routing suppressed) | SplashScreen.tsx, hooks/useForceUpdate.ts, components/ForceUpdateModal | core/app_update/force_update.dart (`/app-version/{ios,android}`, `isVersionLower`), core/app_update/force_update_modal.dart (`ForceUpdateGate` over the whole app, main.dart:132) | PRESENT | v2: landed in 0885d07. |
| Post-auth routing: `profileCompleted === false` → CompleteProfile | SplashScreen.tsx | core/routing/app_router.dart (`computeRedirect`) | PRESENT | Router gate; null profileCompleted waits. |
| Post-auth routing: VIEW_COUNSELOR_CHAT → active-chat check → Listening, else CallLog | SplashScreen.tsx, hooks/useCounselorChat.ts | main.dart (auth listener), core/chat/active_chat_discovery.dart | PRESENT | Routes to `/scribe` or `/conference-listening/:id`. |
| Otherwise → CALL_LOG (drawer + tabs) | SplashScreen.tsx | app_router.dart → `/home` (core/navigation/app_shell_screen.dart) | PRESENT | |
| Hardware back on the OTP step → email step | SplashScreen.tsx (`useHardwareBackPressHandler`) | login_screen.dart (`PopScope`, `_backToEmail`) | PRESENT | |
| Back-arrow button on the OTP step | SplashScreen.tsx | login_screen.dart (`_buildBackButton`) | PRESENT | |
| Tap outside dismisses the keyboard | SplashScreen.tsx | login_screen.dart (GestureDetector unfocus) | PRESENT | |
| Email input: label, lowercase + trim as you type, email keyboard, no autocorrect, return=go submits | components/EmailLogin/EmailLogin.tsx | login_screen.dart (`_buildEmailInput`, `_EmailInputFormatter`) | PRESENT | |
| "Next" disabled until the email is valid; spinner while sending OTP | EmailLogin.tsx | login_screen.dart | PRESENT | Same regex. |
| generateOtp failure → Alert "auth.login.errors.sendOtpFailed" / "common.checkInternet" (network) / backend msg / "common.unknownError" | EmailLogin.tsx | login_screen.dart (`_showSendOtpFailedAlert`) | PRESENT | |
| "OR" divider | EmailLogin.tsx | login_screen.dart | PRESENT | |
| Google Sign-In button (signOut first, idToken → POST google login, allowedRoles) | EmailLogin.tsx, hooks/useGoogleLogin.ts | login_screen.dart (`_signInWithGoogle`, `_GoogleLoginButton`), features/auth/data/auth_repository.dart | BLOCKED-EXTERNAL | v3 (normalised: web client id needs the `ENV_VALUES_*` CI secret, §9 r16; then device check): prod flavor = RN identity (afdccc1); iOS client ids in ios/Flutter/prod.xcconfig, `GIDClientID`/URL schemes in Info.plist:28-42; web client id from RN .env via `--dart-define-from-file` (build-android-production.yml:139). `AppConfig.googleWebClientId` still defaults to `''` (app_config.dart:81-84) so a build without the .env disables it. Confirm sign-in on device. |
| Google SDK errors: cancel/in-progress silent; toast "Google Play Services not available or outdated"; other → toast with `err.message` | hooks/useGoogleLogin.ts | login_screen.dart | PRESENT | v3: `googleSignInErrorToast` — cancel silent, Android provider-config → "Google Play Services not available or outdated", else SDK description or fallback (login_screen.dart:71-79, 295-297). |
| Apple Sign-In (iOS only; email + fullName scopes; identityToken/authorizationCode/fullName) | EmailLogin.tsx, hooks/useAppleLogin.ts | login_screen.dart (`_signInWithApple`, `_AppleLoginButton`), auth_repository.dart | DEVICE-CHECK | v3: code unchanged and complete; `com.apple.developer.applesignin` in Runner.entitlements:10-13. Only on-device confirmation remains. |
| Apple SDK errors: cancel silent; others → toast with `err.message` | hooks/useAppleLogin.ts | login_screen.dart | PRESENT | v3: `appleSignInErrorToast` — cancel silent, else SDK `message` or fallback (login_screen.dart:84-87, 325-327). |
| Backend social-login error: suspended → SuspendedAccount; else toast with backend message or fallback | useGoogleLogin.ts, useAppleLogin.ts | login_screen.dart (`_handleSocialLoginError`) | PRESENT | v3: now `context.go('/suspended')` (replace), toast via `getErrorDetails` (login_screen.dart:256-267). |
| All inputs and buttons disabled while any login is loading | EmailLogin.tsx | login_screen.dart (`_isLoading`) | PRESENT | |
| Footer "By proceeding… Terms & Conditions … Privacy Policy" links open URLs | EmailLogin.tsx | login_screen.dart (`_buildTermsFooter`) | PRESENT | |
| Terms modal shown after social login, before tokens are stored | EmailLogin.tsx | login_screen.dart (`_completeSocialLogin`) | PRESENT | |
| OTP header "enterCode" + email | components/OtpVerification/OtpVerification.tsx | login_screen.dart (`_buildOtpStep`) | PRESENT | |
| 4-box OTP input: digits only, paste-fill, backspace to the previous box, dash in empty boxes | components/OtpInput/OtpInput.tsx | login_screen.dart (`_OtpInput`) | PRESENT | Single hidden field. Also adds iOS one-time-code autofill. |
| Error state: red box outlines + backend message box | OtpVerification.tsx, OtpInput.tsx | login_screen.dart | PRESENT | |
| Expiry text using minutes from `expiresIn` (default 10) | OtpVerification.tsx | login_screen.dart (expires_one/expires_other) | PRESENT | Flutter copy says "N minute(s)". RN's en string omits the unit. |
| Resend link with 60s countdown, disabled while counting or resending; resets OTP and expiry, refocuses the input | OtpVerification.tsx | login_screen.dart (`_resendOtp`, `_startResendCountdown`) | PRESENT | |
| Resend failure → error toast | OtpVerification.tsx | login_screen.dart | PRESENT | v3: `showToast(getErrorDetails(e).message, error)` (login_screen.dart:394-395). |
| Verify disabled until 4 digits or while the terms modal is up; spinner | OtpVerification.tsx | login_screen.dart | PRESENT | |
| 403 USER_SUSPENDED on verify → SuspendedAccount | OtpVerification.tsx, utils/error.ts | login_screen.dart (`_isSuspendedUserError`) | PRESENT | |
| Terms modal after OTP verify → store tokens → re-run auth routing | OtpVerification.tsx | login_screen.dart (`_verifyCode`) + auth_state.dart (`signIn`) | PRESENT | |
| TermsAndAgreementModal: non-dismissable, title, sections with bullets, bold/suffix/link segments | components/TermsAndAgreementModal/TermsAndAgreementModal.tsx | features/auth/presentation/terms_and_agreement_modal.dart | PRESENT | `PopScope(canPop:false)`. |
| "Scroll to bottom" button until scrolled (or content fits) | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Agree checkbox; Agree button enabled only when checked | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Footer link to the full T&C | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Analytics events | — | — | N/A | None in RN. |

#### 2. CompleteProfileScreen — `screens/CompleteProfileScreen/CompleteProfileScreen.tsx`
Tally v3: 7 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 7 / 0 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Title, subtitle, name label, name input (placeholder, word caps, return=go submits) | CompleteProfileScreen.tsx | features/account/presentation/complete_profile_screen.dart | PRESENT | Name only, as in RN (no phone field). |
| Submit disabled when the trimmed name is empty; spinner; input disabled while submitting | CompleteProfileScreen.tsx | complete_profile_screen.dart | PRESENT | |
| PATCH /users/me/complete-profile {name} | services/authApi.ts | features/account/data/account_repository.dart (`completeProfile`) | PRESENT | |
| Success → reset to Splash (re-runs routing incl. counsellor-chat check) | CompleteProfileScreen.tsx | complete_profile_screen.dart (invalidate user → `checkForActiveChat` → `/home`) | PRESENT | |
| Error Alert "completeProfile.errorTitle" + backend message or "errorDescription" | CompleteProfileScreen.tsx | complete_profile_screen.dart (`_showErrorAlert`) | PRESENT | |
| Gate: user cannot leave until the profile is complete | navigation/RootNavigator.tsx, SplashScreen.tsx | core/routing/app_router.dart (`computeRedirect`) | PRESENT | |
| Keyboard-aware scroll | CompleteProfileScreen.tsx | complete_profile_screen.dart (CustomScrollView in a resizing Scaffold) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 3. SuspendedAccountScreen — `screens/SuspendedAccountScreen/SuspendedAccountScreen.tsx`
Tally v3: 4 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 3 / 1 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| EmptyState: suspended icon, "suspended.title", description line1+line2 | SuspendedAccountScreen.tsx | features/suspended/presentation/suspended_account_screen.dart | PRESENT | Flutter adds a missing space between the lines (fixes an RN typo). |
| "Go to login" outlined pill → reset to Splash | SuspendedAccountScreen.tsx | suspended_account_screen.dart (logout + `go('/login')`) | PRESENT | |
| Reached from OTP / Google / Apple suspended errors | OtpVerification.tsx, useGoogleLogin.ts, useAppleLogin.ts | features/auth/presentation/login_screen.dart; app_router.dart allows `/suspended` while signed out | PRESENT | |
| Navigation uses `replace`, so back cannot return to the login form | same | login_screen.dart (`context.push('/suspended')`) | PRESENT | v3: `context.go('/suspended')` at login_screen.dart:264 and :414 replaces the login route (e063d45). |
| Suspension detected mid-session (403 on any API) | — | — | N/A | RN does not handle this either. |
| Analytics events | — | — | N/A | None. |

#### 4. Drawer — `navigation/DrawerNavigator.tsx` + `screens/LogoutScreen/components/CustomDrawerContent.tsx`, `MenuOption/`
Tally v3: 11 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 11 / 0 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Front-type drawer, 85% width, white, no header | DrawerNavigator.tsx | core/navigation/app_drawer.dart, core/navigation/app_shell_screen.dart (`Scaffold.drawer`) | PRESENT | |
| Opened by the hamburger, shown only on the first visible tab (`useTabScreenHeader` showHamburger=isFirstTab) | hooks/useTabScreenHeader.ts, components/TabScreenHeader | core/navigation/drawer_menu_button.dart (`DrawerMenuScope`), app_shell_screen.dart | PRESENT | |
| Edge-swipe to open (react-navigation default swipeEnabled) | DrawerNavigator.tsx | app_shell_screen.dart (Scaffold default drag gesture) | PRESENT | |
| Org logo (tenant logoUrl, falls back to the first letter on error) + separator | CustomDrawerContent.tsx | app_drawer.dart (`_OrgLogo`, `tenantInfoProvider`) | PRESENT | |
| User block: avatar (image or initial), name (2 lines), email (9pt when >30 chars) | CustomDrawerContent.tsx | app_drawer.dart (`_UserProfileAvatar`) | PRESENT | |
| Credit usage (gate EDIT_SCENARIO_SESSION): bolt, consumed/limit, %, bar red when low | CustomDrawerContent.tsx, hooks/useSimulationCredits.ts | app_drawer.dart (`_CreditsSection`, `simulationCreditsProvider`) | PRESENT | |
| Menu "Profile settings" → close drawer → ProfileSettings | CustomDrawerContent.tsx | app_drawer.dart → `/profile` | PRESENT | |
| Menu "Report a problem" → close drawer → BugReport | CustomDrawerContent.tsx | app_drawer.dart → `/bug-report` (extra = active tab name) | PRESENT | |
| Menu "Logout" → LogoutModal | CustomDrawerContent.tsx, DrawerNavigator.tsx | app_drawer.dart (`_confirmLogout`) | PRESENT | |
| Version footer "Version: x.y.z (Dev)" | CustomDrawerContent.tsx | app_drawer.dart (`_VersionFooter`, `drawerVersionLabel`) | PRESENT | |
| Ally logo badge | CustomDrawerContent.tsx | app_drawer.dart | PRESENT | |
| Analytics events | — | — | N/A | None. |

The drawer has exactly these three items in RN. Flutter's `/preferences` route (features/preferences) is not reachable from the drawer, which matches RN.

#### 5. LogoutModal (presented from the drawer) — `screens/LogoutScreen/components/LogoutModal.tsx`
Tally v3: 5 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 5 / 0 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| IllustratedModal: logOut image, title normal + italic, "nav.logout.content", red "nav.logout.button", X to cancel | LogoutModal.tsx | core/navigation/app_drawer.dart (`_confirmLogout`), core/widgets/illustrated_modal.dart | PRESENT | |
| **Logout side effect: unregister this device's FCM token** (DELETE device token, then `messaging().deleteToken()`) | hooks/useUser.ts (`handleUserLogout`), services/pushNotificationService.ts (`unregisterDeviceForPush`) | core/auth/auth_state.dart:70-78 (`logout` → `PushNotificationService.unregister`), core/push/push_notification_service.dart:237-260 | PRESENT | v2: landed in 98b9518. Best-effort, skipped on 401 like RN. |
| Logout side effect: clear tokens, set unauthenticated, clear user and permissions | store/slices/userSlice.ts (`handleLogout`) | core/auth/auth_state.dart (`logout`) | PRESENT | |
| Logout side effect: `api.util.resetApiState()` drops cached data | hooks/useUser.ts | core/network/api_client.dart (`apiClientProvider` watches auth, so dependent providers rebuild) | PRESENT | |
| Navigator swaps to the auth stack (login) | navigation/RootNavigator.tsx | core/routing/app_router.dart (redirect on auth change) | PRESENT | |
| Weekly leaderboard reminder on logout | — | core/push/leaderboard_notification.dart (cancels on sign-out) | N/A | Flutter-only, deliberate. RN never cancels. |
| Analytics events | — | — | N/A | None. |

#### 6. ProfileSettingsScreen — `screens/ProfileSettingsScreen/**`, `hooks/useProfileImage.ts`, `hooks/useLeaderboardNotification.ts`, `components/LanguageSelectorSheet`
Tally v3: 16 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 4 n-a [v2: 14 / 2 / 0 / 0 / 4]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back arrow + "profile.settings.title" | ProfileSettingsScreen.tsx | features/account/presentation/profile_settings_screen.dart (`BackTitleHeader`) | PRESENT | |
| Back with unsaved photo change → CustomModal "common.unsavedChanges" (Discard red / Cancel) → reset + goBack | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_handleBack`, core/widgets/confirmation_modal.dart) | PRESENT | |
| System back with unsaved changes | ProfileSettingsScreen.tsx (no handler; Android back discards silently) | profile_settings_screen.dart (`PopScope`) | PRESENT | Flutter also guards system back, a small improvement. |
| Avatar 116pt (image or initial on lightGray2); spinner overlay while saving | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_ProfileImageSection`) | PRESENT | |
| Upload hint text | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| "Upload Image" link opens the image sheet (disabled while saving) | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| Image sheet: title, "Change"/"Upload" option, "Remove" when an image exists | components/ProfileImageBottomSheet.tsx | features/account/presentation/profile_image_options_sheet.dart | PRESENT | |
| Gallery pick: quality 0.8, max 800×800, **jpeg/png only** | hooks/useProfileImage.ts | profile_settings_screen.dart (`_pickImage`, image_picker) | PRESENT | v3: non-jpeg/png picks are re-encoded to PNG before upload (profile_settings_screen.dart:30-34, 138-151) — image_picker cannot filter by MIME (28ff515). |
| Validation toasts: >2MB "Image size must be less than 2MB…", non-square "Image must be square…" | useProfileImage.ts | profile_settings_screen.dart | PRESENT | Prefixed with "errors.uploadProfileImage". |
| Save button only while unsaved; upload = presign → S3 PUT → PATCH URL → best-effort delete of the old image | useProfileImage.ts | profile_settings_screen.dart (`_save`), features/account/data/account_repository.dart (`uploadProfileImage`) | PRESENT | |
| Remove + Save → DELETE old image, PATCH '' | useProfileImage.ts | profile_settings_screen.dart, account_repository.dart | PRESENT | |
| Save error → toast "errors.uploadProfileImage" | useProfileImage.ts | profile_settings_screen.dart (`_showErrorToast`) | PRESENT | |
| Read-only Name and Email fields ("—" when empty) | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_Field`) | PRESENT | |
| Language row, gated by `env.LANGUAGE_SELECTOR_FLAG` | ProfileSettingsScreen.tsx, config/env.ts | profile_settings_screen.dart (`_LanguageField`) | PRESENT | v3: row inside `if (AppConfig.languageSelectorEnabled)` (profile_settings_screen.dart:318-320). |
| Language sheet: en/hi/mr/ta/kn, selected dot, persist, forceRTL, **reset the API cache so localized content refetches** | components/LanguageSelectorSheet/LanguageSelectorSheet.tsx, services/api.ts + languageCodeEndpoints.ts | features/account/presentation/language_selector_sheet.dart, core/network/api_client.dart:46-52 (rebuilds the client on a language switch), core/network/language_code_interceptor.dart (RN allowlist) | PRESENT | v2: `languageCode` injected on the RN endpoint list and loaded content refetches after a switch (249653c). |
| Leaderboard notification toggle (LEARNER only): persisted, schedules/cancels the weekly reminder | ProfileSettingsScreen.tsx, hooks/useLeaderboardNotification.ts | profile_settings_screen.dart (`LeaderboardNotificationToggleRow`), core/push/leaderboard_notification.dart | PRESENT | |
| Loading and error states for the user record | — (RN reads Redux user) | profile_settings_screen.dart | N/A | Flutter-only states. |
| Delete account | — | — | N/A | Not in RN. |
| Logout from this screen | — | — | N/A | RN only offers logout in the drawer. |
| Analytics events | — | — | N/A | None. |

#### 7. BugReportScreen — `screens/BugReportScreen/BugReportScreen.tsx`, `hooks/useBugReport.ts`, `utils/bugReportContext.ts`
Tally v3: 11 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 9 / 2 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: LeftArrowIcon + ReplayPro "bugReport.title", bottom border | BugReportScreen.tsx | features/bugreport/presentation/bug_report_screen.dart | PRESENT | v3: `BackTitleHeader` with 16pt padding, 0.5 strokePrimary border (bug_report_screen.dart:107-115) (dbd2148). |
| Prompt text | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Multiline input: placeholder, maxLength 1000, disabled while submitting | BugReportScreen.tsx | bug_report_screen.dart (`AppTextField`) | PRESENT | |
| Character counter "n/1000" | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Submit pinned in a bottom footer; disabled until the trimmed text is non-empty and ≤1000; spinner | BugReportScreen.tsx, useBugReport.ts | bug_report_screen.dart | PRESENT | v3: footer pinned under the scroll view, keyboard-aware (bug_report_screen.dart:98-104, 172ff). |
| Silent context: screen, appVersion, device, os, clientTimestamp | utils/bugReportContext.ts | features/bugreport/data/bug_report_repository.dart | PRESENT | |
| Previous screen name (deepest active route) | BugReportScreen.tsx | core/navigation/app_drawer.dart passes `activeTabName` | PRESENT | |
| Success → toast "bugReport.successMessage", clear, goBack | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| HTTP 429 → toast "bugReport.rateLimitMessage" | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| Other errors → error toast "errors.submitBugReport" | useBugReport.ts | bug_report_screen.dart | PRESENT | v3: `showErrorToast(e, 'errors.submitBugReport')` via getErrorDetails; no raw exception text (bug_report_screen.dart:79). |
| Keyboard avoidance | BugReportScreen.tsx | bug_report_screen.dart (Scaffold resize) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 8. NotificationsScreen — `screens/NotificationsScreen/NotificationsScreen.tsx`
Tally v3: 11 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 11 / 0 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: reminder push tap without a "Simulations" hint → Notifications (no in-app entry in RN) | utils/notificationNavigation.ts | core/push/notification_navigation.dart (`reminderRouteFor`), app_router `/notifications` | PRESENT | |
| Header: back + "Notifications" + "Mark all read" only when something is unread | NotificationsScreen.tsx | features/notifications/presentation/notifications_screen.dart | PRESENT | Flutter's title and button are translated; RN hardcodes English. |
| Hardware back → goBack | NotificationsScreen.tsx | default route pop | PRESENT | |
| Initial loading spinner | NotificationsScreen.tsx | notifications_screen.dart | PRESENT | |
| Empty: "You're all caught up — no notifications yet." | NotificationsScreen.tsx | notifications_screen.dart ("notifications.empty") | PRESENT | |
| Error state | — | notifications_screen.dart | N/A | RN has none and shows the empty state. v3: Flutter shows translated "notifications.loadError" (notifications_screen.dart:159), no raw error. |
| Row: title, body (max 3 lines), timeAgo ("just now", "Xm/h/d ago", date) | NotificationsScreen.tsx | notifications_screen.dart:205-240 | PRESENT | v2: body `maxLines: 3` (notifications_screen.dart:237), RN text styles. |
| Unread styling: blue dot + tinted row background | NotificationsScreen.tsx, styles.ts | notifications_screen.dart:205-230 | PRESENT | v2: grey50 row background + 8pt primary dot (`unread-dot`). |
| Tap → mark read | NotificationsScreen.tsx | notifications_screen.dart (`_onItemTap`) | PRESENT | Invalidates the whole list, so pagination resets to page 1. |
| Tap course-discussion reply → CourseItemPlayer(trackId, itemId, highlightPostId) | NotificationsScreen.tsx | notifications_screen.dart:75-84 → `/courses/item/:itemId` with `CourseItemPlayerArgs(trackId, highlightPostId)` | PRESENT | v2: opens the item and highlights the post. |
| Infinite scroll, page size 25 | NotificationsScreen.tsx | features/notifications/data/notifications_repository.dart (`NotificationsController.loadMore`) | PRESENT | |
| Pull-to-refresh | NotificationsScreen.tsx | notifications_screen.dart (RefreshIndicator) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 9. AchievementsScreen — `screens/AchievementsScreen/**`
Tally v3: 10 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 10 / 0 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back arrow + "achievements.title" (also shown when it is a tab) | AchievementsScreen.tsx | features/achievements/presentation/achievements_screen.dart (`BackTitleHeader`) | PRESENT | |
| Back (button or hardware) → goBack | AchievementsScreen.tsx | achievements_screen.dart (pops if it can) | PRESENT | As a tab, see the TabNavigator back row. |
| Fetch gated on VIEW_USER_BADGES (skip) | AchievementsScreen.tsx | features/achievements/data/achievements_repository.dart (`badgesProvider`) | PRESENT | |
| "Badges" label + info tooltip ("achievements.badgesTooltip") | AchievementsScreen.tsx | achievements_screen.dart (`InfoTooltipIcon`) | PRESENT | |
| All / Unlocked filter TabView | AchievementsScreen.tsx | achievements_screen.dart (`AppTabView`) | PRESENT | |
| Category sections: translated label (BADGE_CATEGORY_MAP), tooltip, rule line | AchievementsScreen.tsx, utils | achievements_screen.dart (`_CategorySection`, `_badgeCategorySlugs`) | PRESENT | |
| AchievementCard: locked icon or badge image, name, description, locked colours | components/AchievementCard.tsx | achievements_screen.dart (`_AchievementCard`) | PRESENT | |
| Loading spinner, error text, empty text | AchievementsScreen.tsx | achievements_screen.dart | PRESENT | |
| Localized badge text (`languageCode` injected on `getAvailableBadges`) | services/api.ts, services/languageCodeEndpoints.ts | core/network/language_code_interceptor.dart (`getAvailableBadges`) | PRESENT | v2: injected centrally. |
| Tap card → mark badge viewed | — | achievements_screen.dart | N/A | v3: Flutter-only tap removed; a badge is marked viewed only by closing its popup, as RN (achievements_screen.dart:32). Badge art now `BadgeNetworkImage` (SVG + spinner, achievements_screen.dart:283-289). |
| Badge-unlock celebration popup (global `BadgePopup`/`useBadgePopup`, marks viewed on dismiss) | components/BadgePopup, hooks/useBadgePopup.ts | features/achievements/presentation/badge_popup.dart (`BadgePopupHost`, confetti, poll + `PATCH …/viewed`), hosted in core/navigation/app_shell_screen.dart | PRESENT | v2: landed in a5d3ce7/557dc55. Active on Learn tab, and Review tab for reviewer-only users, as RN. |
| Analytics events | — | — | N/A | None. |

#### 10. ProgressScreen — `screens/ProgressScreen/ProgressScreen.tsx`, `hooks/useProgressSummary.ts`, `components/ProgressHeaderWidget`
Tally v3: 10 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 7 / 3 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: level ring in every TabScreenHeader → Progress (hidden on Progress itself) | components/ProgressHeaderWidget/ProgressHeaderWidget.tsx | features/progress/presentation/progress_header_widget.dart, core/widgets/tab_screen_header.dart | PRESENT | |
| Gate: VIEW_USER_RANK AND org progress-enabled | hooks/useProgressSummary.ts | features/progress/data/progress_repository.dart (`canViewProgressProvider`) | PRESENT | |
| Header "progress.title" | ProgressScreen.tsx | features/progress/presentation/progress_screen.dart | PRESENT | |
| Hero: LevelIndicator (a11y "progress.a11y.level"), "hero.level", "hero.toNextLevel" / "hero.maxLevel", progress bar, "hero.xpTotal" | ProgressScreen.tsx | progress_screen.dart (`_Hero`) | PRESENT | |
| Stats: lifetime minutes, sessions, track items | ProgressScreen.tsx | progress_screen.dart (`_StatsGrid`) | PRESENT | |
| Link "progress.rank.link" → Leaderboard (tab jump; does nothing without leaderboard permission) | ProgressScreen.tsx | progress_screen.dart → `push('/leaderboard')` | PRESENT | v3: `goToHomeTab(kTabLeaderboard)`, no-op without VIEW_COMMUNITY_LEADERBOARD (progress_screen.dart:62-66, 86-90) (baa67dd). |
| Link "progress.badges.link" → Achievements | ProgressScreen.tsx | progress_screen.dart → `/achievements` | PRESENT | |
| When the gate is false RN still renders both link cards | ProgressScreen.tsx | progress_screen.dart (`dashboard == null` → blank) | PRESENT | v3: hero/stats only when `dashboard != null`, both link cards always (progress_screen.dart:53-73). |
| Loading; error shown before empty | ProgressScreen.tsx | progress_screen.dart | PRESENT | |
| Refetch on every mount (`refetchOnMountOrArgChange`) | ProgressScreen.tsx | progress_repository.dart (`progressDashboardProvider`, not autoDispose) | PRESENT | v3: `progressDashboardProvider` is `FutureProvider.autoDispose` (progress_repository.dart:157). |
| `useTabBackToHomeHandler` on this stack screen | ProgressScreen.tsx | default pop | N/A | Equivalent effect: back leaves Progress. |
| Analytics events | — | — | N/A | None. |

#### 11. UserAnalyticsScreen (tab) — `screens/UserAnalyticsScreen/UserAnalyticsScreen.tsx`
Tally v3: 12 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 11 / 1 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_ANALYTICS_DASHBOARD | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| GET /analytics/dashboard once the user id is known; refetch on mount | UserAnalyticsScreen.tsx | features/analytics/data/analytics_repository.dart (`dashboardsProvider`) | PRESENT | |
| Full-screen spinner while loading (no header) | UserAnalyticsScreen.tsx | features/analytics/presentation/user_analytics_screen.dart | PRESENT | |
| Error → centred "analytics.empty.description" | UserAnalyticsScreen.tsx | user_analytics_screen.dart | PRESENT | |
| Header: "analytics.title" + subtitle "analytics.dashboardTitle" | UserAnalyticsScreen.tsx | user_analytics_screen.dart (`TabScreenHeader`) | PRESENT | |
| Empty state: DataUnavailable icon, title, description | UserAnalyticsScreen.tsx | user_analytics_screen.dart (`AppEmptyState`) | PRESENT | |
| Call logs / Simulations TabView, only when both types exist | UserAnalyticsScreen.tsx | user_analytics_screen.dart (`AppTabView`) | PRESENT | Edge case: Flutter counts unknown `analyticsType` values toward "both"; RN ignores them. |
| Lock to the single type when only one exists | UserAnalyticsScreen.tsx | user_analytics_screen.dart (`effectiveTab`) | PRESENT | |
| Per-dashboard embed URL (GET /analytics/dashboard/:id) → square WebView | UserAnalyticsScreen.tsx | user_analytics_screen.dart (`_DashboardWebView`, `dashboardUrlProvider`) | PRESENT | |
| WebView `startInLoadingState` spinner; a failed URL is silently omitted | UserAnalyticsScreen.tsx | user_analytics_screen.dart | PRESENT | v3: white cover + spinner until `onPageFinished`/main-frame error (user_analytics_screen.dart:165-223); failed URLs omitted, spinner until one resolves (:88-97, 119-121) (6ddc45a). |
| Reset URLs when the user changes | UserAnalyticsScreen.tsx | analytics_repository.dart (provider rebuilds on auth or user change) | PRESENT | |
| Android back on the tab → first visible tab (`useTabBackToHomeHandler`) | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 (`PopScope`) | PRESENT | v2: one shell-level fix. |
| Analytics events | — | — | N/A | None. |

#### 12. LeaderboardScreen (tab) — `screens/LeaderboardScreen/LeaderboardScreen.tsx`, `hooks/useLeaderboard.ts`
Tally v3: 14 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 14 / 0 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_COMMUNITY_LEADERBOARD | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Header "community.title" + info tooltip (title + "achievements.badgeTooltipDescription") + "N Badges" button → Achievements | LeaderboardScreen.tsx | features/leaderboard/presentation/leaderboard_screen.dart (`TabScreenHeader` tooltip/trailing, `_BadgesButton`) | PRESENT | |
| Period dropdown: last 7 / 28 / 364 days / all time, default last week | LeaderboardScreen.tsx, constants/leaderboard.ts | leaderboard_screen.dart (`_PeriodDropdown`), features/leaderboard/data/leaderboard_repository.dart (`leaderboardWindowProvider`) | PRESENT | |
| Table header (rank / user / total duration / badges); rank column hidden when `hideRankInCommunity` | LeaderboardScreen.tsx | leaderboard_screen.dart (`_TableHeaderRow`) | PRESENT | |
| Row: medal SVGs for ranks 1–3, number otherwise; avatar or initial; name; "Xh Ymin"; badge count | LeaderboardScreen.tsx | leaderboard_screen.dart (`_RankBadge`, `_LeaderboardAvatar`, `_formatDuration`) | PRESENT | |
| Current user's row highlighted in place | LeaderboardScreen.tsx | leaderboard_screen.dart | PRESENT | |
| Sticky footer with the current user's row while it is below the viewport | LeaderboardScreen.tsx | leaderboard_screen.dart | PRESENT | Uses a fixed row-height constant instead of a measured one. |
| Pagination, limit 30, dedupe by userId | useLeaderboard.ts | leaderboard_repository.dart (`LeaderboardController.loadMore`) | PRESENT | |
| Pull-to-refresh | LeaderboardScreen.tsx | leaderboard_screen.dart | PRESENT | |
| Footer loader while loading more | LeaderboardScreen.tsx | leaderboard_screen.dart | PRESENT | |
| Loading spinner; empty "community.emptyLeaderboard" + description (also shown on error) | LeaderboardScreen.tsx | leaderboard_screen.dart (`_LeaderboardLoading`, `_LeaderboardEmpty`) | PRESENT | |
| My-rank refetch on every screen focus (`useFocusEffect` → refetchMyRank) | useLeaderboard.ts | leaderboard_screen.dart:277-278 (`ScreenFocusListener` → `invalidate(myRankProvider)`) | PRESENT | v2. |
| Localized content (`languageCode` on `getLeaderboard`) | services/languageCodeEndpoints.ts | core/network/language_code_interceptor.dart | PRESENT | v2: injected centrally. |
| Weekly leaderboard notification tap → jump to the Leaderboard tab | navigation/RootNavigator.tsx | core/push/notification_navigation.dart:50 → `homeTabLocation(kTabLeaderboard)` | PRESENT | v2: selects the tab. |
| Analytics events | — | — | N/A | None. |

#### 13. CommunityScreen (tab) — `screens/CommunityScreen/CommunityScreen.tsx`
Tally v3: 3 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 1 n-a [v2: 2 / 1 / 0 / 0 / 1]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_COMMUNITY | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| **On every focus**: goBack (to the previous tab) + open https://community.helloally.ai/ externally | CommunityScreen.tsx (`useFocusEffect`) | features/community/presentation/community_screen.dart (`initState` post-frame) | PRESENT | v3: shell `_selectTab` opens the site on every Community tap and reselects the first tab (app_shell_screen.dart:75-89; community_screen.dart:15-21). When Community is the only/first tab it opens once on mount (community_screen.dart:36-40), as RN `goBack` has nowhere to go. |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: shell `PopScope`. |
| Analytics events | — | — | N/A | None. |

#### 14. SearchScreen (tab) — `screens/SearchScreen/**`, `hooks/useSearch.ts`, `components/ResourceArticleCard`
Tally v3: 15 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 13 / 2 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_REFERENCE_DOCUMENT (also the fallback first tab) | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Launch view: header with Ally logo (+ hamburger if first tab), search input, "search.suggestionsTitle" + 4 suggestion chips | SearchScreen.tsx, components/SearchHeader.tsx, SearchSuggestions.tsx, searchConfig.ts | features/search/presentation/search_screen.dart (`_buildSearchLaunch`, `_SearchHeader`, `_SuggestionChip`) | PRESENT | |
| Focus animation: header up 60, input up 50, over 300ms; suggestions hidden while focused | SearchScreen.tsx | search_screen.dart (TweenAnimationBuilder) | PRESENT | The class doc saying "not ported" is stale; the code does it. |
| Tap outside → dismiss keyboard and unfocus | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Autocomplete dropdown under the input while typing | components/SearchInput.tsx, useSearch.ts | search_screen.dart (`_SearchBar`, `_onTextChanged`) | PRESENT | Divergence: Flutter filters with a 250ms debounce. RN never calls `debounceSearch`, so it always lists all 4. |
| Suggestion tap → search | useSearch.ts | search_screen.dart (`_search`) | PRESENT | |
| Submit → POST search (limit 6), category counts | useSearch.ts | features/search/data/search_repository.dart (pageSize 6) | PRESENT | |
| Clear (X) → reset search state | SearchInput.tsx, useSearch.ts (`resetSearch`) | search_screen.dart (`_resetSearch`) | PRESENT | v3: `_resetSearch` clears query/results but stays on the results view (search_screen.dart:185-200), as RN `resetSearch` (3e47357). |
| Category tabs "All (n)" + "Category (n)", shown when there are results | SearchScreen.tsx (CustomTabs) | search_screen.dart (ChoiceChip row) | PRESENT | v3: RN CustomTabs port `_CategoryTabs` (search_screen.dart:390ff), no longer ChoiceChips. |
| Category change → refetch with `filters.category`, scroll to top | useSearch.ts | search_screen.dart (`_selectCategory`) | PRESENT | |
| Infinite scroll via `excludedIds` | useSearch.ts | search_screen.dart (`_loadMore`) | PRESENT | |
| Initial loader and footer loader | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Empty: 'search.noResults "query"' + suggestions | components/SearchEmpty.tsx | search_screen.dart | PRESENT | |
| **Result card** (ResourceArticleCard): category chip, horizontal tag chips, heading, 3-line content, "common.viewMore" expand/collapse | components/ResourceArticleCard | search_screen.dart (plain `ListTile`) | PRESENT | v3: features/search/presentation/resource_article_card.dart (category chip, tags, heading, 3-line content, downArrow.svg expand, "common.viewMore"), used at search_screen.dart:339; underline `_CategoryTabs` (search_screen.dart:390-394). |
| Error handling | useSearch.ts (logs, shows the empty state) | search_screen.dart (red "search.error: $e") | N/A | v3: Flutter now only logs, as RN (search_screen.dart:151). |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: shell `PopScope`. |
| Analytics events | — | — | N/A | None. |

#### 15. ReactionsScreen — `screens/ReactionsScreen/**`, `hooks/useReactions.ts`
Tally v3: 9 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 2 n-a [v2: 9 / 0 / 0 / 0 / 2]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: ReactionsCount on a review → Reactions {reviewId, reviewType} | screens/ReviewScreen/components/ReactionsCount.tsx | features/reviews/presentation/review_card.dart → `/reactions/:id` (on `parity/reviews` this moves to review_widgets.dart:667) | PRESENT | |
| Simulation vs scribe API by reviewType | ReactionsScreen.tsx (ReviewApiProvider) | features/reactions/presentation/reactions_screen.dart, features/reactions/data/reactions_repository.dart | PRESENT | |
| Header: back + "review.reactionsModal.title" | ReactionsScreen.tsx | reactions_screen.dart (AppBar) | PRESENT | v3: `BackTitleHeader` (reactions_screen.dart:128), no Material AppBar. |
| Filter tabs: "All {total}" + emoji bubble with count, zero counts dropped, sorted by count descending, underline on the selected tab | components/ReactionFilterTabs.tsx | reactions_screen.dart (`_buildFilterTabs`, `_FilterTab`) | PRESENT | Flutter hides the whole row (including "All") while counts load or when empty. |
| Row: avatar or initial with an emoji bubble overlay, name | components/ReactionListItem.tsx | reactions_screen.dart (`_ReactionRow`) | PRESENT | |
| Pagination: 20 per page, threshold 0.3 | useReactions.ts | reactions_screen.dart (`_onScroll`) | PRESENT | |
| Filter change resets to offset 0 | useReactions.ts | reactions_screen.dart (`_selectReaction`, generation guard) | PRESENT | |
| Footer loader | ReactionsScreen.tsx | reactions_screen.dart | PRESENT | |
| Empty "review.reactionsModal.noReactionsYet" | ReactionsScreen.tsx | reactions_screen.dart | PRESENT | |
| Error state | — | reactions_screen.dart ("review.error.loadReactionsFailed") | N/A | Flutter-only. |
| Analytics events | — | — | N/A | None. |

#### 16. TabNavigator — `navigation/TabNavigator.tsx`, `constants/tabs.tsx`, `hooks/useTabBackToHomeHandler.ts`, `hooks/useTabScreenHeader.ts`
Tally v3: 10 present / 0 partial / 0 missing / 0 blocked-external / 0 device-check / 0 n-a [v2: 8 / 2 / 0 / 0 / 0]

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| 8 tabs (Learn, CallLog, Review, UserAnalytics, Leaderboard, Achievements, Search, Community) with active/inactive icons; shown if the user has ANY listed permission | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Achievements tab only for reviewer-only users (VIEW_USER_BADGES without VIEW_COMMUNITY_LEADERBOARD) | TabNavigator.tsx, constants/tabs.tsx | tab_config.dart (`visibleTabsFor`, `isReviewerOnly`) | PRESENT | |
| Initial tab = first visible, falls back to Search | constants/tabs.tsx | tab_config.dart (`getFirstVisibleTab`), app_shell_screen.dart | PRESENT | |
| Render nothing while the user is loading | TabNavigator.tsx | core/navigation/app_shell_screen.dart (spinner while permissions load) | PRESENT | |
| Floating pill bar (60pt, radius 40, 30pt bottom margin, shadow); wider side margins when fewer than 3 tabs | TabNavigator.tsx | core/navigation/app_bottom_tab_bar.dart | PRESENT | |
| Lazy tab mount, tabs stay mounted | TabNavigator.tsx (`lazy`) | app_shell_screen.dart (`_visitedTabNames` + IndexedStack) | PRESENT | |
| Review tab unread dot = simulation unread + scribe unread > 0 (RTK tag-invalidated when reviews are read) | TabNavigator.tsx, services/reviewsApi.ts, services/scribeReviewsApi.ts | app_shell_screen.dart, features/reviews/data/reviews_repository.dart (`unreadReviewCountProvider`) | PRESENT | v3: refetched after mark-read (review_details_screen.dart:89-93) and on Review-list refocus (review_screen.dart:274-277) (93ebfa9). |
| Android hardware back on a tab root → first visible tab instead of exiting (Search, Community, UserAnalytics) | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: back on a non-first tab → first visible tab; on the first tab → exit. |
| Hamburger only on the first visible tab's header | hooks/useTabScreenHeader.ts | core/navigation/drawer_menu_button.dart (`DrawerMenuScope`) | PRESENT | |
| Permissions fetch failure | (RN treats it as an empty permission list) | app_shell_screen.dart (raw `Text('$error')`) | PRESENT | v3: translated "common.somethingWentWrong" + Retry that invalidates `userPermissionsProvider` (app_shell_screen.dart:99-117); empty-tabs text is `home.noAccessibleTabs` (:147). RN logs out instead — documented team decision (:99-101). |




### Parity ledger — Scribe screens (CallLog, CallSummary, Listening, Breathing)

RN source of truth: `ally-platform/ally-mobile/src` @ 7a8ce0c19 (screens/CallLog, screens/CallSummaryScreen, screens/ListeningScreen, screens/BoxBreathingScreen + hooks useSummaryState, useCallSummaryActions, useCallSummaryForm, useCallTranscriptDetails, useListeningCommon, useListeningScreen, useLiveAudioStream, useSocketConnection, useSocket, useToggleReviewPrivacy, useHideReviewDetails, useScribeVoiceNoteEnabled, utils/fieldRenderer.tsx, constants/summary.ts).
Flutter: `ally-mobile-flutter` `master` at **`f770200`** (lib/features/calllog, lib/features/scribe, lib/features/boxbreathing, lib/core/realtime, lib/core/chat, lib/core/settings, lib/core/navigation, lib/core/routing/app_router.dart).
**v3 re-audit (2026-10-28):** every non-PRESENT/N/A row re-read on f770200; rows changed in v3 say `v3:` in Notes. PRESENT rows spot-checked (≈80, list in B_gaps.md (f)) with emphasis on the wave 3–6 Scribe/Conference, call-summary header/icons and toast changes — no regressions. Two new rows (S-N1, S-N2) from discovery. The `Icon sweep:` notes from v2 are all closed: every call-summary/voice-note site now renders the RN SVG/PNG. Read-only audit; nothing built or run.

#### Tallies

| Screen | PRESENT | PARTIAL | MISSING | BLOCKED-EXTERNAL | DEVICE-CHECK | N/A | Rows |
|---|---|---|---|---|---|---|---|
| CallLog | 35 [30] | 0 [3] | 0 [2] | 0 | 0 | 4 [4] | 39 [39] |
| CallSummaryScreen | 50 [49] | 2 [1] | 0 [0] | 0 | 0 | 6 [6] | 58 [56] |
| ListeningScreen (Microphone + Conference) | 46 [46] | 0 [0] | 0 [0] | 0 | 0 | 5 [5] | 51 [51] |
| BoxBreathingScreen ("Breathing") | 9 [9] | 0 [0] | 0 [0] | 0 | 0 | 1 [1] | 10 [10] |
| **Overall** | **140 [134]** | **2 [4]** | **0 [2]** | **0** | **0** | **16 [16]** | **158 [156]** |

v2 → v3: 6 status changes (C5, C6, C12, C24, C33, S44 → PRESENT), 2 new rows (S-N1, S-N2, both PARTIAL), 13 note-only updates. Device-only verification items (background mic, audio routing, export to Downloads) are listed in B_gaps.md (c); their rows stay PRESENT because the code matches RN.

(Backend-call, toast and navigation appendices under each screen are cross-references and are not counted again in the tallies.)

Analytics: RN has **no** product-analytics calls in any of these screens/hooks. Each screen gets one N/A row for this. The only telemetry-like emit is the socket `SCRIBE_START_DIAGNOSTIC` event (L37).

---

#### 1. CallLog (`screens/CallLog/**`, 26 files)

Flutter: `lib/features/calllog/presentation/call_log_screen.dart`, `call_log_row.dart`, `call_log_filter_sheet.dart`, `call_tag_chip.dart`; `lib/features/calllog/data/call_log_repository.dart`, `custom_fields_filter.dart`, `custom_fields_repository.dart`; `lib/core/settings/settings_repository.dart`; `lib/core/widgets/illustrated_modal.dart`, `status_badge.dart`, `app_empty_state.dart`, `app_tab_view.dart`, `tab_screen_header.dart`.

Tally: PRESENT 35 · PARTIAL 0 · MISSING 0 · N/A 4  [v2: 30 · 3 · 2 · 4]

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| C1 | Header title "calls.header.title" + italic subtitle | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart (TabScreenHeader) | PRESENT | |
| C2 | Archive view mode: title `calls.menu.archives`, back arrow, no subtitle, `archive:true` list | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart:411-424 (`_isViewingArchive`, leftArrow.svg) | PRESENT | |
| C3 | Actions menu (three dots → "Archives"), gated ARCHIVE_CALL_LOG + real tab + not in archive view | CallLogHeader.tsx (ActionsMenu) | call_log_screen.dart `_ActionsMenu` (:622) | PRESENT | |
| C4 | Refresh button with 600ms spin while fetching | CallLogHeader.tsx | call_log_screen.dart `_RefreshButton` (:576) | PRESENT | |
| C5 | Filter button + active-filter count badge (shown only for real/archived view + VIEW_CALL_LOGS) | CallLogHeader.tsx, utils/fieldFilters.ts `countActiveFilters` | call_log_screen.dart `_FilterButton` (:517), call_log_repository.dart `activeCount` (:413-417) | PRESENT | v3: fixed (d7964fa) — date range and duration range each count 1, as RN `hasValue` per FilterState entry. |
| C6 | Built-in filters: Date & Time (from/to), Duration (mins, min/max), Mode, Status, Channel → query params | CallLogFilterSheet.tsx:108-136 (`LineTextInput` ×2 for `date`/`number`), utils/fieldFilters.ts:197-215 `buildBuiltinParams` | call_log_filter_sheet.dart:370-393 (`AppTextField` line shape, `calls.filters.from/to`), call_log_repository.dart:460-471 `withDates`, :488-498 `toQueryParameters` | PRESENT | v3: RN's date bounds are free-text `LineTextInput`s too (v2 "date-time picker" claim was wrong). Emptied/blank box now maps to null and is not sent (RN `if (date[0])`). Minutes×60 → seconds kept. |
| C7 | Tags multiselect filter (options from GET /chats/tags, only if non-empty) | CallLogScreen.tsx, fieldFilters.ts | call_log_filter_sheet.dart `_tagsField`, call_log_repository.dart `getAllTags` | PRESENT | Flutter additionally gates on VIEW_TAGS (endpoint needs view:tags; same visible outcome). |
| C8 | Tenant custom-field filters, `fieldFilters` JSON param | fieldFilters.ts, CallLogFilterSheet.tsx | custom_fields_filter.dart, call_log_filter_sheet.dart `_customFieldsSection` | PRESENT | Only when `/settings/custom-fields-enabled` true. Class doc at call_log_screen.dart:105-108 saying custom filters are "not ported" is still stale. |
| C9 | Filter sheet draft lifecycle: reseed on open, Clear, Apply → refetch page 0 | CallLogFilterSheet.tsx, CallLogScreen.tsx | call_log_filter_sheet.dart, call_log_repository.dart `CallLogFilterController` | PRESENT | |
| C10 | Real/Role-play pill tabs only when both VIEW_CALL_LOGS and VIEW_SCENARIO_SESSION | CallLogScreen.tsx (TabView) | call_log_screen.dart:453 (AppTabView) | PRESENT | |
| C11 | `availableLogTypes` + initial-tab correction from permissions | CallLogScreen.tsx | call_log_screen.dart:358-366 | PRESENT | |
| C12 | FeatureNotAvailable state (no TAB_PERMISSIONS): "Oops" title, `calls.appCurrentlyForCounsellors`, "Learn more" → `Linking.openURL(ALLY_WEB_URL)`, Alert `common.error`/`common.unableToOpenLink` on failure | CallLogScreen.tsx:190-194, 551-557, 682-697; components/FeatureNotAvailable/FeatureNotAvailable.tsx | call_log_screen.dart:341-354 (gate on `_tabPermissions` :1011-1021 = RN TAB_PERMISSIONS), `_openLearnMore` :249-266, `_FeatureNotAvailable` :1026-1093; app_config.dart:32 `allyWebUrl` | PRESENT | v3: fixed (d7964fa). Header kept above it as RN. The old `_activeTab == null` text (:465) is now unreachable in practice. |
| C13 | Real logs: GET /chats/call-logs, limit 10, offset paging, hasMore = page==10 | CallLogScreen.tsx, services/callsApi.ts | call_log_repository.dart `RealCallLogsController` | PRESENT | |
| C14 | Simulation logs: GET /learn/scenario-sessions limit/offset | CallLogScreen.tsx, simulationsApi.ts | call_log_repository.dart `SimulationLogsController` | PRESENT | |
| C15 | Archived logs list (separate offset/hasMore) | CallLogScreen.tsx | call_log_repository.dart `ArchivedCallLogsController` | PRESENT | |
| C16 | Hide the ongoing call (`details.chatId === currentChat.chatId`) from the real list | CallLogScreen.tsx `fetchInitialRealLogs` | call_log_repository.dart `RealCallLogsController.build` | PRESENT | v3: `currentChatProvider` is now also set by ScribeRecordingScreen on USER_JOINED (scribe_recording_screen.dart:398) and by the pre-nav counsellor-chat check (C33). |
| C17 | Refetch all permitted lists on every screen focus | CallLogScreen.tsx | call_log_screen.dart:390-396 (`ScreenFocusListener`) | PRESENT | |
| C18 | Pull-to-refresh resets active list to page 0 | CallLogScreen.tsx `handleRefresh` | call_log_screen.dart `_InfiniteScrollListView` | PRESENT | |
| C19 | Infinite scroll + footer spinner | CallLogScreen.tsx | call_log_screen.dart `_InfiniteScrollListView` | PRESENT | |
| C20 | First-page skeleton (CallLogSkeleton ×10) | CallLogScreen.tsx | call_log_screen.dart `_CallLogSkeleton` | PRESENT | Static blocks (no shimmer). |
| C21 | Empty state (NoCallLogsIcon, call vs sim titles, desc) | CallLogScreen.tsx | call_log_screen.dart `_CallLogEmptyState` (noCallRecords.svg :797) | PRESENT | |
| C22 | Error state = empty state | CallLogScreen.tsx | call_log_screen.dart:896, :953 | PRESENT | |
| C23 | Row: title chain, StatusBadge, eye icon only when enabled, date•time / scenario•date line | CallLogItem.tsx, StatusBadge.tsx | call_log_row.dart (eye.svg :270), status_badge.dart | PRESENT | |
| C24 | Single expanded row at a time (`expandedIdx`) via chevron; header greys when expanded | CallLogScreen.tsx:119, 501-503, 521 | call_log_screen.dart:122 `_expandedLogKey`, `_SingleExpandRow` :990-1006; call_log_row.dart:83 | PRESENT | v3: fixed (d7964fa) — one shared key across real/archived/sim lists; opening a row closes the previous. |
| C25 | Expanded details: source label + colour, Duration, Session score (hidden when 0), Mode, tag chips by positivity_rating | CallLogItem.tsx, Tag.tsx | call_log_row.dart, call_tag_chip.dart, call_log_screen.dart:913-932 | PRESENT | |
| C26 | Row disabled unless VIEW_CHAT_DETAILS / VIEW_SCENARIO_SESSION_DETAILS | CallLogScreen.tsx `renderItem` | call_log_screen.dart `enabled:` (:929, :979) | PRESENT | |
| C27 | Nav real/archived row → CallSummary `{callId, fromLogs:true}` | CallLogScreen.tsx | call_log_screen.dart:930 → `/call-log/:id` (extra optional, app_router.dart:312-321) | PRESENT | |
| C28 | Nav sim row → SimulationFeedback `{scenarioSessionId, fromLogs:true}` | CallLogScreen.tsx | call_log_screen.dart:980 | PRESENT | |
| C29 | Start-session FAB: visibility, grey when nothing offerable, unknown → refetch + toast | CallLogScreen.tsx | call_log_screen.dart:486-505 | PRESENT | Toast is now the RN-style toast (aedd4b1). |
| C30 | Re-ask GET /settings/chat-types on every focus | CallLogScreen.tsx | call_log_screen.dart:395 | PRESENT | |
| C31 | StartSessionModal: consent footer, Scribe / Dictation buttons, loading/disabled, close X | StartSessionModal.tsx | call_log_screen.dart `_showStartSessionModal` (:147) | PRESENT | |
| C32 | Start Scribe: mic check→request (30s bound), double-tap guard, denied → settings alert, error → toast, navigate Listening | CallLogScreen.tsx `handleVoiceRecording` | call_log_screen.dart `_startScribeSession` :207-231 | PRESENT | |
| C33 | `checkCounselorChat()` (GET /chats/counsellor-chat) fired right before navigating to Listening | CallLogScreen.tsx:156, 645 | call_log_screen.dart:218-219, `_checkCounselorChat` :238-247 | PRESENT | v3: fixed (d7964fa). Gated on VIEW_COUNSELOR_CHAT as RN's hook; deliberately does not clear the chat when none (scribe screen sets its own from USER_JOINED). |
| C34 | Create note: POST /chats/note → close sheet → CallSummary; failure toast and sheet stays | CallLogScreen.tsx `handleCreateNote` | call_log_screen.dart `_createNote` :183-198 | PRESENT | |
| C35 | Android hardware back: exit app on first visible tab, else first visible tab | CallLogScreen.tsx | core/navigation/app_shell_screen.dart (shell `PopScope`) | PRESENT | |
| C36 | `checkAuth()` on focus when no userData | CallLogScreen.tsx | — | N/A | App-global auth state. |
| C37 | RetrySessionModal | components/RetrySessionModal/* | — | N/A | Only used by Simulation/Case screens. |
| C38 | Badge component | components/Badge/* | — | N/A | Not rendered in RN. |
| C39 | Analytics/tracking | — | — | N/A | None in RN. |

Backend calls (CallLog): GET `/chats/call-logs` {limit, offset, archive, fieldFilters, startDate, endDate, minDuration, maxDuration, tags, mode, status, source} — PRESENT (v3: empty date not sent); GET `/chats/tags` — PRESENT; GET `/custom-fields/definitions` — PRESENT; GET `/learn/scenario-sessions` — PRESENT; GET `/settings/chat-types` — PRESENT; GET `/settings/scribe-note-creation-enabled` — PRESENT; POST `/chats/note` — PRESENT; GET `/chats/counsellor-chat` (pre-nav) — v3 PRESENT (C33).
Toasts/alerts (CallLog): `calls.createNote.error`, `common.somethingWentWrong` ×2, mic settings alert, Alert `common.error`/`common.unableToOpenLink` — all PRESENT (v3: C12). A11y labels: v3 `accessibility.filter` / `accessibility.refresh` translated (call_log_screen.dart:527, :605; 0f7839c).
Navigation targets: CallSummary, SimulationFeedback, Listening, first visible tab / exit app, external ALLY_WEB_URL — all PRESENT.

---

#### 2. CallSummaryScreen (`screens/CallSummaryScreen/**`, 45 files + hooks)

Flutter: `lib/features/calllog/presentation/call_summary_screen.dart` (2338 lines), `call_summary_header.dart`, `call_summary_menu.dart`, `call_summary_actions.dart`, `summary_generation_progress.dart`, `call_transcript_tab.dart`, `searchable_location_dropdown.dart`, `voice_note_section.dart`, `voice_note_recorder.dart`; `lib/features/calllog/data/call_log_repository.dart`, `call_summary_fields.dart`, `summary_form_state.dart`, `summary_file_export.dart`, `voice_custom_fields.dart`, `custom_fields_repository.dart`; `lib/features/reviews/...`; `lib/core/widgets/confirmation_modal.dart`, `custom_dropdown.dart`.

Tally: PRESENT 50 · PARTIAL 2 · MISSING 0 · N/A 6  [v2: 49 · 1 · 0 · 6, 56 rows]

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| S1 | Route params `callId`, `fromLogs`; live flow passes none | CallSummaryScreen.tsx | app_router.dart:312-326, call_summary_screen.dart | PRESENT | |
| S2 | GET /chats/:id summary fetch + loading spinner | useSummaryState.ts | call_log_repository.dart:1026 `callSummaryProvider`; call_summary_screen.dart `_SummaryTab` :1155-1158 | PRESENT | |
| S3 | Refresh on every re-focus after first | CallSummaryScreen.tsx | call_summary_screen.dart `_pushAndRefresh` (:357) | PRESENT | |
| S4 | GET /settings/summary-fields → visible sections/fields | CallSummaryScreen.tsx, CallSummaryDetails.tsx | call_summary_screen.dart (`summaryVisibleFieldsProvider`), voice_note_section.dart | PRESENT | |
| S5 | Header: back arrow, "Session *Summary*" title, `#summaryName` or `-` | components/Header/Header.tsx | call_summary_header.dart:64-133 (leftArrowIcon.svg, ReplayPro title + bold-italic subtitle, 80pt row); call_summary_screen.dart:675-685 | PRESENT | v3: RN custom header ported (64636fa) — v2's "Material AppBar" note is gone; rename no longer reverted by refetch (`_lastFetchedSummaryName` :318-327). |
| S6 | Share switch visible only when summary available + SUCCESS + transcript + not archived | Header.tsx, CallSummaryScreen.tsx | call_summary_screen.dart:623-628 | PRESENT | |
| S7 | Share toggle → ShareCallLog or PATCH review status + toasts + refresh | CallSummaryScreen.tsx, useToggleReviewPrivacy.ts | call_summary_screen.dart `_handleShareToggle` :366-397; call_summary_header.dart:136-145 (`RnCustomSwitch`, label `learn.scenario.share`) | PRESENT | v3: CustomSwitch port replaces Material Switch. |
| S8 | ShareCallLog nav params | CallSummaryScreen.tsx | call_summary_screen.dart:372-385 | PRESENT | |
| S9 | ShareCallLog (scribe) screen | screens/ShareCallLog | reviews/presentation/share_for_review_screen.dart | PRESENT | |
| S10 | Menu → Rename (CustomModal with input; PATCH call-info; toasts) | SummaryModals.tsx, DeleteRenameModal.tsx | call_summary_screen.dart `_showRenameModal` :401-415 (`CallSummaryTextModal`), call_summary_actions.dart:22-31 | PRESENT | v3: RN-style text modal replaces AlertDialog; failure toast via `showErrorToast`. |
| S11 | Menu → Export: storage permission, GET export-summary, save file, toasts | SummaryModals.tsx, useCallSummaryActions.ts, useStoragePermissions.ts, utils/fileOperations | call_summary_actions.dart:37-56, summary_file_export.dart:27-80, MainActivity.kt `ally/file_export` | PRESENT | Android: WRITE_EXTERNAL_STORAGE maxSdk 28 + `requestLegacyExternalStorage` match RN manifest; writes to public Downloads + media scan (same as RNFS). Actual file landing is a device check (B_gaps (c)). |
| S12 | Menu → Data policy | SummaryModals.tsx | call_summary_screen.dart:475-480 | PRESENT | |
| S13 | Menu → Archive/Unarchive with ConfirmationModal, PATCH, toasts | ArchiveActionModal.tsx, useCallSummaryActions.ts | call_summary_screen.dart `_handleArchiveToggle` :418-431, call_summary_actions.dart:58-69 | PRESENT | |
| S14 | Delete summary | DeleteRenameModal.tsx | call_summary_screen.dart `_showDeleteModal` (unused) | N/A | Unreachable in RN; Flutter mirrors (product item 50). |
| S15 | SummaryDropdown | Header/SummaryDropdown.tsx | — | N/A | Not rendered in RN. |
| S16 | Tabs Summary / Transcript; Transcript only if chatId && !403 && VIEW_MESSAGES | CallSummaryScreen.tsx | call_summary_screen.dart:620-622; call_summary_header.dart `CallSummaryTabBar` | PRESENT | v3: RN tab strip (indicator, labels) replaces Material TabBar (64636fa). |
| S17 | 403 → SummaryUnauthorized (image, copy, back) | SummaryUnauthorized.tsx | call_summary_screen.dart:2300 (`summaryFailed.png`) | PRESENT | v3: icon sweep closed (was `Icons.lock_outline`). |
| S18 | Generation in progress (Lottie, ShinyText steps, shield row, ETA, copy, generated state, 3s hold) | SummaryGenerationProgress.tsx, useSummaryState.ts | summary_generation_progress.dart:147-245 | PRESENT | |
| S19 | FAILED and NO_AUDIO states | SummaryGenerationProgress.tsx | summary_generation_progress.dart:147-153 | PRESENT | |
| S20 | Buttons: See if ready / Retry (+ toasts incl. server message) / Setting up; Check later → clear chat + Call Log tab | CallSummaryScreen.tsx:143-156, 304-347 | call_summary_screen.dart:1072-1097, :1105-1133, `_goToCallLog` :450-453 | PRESENT | |
| S21 | AddNotesSection: collapsible, info tooltip, debounced POST notes | AddNotesSection.tsx:50-90 | summary_generation_progress.dart:363-404 (arrowDown/page/info.svg; `showPrivacyTooltip` with `summaryLoading.notesTooltip`) | PRESENT | v3: privacy tooltip on the (i) now present (v2 gap 28 closed). |
| S22 | AI-generated warning banner (GoldenShield) | CallSummaryDetails.tsx | call_summary_screen.dart:1252 (goldenShield.svg) | PRESENT | v3: icon sweep closed. |
| S23 | Exclusive accordion; edit lock; collapse exits edit | CallSummaryDetails.tsx, SectionHeader.tsx | call_summary_screen.dart `_toggleSection`, `_SectionCard`; section icons :94-111; chevron arrowDown/arrowRight.svg :1463 | PRESENT | v3: icon sweep closed — 18 RN section SVGs and the RN chevron (67e7051). |
| S24 | Edit gate `section.canEdit && (admin \|\| counselorId === me)` | SectionWrapper.tsx | call_summary_screen.dart `_SectionCard` | PRESENT | |
| S25 | Edit → Wand / Tick / Close controls | SectionHeader.tsx, SectionWrapper.tsx | call_summary_screen.dart:1496-1525 (editSquare/wandStars/check/closeCircle.svg) | PRESENT | No fade/slide animation (visual only). |
| S26 | AI enhance: POST /chats/enhance; toast `summary.enhanceFailed` | SectionWrapper.tsx, EditableField.tsx | call_summary_screen.dart `_onWandPress`, call_log_repository.dart `enhanceCallSummary` | PRESENT | Spinner replaces wand (:1506-1509). v3: wand updates the open field (67e7051). |
| S27 | Built-in field renderers: Text, InlineTextInput, MultilineTextInput, Dropdown | utils/fieldRenderer.tsx, FieldRow.tsx, EditableField.tsx | call_summary_screen.dart `_FieldEditor`, `_SummaryDropdown` :1658-1690 (`CustomDropdown`) | PRESENT | v3: RN CustomDropdown port replaces Material dropdown. |
| S28 | Location = SearchableLocationDropdown | utils/fieldRenderer.tsx, placesApi.ts | searchable_location_dropdown.dart; call_summary_screen.dart:2011-2021 | PRESENT | |
| S29 | Tags field edit → names array | useCallSummaryForm.ts, formDataTransformer.ts | call_log_repository.dart | PRESENT | |
| S30 | Read transform | formDataTransformer.ts, constants/summary.ts | call_log_repository.dart, summary_display_format.dart | PRESENT | |
| S31 | Global Save button + post-save feedback popup | CallSummaryScreen.tsx, CallSummaryDetails.tsx | call_summary_screen.dart `_onSaveButtonPress` :534-538 | PRESENT | |
| S32 | Unsaved edits survive refetch; seed per chat | useCallSummaryForm.ts | call_summary_screen.dart `_seedIfNeeded` | PRESENT | |
| S33 | Section close resets that section's built-ins | useCallSummaryForm.ts | call_summary_screen.dart `_resetSectionFields` | PRESENT | |
| S34 | Custom fields gate/definitions/values/PUT/toast | CallSummaryDetails.tsx, customFieldsApi.ts | call_summary_screen.dart, custom_fields_repository.dart | PRESENT | |
| S35 | Custom field editPermission BOTH / ADMIN_ONLY / COUNSELLOR_ONLY | CustomFieldsSection.tsx | call_summary_screen.dart `_canEditCustomField` | PRESENT | |
| S36 | Custom field renderers TEXT, NUMBER, SINGLE_SELECT, BOOLEAN, MULTI_SELECT | CustomFieldsSection.tsx | call_summary_screen.dart `_CustomFieldEditor` (:2132, :2150 `_SummaryDropdown`; multi-select dialog :2072) | PRESENT | v3: SINGLE_SELECT/BOOLEAN use the RN CustomDropdown (v2 gap 29 closed). |
| S37 | Custom field DATE display/normalize | CustomFieldsSection.tsx | call_summary_screen.dart | PRESENT | |
| S38 | Manual note latched | useSummaryState.ts | call_summary_screen.dart `_onSummary` :323 | PRESENT | |
| S39 | VoiceNoteSection gate | VoiceNoteSection.tsx, useScribeVoiceNoteEnabled.ts | voice_note_section.dart:257-262 | PRESENT | Visible gate matches; the settings request itself isn't skipped for non-counsellors — see S-N2. |
| S40 | VoiceNotePanel states | VoiceNotePanel.tsx | voice_note_section.dart `_VoiceNotePanel` | PRESENT | v3: RN panel look (bf5d1c5). |
| S41 | Recorder + mic-permission error toasts | useVoiceNoteRecorder.ts, VoiceNoteSection.tsx | voice_note_recorder.dart, voice_note_section.dart `_onRecorderChanged` :125 | PRESENT | v3: 24 MB auto-stop ported (voice_note_recorder.dart:41, :64-72; v2 gap 22 closed). |
| S42 | Generate: POST generate-from-audio + apply built-ins | VoiceNoteSection.tsx, scribeNoteApi.ts | voice_note_section.dart | PRESENT | |
| S43 | Voice custom-field values encode + PUT + remount | VoiceNoteSection.tsx | voice_custom_fields.dart, voice_note_section.dart | PRESENT | |
| S44 | Transcript accumulation: seed from `details.transcript`, append, PUT /chats/:id/transcript | VoiceNoteSection.tsx:193 (`transcriptRef`) | voice_note_section.dart:104-123 (`_seedTranscript` in initState/didUpdateWidget), :202-210; call_summary_screen.dart:1216 (`existingTranscript: summary.transcript`); call_log_repository.dart:273 | PRESENT | v3: fixed (bf5d1c5) — seeded once from `details.transcript`, as RN's `if (existingTranscript && !transcriptRef.current)`. |
| S45 | Voice toasts; keep panel on failure | VoiceNoteSection.tsx | voice_note_section.dart:218-235 | PRESENT | Error toast uses `getErrorDetails` (:230). |
| S46 | Transcript tab UI | CallTranscript.tsx, CallTranscriptItem.tsx | call_transcript_tab.dart (emptyTranscript.svg :125), call_transcript_item.dart | PRESENT | |
| S47 | Transcript pagination | useCallTranscriptDetails.ts, callTranscriptApi.ts | call_log_repository.dart `getChatMessages`, `chatMessagesProvider` :1034 | PRESENT | Pages fetched up front (no footer spinner); full ordered transcript. |
| S48 | Back-press summary-feedback prompt | CallSummaryScreen.tsx `onBackNavigation` | call_summary_screen.dart `_handleBackPress` :509-521, PopScope :639 | PRESENT | Android back routed through PopScope. |
| S49 | `handleGoBack`: logs → goBack; live → CallLog + clearCurrentChat | useCallSummaryActions.ts | call_summary_screen.dart:440-453 | PRESENT | |
| S50 | FeedbackPopup + POST summary-feedback + toasts | FeedbackPopup.tsx, SummaryModals.tsx | call_summary_screen.dart `_submitFeedback` :541-557 | PRESENT | |
| S51 | View-review FAB + hide-private logic | CallSummaryScreen.tsx, useHideReviewDetails.ts | call_summary_screen.dart:629-631, :647-666 (chatBubble.svg :651), `_checkHideReviewDetails` :332-353 | PRESENT | v3: icon sweep closed (RN 56pt white circle + chatBubble.svg). |
| S52 | FAB → ScribeReviewDetails | CallSummaryScreen.tsx | call_summary_screen.dart:648-653 | PRESENT | |
| S53 | Clear summary slice on unmount | useSummaryState.ts | — | N/A | |
| S54 | POST tag-positivity-ratings | callSummaryApi.ts | — | N/A | Never called in RN. |
| S55 | FlowSection, KeyConcernSection, NotesSection | components/FlowSection, KeyConcern, NotesSection.tsx | — | N/A | Not rendered in RN. |
| S56 | Analytics/tracking | — | — | N/A | None in RN. |
| S-N1 | Summary fetch failure (non-403): RN never shows an error view — first-load failure falls through to SummaryGenerationProgress + AddNotes + "See if ready"/"Check later" buttons; a failed refetch keeps the loaded summary (RTK keeps `data`) | CallSummaryScreen.tsx:351-403 (`renderSummaryTab`: only `isUnauthorized` branches out), useSummaryState.ts:21 | call_summary_screen.dart:1156-1169 (`summaryAsync.when` error → centred `getErrorDetails` text, no buttons) | PARTIAL | v3 new (discovery). Riverpod 3 `AsyncValue.when` takes the error branch even when a previous value exists (no `skipError`), so a failed "See if ready"/retry/refocus refetch replaces a loaded summary or the progress view with bare error text and no way to retry except leaving the screen. |
| S-N2 | `useScribeVoiceNoteEnabled` skips `/settings/scribe-voice-note-enabled` unless COUNSELOR_ACCESS | hooks/useScribeVoiceNoteEnabled.ts:13-22 | voice_note_section.dart:258-262 (`ref.watch(scribeVoiceNoteEnabledProvider)` evaluated before the counsellor check) | PARTIAL | v3 new (was v2 "Minor finding", line moved 249→260). Non-counsellors fire one request that 403s; nothing visible changes. |

Backend calls (CallSummary): GET `/chats/:id`, GET `/settings/summary-fields`, PUT `/chats/:id/call-details`, PATCH `/chats/:id/call-info`, GET `/chats/:id/export-summary`, PATCH `/chats/call-logs/:id/archive`, POST `/chats/enhance`, POST `/chats/:id/retry-summary`, POST `/chats/:id/summary-feedback`, POST `/chats/:id/notes`, GET `/chats/:id/messages`, GET `/places` + `/places/search`, custom-fields GET+PUT, POST `/chats/note/generate-from-audio`, PATCH `/scribe-session-reviews/:id`, review threads + reactions count — PRESENT. v3: PUT `/chats/:id/transcript` PRESENT (S44). GET `/settings/scribe-voice-note-enabled` PARTIAL (S-N2: sent for non-counsellors).
Toasts: all RN toasts PRESENT, now on the RN-style toast host with `getErrorDetails`/`showErrorToast` (05d78c1/aedd4b1); no raw exception text remains in calllog/scribe (v2 gap 40 sites `call_log_screen.dart:248`, `call_summary_screen.dart:999,1150` closed).
Navigation targets: ShareCallLog, ScribeReviewDetails, CallLog tab reset, goBack — PRESENT.

---

#### 3. ListeningScreen (`screens/ListeningScreen/**`, 39 files) — Microphone (Scribe) + Conference

Flutter: `lib/features/scribe/presentation/scribe_recording_screen.dart`, `conference_listening_screen.dart`, `listening_chrome.dart`, `listening_controls.dart`, `nudge_section.dart`, `network_disconnected.dart`, `audio_waveform.dart`, `elapsed_timer.dart`, `dismissable_banner.dart`, `call_transcript_item.dart`, `scribe_reference_search.dart`; `lib/features/scribe/data/*`; `lib/core/realtime/socket_service.dart`, `socket_events.dart`, `foreground_recording_service.dart`, `keep_awake.dart`, `connectivity.dart`, `microphone_permission.dart`; `lib/core/chat/*`; `lib/core/routing/app_router.dart` (`/scribe`, `/conference-listening/:chatId` behind `_CurrentUserGate`).

Tally: PRESENT 46 · PARTIAL 0 · MISSING 0 · N/A 5  [v2: 46 · 0 · 0 · 5]

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| L1 | Mode routing: microphone vs conference | ListeningScreen.tsx | app_router.dart:186-195, active_chat_discovery.dart | PRESENT | v3: both routes wait for `/users/me` (`_CurrentUserGate` app_router.dart:415-433) instead of a `dev-user` fallback id (v2 gap 13 closed, 9b76a8a). |
| L2 | Auto-start live mic stream (16 kHz mono 16-bit) | MicrophoneListeningScreen.tsx, useLiveAudioStream.ts | scribe_recording_screen.dart `_startStreaming` :329-348 | PRESENT | |
| L3 | Mic permission on screen; denied → settings alert; re-check on resume | useLiveAudioStream.ts | scribe_recording_screen.dart `_checkMicrophone` :302-327, resume :249-258 | PRESENT | |
| L4 | Socket.IO, websocket+polling, fresh-token auth, reconnection 5 / 1–5s | useSocket.ts, useSocketConnection.ts | socket_service.dart | PRESENT | v3: retry 2s after a failed open (RN `RETRY_AFTER_FAILURE_MS`, 3cb9e36). Cloud-telephony listener uses its own SocketService instance (cloud_telephony_listener.dart:73). |
| L5 | Mic socket not torn down on background | MicrophoneListeningScreen.tsx:321-327 | scribe_recording_screen.dart:249-258 (resume only) | PRESENT | Long-lock survival is a device check (B_gaps (c)). |
| L6 | SESSION_CREATED → START_AUDIO_CHAT payload | MicrophoneListeningScreen.tsx, audioUtils.ts | scribe_recording_screen.dart `_maybeEmitStartAudioChat` :367-378 | PRESENT | |
| L7 | USER_JOINED: take payload.chatId, then hydrate | MicrophoneListeningScreen.tsx:262-268 | scribe_recording_screen.dart `_onUserJoined` :382-405 | PRESENT | |
| L8 | 5s without chatId → MICROPHONE_FAILURE | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_armChatIdTimeout` :260-267 | PRESENT | |
| L9 | AUDIO_MESSAGE when not paused and chatId known; not gated on connected | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_onAudioChunk` :351-364 | PRESENT | |
| L10 | Web-microphone mode | useListeningCommon.ts | scribe_recording_screen.dart `_isWebMicrophoneMode` :153 | PRESENT | |
| L11 | Starts paused with mute tooltip | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart:110-111, :599 | PRESENT | |
| L12 | Pause/Resume debounced 500ms | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_onPauseResumePressed` :488-497 | PRESENT | |
| L13 | MESSAGE_RECEIVED / UTTERANCE_ENDED merge | useListeningCommon.ts | transcript_logic.dart, scribe_recording_screen.dart :441-464 | PRESENT | v3: partials rebuild only the transcript list (aa76bad). |
| L14 | Rehydrate existing chat messages | MicrophoneListeningScreen.tsx | transcript_logic.dart `rehydrateTranscriptions`; scribe_recording_screen.dart `_rehydrate` | PRESENT | |
| L15 | NUDGE → 500ms loading → nudge | both screens | scribe_recording_screen.dart `_onNudge`, conference_listening_screen.dart `_onNudge` | PRESENT | |
| L16 | Nudge only in non-focus + nudge-status | both screens | scribe_recording_screen.dart `_buildNonFocusMode` | PRESENT | |
| L17 | Nudge markdown, skeleton, scroll | NudgeSection.tsx | nudge_section.dart | PRESENT | |
| L18 | Nudge feedback | NudgeSection.tsx | nudge_section.dart | PRESENT | |
| L19 | CHAT_ENDED → replace with Breathing (only when focused) | useListeningCommon.ts:173-177 | scribe_recording_screen.dart `_goToBreathing` :524-529 | PRESENT | Flutter doesn't check focus (nothing in the Scribe flow pushes over the screen; only a push-notification route could). |
| L20 | End-session confirmation (IllustratedModal, EndSessionIcon, mic copy) | CallEndConfirmationModal.tsx | scribe_recording_screen.dart:606-615 (`CallIllustratedModal`, endSession.svg) | PRESENT | v3: illustration now present (v2 note said none). |
| L21 | End call: stop stream, POST end, Breathing on success and error | useListeningCommon.ts | scribe_recording_screen.dart `_endSession` :503-521 | PRESENT | |
| L22 | Back: no live session → clear chat + goBack; live → confirmation | MicrophoneListeningScreen.tsx:121-140 | scribe_recording_screen.dart `_handleBackPress` :555-562, `_handleGoBack` :532-546, PopScope :565 | PRESENT | v3: empty stack falls back to the Call Log tab via `goToHomeTab` (scribe_recording_screen.dart:543; v2 gap 7 Scribe part closed). |
| L23 | "Connecting…" with Cancel | MicrophoneListeningScreen.tsx:532-552 | scribe_recording_screen.dart:580; listening_chrome.dart `ListeningConnectingView` | PRESENT | |
| L24 | NetworkDisconnected view | NetworkDisconnected.tsx | network_disconnected.dart | PRESENT | |
| L25 | Offline → NETWORK; disconnect NETWORK vs SOCKET | useNetworkConnectivity.ts | connectivity.dart; scribe_recording_screen.dart:174-180, :269-283 | PRESENT | |
| L26 | Try again → clear + go back | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_handleTryAgain` :547-550 | PRESENT | |
| L27 | Focus layout + privacy tooltip | MicrophoneListeningScreen.tsx, useListeningScreen.ts | scribe_recording_screen.dart `_buildFocusMode` :625-655; listening_chrome.dart | PRESENT | |
| L28 | Non-focus layout + Search + auto-scroll transcript | MicrophoneListeningScreen.tsx:594-641 | scribe_recording_screen.dart `_buildNonFocusMode` :660-727 | PRESENT | |
| L29 | Search (reference documents) | components/Search/Search.tsx, useSearch.ts | scribe_reference_search.dart | PRESENT | |
| L30 | Live transcript item mm:ss + speaker label | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_elapsedLabel` :730-752 | PRESENT | |
| L31 | Timer HH:MM:SS from startedAt | Timer.tsx | elapsed_timer.dart | PRESENT | |
| L32 | Waveform | AudioWaveformContainer.tsx, AudioWaveform.tsx | audio_waveform.dart | PRESENT | |
| L33 | ListeningControls | ListeningControls.tsx | listening_controls.dart | PRESENT | |
| L34 | Keep screen awake | useListeningCommon.ts | keep_awake.dart; scribe_recording_screen.dart:169, conference_listening_screen.dart:90 | PRESENT | |
| L35 | Foreground → GET counsellor-chat; none → Breathing | useListeningCommon.ts | scribe_recording_screen.dart `_checkChatStillActive` :418-432 | PRESENT | |
| L36 | iOS swipe-back disabled for mic mode | useListeningCommon.ts:279-281 | scribe_recording_screen.dart PopScope(`canPop: false`) :565-570 | PRESENT | |
| L37 | SCRIBE_START_DIAGNOSTIC at 5s/15s | MicrophoneListeningScreen.tsx:431-466 | scribe_recording_screen.dart:198-221 | PRESENT | Backend consumer unverified (item 47). |
| L38 | Android foreground service + notification permission | — (RN has none) | foreground_recording_service.dart (channel `ally_recording_channel`, type microphone); AndroidManifest FOREGROUND_SERVICE(_MICROPHONE); scribe_recording_screen.dart:336-341 | N/A | Flutter-only addition. Note: `Permission.notification.request()` runs on every Scribe start on both platforms — an extra prompt RN never shows (first time only). |
| L39 | Full-screen dark UI, no header | MicrophoneListeningScreen.tsx | listening_chrome.dart `ListeningPage` | PRESENT | |
| L40 | Conference: socket path; USER_JOINED → checkCounselorChat; Connecting… until chatId | ConferenceListeningScreen.tsx | conference_listening_screen.dart `_connect` :123-137, `_onUserJoined` :139-150 | PRESENT | |
| L41 | Conference AUDIO_STREAM amplitudes; inactivity clear | ConferenceListeningScreen.tsx | conference_listening_screen.dart `_onAudioStream` :162-180 | PRESENT | |
| L42 | Conference DismissableBanner | ConferenceListeningScreen.tsx | conference_listening_screen.dart, dismissable_banner.dart | PRESENT | |
| L43 | Conference CHAT_ENDED → Breathing | ConferenceListeningScreen.tsx | conference_listening_screen.dart `_goToBreathing` :194-199 | PRESENT | |
| L44 | Conference focus/non-focus layouts (timer, waveform, nudge, Search) | ConferenceListeningScreen.tsx:265-272 | conference_listening_screen.dart:301 (`ScribeReferenceSearch`) | PRESENT | v3: stale "Search missing" note removed — Search is rendered. |
| L45 | Conference controls: pause/end hidden; focus gated | ConferenceListeningScreen.tsx | conference_listening_screen.dart | PRESENT | |
| L46 | Conference end-call confirmation | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN. |
| L47 | Conference privacy lock + tooltip | ConferenceListeningScreen.tsx | listening_chrome.dart `TakingNotesRow` | PRESENT | |
| L48 | Conference AUDIO_CHAT_PAUSED/RESUMED | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN. |
| L49 | Conference socket disconnect on background / reconnect on active | useSocketConnection.ts | conference_listening_screen.dart `didChangeAppLifecycleState` :113-121 | PRESENT | Conference has no back handler in RN or Flutter (default pop). |
| L50 | ControlButtonsSection, ListeningAnimation | components/* | — | N/A | Not rendered in RN. |
| L51 | Analytics/tracking | — | — | N/A | None in RN. |

Backend/socket calls (Listening): all PRESENT as v2. v3: socket open-failure retry PRESENT.
Toasts/alerts: mic settings alert PRESENT.
Navigation targets: Breathing (replace) PRESENT; goBack PRESENT with Call Log tab fallback.

---

#### 4. BoxBreathingScreen — route "Breathing" (`screens/BoxBreathingScreen/**`)

Flutter: `lib/features/boxbreathing/presentation/box_breathing_screen.dart`, `call_end_overlay.dart`, `flower_petal_painter.dart`, `breath_sound_player.dart`; route `/box-breathing?chatId=` (app_router.dart:336-342).

Tally: PRESENT 9 · PARTIAL 0 · N/A 1  [v2: 9 · 0 · 1]

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| B1 | CallEndOverlay for 3s | BreathingScreen.tsx, CallEndOverlay.tsx | call_end_overlay.dart | PRESENT | |
| B2 | Background image + gradient + heading | BreathingScreen.tsx | box_breathing_screen.dart:220 (breathingBackground.png) | PRESENT | |
| B3 | Box animation, petals, 4×4s phases | BoxBreathingAnimation.tsx, FlowerPetal.tsx | box_breathing_screen.dart, flower_petal_painter.dart | PRESENT | |
| B4 | Breath sound (mix, mute, replay on unmute) | BoxBreathingAnimation.tsx | breath_sound_player.dart, box_breathing_screen.dart:178-184 | PRESENT | Audio mixing is a device check. |
| B5 | Per-phase seconds counter | BreathingScreen.tsx | box_breathing_screen.dart `_restartCountdown` :141-154 | PRESENT | |
| B6 | Controls: mute/unmute, play/pause | BreathingControls.tsx | box_breathing_screen.dart `_setPlaying` :156-176, controls :422-434 (RN SVGs) | PRESENT | |
| B7 | Pause when inactive; stop on unmount | BreathingScreen.tsx | box_breathing_screen.dart | PRESENT | |
| B8 | "View call summary" → CallSummary, live-flow semantics | BreathingScreen.tsx | box_breathing_screen.dart `_viewCallSummary` :195-199 | PRESENT | |
| B9 | Hardware back → clear chat, stop, reset to CallLog | BreathingScreen.tsx | box_breathing_screen.dart `_resetToCallLog` :187-191, PopScope :204 | PRESENT | |
| B10 | Analytics/tracking | — | — | N/A | None in RN. |

---

#### Top gaps by user impact (v3 — remaining only)

1. S-N1 — A failed summary fetch/refetch shows bare error text with no buttons, and wipes an already-loaded summary; RN keeps the data or shows the progress view with "See if ready"/"Check later" (call_summary_screen.dart:1156-1169).
2. S-N2 — Non-counsellors fire `/settings/scribe-voice-note-enabled` and get a 403; invisible (voice_note_section.dart:260).

Closed since v2: S44 transcript seed, voice-note 24 MB cap, C12 FeatureNotAvailable, C6 (was mis-scored; RN is free text too) + empty date param, C5 badge count, C24 single expanded row, C33 counsellor-chat check, AddNotes privacy tooltip, custom-field dropdowns, Scribe exit tab, `dev-user` fallback, raw error text, Filter/Refresh a11y labels, and all 27 call-summary/voice-note icon-sweep sites.

### Parity ledger — Learn screens (RN → Flutter)

RN root: `ally-platform/ally-mobile/src` (source of truth). Flutter root: `ally-mobile-flutter/lib` on `master` (v3: `f770200`).
Audit date: 2026-10-28. **v2 re-audit:** 2026-10-28 against Flutter `master` @ `227db3a` (RN unchanged at `7a8ce0c19`; only a release-bot version bump since). Every v1 PARTIAL/MISSING row re-read on master; ~25 PRESENT rows spot-checked in changed areas (course players, role-play lifecycle, mic-before-credit, feedback recording/transcript language, path/case threading, completed items). 49 status changes; 0 regressions; 1 audit miss (short-session help icon/modal, PRESENT → PARTIAL).

**v3 re-audit:** 2026-10-28 against Flutter `f770200` (RN still `7a8ce0c19`). Every v2 non-PRESENT row re-read; 40+ PRESENT rows spot-checked (course players incl. all 6 game bundles byte-compared, RN 7a8ce0c19 assessment mode line by line incl. 5 locales, role-play voice screen, feedback, path/case, course progress sheet, endpoints). 32 rows touched: 13 closed to PRESENT, 2 → DEVICE-CHECK, 2 reclassified to PARTIAL (audit, not regression), 1 new row (L-N1). Status vocabulary adds BLOCKED-EXTERNAL / DEVICE-CHECK. 0 regressions.

**Branch note (v2):** the brief said `parity/feedback` held in-flight work. While this audit ran, `parity/feedback` was merged into `master` (merge commit `e248a07`, which includes `517c5e4` "Match the live role-play screen to RN SimulationAssistantScreen"), and the branch was deleted. Everything that was on that branch is now on master, so it is marked PRESENT or PARTIAL with the master file named. No IN PROGRESS rows are left. `feature/simkit` was already merged (`de796ac`).

**Analytics:** RN has no client analytics SDK at all. A grep for track/capture/posthog/logEvent/analytics/mixpanel/amplitude/Sentry/crashlytics across `src/` finds no event calls. So there are no event names to port, and every analytics row is N/A.

#### Overall tally

v3 counts; v2 in brackets.

| Screen | PRESENT | PARTIAL | MISSING | BLOCKED-EXTERNAL | DEVICE-CHECK | N/A | Total |
|---|---|---|---|---|---|---|---|
| SimulationsScreen — the "Learn" bottom tab | 19 [19] | 0 [0] | 0 [0] | 0 | 0 | 2 [2] | 21 [21] |
| SimulationDetailsScreen | 21 [21] | 0 [0] | 0 [0] | 0 | 0 | 1 [1] | 22 [22] |
| SimulationPathDetailsScreen + CaseDetailsScreen | 23 [20] | 0 [3] | 0 [0] | 0 | 0 | 1 [1] | 24 [24] |
| CourseOverviewScreen | 17 [16] | 0 [1] | 0 [0] | 0 | 0 | 2 [2] | 19 [19] |
| CourseItemPlayerScreen (incl. new L-N1) | 52 [52] | 2 [0] | 0 [0] | 0 | 0 | 1 [2] | 55 [54] |
| CourseProgressScreen | 10 [10] | 0 [0] | 0 [0] | 0 | 0 | 1 [1] | 11 [11] |
| BreathingExerciseScreen (course GAME / BREATHING_EXERCISE) | 6 [6] | 0 [0] | 0 [0] | 0 | 0 | 1 [1] | 7 [7] |
| SimulationAssistantScreen — live roleplay voice session | 30 [30] | 1 [2] | 0 [1] | 0 | 2 | 2 [2] | 35 [35] |
| SimulationFeedbackScreen | 37 [34] | 0 [3] | 0 [0] | 0 | 0 | 7 [7] | 44 [44] |
| **Overall** | **215 [208]** | **3 [9]** | **0 [1]** | **0** | **2** | **18 [19]** | **238 [237]** |

---

#### 1. SimulationsScreen — the "Learn" bottom tab

RN: `screens/SimulationsScreen/SimulationsScreen.tsx`, `hooks/useSimulationCredits.ts`, `components/SimulationCard`, `components/CircularProgress`, `components/SimulationsSkeleton`, `components/BadgePopup` + `hooks/useBadgePopup.ts`, `navigation/TabNavigator.tsx`.
Flutter: `features/simulations/presentation/simulations_screen.dart`, `.../widgets/learn_tab_view.dart`, `.../widgets/credits_display.dart`, `.../widgets/simulation_card.dart`, `.../widgets/circular_progress.dart`, `.../widgets/simulations_skeleton.dart`, `core/navigation/tab_config.dart`, `core/navigation/app_shell_screen.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Learn tab gated by `edit:scenario-session` (OR-match) | navigation/TabNavigator.tsx | core/navigation/tab_config.dart (`kTabLearn`) | PRESENT | Same permission, same OR semantics. |
| Header: app name + italic "Learn" subtitle | SimulationsScreen.tsx `renderHeader` | simulations_screen.dart (`TabScreenHeader`) | PRESENT | |
| Credits read-out (⚡ used/limit, red when low) | SimulationsScreen.tsx `renderCreditsDisplay`, hooks/useSimulationCredits.ts | widgets/credits_display.dart | PRESENT | `GET /simulation-credits`. RN clears credits when the permission is missing; in Flutter the tab gate makes that unreachable. |
| Intro line with `<blue>` spans | SimulationsScreen.tsx (`Trans simulations.learnIntro`) | simulations_screen.dart `_LearnIntro` | PRESENT | |
| Tab switcher Courses / Cases / Role plays / Tracks (content-width mode) | SimulationsScreen.tsx `TabView tabWidthMode="content"` | widgets/learn_tab_view.dart | PRESENT | |
| Each tab hidden once its query resolves empty; shown while fetching | SimulationsScreen.tsx `show*Tab` | simulations_screen.dart `show()` | PRESENT | |
| Active tab falls back to the first visible tab | SimulationsScreen.tsx useEffect | simulations_screen.dart (`activeTab` derivation) | PRESENT | |
| "Choose your *X*" list title | SimulationsScreen.tsx `listTitle` | simulations_screen.dart `_ListTitle` | PRESENT | |
| Courses list (`GET /learn/tracks`) with progress ring | `useGetLearnTracksQuery`, `renderCourseItem` | simulations_screen.dart + courses/data/courses_repository.dart `learnTracksProvider` | PRESENT | |
| Cases list (`GET /learn/cases`) with progress ring | `useGetCasesQuery`, `renderCaseItem` | simulations_screen.dart + simulations_repository.dart `casesProvider` | PRESENT | |
| Role plays list (`GET /learn/scenarios`) with trigger warnings + "Completed N×" badge | `useGetScenariosQuery`, `renderSimulationItem` | simulations_screen.dart `_CompletedBadge`, simulation_card.dart | PRESENT | |
| Tracks / paths list (`GET /learn/scenario-paths`) with progress ring | `useGetSimulationPathsQuery`, `renderPathItem` | simulations_screen.dart | PRESENT | |
| Loading skeleton (4 cards) while fetching with no data | `SimulationsSkeleton count={4}` | widgets/simulations_skeleton.dart | PRESENT | |
| Empty state per tab ("No … available") | `ListEmptyElement` | simulations_screen.dart `_EmptyTitle` | PRESENT | |
| Error state | — (RN shows an error as empty) | simulations_screen.dart | PRESENT | Same behaviour: no separate error UI. |
| Pull-to-refresh per active tab | `RefreshControl` → `refetch*` | simulations_screen.dart `RefreshIndicator` → `ref.invalidate` | PRESENT | |
| Navigation: course → CourseOverview(trackId); case → CaseDetails(caseId); scenario → SimulationDetails(scenario); path → SimulationPathDetails(pathId) | SimulationsScreen.tsx `handle*Press` | `/courses/:id`, `/cases/:id`, `/simulations/:id` (extra: Scenario), `/simulation-paths/:id` | PRESENT | |
| Android hardware back: exit the app on the first tab, otherwise jump to the first tab | `useHardwareBackPressHandler` + `getFirstVisibleTab` | core/navigation/app_shell_screen.dart:150 (`PopScope`, back → first visible tab) | PRESENT | v2: fixed by `557dc55`. |
| BadgePopup (app-wide unlock celebration: confetti, image, mark viewed, polls `/badges/me`) | components/BadgePopup, hooks/useBadgePopup.ts | features/achievements/presentation/badge_popup.dart (`BadgePopupHost`, polls `/badges/me?viewedStatus=UNVIEWED`), core/navigation/app_shell_screen.dart:165 | PRESENT | v2: `a5d3ce7`/`557dc55`. |
| Offline / no-network handling | — | — | N/A | RN has nothing specific on this screen. |
| Analytics | — | — | N/A | RN has no analytics calls (see header). |

Tally (v3): PRESENT 19 · PARTIAL 0 · MISSING 0 · N/A 2  [v2 same]

---

#### 2. SimulationDetailsScreen

RN: `screens/SimulationDetailsScreen/SimulationDetailsScreen.tsx`, `components/ActiveSimulationModal.tsx`, `hooks/useStartSimulation.ts`, `screens/CallLog/components/RetrySessionModal`, `components/NotificationModal`, `components/IllustratedModal`, `components/VideoPreview`.
Flutter: `features/simulations/presentation/simulation_details_screen.dart`, `.../start_simulation/start_simulation_controller.dart`, `.../start_simulation/start_simulation_modals.dart`, `core/widgets/cover_video_preview.dart`, `.../widgets/scenario_language_dropdown.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back arrow + "Start *Role play*" | SimulationDetailsScreen.tsx `renderHeader` | simulation_details_screen.dart (`BackTitleHeader`) | PRESENT | |
| Data comes from the route param `scenario` (no fetch) | route.params.scenario | `initialScenario` extra; falls back to `GET /learn/scenarios/:id` | PRESENT | The by-id fallback is an addition. |
| Language dropdown (`availableLanguages`; defaults to the first; disabled while creating the room) | `CustomDropdown` | widgets/scenario_language_dropdown.dart | PRESENT | |
| Cover video (`VideoPreview`, pauses on blur) or else cover image | `VideoPreview shouldPause={!isFocused}` | core/widgets/cover_video_preview.dart (pauses when the route is covered) | PRESENT | |
| Title + share icon → copy `ALLY_WEB_URL/scenario/:id` + "Link copied" toast | `linkCopyToClipboard` | simulation_details_screen.dart:61-63 `_copyLink` → `AppConfig.allyWebUrl` (core/config/app_config.dart:24, `ALLY_WEB_URL` dart-define) | PRESENT | v2: `c80310b`. Default is the prod origin when the define is absent. |
| "Completed N×" chip | `completedChip` | `_CompletedChip` | PRESENT | |
| Scenario label + rich-text description | `RichText html` | `HtmlRichText` | PRESENT | |
| Trigger-warning chips | `getTriggerWarningNames` | simulation_details_screen.dart | PRESENT | |
| CTA "Start Role play" / "Practice again" | `renderCtaSection` | `AppButton` | PRESENT | |
| CTA disabled when credits are low | `isStartSimulationDisabled` | `isStartDisabled = credits?.isLow` | PRESENT | |
| Low-credits modal, auto-hides after 5 s | `IllustratedModal` + `LOW_CREDITS_MODAL_DISPLAY_MS` | start_simulation_controller.dart `onCredits` / `LowCreditsModal` | PRESENT |  |
| Pre-start "Before you get started" modal | `NotificationModal` | start_simulation_modals.dart `PreStartNotificationModal` | PRESENT | |
| Start call `POST /learn/scenario-session-start` {scenarioId, languageId?} | useStartSimulation `callSessionStart` | simulations_repository.dart `startScenarioSession` | PRESENT | |
| "Creating room…" full-screen overlay | `renderLoadingOverlay` | `_CreatingRoomOverlay` | PRESENT | |
| Microphone permission request before start; Settings alert when blocked; toast when denied | useStartSimulation + usePermissionAlert | start_simulation_controller.dart:178 `_ensureMicrophone` (before `_callSessionStart`), core/realtime/microphone_permission.dart (`showPermissionSettingsAlert` → `openAppSettings`) | PRESENT | v2: `497317a`. Checked before the session/credit is spent, as RN. |
| 429 → RetrySessionModal (retry with stored params) | `isRateLimitError`, `retryStartSimulation` | start_simulation_controller.dart `_showRetry` / `RetrySessionModal` | PRESENT | |
| `entityId` error → ActiveSimulationModal (end session `POST /learn/scenario-session/:id/end`, success/error toast) | ActiveSimulationModal.tsx | start_simulation_modals.dart `ActiveSimulationModal`, controller `_showActiveSimulation` | PRESENT | |
| Other errors → error toast `errors.startSimulation` | showErrorToast | start_simulation_controller.dart:230, 269, 340 (`showToast(..., ToastType.error)`) | PRESENT | v3: real RN-style toast (`aedd4b1`); message = key + backend reason, as RN `showErrorToast`. |
| Navigate to the live screen with sessionData + scenario (reminders only when `remindersEnabled`) | navigate SIMULATION_ASSISTANT | `_pushRoleplay` → `/roleplay` extra; simulation_models.dart filters reminders | PRESENT | |
| Hardware back → goBack | useHardwareBackPressHandler | default pop | PRESENT | |
| Error state when the scenario fetch fails | — (RN never fetches) | `learn.details.loadingDetailsError` text | PRESENT | Extra state, harmless. v3: translated copy, no raw exception (`930992c`). |
| Analytics | — | — | N/A | None in RN. |

Tally (v3): PRESENT 21 · PARTIAL 0 · MISSING 0 · N/A 1  [v2 same]

---

#### 3. SimulationPathDetailsScreen + CaseDetailsScreen

The two RN screens are line-for-line identical apart from type names (they share `useLearningPathDetails`, `PathSimulationCard` and `SimulationDetailsModal`). Flutter shares one body, `LearningPathDetailView`.
RN: `screens/SimulationPathDetailsScreen/*`, `screens/CaseDetailsScreen/CaseDetailsScreen.tsx`, `hooks/useLearningPathDetails.ts`, `components/LearningPathDetails` (LearningPathHeader / LearningPathListHeader).
Flutter: `features/simulations/presentation/simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart`, `simulation_details_modal.dart`, `widgets/learning_path_widgets.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back + "Track" / "Case" title + credits read-out | LearningPathHeader | learning_path_widgets.dart `LearningPathHeader(showCredits)` | PRESENT | |
| Back falls back to the Learn tab when there's no back stack (`navigateToLearnTab`) | `handleBack` | widgets/learning_path_widgets.dart:300-305 `learningPathBack` (pop, else `goToHomeTab(kTabLearn)`); simulation_path_details_screen.dart:30-42, case_details_screen.dart:33-45 | PRESENT | v3: closed (`cfaba0b`); header and hardware back both use it. |
| Fetch `GET /learn/scenario-paths/:id` or `GET /learn/cases/:id` | useLearningPathDetails | simulations_repository.dart `simulationPathDetailsProvider` / `caseDetailsProvider` | PRESENT | |
| Loading spinner | ActivityIndicator | `LearningPathLoading` | PRESENT | |
| Error / empty → DataUnavailable EmptyState ("failedToLoadPathDetails" / "…CaseDetails") | EmptyState | `LearningPathLoadError` | PRESENT | |
| Pull-to-refresh | RefreshControl | RefreshIndicator | PRESENT | |
| List header: cover, title, description, progress bar x/y, completed state | LearningPathListHeader | learning_path_widgets.dart `LearningPathListHeader` | PRESENT | |
| Start / Continue button (label by `completedScenarios > 0`) | `handleStartPath` | learning_path_detail_view.dart | PRESENT | |
| Start disabled when there is no next scenario or credits are low | `isStartPathDisabled` | `isStartDisabled` | PRESENT | |
| Lazily create the path/case session (`POST …/create-session`) before opening the modal | `createSession` | `onEnsureSession` | PRESENT | |
| createSession failure → error toast with the server message | showToast(getErrorDetails) | learning_path_detail_view.dart:100-105, 121-125 (`showToast(getErrorDetails(e).message, error)`) | PRESENT | v3: closed (`cfaba0b`); no raw exception text. |
| Scenario row: 120×60 thumb, lock overlay, "Role play N", tick, "Next" chip, 2-line title | PathSimulationCard.tsx | learning_path_detail_view.dart `_ScenarioRow` | PRESENT | |
| Locked row not tappable | `handleSimulationPress` guard | `onTap: locked ? null` | PRESENT | |
| Completed row file icon → session lookup `GET /learn/scenario-session/(scenario-path-session-item or case-session-item)/:id` → Feedback(fromLogs) | `handleFileIconPress` | simulation_path_details_screen.dart:69-90 / case_details_screen.dart (same shape) → `onViewFeedback` returns false on no id; learning_path_detail_view.dart:127-133 toasts `sessionNotFoundMessage` | PRESENT | v3: closed (`cfaba0b`); `failedToLoadPathDetails` / `…CaseDetails` toast when the lookup returns no id. |
| SimulationDetailsModal: header, close, language dropdown, video/image, order label, title, description, trigger warnings, Start | SimulationDetailsModal.tsx | simulation_details_modal.dart | PRESENT | |
| Modal hidden while the pre-start NotificationModal shows | `visible={!!selected && !showNotification}` | simulation_details_modal.dart → `PreStartNotificationModal` | PRESENT | |
| Start with `scenarioPathSessionItemId` / `caseSessionItemId` from the *fresh* scenario, plus languageId | `handleProceedWithSimulation` | `startParamsFor(fresh ?? scenario)` | PRESENT | |
| Close the modal after the start settles | `.finally(handleCloseModal)` | `onSettled: close` | PRESENT | |
| Pass pathId / caseId to the live screen, then on to Feedback (back resets to path/case details; "Try another" hidden) | useStartSimulation params `pathId` / `caseId` | start_simulation_controller.dart:41-44, 99-101 → app_router.dart:204-218 `/roleplay` → roleplay_voice_screen.dart:526 → simulation_feedback_screen.dart:240-254 | PRESENT | v2: `c29e765`. Feedback back resets to path/case details; "Try another" hidden. |
| ActiveSimulationModal / RetrySessionModal / error toast | shared hook | start_simulation_controller.dart | PRESENT | |
| Low-credits modal (5 s) | useEffect isLow | controller `onCredits` | PRESENT | |
| Path/case details + credits refreshed after a session ends (RN `endScenarioSession` invalidates SimulationCredits, SimulationPaths, SimulationPathDetails, Cases, CaseDetails) | services/simulationsApi.ts `invalidatesTags` | simulations_repository.dart:120-131 `endScenarioSession` → `_onInvalidate` (credits, paths, pathDetails, cases, caseDetails) wired at :200-218 | PRESENT | v2: `8e6ad33`. |
| Hardware back | useHardwareBackPressHandler | `PopScope(canPop: context.canPop())` → `learningPathBack` (simulation_path_details_screen.dart:30-33) | PRESENT | v3: Android back now takes the same Learn-tab fallback as RN. |
| Analytics | — | — | N/A | |

Tally (v3): PRESENT 23 · PARTIAL 0 · MISSING 0 · N/A 1  [v2: 20 · 3 · 0 · 1]

---

#### 4. CourseOverviewScreen

RN: `screens/CourseOverviewScreen/CourseOverviewScreen.tsx`, `components/CourseSectionBlock.tsx`, `CourseItemRow.tsx`, `CourseLanguageSheet.tsx`, `CourseProgressSheet.tsx`, `utils/trackNavigation.ts`, `utils/trackItemMeta.ts`.
Flutter: `features/courses/presentation/course_detail_screen.dart`, `course_language_sheet.dart`, `course_progress_screen.dart` (v3: `showCourseProgressSheet`), `course_progress_body.dart`, `course_bottom_sheet.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back + "Course" | LearningPathHeader | course_detail_screen.dart | PRESENT | |
| Back fallback to the Learn tab when the stack is empty | `handleBack` / navigateToLearnTab | default pop | PRESENT | v3: still default pop (course_detail_screen.dart:78 `LearningPathHeader` without onBack), but every entry pushes over a stack, incl. the new `/course/:uuid` deep link (core/deeplink/deep_link_binding.dart:83 `router.push`). |
| Fetch `GET /learn/tracks/:id` | useGetLearnTrackDetailQuery | courses_repository.dart `trackDetailProvider` | PRESENT | |
| Loading spinner | ActivityIndicator | course_detail_screen.dart | PRESENT | |
| 403 → "Course not available" EmptyState; other errors → "Course not found" | CourseOverviewScreen.tsx | course_detail_screen.dart (DioException 403 check) | PRESENT | |
| Pull-to-refresh | RefreshControl | RefreshIndicator | PRESENT | |
| Language row "Reading in X · Change" (only with ≥2 languages) | `renderLanguageRow` | course_detail_screen.dart | PRESENT | |
| Language sheet: list, select → `PUT /learn/tracks/:id/language` {languageCode}, errors swallowed, close | CourseLanguageSheet.tsx | course_language_sheet.dart | PRESENT | |
| List header: cover, title, description, progress, completed | LearningPathListHeader | course_detail_screen.dart | PRESENT | |
| Start / Continue: enrol if needed (`POST /learn/tracks/:id/enroll`) → `GET /learn/tracks/:id/next-item` → open player; errors swallowed | `handleStartOrContinue` | `_startOrContinue` | PRESENT | |
| Tap progress bar → CourseProgressSheet (bottom sheet, 70% snap; session → Feedback; Continue → start/continue) | CourseProgressSheet.tsx | course_detail_screen.dart:177-185 → course_progress_screen.dart:90-113 `showCourseProgressSheet` (`showCourseBottomSheet`, heightFraction 0.7) + course_progress_body.dart | PRESENT | v3: closed (`6323de1`). Gated on `enrolled` like RN; session/continue run after the sheet closes, as RN. |
| Section blocks sorted by order: ring with number, title, subtitle | CourseSectionBlock.tsx | `_CourseSectionBlock` | PRESENT | |
| Item row: type badge letter, lock, tick, status chip (Completed / In progress / Next), meta line, language-fallback caption, locked caption, current-item border | CourseItemRow.tsx | `_CourseItemRow`, `trackItemMeta`, `_typeBadge` | PRESENT | |
| "Next" item computed client-side (`findNextItemId`) | utils/trackNavigation.ts | `findNextTrackItemId` | PRESENT | |
| Item tap: locked ignored, otherwise open the player | `handleItemPress` | course_detail_screen.dart:37 `_openItem` | PRESENT | v2: unknown item types now open the player, which shows `_UnsupportedItemCard` (`3ac5dbb`). |
| Refresh after returning from the player (RN mutations invalidate `ALL_TRACK_TAGS`: list, detail, next-item) | services/coursesApi.ts | courses_repository.dart `_invalidateTracks()` on every mutation, wired at :288-291 (learnTracks, trackDetail, trackProgress) | PRESENT | v2: `8e6ad33`/`05e06d0`. |
| Track languages endpoint `GET /learn/tracks/:id/languages` | coursesApi `getTrackLanguages` | courses_repository.dart:74-80 `getTrackLanguages` (ported, `05e06d0`) | N/A | No RN screen calls it; options come from the track detail. |
| Hardware back | useHardwareBackPressHandler | `PopScope(canPop: context.canPop())` → `learningPathBack` (simulation_path_details_screen.dart:30-33) | PRESENT | v3: Android back now takes the same Learn-tab fallback as RN. |
| Analytics | — | — | N/A | RN has none. |

Tally (v3): PRESENT 17 · PARTIAL 0 · MISSING 0 · N/A 2  [v2: 16 · 1 · 0 · 2]

---

#### 5. CourseItemPlayerScreen

RN: `screens/CourseItemPlayerScreen/**` (37 non-test files), `hooks/useTrackPlayerNavigation.ts`, `hooks/useVideoWatchProgress.ts`, `components/DiscussionThread`, `DiscussionPost`, `PostInput`, `utils/activeTrackContext`.
Flutter: `features/courses/presentation/course_item_player_screen.dart` (player shell, PlayerTopBar, rail, bottom nav, `_ArticleView`, `_BreathingExerciseIntro`), `quiz/quiz_player.dart`, `quiz/quiz_question_widget.dart`, `video/*`, `journal/journal_player.dart`, `game/game_player.dart`, `branching/branching_scenario_player.dart`, `bucket_sort/bucket_sort_player.dart`, `roleplay/roleplay_case_player.dart`, `celebration_modal.dart`, `discussion/*`, `data/courses_repository.dart`, `data/discussion_repository.dart`, `data/video_watch_progress.dart`, `data/start_item_payload.dart`, `assets/games/*.html`.

##### Shell / navigation / states

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params trackId, itemId, highlightPostId | navigation/types.ts | app_router.dart:182-196 (`CourseItemPlayerArgs{trackId, item?, highlightPostId}`, opens by id), course_item_player_screen.dart:48-77 | PRESENT | v2. |
| Track fetch for nav (`GET /learn/tracks/:id`) + flatten sections/items | useTrackPlayerNavigation | `_flattenTrackItems`, `trackDetailProvider` | PRESENT | |
| Start item `POST /learn/tracks/items/:id/start` on every item change | `loadItem` | `_start()` | PRESENT | |
| Loading spinner | ActivityIndicator | CircularProgressIndicator | PRESENT | |
| Track-load failure → "trackLoadFailed" + Retry button | `isTrackError` branch | course_item_player_screen.dart:317-320 (`player-track-retry`) | PRESENT | v2. |
| Item-load failure → "loadFailed" + Retry button | `loadError` branch | course_item_player_screen.dart:327-328 (`player-item-retry` → `_loadItem`) | PRESENT | v2. |
| PlayerTopBar: exit X, section eyebrow, item title, description, overall % | PlayerTopBar.tsx | `_PlayerTopBar` | PRESENT | |
| SegmentedProgressRail (current section) | SegmentedProgressRail.tsx | `_SegmentedProgressRail` | PRESENT | |
| PlayerBottomNav: Prev / Next / Finish, gated on `canAdvance` | PlayerBottomNav.tsx | `_PlayerBottomNav` | PRESENT | |
| `justCompleted` optimistic set | CourseItemPlayerScreen.tsx | `_justCompleted` | PRESENT | |
| `alreadyCompleted` passed to article/video/journal = server COMPLETED status OR justCompleted | CourseItemPlayerScreen.tsx | course_item_player_screen.dart:342-366 `_isItemCompleted(item)` | PRESENT | v2: `cc7c787`. |
| Exit / back to overview (pop, else go to the overview) | `handleBackToOverview` | `_exitToOverview` | PRESENT | |
| Celebration modal (section / track complete), confetti, reduce-motion respected | CelebrationModal.tsx | celebration_modal.dart | PRESENT | |
| Celebration stats pill (completedCount) | CelebrationModal `completedCount` | course_item_player_screen.dart:234, 283 | PRESENT | v2. |
| Celebration "Continue" → go to the next item, or the overview | `onContinue` → goNextOrOverview | course_item_player_screen.dart:284-286 → `_goNextOrOverview` (:198) | PRESENT | v2. |
| Celebration "Back to Learn" → Learn tab | navigateToLearnTab | course_item_player_screen.dart:290-293 `goToHomeTab(kTabLearn)` | PRESENT | v3: v2 gap 7 closed (`93ebfa9`): lands on Learn, not the last-open tab. |
| Refetch the track on return from a launched roleplay/case/breathing (`getActiveTrackContext`) | useFocusEffect | `didChangeDependencies` + `_refetchTrackOnReturn` (roleplay/case only) | PRESENT | Breathing doesn't set the flag, which doesn't matter because it completes on mount. |
| Unsupported item type → UnsupportedItemCard (title, body, "Back to course") | UnsupportedItemCard.tsx | course_item_player_screen.dart:389, 424, 429-450 `_UnsupportedItemCard(onBackToCourse)` | PRESENT | v2. |
| Discussion thread under the item when `hasDiscussion` | `DiscussionThread itemId` | discussion/discussion_thread.dart | PRESENT | |
| Discussion `highlightPostId` deep link (from a COURSE_DISCUSSION_REPLY notification → player + scroll/highlight) | NotificationsScreen.tsx → COURSE_ITEM_PLAYER {highlightPostId} | notifications_screen.dart:82 → `CourseItemPlayerArgs(trackId, highlightPostId)` → course_item_player_screen.dart:265 → discussion_thread.dart | PRESENT | v2 (`6661ae8`). Push-tap routing for this type is a §4b row. |
| Discussion CRUD (GET thread, POST post, POST reply, PUT edit, DELETE, PUT lock post, PUT lock discussion) | services/discussionApi.ts | data/discussion_repository.dart | PRESENT | Tenants endpoint now also ported (discussion_repository.dart:27-30). |

##### Article

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Article HTML body | ArticlePlayer.tsx (`RichText`) | article/article_player.dart (`HtmlRichText` segments) | PRESENT | v2 spot-check: ported to a dedicated ArticlePlayer (`2200d4c`). |
| Scroll-progress bar at the top | ArticlePlayer `progressTrack` | article/article_player.dart:235-243 (`article-progress-track`) | PRESENT | v2. |
| Inline questions placed at their anchors in the body (`splitArticleHtml`) | ArticlePlayer `segments` | article/article_player.dart:54-80 `splitArticleHtml`, :261 | PRESENT | v2. |
| ArticleQuestionCard: rich prompt, select then Submit (`POST …/article-questions/:qid/answer`), correct/incorrect + explanation, "answered" hint, resumes from `answered` | ArticleQuestionCard.tsx | article/article_question_card.dart (Submit :151, explanation :138, answered hint :144, resume :42, HTML prompt :102) | PRESENT | v2. |
| QuestionMedia (image with tap-to-expand, embedded video WebView, failure caption) | QuestionMedia.tsx | question_media.dart; start_item_payload.dart:54-82 `media`; used in article_question_card.dart:108, quiz_player.dart:233/663, video_interjection_dialog.dart:93 | PRESENT | v2. |
| Resources list + ExternalResourceSheet (in-app WebView, timeout falls back to the OS browser, documents open externally) | ArticlePlayer resources, ExternalResourceSheet.tsx | article/article_player.dart:207, 229; article/external_resource_sheet.dart | PRESENT | v2. |
| "Mark as read" gated on reaching the end (sentinel / threshold) AND all shown questions answered; "Keep reading" label; last answer auto-completes | ArticlePlayer `canMark` | article/article_player.dart:150-210 (`_canMark`: sentinel / 95% scroll AND all answered), :188 last-answer handling | PRESENT | v2. |

##### Video

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Native S3 playback | VideoPlayer.tsx | video/video_player_widget.dart | PRESENT | |
| Watch progress: unique seconds, 10 s / +10% throttle, flush on pause/end/unmount → `POST …/video-progress` | hooks/useVideoWatchProgress.ts | data/video_watch_progress.dart, video_item_player.dart | PRESENT | |
| YouTube/Vimeo/Loom fallback card (open externally + mark watched) | VideoFallbackCard.tsx | video/video_fallback_card.dart | PRESENT | |
| Interjections: pause at the timestamp, blocking question, submit `POST …/interjections/:id/answer`, result, Continue resumes | VideoInterjectionModal.tsx | video/video_interjection_dialog.dart | PRESENT | v3: question media now rendered (video_interjection_dialog.dart, QuestionMedia row). |
| "Watched" state | VideoItemPlayer | video_item_player.dart | PRESENT | v3: `alreadyCompleted` seeding fixed (course_item_player_screen.dart:186-187, 345). |

##### Quiz

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Intro card: question count, pass score (hidden for surveys), attempts, Start disabled when exhausted | QuizIntro.tsx | quiz_player.dart `_QuizIntro` | PRESENT | |
| One question per page with "Question x of y", Back / Next / Submit | QuizItemPlayer.tsx | quiz/quiz_player.dart (paged, Back / Next / Submit) | PRESENT | v2. |
| 8 question types (MCQ single/multi, true/false, ordering, matching, fill-blank, open-ended, Likert) | quiz/widgets/*.tsx | quiz/quiz_question_widget.dart | PRESENT | v3: matching is now RN's tap-left-then-right pairing with pair colours (quiz_question_widget.dart:263-397); ordering uses up/down arrows in RN too (OrderingQuestion.tsx:19-24). |
| Submit `POST …/quiz-attempts` | `handleSubmit` | `_submit` | PRESENT | Flutter adds an "answer all" check. |
| Results: passed/failed, score, attempts used, "Your responses" with correct answer, explanation and AI feedback per question | QuizResults.tsx | quiz/quiz_player.dart:440-547 `_QuizResults` (survey state :484, correct answer / explanation / AI feedback accordion) | PRESENT | v2. |
| PENDING_GRADING → "Finish grading" (regrade `POST …/quiz-attempts/:aid/regrade`) | QuizItemPlayer `handleRegrade` | quiz/quiz_player.dart:126, :470; courses_repository.dart:205 `regradeQuizAttempt` | PRESENT | v2. |
| Retry: re-fetch `startTrackItem` for a fresh quiz and attempt count | `handleRetry` | quiz/quiz_player.dart:137-142 (fresh `startTrackItem`, `_attemptsUsed` updated) | PRESENT | v2. |
| Confetti on pass (reduce-motion respected) | `fireConfetti` | quiz/quiz_player.dart:90, 288-322 `_QuizConfetti` | PRESENT | v2. |
| Results "Next" button → next item / overview | QuizResults `onNext` | — (bottom nav Next only) | PRESENT | The bottom nav covers it. |
| Completion reported only when `passed && itemCompleted` (with section/track flags) | `applyAttemptResult` | `if (result.passed)` | PRESENT | Close enough: same flags forwarded. |

##### Journal, Game, Breathing, Branching, Bucket sort, Roleplay/Case

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Journal: prompts, required markers, debounced draft autosave `POST …/journal`, submit `POST …/journal/submit`, read-only after submit | JournalPlayer.tsx | journal/journal_player.dart | PRESENT | v2 spot-check OK; `alreadyCompleted` seeding fixed. |
| HTML5 game bundles (6) in a WebView + bridge, `POST …/game-result`, last/best score | GamePlayer.tsx, games/*Html.ts | game/game_player.dart, assets/games/*.html | PRESENT | v3: all 6 RN game keys (TREX_RUNNER, TIC_TAC_TOE, MEMORY_MATCH, CUB_N_PUP, SNAKE, SPROUT) mapped (game_player.dart:19-37); each asset byte-identical to the RN `*Html.ts` string; heights, controlsTouch/lastScore/bestScore/optional strings, bestScore seed and bridge match. |
| Game in-frame localized strings (`window.__allyGameStrings` via FRAME_STRING_KEYS) | GamePlayer.tsx `injectedStrings` | game/game_player.dart:41-117 (`window.__allyGameStrings`) | PRESENT | v2: `9898caf`. |
| Unknown game key → unsupported title + body | GamePlayer `unsupported` | game/game_player.dart:266-282 (title + `unsupportedBody`) | PRESENT | v2. |
| Breathing game key → NativeGamePlayer intro card (completes on mount) → BreathingExercise screen | NativeGamePlayer.tsx | `_BreathingExerciseIntro` → `/breathing-exercise` | PRESENT | |
| Breathing key with no config → UnsupportedItemCard | CourseItemPlayerScreen switch | course_item_player_screen.dart:390-391 `_UnsupportedItemCard` | PRESENT | v3: now the exact RN branch (not the GamePlayer fallback). |
| Branching scenario: intro, nodes, choices, images, outcome / score / takeaway, trail, `POST …/branching-result`, attempts left, exhausted pause with recap and next round, Continue → next | BranchingScenarioPlayer.tsx | branching/branching_scenario_player.dart | PRESENT | Missing only the a11y labels `recapLabel` / `trailLabel`. |
| Bucket sort: tap-to-place `POST …/bucket-sort/place`, per-item feedback, rounds, restart `POST …/bucket-sort/restart`, first-try %, Continue | BucketSortPlayer.tsx | bucket_sort/bucket_sort_player.dart | PRESENT | Missing the `bucketA11y` label. |
| ROLEPLAY/CASE item: launch roleplay (trackItemProgressId) or open the case; assessment mode | RoleplayCasePlayer.tsx | roleplay/roleplay_case_player.dart (+ start_simulation_controller) | PRESENT | v3: assessment mode (RN 7a8ce0c19) compared line by line: roleplay_case_player.dart:54-57 (isAssessment/submittedAt/locked), :128 card tap no-op when locked, :131 assessmentIntro, :135-145 amber notice, :163-170 submitted+notPassed when locked and not completed, :171-197 locked text replaces dropdown+button; start_item_payload.dart:621-624 parses `completionCriteria.assessmentMode` + `assessmentSubmittedAt`; all 5 `courses.roleplay.*` keys identical in en/hi/kn/mr/ta; `formatDate` = `MMM dd`. |
| Accessibility labels on branching / bucket sort | various | branching/branching_scenario_player.dart, bucket_sort/bucket_sort_player.dart (no `Semantics` / labels) | PARTIAL | v3 reclassified (N/A → PARTIAL; strings must port): RN `courses.branching.recapLabel` (BranchingScenarioPlayer.tsx:285), `trailLabel` (:386), `courses.bucketSort.bucketA11y` (BucketSortPlayer.tsx:178) unused in Flutter. |
| Analytics | — | — | N/A | |

##### v3 discovery rows

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| L-N1 Native video controls (react-native-video `controls`: platform play/pause, scrubber, elapsed/duration readout, fullscreen) | players/VideoPlayer.tsx:40-49 (`controls`, `resizeMode="contain"`) | video/video_player_widget.dart:140-185 (`_PlayPauseOverlay` tap toggle + `VideoProgressIndicator(allowScrubbing)`) | PARTIAL | v3 new: no fullscreen and no time readout; play/pause + scrub present. |

Tally (v3): PRESENT 52 · PARTIAL 2 · MISSING 0 · N/A 1 (55 rows incl. L-N1)  [v2: 52 · 0 · 0 · 2 of 54]

---

#### 6. CourseProgressScreen

RN: `screens/CourseProgressScreen/CourseProgressScreen.tsx`, `components/CourseProgressBody.tsx`, `PracticeNudge.tsx`, `LatestFeedbackPreview.tsx`, `RoleplaySessionRow.tsx`, `ScoreTrendSparkline.tsx`, `SectionProgressRow.tsx`, `SkillCategoryRow.tsx`.
Flutter: `features/courses/presentation/course_progress_screen.dart`, `course_progress_body.dart` (v3: shared body, `6323de1`).

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header "Progress" + back | CourseProgressScreen.tsx | course_progress_screen.dart | PRESENT | v3: uses `LearningPathHeader` like RN (`6323de1`). Neither app navigates to this screen (RN registers COURSE_PROGRESS but never navigates to it; Flutter `/courses/:id/progress` likewise); content is shared with the sheet. |
| Fetch `GET /learn/tracks/:id/progress` | useGetLearnTrackProgressQuery | `trackProgressProvider` | PRESENT | |
| Loading / error EmptyState (DataUnavailable icon) | CourseProgressScreen.tsx | course_progress_screen.dart:96-101 (`AppEmptyState`, notFound) | PRESENT | v2: `3ac5dbb`. |
| Overall progress bar + % | CourseProgressBody | course_progress_screen.dart | PRESENT | |
| Section progress rows | SectionProgressRow.tsx | `_SectionProgressRow` | PRESENT | |
| Practice nudge → Continue (`GET …/next-item` → player) | PracticeNudge.tsx | `_PracticeNudge` | PRESENT | |
| Score-trend sparkline | ScoreTrendSparkline.tsx | `_ScoreTrendSparkline` / `_SparklinePainter` | PRESENT | |
| Skill-category rows | SkillCategoryRow.tsx | `_SkillCategoryRow` | PRESENT | |
| Feedback subheading ("based on N evaluated sessions", shown when `evaluatedRoleplaySessionCount > 0`) | CourseProgressBody `feedbackSubheading` | course_progress_screen.dart:160-168 (`feedbackSubheading_one/_other`) | PRESENT | v2. |
| Latest feedback preview + roleplay session rows → Feedback(scenarioSessionId) | LatestFeedbackPreview.tsx, RoleplaySessionRow.tsx | `_LatestFeedbackPreview`, `_RoleplaySessionRow` → `/simulations/feedback/:id` | PRESENT | v3: chevron is RN `chevronRight.svg` (course_progress_body.dart:568); v2 gap 46 (Learn chevron) closed. |
| Analytics | — | — | N/A | |

Tally (v3): PRESENT 10 · PARTIAL 0 · MISSING 0 · N/A 1  [v2 same]

---

#### 7. BreathingExerciseScreen (course GAME / BREATHING_EXERCISE)

RN: `screens/BreathingExerciseScreen/BreathingExerciseScreen.tsx`. Flutter: `features/courses/presentation/breathing_exercise_screen.dart`.
(`BoxBreathingScreen` / `features/boxbreathing` is the separate post-call Scribe screen, outside this scope.)

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Dot tracing the square edges, one per phase with per-phase duration | BreathingExerciseScreen.tsx | breathing_exercise_screen.dart | PRESENT | |
| Phase text (inhale/hold/exhale/hold, from config) | same | same | PRESENT | |
| Cycle counter "x of y", stops after `cycles` | same | same | PRESENT | |
| Exit button → goBack | `handleExit` | `context.pop()` | PRESENT | |
| Config passed via route params | navigate BREATHING_EXERCISE {config} | `/breathing-exercise` extra | PRESENT | |
| Sets the active-track context so the player refetches on return | NativeGamePlayer `setActiveTrackContext` | course_item_player_screen.dart:380-385 (`onLaunched: () => _refetchTrackOnReturn = true`) | PRESENT | v2. |
| Analytics | — | — | N/A | |

Tally (v3): PRESENT 6 · PARTIAL 0 · MISSING 0 · N/A 1  [v2 same]

---

#### 8. SimulationAssistantScreen — live roleplay voice session

RN: `screens/SimulationAssistantScreen/SimulationAssistantScreen.tsx` + 37 component files (SessionChecklist, SessionInfoTabs, LiveFeedback, SessionGoalTimer, SessionProgress, ScenarioInfoOverlay, SimulationTimer, SimulationControls, SpeakingIndicator, TurnIndicator, EndingSoonModal, SimulationCountdown, SessionScoreMeter, ParticipantTile, AudioWave/useAudioLevel).
Flutter (master, after merge `e248a07`): `features/roleplay/presentation/roleplay_voice_screen.dart`, `checklist_panel.dart`, `session_info_tabs.dart`, `participant_tile.dart`, `turn_state.dart`, `live_feedback_toast.dart`, `session_score_meter.dart`, `pause_resume_state.dart`, `core/realtime/livekit_room_service.dart`, v3: `roleplay_audio_session.dart`, `participant_audio_level.dart`, `simulation_sound_player.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params: sessionData {id, accessToken, liveKitServerUrl}, scenario, pathId, caseId, languageId | navigation/types.ts | app_router.dart:204-218 (`pathId`, `caseId`, `languageId` read from extra) → roleplay_voice_screen.dart:96-117 | PRESENT | v2: `c29e765`. |
| Auto-connect on mount (100 ms guard) | `handleConnect` useEffect | roleplay_voice_screen.dart:241-244 (`_connectTimer = Timer(_connectDelay, _connect)`) | PRESENT | v2: `b82d84f`. Manual Connect button gone. |
| AudioSession configuration (Android communication preset / iOS) before connect | `configureAudioSession` | roleplay_audio_session.dart:29-51 (`LiveKitClient.initialize(... AndroidAudioSessionConfiguration.media)`, `AudioManager.setSpeakerOutputPreferred(true)`); roleplay_voice_screen.dart:474-480 (before connect, `errors.audioSession` on failure) | DEVICE-CHECK | v3: code added (`39f4ee2`). Routing (speaker vs earpiece, BT/headset precedence, Android media preset) only provable on device. |
| Keep screen awake during the call | activateKeepAwake / deactivateKeepAwake | roleplay_voice_screen.dart:235-236, 250 (`keepAwakeProvider` activate/deactivate) | PRESENT | v2: `b82d84f`. |
| Start-simulation ringtone on mount, stopped when the agent speaks; end sound on disconnect | `playNotificationSound(sounds.start/endSimulation)`, SoundPlayer | roleplay_voice_screen.dart:245-246 (start), :517-524 `_transitionToAgentJoined` → `_sound.stop()`, :566 (end); simulation_sound_player.dart (`stop`) | PRESENT | v3: closed (`39f4ee2`); stop on agent join. |
| 3-2-1 countdown overlay | SimulationCountdown | roleplay_voice_screen.dart:241, 539-552 (on mount) | PRESENT | v2. |
| Room status: connecting → connected → ringing → AGENT_JOINED (agent speaks, or 1.5 s silent grace after the participant joins) | attachRoomListeners `transitionToAgentJoined`, AGENT_SILENT_GRACE_MS | roleplay_voice_screen.dart:137, 487-506 (`_onParticipantConnected`, 1.5 s silent grace, `_transitionToAgentJoined`; timer starts on participant join) | PRESENT | v2: `b82d84f`. |
| Loader text (connecting / waiting for agent / ending) + mic prompt | `renderLoader` | `_buildLoader` | PRESENT | |
| Room disconnected by the agent/server → end sound + `navigation.replace(Feedback)` | `onDisconnected` | roleplay_voice_screen.dart:463-465, 510-532 (`_onRoomDisconnected` → end sound → `pushReplacement` Feedback) | PRESENT | v2: `b82d84f`. |
| Session timer (elapsed, freezes while paused) | SimulationTimer.tsx | `_elapsed` / `_onTick` | PRESENT | |
| 30 s-remaining warning → EndingSoonModal (Continue / End) | SimulationTimer `onWarning`, EndingSoonModal.tsx | `_showEndingSoon` dialog | PRESENT | |
| Auto-end at time limit + 15 s grace | `onTimeLimit` | `_onTick` → `_endCall` | PRESENT | |
| SessionGoalTimer (when `timerMode`: "x min y sec remaining", session-timer label) | SessionGoalTimer.tsx | session_goal_timer.dart; roleplay_voice_screen.dart:711; simulation_models.dart:122-124 `timerMode` | PRESENT | v2. |
| SessionProgress (scenario `stateNames` progress) | SessionProgress.tsx | session_progress.dart; roleplay_voice_screen.dart:727; simulation_models.dart:126-129 `stateNames` | PRESENT | v2. |
| AI ParticipantTile + learner picture-in-picture, speaking border/pulse | ParticipantTile.tsx | participant_tile.dart | PRESENT | |
| Audio-level waveform (`useAudioLevel`, polled 100 ms) | AudioWave/useAudioLevel.ts | participant_audio_level.dart:16-74 (100 ms `audioLevel` poll while speaking, threshold 0.01); roleplay_voice_screen.dart:530-560 `_attachLevel`/`_levelTile` | PRESENT | v3: closed (`39f4ee2`). RN uses the level only for `isSpeaking = level > AUDIO.THRESHOLD` (ParticipantTile.tsx:53-54); same here. |
| TurnIndicator / SpeakingIndicator (thinking / AI speaking / your turn), AGENT_STATE data messages, debounced remote speaking | TurnIndicator.tsx, SpeakingIndicator.tsx | turn_state.dart `deriveTurnStates`, participant_tile.dart | PRESENT | |
| ScenarioInfoOverlay (i): title + trigger warnings | ScenarioInfoOverlay.tsx | roleplay_voice_screen.dart (scenario info overlay) | PRESENT | |
| Info tab bar: Checklist / Reminders / Description (each tab only when it has content) | SimulationAssistantScreen `infoTabs`, SessionInfoTabs.tsx | session_info_tabs.dart | PRESENT | |
| SessionChecklist (CHECKLIST mode, ticked via `detected_event_ids`); falls back when there are 0 events | SessionChecklist.tsx | checklist_panel.dart | PRESENT | |
| LiveFeedback toast (emoji + message), hidden in checklist/focus mode | LiveFeedback.tsx | live_feedback_toast.dart | PRESENT | |
| SessionScoreMeter (accumulated score; hidden when `showScoreMeter === false`) | SessionScoreMeter.tsx | session_score_meter.dart | PRESENT | |
| SimulationControls: collapsible button group (mic, focus, pause, end) | SimulationControls.tsx | roleplay_voice_screen.dart (`_controlsMaximized`) | PRESENT | Merged via `517c5e4`. |
| Mic toggle (error toast `errors.toggleMic`) | `handleToggleMic` | roleplay_voice_screen.dart:609-615 `_toggleMic` | PRESENT | v3: behaviour present; error surface counted in the error-toast row. |
| Focus mode (hidden for NONE experience mode) | `showFocusButton={!isNoneMode}` | `_isFocusMode` | PRESENT | |
| Pause/resume (only when `pauseEnabled === true`): mic off, clock frozen, publish {type:pause/resume}, 2.5 s ack timeout revert + `errors.pauseControl` | `handleTogglePause`, `armControlAck` | pause_resume_state.dart, `_togglePause` | PRESENT | |
| Agent control messages paused/resumed ack, cap-warning → EndingSoon, cap-ended | onDataReceived | roleplay_voice_screen.dart:323 (`cap-ended` no-op) + disconnect handler :510 | PRESENT | v2: the room-disconnect listener now exists, so cap-ended leaves for Feedback. |
| End session: disconnect, `POST /learn/scenario-session/:id/end` {enableRecommendations:true}, always replace with Feedback (in `finally`) with pathId/caseId/languageId | `handleDisconnect` | roleplay_voice_screen.dart:636-660 (`finally` → `_goToFeedback` with pathId/caseId/languageId); simulations_repository.dart:120-131 (body `{enableRecommendations:true}` + invalidation) | PRESENT | v2. |
| Hardware/system back during the session → "End Simulation?" IllustratedModal | useHardwareBackPressHandler + IllustratedModal | `PopScope` + `_showEndConfirmation` | PRESENT | |
| Dark full-bleed call layout, RN info-tab styling | styles.ts | roleplay_voice_screen.dart | PRESENT | Merged via `517c5e4`. |
| Error toasts (`errors.connect` / `attachListeners` / `audioSession` / `toggleMic`) | useErrorToast | roleplay_voice_screen.dart:156, 453, 479, 488, 498, 669 set `_error`; rendered inline :825-832 | PARTIAL | v3 reclassified (PRESENT → PARTIAL, not a regression): RN `showErrorToast(error, key)` (SimulationAssistantScreen.tsx:379, 571, 580, 612, 638, 654) is a transient toast with the backend reason; Flutter shows a persistent red line with the key text only. App toast host now exists (`05d78c1`), so this is a code gap. |
| Mic permission | requested upstream in useStartSimulation | start_simulation_controller.dart:178 (before session start); roleplay screen no longer requests it (:449-453) | PRESENT | v2: Settings alert present (core/realtime/microphone_permission.dart). |
| Background audio (call continues when the app is backgrounded) | LiveKit SDK | ios/Runner/Info.plist:62-64 (`UIBackgroundModes` audio); AndroidManifest FOREGROUND_SERVICE_MICROPHONE + service :79-84 | DEVICE-CHECK | v3: config exists (superset of RN, which declares only remote-notification); behaviour only provable on device. |
| Credits refresh after the session | endScenarioSession invalidates SimulationCredits | — | N/A | Counted in §3. |
| Analytics | — | — | N/A | |

Tally (v3): PRESENT 30 · PARTIAL 1 · MISSING 0 · DEVICE-CHECK 2 · N/A 2  [v2: 30 · 2 · 1 · – · 2]

---

#### 9. SimulationFeedbackScreen

RN: `screens/SimulationFeedbackScreen/SimulationFeedbackScreen.tsx` + 47 component files, `components/FeedbackPopup`, `components/SessionRatingTrigger`, `hooks/useHideReviewDetails.ts`, `hooks/useToggleReviewPrivacy.ts`, `hooks/useSimulationSessionRecordingUrl.ts`, `hooks/useSimulationTranscriptDetails.ts`.
Flutter (master, after merge `e248a07`): `features/simulations/presentation/simulation_feedback_screen.dart`, `simulation_transcript_tab.dart`, `widgets/feedback/{debrief_tab,debrief_sections,supervisor_note,feedback_popup,feedback_widgets}.dart`, `core/widgets/ask_ai_chat/*`, `data/simulation_transcript_repository.dart`, `data/simulations_repository.dart`, `data/simulation_models.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params scenarioSessionId, fromLogs, pathId, caseId | navigation/types.ts | app_router.dart:264-266 (`pathId`, `caseId`, `languageId` query params); simulation_feedback_location.dart | PRESENT | v2. |
| Fetch `GET /learn/scenario-session/:id?enableRecommendations=true`, polling every 3.5 s ×7 until feedback lands (or both tabs off); retry-limit state | `fetchSimulationDetailsWithRetry` | `_fetchWithRetry` / `_restartPolling` | PRESENT | |
| Restart polling when the UI language changes | effect on `activeLanguageCode` | simulation_feedback_screen.dart:444-459 (`ref.listen(localizationControllerProvider)` → `_restartPolling`) | PRESENT | v2: `bc9381b`. |
| Restart polling on screen re-focus | useFocusEffect | simulation_feedback_screen.dart:381-389 `_onRefocus`, :495-496 `ScreenFocusListener` (core/navigation/screen_focus_listener.dart) | PRESENT | v3: closed (`0894fa5`); any pushed route returning restarts the poll and refetches the review / hide-review check. |
| Header: back arrow, "Simulation *Summary/End*" (by fromLogs) | `renderTitle` | `_buildTitle` | PRESENT | |
| Title / tabs gated by `view:session-scenario-messages` | `hasScenarioMessagesPermission` | `canSeeMessages` | PRESENT | |
| Share switch (feedback on, not a short session): on with no review or a review <10 min old → share flow; otherwise toggle privacy (toasts) | `CustomSwitch onToggle`, useToggleReviewPrivacy | `_buildTitle` switch, `_shareSimulation`, privacy toggle + `privacyUpdated` / `errorUpdatePrivacy` snackbars | PRESENT | v3: privacy toasts are now RN-style toasts (simulation_feedback_screen.dart:408, 411). |
| Share for review → ShareForReview(reviewId, scenarioSessionId, scenarioData, note) | `handleShareSimulation` | `/share-for-review/:id` extra | PRESENT | |
| Review fetch `GET` review by id (status, note, createdAt) | useGetReviewByIdQuery | `_loadReview` (reviews_repository) | PRESENT | |
| SessionRatingTrigger (5 stars, sm) → opens the popup with that rating | SessionRatingTrigger | feedback_widgets.dart `SessionRatingTrigger` | PRESENT | |
| FeedbackPopup (title, stars, caption, per-rating tag chips, comment, Submit) | components/FeedbackPopup | feedback_popup.dart | PRESENT | |
| Auto-open the rating popup on a fresh session without feedback; adopt existing `sessionFeedback` | init effect | `_handledFeedbackInit` | PRESENT | |
| Leave-without-rating interception (popup source auto/leave/manual) | `handleFeedbackAndNavigate`, `hideFeedbackPopup` | `_onBackPressed`, `_hidePopup`, PopScope | PRESENT | |
| Submit `POST /learn/scenario-session/:id/feedback` {rating, feedback, tags} + success/fail toast; leave after submit when source=leave or feedback is disabled | `submitFeedback` | `_submitFeedback` | PRESENT | |
| Back: path/case → reset to path/case details; fromLogs → goBack; otherwise → Learn tab | `handleBack` | simulation_feedback_screen.dart:245-264 (`goToHomeTab(kTabLearn)` then push details; fromLogs pop; else `goToHomeTab`) | PRESENT | v3: v2 gap 7 closed (`93ebfa9`): lands on Learn, not the last-open tab. |
| `feedbackTabs` (debrief / transcript toggles), DEFAULT fallback, both off = rating only | `feedbackTabs`, `feedbackEnabled` | `showDebriefTab` / `showTranscriptTab` / `feedbackEnabled` | PRESENT | |
| Short session (≤30 s) → only the "Session Review" tab (ShortSessionUI card) | getSimulationSummaryTabs, SummaryTab → SimulationSummary → ShortSessionUI | feedback_widgets.dart:336-366 (title row + `help.svg` 14pt → `SimulationInfoModal.show`), simulation_info_modal.dart | PRESENT | v3: closed (`0894fa5`); modal shows scenario title header, `simulationPage.simulationDetails`, cover video/image, description, as RN SimulationSummary.tsx:70-112. v2 gap 46 (help icon) closed. |
| SimulationSummarySkeleton while loading | SummaryTab | `_NoteSkeleton` / summary loading | PRESENT | |
| Tab bar (scrollable, primary indicator), active tab falls back to the first | `renderTabBar`, effect | `_buildTabBar`, TabController rebuild | PRESENT | |
| EventChecklist (CHECKLIST mode, not short): `GET /learn/scenario-session/:id/event-checklist`, green/red rows | EventChecklist.tsx | feedback_widgets.dart `EventChecklist`, repository `getEventChecklist` | PRESENT | |
| DebriefTab: header, generating skeleton + hint, failed state, SupervisorNote | Debrief/DebriefTab.tsx | widgets/feedback/debrief_tab.dart | PRESENT | |
| SupervisorNote: Ally avatar, "from Ally", AI-generated badge + tooltip, sections, `**bold**`, `[[msg:id]]` → "See this moment" chips | Debrief/SupervisorNote.tsx, debriefSections.ts | supervisor_note.dart, debrief_sections.dart | PRESENT | |
| Moment chip → switch to Transcript, page until the row loads, scroll + highlight; "moment not found" toast | `handleOpenMoment`, SimulationTranscript | `_openMoment`, simulation_transcript_tab.dart | PRESENT | |
| Ask-AI reply thread: history `GET /learn/scenario-sessions/:id/chat/history`, SSE stream `POST …/chat/stream`, streaming bubble, citations table, interrupted state, error + Retry, 2,000-char limit, keyboard handling | AskAI/chatSessionManager.ts, useAskAIChat.ts, ChatElements.tsx, DebriefReplyInput.tsx | core/widgets/ask_ai_chat/{ask_ai_chat_api,controller,widgets,markdown,sse_event_parser}.dart | PRESENT | RN keeps a module-level session store, so a stream survives leaving the screen. Flutter's controller is screen-scoped and cancels on dispose. |
| Read-only debrief from Logs (no reply thread) | `readOnly={fromLogs}` | `readOnly` | PRESENT | |
| Transcript tab: card, accuracy disclaimer, paginated `GET /learn/scenario-session/:id/messages` (10/page), learner/AI tinted rows, `mm:ss Speaker`, agent name, empty state | TranscriptTab, SimulationTranscript, SimulationTranscriptItem, EmptyTranscript | simulation_transcript_tab.dart | PRESENT | |
| Session recording player: `GET /learn/scenario-session/:id/recording` presigned URL, play/pause/seek, "no recording" text | SimulationAudioPlayer.tsx (571 lines), useSimulationSessionRecordingUrl.ts | simulation_transcript_tab.dart:84-111, 360-373; simulation_transcript_repository.dart:88; reviews/presentation/simulation_audio_player.dart:62-92, 115, 130 | PRESENT | v3: playback speed persisted under RN `AUDIO_PLAYBACK_RATE` (`930992c`); v2 gap 45 (speed) closed. |
| Playback-synced transcript highlighting + tap-to-seek | SimulationTranscript | simulation_transcript_tab.dart:140-146 `_seekTo`, :341 tap-to-seek, playback highlight | PRESENT | v2. |
| Transcript translation language dropdown | SimulationTranscript `useLanguageDropdown`, languageCodeEndpoints | simulation_transcript_tab.dart:31-33, 81-82, 165-203 (`languageCode` on `/messages`) | PRESENT | v2. |
| Floating review button (feedback on, not the Debrief tab, review exists, `!hideReviewDetails`, `view:simulation-review`) → ReviewDetails | `handleViewReview`, useHideReviewDetails (threads / reactions count) | `_ReviewButton`, `_checkHideReviewDetails` (getThreads, getReactionsCount) | PRESENT | |
| "Try another simulation" button (not Debrief, not fromLogs, no path/case, details loaded) | `renderTryAnotherSimulation` → `handleSubmit` (opens the rating popup) | simulation_feedback_screen.dart:476-481 (hide conditions), :560-566 `setState(_popupVisible = true)` | PRESENT | v3: closed (`0894fa5`); reopens the rating popup like RN `handleSubmit` (SimulationFeedbackScreen.tsx:365-367, 404-411). |
| Hardware back → same interception | useHardwareBackPressHandler | PopScope | PRESENT | |
| Lazy tab placeholder spinner | TabView `renderLazyPlaceholder` | TabBarView | PRESENT | |
| Session date/duration for share (`formatDurationAsMMSS`) | handleShareSimulation | `_shareSimulation` (seconds string) | PRESENT | |
| Reactions (count drives review-button visibility) | useLazyGetReactionsCountQuery | reactions_repository `getReactionsCount` | PRESENT | |
| Language-translated payload headers (languageCodeEndpoints) | services/languageCodeEndpoints.ts | core/network (`languageCode` interceptor, `249653c`) | PRESENT | v2: now real; see §5. |
| SessionGlimpse | components/SessionGlimpse | — | N/A | Not rendered anywhere in RN (dead code). |
| ExpandableFeedbackSection + RecommendationBox | components/ExpandableFeedbackSection, RecommendationBox | — | N/A | Not rendered in RN (dead code). |
| PrivacyToggle | components/PrivacyToggle | — | N/A | Not rendered in RN; the header switch replaces it. |
| FeedbackDropdown | components/FeedbackDropdown | — | N/A | Not rendered in RN. |
| UpNextSimulationCard / SimulationTransitionSection / useSimulationTransition (up-next transition, `GET …/upcoming-scenario`) | components/SimulationTransitionSection, UpNextSimulationCard, hooks/useSimulationTransition.ts | — | N/A | Exported but never rendered by any RN screen. `upcoming-scenario` endpoints are unused in live RN UI. |
| Standalone AskAI panel + AskAiInitialState | components/AskAI/AskAI.tsx, AskAiInitialState.tsx | — | N/A | Not rendered in RN; DebriefTab uses the hook directly. |
| SummaryCard reuse (CallTranscript) | components/SummaryCard | feedback_widgets.dart `FeedbackSummaryCard` | PRESENT | |
| Analytics | — | — | N/A | |

Tally (v3): PRESENT 37 · PARTIAL 0 · MISSING 0 · N/A 7  [v2: 34 · 3 · 0 · 7]

---

#### Backend calls checklist (Learn scope)

| Method + path | RN caller | Flutter |
|---|---|---|
| GET /learn/scenarios | SimulationsScreen | PRESENT |
| GET /learn/scenarios/:id | (fallback) | PRESENT |
| GET /learn/scenario-paths, GET /learn/scenario-paths/:id, POST …/create-session | Learn tab / Path details | PRESENT |
| GET /learn/cases, GET /learn/cases/:id, POST …/create-session | Learn tab / Case details | PRESENT |
| GET /learn/scenario-session/{scenario-path-session-item,case-session-item}/:id | file-icon lookup | PRESENT |
| GET /simulation-credits | credits | PRESENT |
| POST /learn/scenario-session-start | useStartSimulation | PRESENT |
| POST /learn/scenario-session/:id/end (body enableRecommendations) | Assistant / ActiveSimulationModal | PRESENT (v2: body + invalidation, simulations_repository.dart:120) |
| GET /learn/scenario-session/:id?enableRecommendations=true | Feedback | PRESENT |
| POST /learn/scenario-session/:id/feedback | Feedback | PRESENT |
| GET /learn/scenario-session/:id/messages | Transcript | PRESENT |
| GET /learn/scenario-session/:id/recording | Audio player | PRESENT (v2: simulation_transcript_repository.dart:88) |
| GET /learn/scenario-session/:id/event-checklist | EventChecklist | PRESENT |
| GET/POST /learn/scenario-sessions/:id/chat/{history,stream} | Debrief Ask-AI | PRESENT |
| GET /learn/scenario-paths/:id/upcoming-scenario, GET /learn/cases/:id/upcoming-scenario | dead RN code | N/A |
| GET /learn/tracks, /:id, /:id/progress, /:id/next-item; POST /:id/enroll; PUT /:id/language | Course screens | PRESENT |
| POST /learn/tracks/items/:id/{start,article-read,video-progress,quiz-attempts,game-result,branching-result,bucket-sort/place,bucket-sort/restart,journal,journal/submit} | Player | PRESENT |
| POST …/article-questions/:qid/answer, …/interjections/:iid/answer | Player | PRESENT |
| POST /learn/tracks/items/:id/quiz-attempts/:aid/regrade | Quiz | PRESENT (v2: courses_repository.dart:205) |
| GET /learn/tracks/:id/languages | unused by RN UI | N/A (ported anyway, courses_repository.dart:80) |
| Discussion GET/POST/PUT/DELETE + locks | Player discussion | PRESENT (tenants endpoint also ported, discussion_repository.dart:30) |
| GET /badges/me (BadgePopup polling) | Learn tab BadgePopup | PRESENT (v2: badge_popup.dart) |

v3: backend checklist re-grepped (simulations_repository.dart:27-187, simulation_transcript_repository.dart:59/88, ask_ai_chat_api.dart:34-36, courses_repository.dart:53-281); all PRESENT, no change.

### §2d Reviews (from reviews_and_components part A)

### Parity ledger — Reviews (Part A) and shared components (Part B)

RN source of truth: `ally-platform/ally-mobile/src` at `7a8ce0c19` (only a release-bot version bump has landed in `ally-mobile` since). v3 baseline (2026-10-28): Flutter worktree `ally-mobile-flutter-wt-ledger` at **f770200** (v2 was 227db3a). Since v2: f87fa32 (review cover video, share args carry cover + description, details refetch), 41744fd (rn-emoji-keyboard port), a6d4e24 (SVG badge art, info.svg), 3e47357 (Search ResourceArticleCard + underline CustomTabs), 67e7051/64636fa (call-summary CustomDropdown + CustomSwitch), 05d78c1/aedd4b1 (RN toast host + getErrorDetails; no SnackBar left), 81622e1 (dead `app_chat_input.dart` / `emoji_insert_picker.dart` removed). v3 re-read every non-PRESENT row and spot-checked 60+ PRESENT rows against current code; verdicts are from code only.

Status key: **PRESENT** = master has the behaviour (or the same behaviour under another name). **PARTIAL** = master has part of it (the Notes column says what is missing). **MISSING** = master has nothing. **N/A** = RN never renders it, or it is gated to dev builds. v3 adds **BLOCKED-EXTERNAL** (code present; needs credentials/admin config to work) and **DEVICE-CHECK** (code present; only provable on a device). PARTIAL/MISSING are true code gaps only.

#### Tallies

| Part | Rows | PRESENT | PARTIAL | MISSING | BLOCKED-EXTERNAL | DEVICE-CHECK | N/A |
|---|---|---|---|---|---|---|---|
| A — Review screens + hooks | 77 | 72 [69] | 3 [5] | 0 [1] | 0 | 0 | 2 [2] |
| B — Shared components (67 dirs; sub-components split into 72 rows) | 72 | 63 [59] | 0 [7] | 0 [0] | 2 [–] | 1 [–] | 6 [6] |

v2 → v3 (v2 in brackets above): Reviews 69/5/1 → 72/3/0 (PRESENT/PARTIAL/MISSING); components 59/7/0 → 63/0/0 + 2 BLOCKED-EXTERNAL + 1 DEVICE-CHECK. 17 status changes (Reviews 7, components 10). Two Reviews rows moved PRESENT → PARTIAL on a new code finding (A4.1, A4.8: share screen treats every reviewId as edit-note), not a regression since v2.

---

#### Part A — Review screens

Flutter files (f770200): `lib/features/reviews/presentation/{review_screen,review_card,review_widgets,review_details_screen,review_details_parts,review_conversation,review_comment_sheets,comment_list_controller,share_for_review_screen,review_note_callout,simulation_details_card,simulation_audio_player,review_formatting}.dart`, `presentation/emoji_keyboard/{emoji_keyboard,emoji_keyboard_data}.dart`, `lib/features/reviews/data/{review_api,reviews_repository,scribe_reviews_repository,review_models}.dart`.
`thread_detail_screen.dart` no longer exists on master.

##### A1. ReviewScreen (Review tab) — RN `screens/ReviewScreen/ReviewScreen.tsx`, `components/ReviewList.tsx`, `hooks/useReviews.ts`, `constants/reviews.ts`

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A1.1 | Header | `TabScreenHeader title=review.title` | `review_screen.dart` `TabScreenHeader` | PRESENT | |
| A1.2 | Type tabs gate | Scribe/Simulation `TabView` (underline TabBar) only when user has both `VIEW_SIMULATION_REVIEWS` and `VIEW_SCRIBE_REVIEWS`; Scribe first; with only one permission that list renders directly | `features/reviews/presentation/review_screen.dart:118` `_ReviewTypeTabBar` + permission logic | PRESENT | |
| A1.3 | Detail-open gate | `VIEW_SIMULATION_REVIEW` / `VIEW_SCRIBE_REVIEW` → `canViewReview`; when false, "Review Conversation" link is hidden and the comment preview can't open details | `features/reviews/presentation/review_screen.dart:62,321` (`onOpenReview: canViewReview ? … : null`) → `review_card.dart:191` link hidden | PRESENT | |
| A1.4 | No-permission fallback | Neither permission → simulation list (`reviewTypeTabs[0] ?? SIMULATION`) | `features/reviews/presentation/review_screen.dart:94` `AppEmptyState` | PRESENT | |
| A1.5 | BadgePopup | `isReviewerOnly(permissions) && <BadgePopup/>` on the Review tab | `core/navigation/app_shell_screen.dart:95-165` `BadgePopupHost` (Learn tab, and Review tab for `isReviewerOnly`); `features/achievements/presentation/badge_popup.dart` | PRESENT | v2: landed in a5d3ce7/557dc55. |
| A1.6 | Read filter | All/Read/Unread pill `TabView tabWidthMode="content"` | `features/reviews/presentation/review_screen.dart:358` `_ContentWidthTabs` | PRESENT | |
| A1.7 | Sort dropdown | `CustomDropdown alignModalRight`: Latest / Most viewed / Most commented | `features/reviews/presentation/review_screen.dart:452` `_SortDropdown` (right-aligned card) | PRESENT | v3: private port, not `core/widgets/custom_dropdown.dart`; behaviour matches. |
| A1.8 | Filter/sort change | Resets offset, clears list, refetches | master: new family-provider key → refetch | PRESENT | |
| A1.9 | Pagination | `useReviews` LIMIT 10, `onEndReached` 0.5, `hasMore = page==10 && offset+len<count` | `features/reviews/presentation/review_screen.dart:192,235` (10/page, `hasMore` as RN, scroll threshold 0.5 at :259); `data/reviews_repository.dart:26-37` + `scribe_reviews_repository.dart:22-33` send `order: DESC` | PRESENT | `languageCode` injected for `getReviews` by `core/network/language_code_interceptor.dart:40`. |
| A1.10 | Pull-to-refresh | `FlatList refreshing/onRefresh` | `features/reviews/presentation/review_screen.dart:305` `RefreshIndicator` | PRESENT | |
| A1.11 | Refresh on re-focus | `useFocusEffect` → `refresh()` on every return after the first | `features/reviews/presentation/review_screen.dart:271` `ScreenFocusListener(onFocus: _fetch(reset: true))` | PRESENT | v2: landed in 023b77c. |
| A1.12 | Loading state | Footer `ActivityIndicator` while loading/fetching/hasMore | `features/reviews/presentation/review_screen.dart` footer spinner | PRESENT | |
| A1.13 | Empty state | `EmptyState` icon `EmptyReviewIcon` + `review.empty.title` + `review.empty.description` | `features/reviews/presentation/review_screen.dart:325` `AppEmptyState(emptyReviews.svg, title, description)` | PRESENT | |
| A1.14 | Error state | `showToast(review.error.title,'error')`; list stays | `features/reviews/presentation/review_screen.dart:243` `showToast(review.error.title, type: ToastType.error)` | PRESENT | v3: RN-styled error toast (aedd4b1). |
| A1.15 | Navigation → details | `REVIEW_DETAILS` or `SCRIBE_REVIEW_DETAILS` `{reviewId}` | `/reviews/:id` (+ `extra: ReviewType.scribe`) | PRESENT | Master's simulation path pushes without `extra` (defaults to simulation, fine). |
| A1.16 | Mark-as-read timing | Not on tap; details screen marks read after 10 s | `features/reviews/presentation/review_details_screen.dart:81` 10 s `_markReadTimer`; list tap is a plain push (`review_screen.dart:252`) | PRESENT | |
| A1.17 | Unread dot on Review tab | `TabNavigator` sums sim + scribe unread counts | `app_shell_screen.dart:100` → `unreadReviewCountProvider` (`data/reviews_repository.dart:131`) sums sim + scribe counts, each asked only of users with the matching permission | PRESENT | v2: scribe count now included. v3: now also invalidated after mark-read (`review_details_screen.dart:93`) and on list re-focus (`review_screen.dart:277`) — fresher than RN, harmless. |
| A1.18 | Analytics | None in RN review screens/hooks (grep: no analytics/logEvent) | — | N/A | |

##### A2. ReviewCard (list item) — RN `ReviewScreen/components/ReviewCard.tsx`, `ExpandedComments.tsx`, `ReactionsCount.tsx`

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A2.1 | Author row | `UserProfileImage` (36, image or initial with border) + name + `formatRelativeTime` | `features/reviews/presentation/review_card.dart:136` `ReviewUserAvatar` (`review_widgets.dart:23`) | PRESENT | |
| A2.2 | Note | Full note text | `review_card.dart` | PRESENT | |
| A2.3 | Simulation body | Date&time / Duration rows, then `SimulationDetailsCard` (cover, chip, title, plain-text description with View more) | `review_card.dart` + `simulation_details_card.dart` | PRESENT | |
| A2.4 | Scribe body | `SimulationDetailsCard` titled `summaryName`, Date/Duration rows inside | `review_card.dart` | PRESENT | |
| A2.5 | Cover video | `SimulationDetailsCard` plays `coverVideoUrl` via `VideoPreview` | `features/reviews/presentation/simulation_details_card.dart:71-73` `CoverVideoPreview` (image as thumbnail/fallback); `review_card.dart:178` passes `coverVideoUrl` | PRESENT | v3: MISSING → PRESENT (f87fa32). |
| A2.6 | Audio player | `SimulationAudioPlayer` when sim review has `audioUrl` | `simulation_audio_player.dart` | PRESENT | |
| A2.7 | Reactions summary | `ReactionsCount`: top-3 emoji bubbles overlapped + `pluralize(n,'reaction')` → `REACTIONS {reviewId, reviewType}` | `features/reviews/presentation/review_card.dart:212` `ReactionsCount` (`review_widgets.dart:647`, top-3 bubbles) | PRESENT | |
| A2.8 | Comment-count toggle | Tap → fetch general-comments overview (offset 0, limit 2) once, expand inline; tap again collapses; 0 comments = no-op | `features/reviews/presentation/review_card.dart:87` `_toggleComments` | PRESENT | |
| A2.9 | ExpandedComments | Spinner while loading; ≤2 `ReviewComment`s (no reply/reaction buttons; tap → details); "No comments yet"; "Show more" when count>2; "Collapse" with chevron | `features/reviews/presentation/review_card.dart:256` `ExpandedComments` | PRESENT | |
| A2.10 | Review Conversation link | `ChatAddOnIcon` + `review.feedCard.reviewTranscript`, only when `onReviewPress` | `features/reviews/presentation/review_card.dart:191-200` (`chatAddOn.svg`, only when `onOpenReview`) | PRESENT | |

##### A3. ReviewDetailsScreen — RN `SimulationReviewDetailsScreen.tsx`, `ScribeReviewDetailsScreen.tsx`, `components/ReviewDetailsLayout.tsx`, `GeneralCommentsSection.tsx`, `ReviewNote.tsx`, `hooks/useReviewDetailsLogic.ts`, `useReviewComments.ts`, `contexts/ReviewApiContext.tsx`

Master `review_details_screen.dart` now follows the RN layout: back arrow + `ReviewTranscriptHeader`, a paged transcript with selection comments and highlighted thread ranges, the general-comments footer, and the floating `InteractionsBar`. Comment threads, replies and message threads are pages inside one `ReviewCommentSheet`.

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A3.1 | Data source per type | `ReviewApiProvider` (simulationApiHooks / scribeApiHooks) | `features/reviews/data/review_api.dart` `ReviewApi` keyed by `ReviewType` | PRESENT | |
| A3.2 | Review fetch | `useGetReviewByIdQuery` refetchOnMount/Focus/Reconnect | `data/reviews_repository.dart` `reviewDetailProvider` autoDispose (fresh per open); foreground `review_details_screen.dart:107-114` `didChangeAppLifecycleState`; reconnect `:318-320` (`isOfflineProvider`); after edit-note `:298-312` (`.then(_refreshReview)`) | PRESENT | v3: PARTIAL → PRESENT (f87fa32). |
| A3.3 | Mark read after 10 s | `setTimeout(markXReviewAsRead, 10000)`, cleared on unmount | `features/reviews/presentation/review_details_screen.dart:81` `_markReadTimer` 10 s, cancelled in dispose | PRESENT | |
| A3.4 | Header | Back arrow + `ReviewTranscriptHeader` (type chip, title, help icon → scenario details modal (sim), "By avatar name • date • Duration") over a lightGray7 rule | `features/reviews/presentation/review_details_parts.dart:24` `ReviewTranscriptHeader`; help icon `:89-101` → `simulations/presentation/simulation_info_modal.dart` (`CoverVideoPreview` when `coverVideoUrl`) | PRESENT | v3: PARTIAL → PRESENT; dialog now plays cover video (f87fa32). |
| A3.5 | Scribe title fallback | `summaryName` or `review.details.callTitle {id}` | `features/reviews/presentation/review_details_screen.dart:424-426` | PRESENT | |
| A3.6 | Transcription disclaimer | Simulation only: `transcription.accuracyDisclaimer` | master + branch | PRESENT | |
| A3.7 | Audio player header | `SimulationAudioPlayer` as list header (sim with audioUrl), no transcript sync | master + branch | PRESENT | |
| A3.8 | ReviewNote | Orange callout "NOTE"; edit icon when the user can edit; "+" add-note button when note is empty and editable; hidden when no note and not editable | `features/reviews/presentation/review_note_callout.dart` (edit icon `editSquare.svg` :82; "+" add-note :57) | PRESENT | |
| A3.9 | Edit-note gate | Owner && not HIDDEN && created < 10 min (`isMinutesPassed`) | master `_isMinutesPassed` + owner + !private | PRESENT | |
| A3.10 | Edit-note navigation | → `SHARE_SIMULATION`/`SHARE_CALL_LOG` with `isEditNote`, `note`, scenario/session context (cover, title, description, createdAt, duration) | `features/reviews/presentation/review_details_screen.dart:284-313` `_editNote` pushes `ShareSimulationForReviewArgs` (cover image/video, description) for sims; route `core/routing/app_router.dart:66,348-373` forwards them | PRESENT | v3: PARTIAL → PRESENT (f87fa32). Scribe title fallback nit tracked in A4.3. |
| A3.11 | Transcript (Conversation) | Paged 10 messages, de-duped, "mm:ss Speaker: text"; owner name for learner side; pull-to-refresh; footer spinner while loading more | `features/reviews/presentation/review_conversation.dart:53` `TranscriptMessageRow` + paging `review_details_screen.dart:101` (10/page, de-duped) | PRESENT | |
| A3.12 | Comment from text selection | `isSelectable = !isPrivate && canEditThread`; native selection menu "Add comment" → `CommentInput` sheet → POST `{messageId, selection{start,end,text}, content}`; new thread inserted locally | `features/reviews/presentation/review_conversation.dart:204` `_AddCommentMenu` → `review_comment_sheets.dart:886` `_CommentInputSheet`; gate `review_details_screen.dart:392` | PRESENT | |
| A3.13 | Commented-range highlight + tap | `splitByCommentRanges` amber highlight; tap → `MessageThreadsBottomSheet` (only if `canViewThreads`, not while composing) | `features/reviews/presentation/review_details_screen.dart:511` `onThreadsTap` → `MessageThreadsSheetPage` | PRESENT | |
| A3.14 | General comments footer | `GeneralCommentsSection` once all transcript pages load: "Comments", own avatar + "Add a comment" input + send; list (20/page, "Load More"); reply → ReplyBottomSheet; inline edit within 10 min; delete with confirmation; hide/unhide (review owner); emoji reactions | `features/reviews/presentation/review_details_parts.dart:149` `GeneralCommentsSection` (Load More `:351`) + `comment_list_controller.dart` | PRESENT | |
| A3.15 | InteractionsBar (floating) | Bottom pill: Share switch (sim owners with EDIT perm), comment button + count → ThreadsBottomSheet (if `canViewThreads`), own emoji reaction on the review (`myReaction`), divider, ReactionsCount | `features/reviews/presentation/review_details_parts.dart:405` `InteractionsBar` | PRESENT | |
| A3.16 | Privacy toggle | `useToggleReviewPrivacy`: on→IN_REVIEW, off→HIDDEN; toast success/error; sim: in InteractionsBar; scribe: in header (`toggleInHeader`); owner + `EDIT_*_REVIEW` only | `features/reviews/presentation/review_details_screen.dart` — sim in `InteractionsBar`, scribe in the header (`:374`), toasts `:187-189`; `call_summary_screen.dart`, `simulation_feedback_screen.dart` | PRESENT | Placement now matches RN. |
| A3.17 | Threads sheet | `ThreadsBottomSheet`: Inline / General tabs, thread cards (selected text, first comment faded, "N more comments") → CommentThreadBottomSheet; General list + footer input | `features/reviews/presentation/review_comment_sheets.dart:316` `_ThreadsPage` + `:479` `_GeneralList` | PRESENT | |
| A3.18 | Comment thread view | `CommentThreadBottomSheet`: back header, comments with Reply/reactions/actions, "Add comment" footer hidden when private | `features/reviews/presentation/review_comment_sheets.dart:688` `_CommentThreadPage` | PRESENT | `thread_detail_screen.dart` is gone from master. |
| A3.19 | Reply view | `ReplyBottomSheet`: original comment + indented replies + "Add reply" footer; deleting original goes back | `features/reviews/presentation/review_comment_sheets.dart:763` `_ReplyPage` | PRESENT | |
| A3.20 | Sheet back-stack | `useReviewComments`/`replySourceRef`: back returns to the originating sheet (threads list, message threads, or closes for inline-general) | `features/reviews/presentation/review_comment_sheets.dart:51` `ReviewSheetPage` stack inside one sheet | PRESENT | |
| A3.21 | Android hardware back | `useHardwareBackPressHandler` closes the top sheet first, then `goBack` | `features/reviews/presentation/review_comment_sheets.dart` (modal route; system back pops) | PRESENT | |
| A3.22 | Local thread-sync | `handleThreadCommentChange` add/edit/delete/hide mirrored into transcript; a thread with no comments left disappears (un-highlights) | `features/reviews/presentation/review_details_screen.dart:255` (RN `handleThreadCommentChange`), `comment_list_controller.dart:8` | PRESENT | |
| A3.23 | Gates | sim: `VIEW_SIMULATION_REVIEW_THREADS` (threads), `EDIT_SIMULATION_REVIEW_THREAD` (selection), `EDIT_SIMULATION_REVIEW` (privacy); scribe: threads/selection always on, `EDIT_SCRIBE_REVIEW` | `features/reviews/presentation/review_details_screen.dart:342-346` `canViewThreads`/`canEditThread` | PRESENT | |
| A3.24 | Private-review restrictions | isPrivate: no selection, no actions menu, no reply button, reaction disabled on anchor, footers hidden | `features/reviews/presentation/review_details_screen.dart:347-392` `isPrivate` threaded through | PRESENT | |
| A3.25 | Loading / error | `isLoading` spinner; `isError` → spinner (RN shows a spinner on error too) | `review_details_screen.dart:328-340` spinner, else `review.error.loadReviewFailed` text | PRESENT | v3: raw exception text removed (930992c); copy is a Flutter-only i18n key (§i18n). |
| A3.26 | Delete confirmation | `ConfirmationModal` destructive (threadsBottomSheet.deleteConfirmation.*) | `features/reviews/presentation/review_details_parts.dart`, `review_comment_sheets.dart` `ConfirmationModal.show` | PRESENT | |

##### A4. ShareForReviewScreen — RN `ShareSimulationScreen.tsx`, `ShareCallLogScreen.tsx`, `components/ShareReviewLayout.tsx`, `hooks/useShareScreenLogic.ts`

Flutter: one `share_for_review_screen.dart` (`isScribe` switch) at `/share-for-review/:scenarioSessionId`. Reached from `simulation_feedback_screen.dart` and `call_summary_screen.dart` (`_handleShareToggle`).

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A4.1 | Header | Close (X) + title: edit → `review.details.editNote`; scribe share → `review.details.shareModalHeader`; sim share → `simulationPage.shareScreenTitle`. `isEditNote` comes only from the edit-note callers (RN `SimulationReviewDetailsScreen.tsx:99-114`, `ScribeReviewDetailsScreen.tsx:96-110`); CallSummary/SimFeedback pass `reviewId` without it (`CallSummaryScreen.tsx:170-181`, `SimulationFeedbackScreen.tsx:396-401`) | `share_for_review_screen.dart:171-174` title/label; `core/routing/app_router.dart:365` `isEditNote: args?.reviewId != null` | PARTIAL | v3: PRESENT → PARTIAL (new finding). Re-sharing an existing review from Call summary (`call_summary_screen.dart:371-384`, recent review) or Sim feedback (`simulation_feedback_screen.dart:359-372`, `summary.reviewId`) shows "Edit note" + "Save" instead of the share title + "Share". Fix: carry an explicit `isEditNote` in the args. |
| A4.2 | Note input | `LineTextInput` placeholder `review.addNotePlaceholder`, maxLength 250, counter `n/250` (grapheme count) | `features/reviews/presentation/share_for_review_screen.dart:106,206,222` (formatter 250, emoji gate on code points, `characters.length` counter) | PRESENT | |
| A4.3 | Context card | Sim: Date&time/Duration rows + `SimulationDetailsCard` (cover image/video, title, description); scribe: card titled session name with rows inside (`ShareCallLogScreen` shows `sessionData.duration` preformatted; edit-note title fallback `'Session Review'`) | `share_for_review_screen.dart:224-237` `SimulationDetailsCard`; sim cover/video/description arrive via `ShareSimulationForReviewArgs` (`app_router.dart:66,370-372`) | PARTIAL | v3: cover/description gap closed (f87fa32). New: scribe share from Call summary shows Duration "-": `call_summary_screen.dart:382` passes an already formatted string (`formatReviewDuration(...)`) and `share_for_review_screen.dart:166` formats it again (`int.tryParse` fails → "-", `review_formatting.dart:63-66`). Nit: scribe edit-note title falls back to "-" (`review_details_screen.dart:293`, `simulation_details_card.dart:143`) where RN uses "Session Review". |
| A4.4 | Emoji picker | `rn-emoji-keyboard` (search, recents, multi-select), appended to note while under limit | `features/reviews/presentation/emoji_keyboard/emoji_keyboard.dart` `EmojiKeyboard.show(allowMultipleSelections, enableRecentlyUsed, enableSearchBar, hideHeader)` from `share_for_review_screen.dart:245-252` | PRESENT | v3: PARTIAL (product call) → PRESENT; full port incl. categories + skin tones (41744fd). Recents are in-memory, as RN default. |
| A4.5 | Submit button | `Button` Share / Save | `AppButton` | PRESENT | |
| A4.6 | Create (sim) | `createReview {scenarioSessionId, note}` → toast `callFeedback.sharedForReview` → goBack | `features/reviews/presentation/share_for_review_screen.dart:145-146` toast + `pop` | PRESENT | |
| A4.7 | Create (scribe) | `createScribeReview` → toast → `replace(SCRIBE_REVIEW_DETAILS, newId)` | `features/reviews/presentation/share_for_review_screen.dart:132-133` toast + `pushReplacement(/reviews/:id)` | PRESENT | |
| A4.8 | Update (reviewId present) | `updateStatus {IN_REVIEW, note}` → toast (share: sharedForReview; edit: editNoteSuccess) → goBack | `features/reviews/presentation/share_for_review_screen.dart:138-146` | PARTIAL | v3: PRESENT → PARTIAL (new finding, same root as A4.1): toast keyed on `isEditNote`, which the route derives from `reviewId` (`app_router.dart:365`), so a re-share toasts `editNoteSuccess` instead of `sharedForReview`. API call is the same. |
| A4.9 | Error handling | Toast server `data.message` (and goBack) or `callFeedback.issues.editNoteExpired` | `features/reviews/presentation/share_for_review_screen.dart:147-153` (error toast) server message or `editNoteExpired`, pop on server message | PRESENT | |
| A4.10 | Analytics | None | — | N/A | |

##### A5. Review hooks / context

| # | Hook | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A5.1 | `contexts/ReviewApiContext` | Swaps 15 RTK hooks between simulation and scribe | `features/reviews/data/review_api.dart` | PRESENT | |
| A5.2 | `useReviews` | Paged list (10), filter/sort reset, loadMore, refresh | `features/reviews/presentation/review_screen.dart` `_ReviewList` (10/page) | PRESENT | |
| A5.3 | `useCommentActions` — add | Prepend new comment locally after success | `features/reviews/presentation/comment_list_controller.dart` `submit` | PRESENT | |
| A5.4 | `useCommentActions` — edit | Single input switches to update when `editingCommentId`; 10-min window | `features/reviews/presentation/comment_list_controller.dart` | PRESENT | |
| A5.5 | `useCommentActions` — delete | Confirm → delete → local remove, count−1, `goback` callback | `features/reviews/presentation/comment_list_controller.dart` | PRESENT | |
| A5.6 | `useCommentActions` — hide/unhide | `updateCommentVisibility`, local `hidden` flag | `features/reviews/presentation/comment_list_controller.dart` | PRESENT | |
| A5.7 | `useCommentActions` — emoji | `getReactionAction` ADD/UPDATE/REMOVE with local count bookkeeping and `myReaction` | `features/reviews/presentation/comment_list_controller.dart:197-212` `reactionActionFor` ADD/UPDATE/REMOVE + local counts | PRESENT | |
| A5.8 | `usePaginatedComments` | 20/page, `hasMore = loaded<count` | `features/reviews/presentation/comment_list_controller.dart` (20/page) | PRESENT | |
| A5.9 | `useReactions` | Count summary + paged (20) list per emoji filter | `features/reactions/presentation/reactions_screen.dart` | PRESENT | Branch f5fb4f0 restyles it. |
| A5.10 | `useToggleReviewPrivacy` | IN_REVIEW/HIDDEN + toasts | master `review_details_screen.dart` `_togglePrivate`; `call_summary_screen.dart` `_handleShareToggle`; `simulation_feedback_screen.dart` `_onShareToggled` | PRESENT | |
| A5.11 | `useHideReviewDetails` | Private review shows the "view review" button only if it has threads or reactions | `call_summary_screen.dart` and `simulation_feedback_screen.dart` (doc-commented as this gate) | PRESENT | |
| A5.12 | `useShareScreenLogic` | Title/label/submit branching, 250 limit, emoji append | `features/reviews/presentation/share_for_review_screen.dart` | PRESENT | v3: emoji append now via `EmojiKeyboard`; open issues are A4.1/A4.3/A4.8. |
| A5.13 | `useReviewComments` (sheet state machine) | 4 sheets with back-stack | `features/reviews/presentation/review_comment_sheets.dart` | PRESENT | |

---


---

## §3 Shared components (`src/components/`)

### Part B — Shared components (`src/components/*`)

RN call sites were found by grepping `<Component` outside `__tests__`. Each Flutter verdict comes from reading the Flutter file, not from a single grep miss.

| RN component | RN file(s) | RN call sites | Flutter equivalent | Status | Notes |
|---|---|---|---|---|---|
| ActionsMenu | `ActionsMenu/ActionsMenu.tsx` | ReviewComment (Edit/Delete/Hide), CallLog header (Archive) | `call_log_screen.dart:556` `_ActionsMenu`; `features/reviews/presentation/review_widgets.dart:240` `ReviewActionsMenu` | PRESENT | |
| BadgePopup | `BadgePopup/BadgePopup.tsx` + `hooks/useBadgePopup` | ReviewScreen (reviewer-only), SimulationsScreen | `features/achievements/presentation/badge_popup.dart` `BadgePopupHost` (art via `badge_network_image.dart` `BadgeNetworkImage` at `:256`, first-badge confetti), mounted in `core/navigation/app_shell_screen.dart:165` | PRESENT | v2: a5d3ce7 + 557dc55. |
| BottomSheet | `BottomSheet/BottomSheet.tsx` (gorhom: snapPoints, handle 80x4, 16 radius, backdrop) | CommentInput, Comment/Reply/Threads/MessageThreads sheets, LanguageSelectorSheet, CallLog, CourseItemPlayer, CourseOverview, ProfileSettings | `showModalBottomSheet` in `language_selector_sheet.dart`, `call_log_filter_sheet.dart`, `courses/presentation/course_bottom_sheet.dart`, `profile_image_options_sheet.dart`, `review_comment_sheets.dart` (`ReviewCommentSheet`, 80% snap, 80x4 handle) | PRESENT | v3: `emoji_insert_picker.dart` removed (81622e1); emoji keyboard uses its own sheet. No shared styled wrapper; reviews use `ReviewCommentSheet` (80% snap, 80x4 handle); others vary per call site. |
| BottomSheetBackHeader | `BottomSheetBackHeader/BottomSheetBackHeader.tsx` | CommentThreadBottomSheet, ReplyBottomSheet | `features/reviews/presentation/review_widgets.dart:896` `ReviewSheetBackHeader` | PRESENT | |
| Button | `Button/Button.tsx` | ~22 screens/components | `core/widgets/app_button.dart` `AppButton` | PRESENT | |
| GoogleLoginButton | `Button/GoogleLoginButton.tsx` | SplashScreen | `features/auth/presentation/login_screen.dart:166-169` (`_signInWithGoogle`) | BLOCKED-EXTERNAL | v3: code wired; `AppConfig.googleWebClientId`/`googleIosClientId` default to `''` (`core/config/app_config.dart:81-92`) and no `google-services.json` is in the repo — needs the OAuth clients for the store bundle id (§10). |
| AppleLoginButton | `Button/AppleLoginButton.tsx` | SplashScreen (iOS) | `login_screen.dart` (`sign_in_with_apple`); entitlement `ios/Runner/Runner.entitlements` | DEVICE-CHECK | v3: code + entitlement present; sign-in only provable on a device with an Apple ID. |
| ButtonGroup / ButtonItem | `ButtonGroup/ButtonGroup.tsx`, `ButtonItem.tsx` | only via CollapsibleButtonGroup | see next row | PRESENT | Internal to CollapsibleButtonGroup. |
| CollapsibleButtonGroup | `ButtonGroup/CollapsibleButtonGroup.tsx` | ListeningScreen controls, SimulationAssistantScreen controls | `roleplay_voice_screen.dart:785` `_SimulationControls`; `features/scribe/presentation/listening_controls.dart:20` `ListeningControls` (collapsible dark bar, chevronDown.svg, expanded by default) | PRESENT | v2: Scribe/Conference listening ported in d4ae9eb. |
| Carousel / Pagination / SecurityCarousel | `Carousel/*.tsx` | none rendered (SplashScreen only mocks it in tests; configs live in `constants/general.ts`) | — | N/A | Dead in RN. |
| ChartComponent | `ChartComponent/ChartComponent.tsx` | none (exported only) | — | N/A | Dead in RN. |
| Checkbox | `Checkbox/Checkbox.tsx` | SplashScreen TermsAndAgreementModal | `features/auth/presentation/terms_and_agreement_modal.dart` `_TermsCheckbox` | PRESENT | |
| SessionChecklist | `Checklist/SessionChecklist.tsx` | SimulationAssistantScreen | `features/roleplay/presentation/checklist_panel.dart` | PRESENT | Restyled in the parity/feedback merge. |
| ChipGroup / Chip | `ChipGroup/*.tsx` | FeedbackPopup (rating tags + FEEDBACK_ISSUE_OPTIONS chips) | `feedback_popup.dart:172` issue chips (`feedbackIssueOptions`); call summary passes `showChips: true` (`call_summary_screen.dart:706`) | PRESENT | v2: call summary now uses the shared `FeedbackPopup`. |
| CircularProgress | `CircularProgress/CircularProgress.tsx` | LevelIndicator, CourseItemPlayer, CourseOverview, CourseProgress, SimulationsScreen | `simulations/presentation/widgets/circular_progress.dart` (used by `course_detail_screen.dart`, `course_progress_body.dart`, `quiz/quiz_player.dart`, `simulations_screen.dart`) | PRESENT | v3: course-progress rings now animate; only LevelIndicator still uses Material `CircularProgressIndicator` (`core/widgets/level_indicator.dart:59`, no 1200 ms animation; cosmetic). |
| CommentBottomSheetFooter | `CommentBottomSheetFooter/*.tsx` (via `hooks/useStableFooterRenderer`) | Comment/Reply/Threads sheets | `review_widgets.dart:755` `CommentFooterInput` | PRESENT | |
| CommentInput | `CommentInput/CommentInput.tsx` | ReviewDetails (after text selection) | `review_comment_sheets.dart:886` `_CommentInputSheet` | PRESENT | |
| CommentThreadBottomSheet | `CommentThreadBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:684` `_CommentThreadPage` | PRESENT | |
| CommentableText (iOS / Android) | `CommentableText/IosCommentableText.tsx`, `AndroidCommentableText.tsx` (native selection + "Add comment" menu, highlight ranges) | Conversation | `review_conversation.dart:53` `TranscriptMessageRow` (SelectableText + `_AddCommentMenu` :204, one implementation for both platforms) | PRESENT | |
| ConfirmationModal | `ConfirmationModal/ConfirmationModal.tsx` | Comment/Reply/Threads sheets, CallSummary (archive), ReviewDetails | `core/widgets/confirmation_modal.dart` (call_summary, profile_settings, review_details_parts, review_comment_sheets, discussion_post_tile) | PRESENT | |
| Conversation | `Conversation/Conversation.tsx` | ReviewDetails | `review_details_screen.dart` + `review_conversation.dart` | PRESENT | |
| CustomLineChart | `CustomLineChart/CustomLineChart.tsx` | none (exported only) | — | N/A | Dead in RN. |
| CustomModal | `CustomModal/CustomModal.tsx` (title, optional input, primary/secondary buttons) | CallSummary DeleteRenameModal (rename + delete), ProfileSettings (unsaved changes) | `features/calllog/presentation/call_summary_menu.dart:148` `CallSummaryTextModal` (rename + delete); ProfileSettings → `ConfirmationModal.show` | PRESENT | Delete is wired (`call_summary_actions.dart:98`) though, as in RN, the menu never opens it. |
| CustomSwitch | `CustomSwitch/CustomSwitch.tsx` (32x18 pill) | InteractionsBar/ReviewTranscriptHeader, CallSummary, ProfileSettings, SimulationFeedback | `profile_settings_screen.dart:570` `RnCustomSwitch` (ProfileSettings, `simulation_feedback_screen.dart:646`, `call_summary_header.dart:141`); `review_widgets.dart:606` `ReviewSwitch` (32x18 pill) in review header/InteractionsBar | PRESENT | v3: call summary moved to `RnCustomSwitch` (64636fa); no Material `Switch` left in lib/. |
| CustomTabs | `CustomTabs/CustomTabs.tsx` (scrollable underline tabs, light/dark scheme) | SearchScreen, ListeningScreen resource search | Light: `features/search/presentation/search_screen.dart:390-410` `_CategoryTabs` (horizontal scroll, 2pt underline); dark: `features/scribe/presentation/scribe_reference_search.dart:307` | PRESENT | v3: PARTIAL → PRESENT (3e47357). |
| DiscussionPost | `DiscussionPost/DiscussionPost.tsx` | DiscussionThread | `courses/presentation/discussion/discussion_post_tile.dart` | PRESENT | |
| DiscussionThread | `DiscussionThread/DiscussionThread.tsx` | CourseItemPlayer | `courses/presentation/discussion/discussion_thread.dart` | PRESENT | |
| Dropdown (CustomDropdown) | `Dropdown/Dropdown.tsx` | ReviewScreen sort, Leaderboard period, SimulationDetails language, SimPath modal language, RoleplayCasePlayer language, SimulationTranscript translation language, CallSummary custom fields, fieldRenderer | `core/widgets/custom_dropdown.dart` (leaderboard `leaderboard_screen.dart:299`, transcript translation `simulation_transcript_tab.dart:543`, call-summary custom fields `call_summary_screen.dart:1657-1683` `_SummaryDropdown`); review sort `review_screen.dart:452`; `scenario_language_dropdown.dart` (sim details, roleplay case player) | PRESENT | v3: PARTIAL (cosmetic) → PRESENT; `DropdownButtonFormField` gone (67e7051). |
| DropdownMenu | `DropdownMenu/DropdownMenu.tsx` | only `SummaryDropdown` / `FeedbackDropdown`, which are exported but never rendered | — | N/A | Dead in RN. |
| EmojiPicker | `EmojiPicker/EmojiPicker.tsx` (pill of platform emoji above icon; ADD/UPDATE/REMOVE) | ReviewComment, InteractionsBar | `review_widgets.dart:135` `ReviewEmojiPicker` (ADD/UPDATE/REMOVE) | PRESENT | |
| EmptyState | `EmptyState/EmptyState.tsx` | CallLog, CaseDetails, CourseOverview, CourseProgress, ReviewScreen, SimPathDetails, SuspendedAccount, UserAnalytics | `core/widgets/app_empty_state.dart` | PRESENT | ReviewScreen now uses it (`review_screen.dart:94,325`). |
| EmptyTranscript | `EmptyTranscript/EmptyTranscript.tsx` (icon + `transcription.empty`) | CallSummary transcript, SimulationFeedback transcript | `simulation_transcript_tab.dart` `_EmptyTranscript`; `features/calllog/presentation/call_transcript_tab.dart:114` `_EmptyTranscript` (`emptyTranscript.svg`) | PRESENT | |
| ErrorBoundary | `ErrorBoundary/ErrorBoundary.tsx` (crashlytics.recordError + "Something went wrong" + Try again reset) | App.tsx root | `core/errors/error_boundary.dart` `AppErrorBoundary` (`main.dart:155`) + `core/errors/crash_reporting.dart` (`ErrorWidget.builder`, `FlutterError.onError` → `recordError`) | BLOCKED-EXTERNAL | v3: fallback UI present; crash reporting no-ops until Firebase native config (GoogleService-Info.plist / google-services.json — none in repo) ships (§10). |
| FeedbackPopup | `FeedbackPopup/FeedbackPopup.tsx` | CallSummary, SimulationFeedback | `feedback_popup.dart` (SimFeedback + CallSummary `call_summary_screen.dart:702`) | PRESENT | |
| ForceUpdateModal | `ForceUpdateModal/ForceUpdateModal.tsx` + `hooks/useForceUpdate` (`appConfigApi.getForceUpdateConfig.minimumSupportedVersion` vs app version) | SplashScreen | `core/app_update/force_update.dart` (`/app-version/{ios,android}` `minimumSupportedVersion`) + `force_update_modal.dart` `ForceUpdateGate` (`main.dart:159`, `forceUpdateAlert.svg`) | PRESENT | v3: store URLs (`force_update.dart:18-19`) equal RN `constants/general.ts:453-454`. |
| IllustratedActionModal | `IllustratedActionModal/*.tsx` | SimulationDetails (ActiveSimulationModal), SimulationAssistant (EndingSoonModal) | `start_simulation/start_simulation_modals.dart` `ActiveSimulationModal`; `roleplay_voice_screen.dart` ending-soon state (`_showEndingSoon`) | PRESENT | |
| IllustratedModal | `IllustratedModal/IllustratedModal.tsx` | CaseDetails/SimPath (no credits), Listening end-call, Logout, SimAssistant end, SimDetails | `core/widgets/illustrated_modal.dart` (drawer logout, call_log start, scribe end confirmation); `LowCreditsModal` in start_simulation_modals; roleplay `_ConfirmOverlay` | PRESENT | |
| InfoTooltip | `InfoTooltip/InfoTooltip.tsx` | TabScreenHeader, Achievements, SimulationFeedback (Debrief SupervisorNote) | `core/widgets/info_tooltip_icon.dart` (Material Tooltip, tap trigger, RN `info.svg` :27); supervisor note `simulations/presentation/widgets/feedback/supervisor_note.dart:91` | PRESENT | v3: icon now RN `info.svg` (a6d4e24). Bubble styling differs from RN's tooltip (cosmetic). |
| LanguageSelectorSheet | `LanguageSelectorSheet/*.tsx` | ProfileSettings | `account/presentation/language_selector_sheet.dart` | PRESENT | |
| LearningPathHeader / LearningPathListHeader / ProgressBar | `LearningPathDetails/*.tsx` | CaseDetails, CourseOverview, CourseProgress, SimPathDetails | `simulations/presentation/widgets/learning_path_widgets.dart` (`LearningPathHeader`, `LearningPathProgressBar`, list header); `learning_path_detail_view.dart` | PRESENT | |
| LevelIndicator | `LevelIndicator/LevelIndicator.tsx` | ProgressHeaderWidget, ProgressScreen | `core/widgets/level_indicator.dart` | PRESENT | Uses `CircularProgressIndicator` (no animation). |
| LineTextInput | `LineTextInput/LineTextInput.tsx` | CallLog, ShareForReview | `core/widgets/app_text_field.dart:22` (hairline mode), share screen TextField `share_for_review_screen.dart:198-219` | PRESENT | v3: `app_chat_input.dart` deleted (81622e1, was dead). |
| CallLogSkeleton | `LoadingSkeleton/CallLogSkeleton.tsx` | CallLog | `calllog/presentation/call_log_screen.dart` `_CallLogSkeleton` | PRESENT | |
| SimulationsSkeleton | `LoadingSkeleton/SimulationsSkeleton.tsx` | SimulationsScreen | `simulations/presentation/widgets/simulations_skeleton.dart` | PRESENT | |
| Message | `Message/Message.tsx` (timestamp + body row) | Conversation | `review_conversation.dart:53` `TranscriptMessageRow`; `simulation_transcript_tab.dart` `TranscriptItem` | PRESENT | |
| MessageThreadsBottomSheet | `MessageThreadsBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:640` `_MessageThreadsPage` | PRESENT | |
| NetworkImage | `NetworkImage/NetworkImage.tsx` (SvgUri → fetch+SvgXml fallback, spinner, error state) | BadgePopup, AchievementsScreen (AchievementCard) | `features/achievements/presentation/badge_network_image.dart:15` `BadgeNetworkImage` (SVG via `SvgPicture.network`, else bitmap; adaptive spinner; grey error box) used by `badge_popup.dart:256` and `achievements_screen.dart:288` | PRESENT | v3: PARTIAL → PRESENT (a6d4e24). |
| NetworkLogs | `NetworkLogs/NetworkLogs.tsx` (draggable "Logs" bubble + react-native-network-logger) | App.tsx, gated `env.ENVIRONMENT === 'development'` | — | N/A | Dev-only tool. |
| NotificationModal | `NotificationModal/NotificationModal.tsx` | CaseDetails, SimDetails, SimPathDetails (pre-start) | `start_simulation_modals.dart` `PreStartNotificationModal` | PRESENT | |
| PostInput | `PostInput/PostInput.tsx` | DiscussionPost, DiscussionThread | `courses/presentation/discussion/discussion_post_input.dart` | PRESENT | Hard-caps at maxLength instead of showing RN's red over-limit state (documented). |
| PrivacyTooltip | `PrivacyTooltip/PrivacyTooltip.tsx` | Microphone + Conference ListeningScreen (data-safe bullets), CallSummary AddNotesSection (`summaryLoading.notesTooltip`) | `features/scribe/presentation/listening_chrome.dart:140` `showPrivacyTooltip` (anchored bubble; Scribe + Conference); `summary_generation_progress.dart:393` `summaryLoading.notesTooltip` | PRESENT | v2: d4ae9eb, 98ba567. |
| ProgressHeaderWidget | `ProgressHeaderWidget/*.tsx` | TabScreenHeader | `progress/presentation/progress_header_widget.dart` | PRESENT | |
| ReplyBottomSheet | `ReplyBottomSheet/ReplyBottomSheet.tsx` | ReviewDetails | `review_comment_sheets.dart:759` `_ReplyPage` | PRESENT | |
| ResourceArticleCard | `ResourceArticleCard/*.tsx` (category, tag chips, heading, 3-line content with View more/less, light/dark) | SearchScreen, ListeningScreen resource search (dark) | Light: `features/search/presentation/resource_article_card.dart:17` (tags, 3-line + View more, tap-to-collapse as RN) used at `search_screen.dart:339`; dark: `scribe_reference_search.dart:441` `DarkResourceArticleCard` | PRESENT | v3: PARTIAL → PRESENT (3e47357). |
| ReviewComment | `ReviewComment/ReviewComment.tsx` | All comment sheets, ReviewDetails general comments, ReviewScreen ExpandedComments | `review_widgets.dart:318` `ReviewCommentTile` / `:561` `ControlledCommentTile` | PRESENT | |
| ReviewTranscriptHeader | `ReviewTranscriptDetails/ReviewTranscriptHeader.tsx` | ReviewDetails | `review_details_parts.dart:23` | PRESENT | |
| InteractionsBar | `ReviewTranscriptDetails/InteractionsBar.tsx` | ReviewDetails | `review_details_parts.dart:519` | PRESENT | |
| ReviewTypeChip | `ReviewTypeChip/ReviewTypeChip.tsx` | ReviewTranscriptHeader, SimulationDetailsCard | `core/widgets/review_type_chip.dart` | PRESENT | |
| RichText | `RichText/RichText.tsx` | LearningPathDetails, CourseItemPlayer, SimulationAssistant, SimulationDetails | `core/widgets/html_rich_text.dart` `HtmlRichText` | PRESENT | |
| SearchableLocationDropdown | `SearchableLocationDropdown/*.tsx` (placesApi paged + search) | `utils/fieldRenderer.tsx` FieldType.SearchableDropdown (CallSummary location/custom fields), VoiceNoteSection | `features/calllog/presentation/searchable_location_dropdown.dart` + `data/places_repository.dart`, used at `call_summary_screen.dart:1538` | PRESENT | v2: 98ba567 / 9d4807b. |
| SessionRatingTrigger | `SessionRatingTrigger/*.tsx` | SimulationFeedback header | `simulations/presentation/widgets/feedback/feedback_widgets.dart` `SessionRatingTrigger` | PRESENT | Merged from parity/feedback. |
| ShinyText | `ShinyText/ShinyText.tsx` (shimmer sweep) | CallSummary SummaryGenerationProgress step label | `features/calllog/presentation/summary_generation_progress.dart:258` `ShinyText` (cycling steps :192) | PRESENT | |
| SimulationCard | `SimulationCard/SimulationCard.tsx` | CourseItemPlayer, SimulationsScreen | `simulations/presentation/widgets/simulation_card.dart` | PRESENT | |
| SimulationDetailsCard / SimulationDetailRow | `SimulationDetailsCard/*.tsx` | ReviewScreen card, ShareForReview | `reviews/presentation/simulation_details_card.dart:27` (cover video `:71-73`) + `ReviewDetailRow` :160 | PRESENT | v3: PARTIAL → PRESENT (f87fa32). |
| SimulationTransitionSection / UpNextSimulationCard | `SimulationTransitionSection/*.tsx` | none (exported only; SimFeedback has its own UpNextSimulationCard) | — | N/A | Dead in RN. |
| StarRating | `StarRating/StarRating.tsx` | FeedbackPopup | `feedback_widgets.dart` `StarRatingRow`; `_SummaryFeedbackPopup` stars | PRESENT | |
| TabScreenHeader | `TabScreenHeader/TabScreenHeader.tsx` | CallLog, Leaderboard, Progress, Review, Search, Simulations, UserAnalytics | `core/widgets/tab_screen_header.dart` | PRESENT | |
| TabView | `TabView/TabView.tsx` (pill tabs; `tabWidthMode` equal/content) | ThreadsBottomSheet, Achievements, CallLog, CallSummary, Review, SimFeedback, Simulations, UserAnalytics | `core/widgets/app_tab_view.dart` `AppTabView` (+ `learn_tab_view.dart`); branch `_ContentWidthTabs` | PRESENT | Content-width mode exists for reviews (`review_screen.dart:358`). CallSummary uses its own tab bar. |
| ThreadsBottomSheet / GeneralCommentsList | `ThreadsBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:316` `_ThreadsPage` + `:479` `_GeneralList` | PRESENT | |
| Toast / ToastProvider / useToast | `Toast/*.tsx` (success/error styled, top/bottom, auto-hide) | App root; ~15 screens | `core/widgets/toast/{toast_controller,toast_host}.dart` (`ToastHost` in `main.dart:154`; RN `TOAST_STYLES` colours, top/bottom 100, spring + 300 ms fade, 3000 ms default, single toast replaces); `core/network/error_details.dart` `getErrorDetails` | PRESENT | v3: PARTIAL (product call) → PRESENT (05d78c1, aedd4b1). No `SnackBar` left in lib/ (`rootScaffoldMessengerKey` remains, unused). |
| UserProfileImage | `UserProfileImage/UserProfileImage.tsx` (image or initial, border, fallback icon) | ReviewComment, ReviewTranscriptHeader, LogoutScreen, ReviewDetails, ReviewScreen | `review_widgets.dart:24` `ReviewUserAvatar` (image or initial, 1pt border) | PRESENT | Used in reviews; other call sites (drawer) keep their own avatar. |
| VideoPreview | `VideoPreview/VideoPreview.tsx` | SimulationDetailsCard, SimulationDetailsScreen, SimulationPathDetailsScreen | `core/widgets/cover_video_preview.dart` (`simulation_details_card.dart:73`, `simulation_info_modal.dart`, `simulation_details_screen.dart:145`, `simulation_details_modal.dart:125`) | PRESENT | v3: PARTIAL → PRESENT; wired into review/share cards and the review header dialog (f87fa32). |

Not a component: `components/shared/commentBottomSheetStyles.ts` (a style sheet), so it has no row.

v3 discovery: an import/JSX graph over `src/**` (excluding tests/mocks) finds every rendered component file under `src/components/**` covered by a row above (incl. aliased `Message as MessageComponent` in Conversation, `CustomDropdown` from `Dropdown.tsx`, `ProgressBar` via SessionChecklist/CourseProgressBody). Zero-usage files confirmed dead: Carousel/SecurityCarousel, ChartComponent, CustomLineChart, SimulationTransitionSection; DropdownMenu only via never-rendered `SummaryDropdown`/`FeedbackDropdown`. RN `screens/{ReviewScreen,ReviewDetailsScreen,ShareForReviewScreen}/**` components/hooks all map to rows A1–A5; ReactionsScreen is ledgered in §A (Account/nav). No new rows.

---

### Top gaps by user impact (v3)

v2 top gaps 1–7 are closed in code (cover video, share cover/description, details refetch, SVG badge art, Search card/tabs, toast, call-summary dropdowns, emoji keyboard). What remains:

1. **Re-sharing an existing review opens the share screen in edit-note mode** (A4.1, A4.8). `app_router.dart:365` sets `isEditNote` from `reviewId`, so Call summary / Sim feedback re-shares show "Edit note"/"Save" and toast `editNoteSuccess`. Carry `isEditNote` explicitly (true only from `review_details_screen.dart:_editNote`).
2. **Scribe share card shows Duration "-"** (A4.3). `call_summary_screen.dart:382` pre-formats and `share_for_review_screen.dart:166` formats again. Pass raw seconds. Same row: scribe edit-note title falls back to "-" not "Session Review".
3. **External/device only:** Crashlytics (ErrorBoundary) and Google sign-in need Firebase/OAuth config (BLOCKED-EXTERNAL); Apple sign-in is DEVICE-CHECK.
4. **Cosmetic, left PRESENT:** LevelIndicator ring has no 1200 ms animation (`level_indicator.dart:59`); InfoTooltip uses a Material tooltip bubble.

Icon substitutes in this slice: none left. `info_tooltip_icon.dart:27` now renders RN `info.svg`; `app_chat_input.dart` (`Icons.send`) was deleted. Review and comment widgets use RN SVGs throughout.


---



## §4 Hooks, app shell, services, utils (and §6 Store)

This part covers §4 (Section A: hooks), §4b (Section B: app shell) and §6 (Section C: store).

### Parity ledger part: hooks, app shell, store

RN source: `ally-platform/ally-mobile/src` at `7a8ce0c19` · Flutter: `ally-mobile-flutter/lib` at `f770200` (v3 re-audit, 2026-10-28; v2 was `227db3a`). Every v2 non-PRESENT row was re-read in current code; 30+ PRESENT rows spot-checked (mostly wave 3–6 areas). Changed notes start with "v3:". Discovery added 17 rows to Section B (RN utils with runtime behaviour, the RN→Flutter storage migration, `I18N_BASE_URL`) and 1 to Section C.

Flutter paths below are relative to `lib/`.

#### Tallies

v3 counts, v2 in brackets. v2 had no BLOCKED-EXTERNAL / DEVICE-CHECK columns.

| Section | Rows | PRESENT | PARTIAL | MISSING | BLOCKED-EXTERNAL | DEVICE-CHECK | N/A |
|---|---|---|---|---|---|---|---|
| A. Hooks | 53 [53] | 42 [43] | 1 [2] | 0 [0] | 1 [–] | 1 [–] | 8 [8] |
| B. App shell / services / utils | 79 [62] | 65 [48] | 0 [4] | 0 [5] | 4 [–] | 4 [–] | 6 [5] |
| C. Store | 29 [28] | 25 [24] | 1 [2] | 0 [0] | 0 [–] | 0 [–] | 3 [2] |
| **Total** | **161 [143]** | **132 [115]** | **2 [8]** | **0 [5]** | **5 [–]** | **5 [–]** | **17 [15]** |

The 2 PARTIALs are one behaviour (logout on any `/users/me` failure) counted in §4 and §6; the code says the team decided against it.

Status key:
- **PRESENT**: the same behaviour exists, possibly built a different way.
- **PARTIAL**: some of the behaviour exists.
- **MISSING**: nothing equivalent exists. Every MISSING row was checked by reading the Flutter files and searching `lib/` under several names, not by one failed grep.
- **N/A**: dead code in RN, an RN-only wrapper, or dev-only.
- **BLOCKED-EXTERNAL**: code done; needs credentials, CI secrets, console or web-host config.
- **DEVICE-CHECK**: code done; only provable on a signed device build.

---

#### Section A — Hooks (`src/hooks/`)

| Hook | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| useAppNavigation | Typed `useNavigation` for the native stack. | go_router `context.push/go` | N/A | Navigation wrapper only. |
| useAppleLogin | Apple sign-in requests email and full name, then POSTs `/auth/apple` with identityToken, authorizationCode and fullName. A suspended account (403 `USER_SUSPENDED`) is sent to SuspendedAccount. A cancel does nothing; any other error shows a toast. | `features/auth/presentation/login_screen.dart` (`_signInWithApple`), `features/auth/data/auth_repository.dart` (`loginWithApple`) | DEVICE-CHECK | v3: code unchanged; `ios/Runner/Runner.entitlements` now has `com.apple.developer.applesignin` and the prod flavor uses RN's bundle id `com.helloally.app` (`ios/Flutter/prod.xcconfig:6`), so only a signed device build can prove it. |
| useBadgePopup | Polls `GET /badges/me?viewedStatus=UNVIEWED` every 60s, only while the screen is focused and the user has `VIEW_USER_BADGES`; also refetches on focus and reconnect. Badges are queued: the first shows after 1s, auto-closes after 5s, then the next follows 350ms later. Closing calls `PATCH /badges/me/:id/viewed`. Mounted on SimulationsScreen, and on ReviewScreen for reviewer-only users. | `features/achievements/presentation/badge_popup.dart` (`BadgePopupHost`), hosted in `core/navigation/app_shell_screen.dart:52` | PRESENT | v2: ported (`a5d3ce7`, `557dc55`): 60s poll while the Learn tab (or Review tab for reviewer-only users) is showing, queue with 1s/5s/350ms timings, confetti, `PATCH /badges/me/:id/viewed` on close. Android back closes it first. |
| useBugReport | Validates description length, then `POST /bug-reports` with context (screen, appVersion, device, os, clientTimestamp). A 429 shows a rate-limit toast; success shows a toast and clears the field. | `features/bugreport/presentation/bug_report_screen.dart`, `features/bugreport/data/bug_report_repository.dart` | PRESENT | v3 spot-check: 429 at `bug_report_screen.dart:16,74`. |
| useCallSummaryActions | Rename (`updateCallInfo`, then toast). Export: storage permission, `GET` export, save `.txt` to Documents/CallSummary (iOS) or Downloads (Android). Archive/unarchive with modal and toast. Delete (`summary: {}`, then `goBack` after 2s). Summary feedback POST. `handleGoBack` resets to CallLog and clears currentChat outside the log flow. | `features/calllog/presentation/call_summary_actions.dart`, `call_log_repository.dart:612-636`, `data/summary_file_export.dart` | PRESENT | v2: export (permission → `GET /chats/:id/export-summary` → `saveFile`) and delete (`PUT call-details {summary:{}}`, back after 2s) landed in `98ba567`/`9d4807b`. |
| useCallSummaryForm | Keeps a form baseline shared in the store. Reseeds on every summary refetch while keeping unsaved edits. Seeds manual notes with empty values. Saves only changed keys. Marks clean only the keys actually written, so an edit made during the save stays dirty. Section reset restores the server values. | `features/calllog/data/summary_form_state.dart`, `call_summary_screen.dart` | PRESENT | v2 (`0de134b`): `SummaryFormState.markSaved` only advances the baseline to the sent values, so in-flight edits stay dirty; a refetch of the same chat reseeds untouched fields. |
| useCallTranscriptDetails | Pages `/chats/:id/messages` with limit 20 and an offset. Sorts by `createdAt` for WEBRTC, otherwise `startSeconds` ASC. Timestamps are relative to the start. Infinite scroll. | `call_log_repository.dart:759-774` | PRESENT | v2 (`118522d`): limit 20 + offset paging, `sortOrder: ASC`, `sortBy` per provider. |
| useCommentActions | Comment CRUD with local optimistic patching: add (prepend), edit, delete with confirm, hide/unhide, emoji reaction add/update/remove count maths. Dismisses the keyboard; `onCommentsChanged` fires for parents. | `features/reviews/presentation/comment_list_controller.dart` | PRESENT | Re-read on master: `CommentListController` (add/edit/delete/hide/reactions, edit window). |
| useCounselorChat | When authenticated with `VIEW_COUNSELOR_CHAT`: `GET /chats/counsellor-chat`. On an active chat it sets currentChat and fires a callback; otherwise it clears currentChat unless the user is on Breathing, CallSummary or Listening. Re-checks on AppState background→active. Guards against concurrent checks. | `core/chat/active_chat_discovery.dart` (`checkForActiveChat`), `main.dart` (`didChangeAppLifecycleState`, auth listener) | PRESENT | v3 spot-check: still no in-flight guard (RN `isCheckingRef`, `useCounselorChat.ts:29-65`); `active_chat_discovery.dart:47`. Low risk. Now reads the top route (`active_chat_discovery.dart:66`). |
| useDebounce | Debounced callback, leading or trailing. | `Timer` used inline where needed | N/A | |
| useDrawerNavigation | Typed drawer navigation. | `core/navigation/drawer_menu_button.dart` (`DrawerMenuScope`) | N/A | |
| useForceUpdate | `GET /app-version/{ios,android}` returns `minimumSupportedVersion`, compared by semver against the app version. Splash shows a blocking ForceUpdateModal whose button opens the store, and navigation is held back. | `core/app_update/force_update.dart`, `force_update_modal.dart:22` (`ForceUpdateGate` in `main.dart` builder) | PRESENT | v3 spot-check: store URLs `force_update.dart:18-19` now match the prod flavor's identity (`com.helloally.app`), so they are correct, not a gap. |
| useGoogleLogin | `GoogleSignin.configure`, `hasPlayServices`, `signOut` before `signIn`, then POST `/auth/google` with the idToken. Suspended goes to SuspendedAccount; cancel and in-progress are silent; Play Services and other errors show a toast. | `login_screen.dart` (`_signInWithGoogle`, `GoogleSignIn.instance.initialize`) | BLOCKED-EXTERNAL | v3: code done; `GOOGLE_WEB_CLIENT_ID`/`GOOGLE_IOS_CLIENT_ID` default `''` (`core/config/app_config.dart:82-92`) and come from the `ENV_VALUES_*` repo secret via `--dart-define-from-file` (`.github/workflows/build-ios-production.yml:81,130`); reversed client ids in `ios/Flutter/prod.xcconfig:11-12`. Needs the secret copied to this repo. |
| useHardwareBackPressHandler | Android back calls a custom callback, else `goBack`, else the system default. | `PopScope` in call_summary, box_breathing, login (OTP→email), celebration_modal, simulation_feedback, profile_settings, scribe_recording, roleplay_voice, start_simulation_modals, simulation_details_modal | PRESENT | Implemented per screen. |
| useHideReviewDetails | For a private review, fetch threads (limit 1), then reaction counts; hide the review section if both are empty. | `simulation_feedback_screen.dart` (`_hideReviewDetails`), `call_summary_screen.dart` | PRESENT | |
| useIsEvaluator | `EVALUATOR_ACCESS` permission check. | — | N/A | **Unused in RN**: no caller outside `hooks/index.ts`. |
| useKeyboardState | Keyboard show/hide listener (used by SearchableLocationDropdown). | `MediaQuery.viewInsets` | N/A | |
| useLanguageDropdown | Language options and map from `/languages?active&hasVoices` plus preferences. | — | N/A | **Unused in RN** (exported only). Preferences have their own Flutter port. |
| useLeaderboard | `GET /community/leaderboard?window&limit=50&offset`, deduped by userId, infinite scroll. `GET /community/leaderboard/my-rank`, refetched on focus. Flags the current user; window change resets the offset. | `features/leaderboard/data/leaderboard_repository.dart` (`LeaderboardController`, `myRankProvider`), `leaderboard_screen.dart` | PRESENT | |
| useLeaderboardNotification | Toggle stored under AsyncStorage `LEADERBOARD_NOTIFICATION_ENABLED` (default ON); schedules or cancels the weekly Notifee trigger. | `core/push/leaderboard_notification.dart` (`leaderboardNotificationEnabledProvider`), `profile_settings_screen.dart:496` | PRESENT | Same key name, in SharedPreferences. v3: migrated from RN AsyncStorage on first prod launch (`legacy_session_migration.dart:83-87`). |
| useLearningPathDetails | Track or case details query, create a path or case session, look up the scenario session for an item, pull to refresh. | `simulations_repository.dart` (`createPathSession`, `createCaseSession`, `/learn/scenario-session/scenario-path-session-item/:id`, `/case-session-item/:id`), `simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart` | PRESENT | |
| useListeningScreen | Derives isWebMicrophoneMode and isConferenceCall, the privacy tooltip list (noRecording / encrypted / noTrainingData / personalInfoRemoved), the tooltip insets and the start time. | `features/scribe/presentation/listening_chrome.dart:96-140` (`showPrivacyTooltip`) | PRESENT | v2 (`d4ae9eb`): privacy tooltip (`audioCall.privacy.*`) on both listening screens. |
| useLiveAudioStream | Mic permission check/request. A start request is held until init finishes (avoids a native crash). Streams 16kHz mono PCM base64. Permission denied: settings alert, and cancel goes back. Re-checks permission when the app returns to the foreground. Stops on unmount. | `scribe_recording_screen.dart:229-299`, `core/realtime/microphone_permission.dart` (`showPermissionSettingsAlert`) | PRESENT | v3 spot-check: foreground re-check at `scribe_recording_screen.dart:249-250`. |
| useNavigationAwareCounselorChat | Tracks the current route. An active chat from Splash resets to [CallLog, Listening]; from Listening it does nothing; otherwise it navigates to Listening. Always subscribed to AppState. | `active_chat_discovery.dart` (`targetRouteForActiveChat`, `isListeningRoute`) | PRESENT | Uses `router.go` (replaces the stack) instead of reset/navigate; documented. |
| useNetworkConnectivity | NetInfo subscription: `isConnected` / `isInternetReachable` / `isOffline`. Drives NetworkDisconnected (network vs socket copy, Try-again hidden while offline) on the Listening screens. | `core/realtime/connectivity.dart:13` (`isOfflineProvider`), `network_disconnected.dart:43`, `scribe_recording_screen.dart:159` | PRESENT | v2 (`d4ae9eb`): `connectivity_plus` stream; NetworkDisconnected picks network vs socket copy from it. |
| usePaginatedComments | Comment pagination, 20 per page, append/reset, `hasMore`. | `features/reviews/presentation/comment_list_controller.dart` (`fetchPage(offset, limit)`) | PRESENT | Re-read on master. |
| usePermissionAlert | Alert with Cancel and "Open settings" (`openSettings()`); preset microphone variant. | `core/realtime/microphone_permission.dart:20-56`, `call_log_screen.dart:233` | PRESENT | v2: shared Cupertino alert with Open Settings; used by Scribe and start-simulation (roleplay now never starts without mic, so no alert is needed there). |
| useProfileImage | Image library (jpeg/png, 0.8 quality, 800px); rejects over 2MB or non-square. Save: presigned URL → PUT to S3 → PATCH `/users/profile-image` → delete the old image best-effort. Remove: delete + PATCH empty. | `features/account/presentation/profile_settings_screen.dart` (`_maxProfileImageBytes`, square check), `account_repository.dart` (`/users/profile-image-url`, PATCH `/users/profile-image`, delete) | PRESENT | v3 spot-check: 2MB cap and jpeg/png-only picks (`profile_settings_screen.dart:28-34`, `28ff515`). |
| useProgressSummary | Two gates: the `VIEW_USER_RANK` permission and `GET progress-enabled`. Then the summary query, shared through one cache entry. | `features/progress/data/progress_repository.dart` (`progressEnabledProvider`, `viewUserRank` gate), `progress_header_widget.dart` | PRESENT | |
| useReactions | Reaction counts summary (emoji map, sorted), paged list (20) filtered by reaction, refresh. Swaps between simulation and scribe APIs via ReviewApiContext. | `features/reactions/presentation/reactions_screen.dart`, `reactions_repository.dart` | PRESENT | |
| useReviews | Reviews list: readFilter and sort, LIMIT 10 with offset paging, reset on filter change. | `features/reviews/data/reviews_repository.dart:20-33` | PRESENT | Re-read on master: limit 10, offset paging, `order: DESC`, readFilter/sort. |
| useScribeNoteCreationEnabled | `GET /settings/scribe-note-creation-enabled`, skipped unless `COUNSELOR_ACCESS` (otherwise 403). | `core/settings/settings_repository.dart` `scribeNoteCreationEnabledProvider`; `call_log_screen.dart:273` watches it only when `isCounselor` | PRESENT | |
| useScribeVoiceNoteEnabled | `GET /settings/scribe-voice-note-enabled`, gated by counsellor permission. | `settings_repository.dart:113`, `voice_note_section.dart:249` | PRESENT | v3 spot-check: `voice_note_section.dart:259-261` still watches the provider before `isCounselor` short-circuits (one harmless 403 for non-counsellors). Cosmetic. |
| useSearch | `searchDocuments` (PAGE_SIZE, category filter); `excludedIds` pagination; category counts; 250ms debounced suggestion filter; suggestion tap. | `features/search/data/search_repository.dart` (`excludedIds`, `categories`), `search_screen.dart` | PRESENT | |
| useShareScreenLogic | Share or edit-note: max 250 chars, emoji appended, create review or update status. Toast; on a server message, toast then go back. | `features/reviews/presentation/share_for_review_screen.dart` (`_maxNoteLength = 250`, `EmojiInsertPicker`, `isEditNote`) | PRESENT | Reworked again on `parity/reviews` (UI fidelity). |
| useSimulationCredits | Fetches `/simulation-credits` on every mounting screen when the user has `EDIT_SCENARIO_SESSION`, otherwise clears. Stores in the credits slice. `refreshCredits`, usage %, low-credit flag. | `simulations_repository.dart:120-131, 206-207` | PRESENT | v3 spot-check: `simulations_repository.dart:207` invalidates credits; `usagePercentage`/`isLow` in `simulation_models.dart:262-268`. |
| useSimulationSessionRecordingUrl | `GET` session recording presigned URL (2 attempts; a 404 means missing). `refreshFromPlaybackError` with a 4s cooldown for expired URLs. Feeds the TranscriptTab audio player. | `simulation_transcript_repository.dart:81-88`, `simulation_transcript_tab.dart:34` | PRESENT | v2 (`bc9381b`): `GET …/recording` presigned URL feeding the feedback-transcript player. |
| useSimulationTranscriptDetails | Pages `/learn/scenario-session/:id/messages` (limit 10, startSeconds ASC, **languageCode**) with a paging lock, id dedupe and MM:SS formatting. | `simulation_transcript_repository.dart:52-65` | PRESENT | v2 (`bc9381b`): optional `languageCode` for the transcript-language dropdown; repoll on change. |
| useSimulationTransition | Polls upcoming path/case scenario (5s, 4 tries); retry or start the next simulation. | — | N/A | **Unused in RN** (only a comment in `languageCodeEndpoints.ts`). |
| useSocket | One socket per owner, idempotent `connect`, a generation stamp against stale connects, auth as a function (fresh token on each reconnect), 5 reconnects, 1–5s delay, 10s timeout, forceNew, retry after failure 2s, emit/on/off. | `core/realtime/socket_service.dart` | PRESENT | v3: generation stamp (`socket_service.dart:42,66-71,131`) and 2s retry after a failed open (`socket_service.dart:27,111-123`, commits `5a37e28`/`3cb9e36`) now ported. Fully mirrors `useSocket.ts:115-190`. |
| useSocketConnection | Connects on screen focus, disconnects on blur. AppState: background disconnects (unless `disconnectOnBackground=false`), foreground reconnects. | `scribe_recording_screen.dart:229-233`, `conference_listening_screen.dart:113-118`, `core/chat/cloud_telephony_listener.dart` | PRESENT | v2: Scribe reconnects on foreground (RN `disconnectOnBackground:false` for recording); Conference disconnects on pause and reconnects on resume; app-wide telephony socket exists (Section B). |
| useStableFooterRenderer | Bottom-sheet footer render-stability shim. | — | N/A | Specific to `@gorhom/bottom-sheet`. |
| useStartSimulation | Checks or requests mic permission **before** creating the session (blocked: settings alert; denied: toast). Creates the scenario session; navigates to the assistant with token, LiveKit URL, scenario and reminders. 429 shows a retry modal; an `entityId` body shows the active-simulation modal. | `start_simulation_controller.dart:178-202` | PRESENT | v3 spot-check: mic still checked before session create (`start_simulation_controller.dart:113-115,200-203`). |
| useStoragePermissions | Android below 33 needs `WRITE_EXTERNAL_STORAGE`; denied shows a toast and opens settings. | `features/calllog/data/summary_file_export.dart:28-34` | PRESENT | v2: Android ≤ 28 requests storage, else granted. |
| useSummaryState | Lazy summary fetch; holds the loader for 3s after the summary arrives; latches manual-note status; **debounced (1s) notes autosave `POST /chats/:id/notes` while the summary generates** (AddNotesSection); refresh; clears summary state on unmount. | `call_summary_screen.dart:777`, `summary_generation_progress.dart:303`, `call_log_repository.dart:636` | PRESENT | v2 (`98ba567`): notes typed during generation autosave via debounced `POST /chats/:id/notes`. |
| useTabBackToHomeHandler | On Search, Community, Progress and UserAnalytics tab roots, Android back jumps to the first visible tab instead of leaving the app. | `core/navigation/app_shell_screen.dart:150` | PRESENT | v3 spot-check: `app_shell_screen.dart:186-187` `PopScope(canPop: currentIndex == 0 && !_isBadgePopupShowing)`. |
| useTabScreenHeader | The hamburger shows only on the first visible tab and opens the drawer. | `core/navigation/app_shell_screen.dart` (`onOpenDrawer: i == 0`), `drawer_menu_button.dart`, `core/widgets/tab_screen_header.dart` | PRESENT | |
| useToggleReviewPrivacy | PATCH review status: `IN_REVIEW` when on, `HIDDEN` when off, then a toast. | `simulation_feedback_screen.dart:361`, `call_summary_screen.dart:317`, `review_details_screen.dart:108` | PRESENT | |
| useTrackPlayerNavigation | Flattens the track by sorted sections and items; current/prev/next; `canAdvance` (completed or just completed); overall %. | `features/courses/presentation/course_item_player_screen.dart` (`_flattenTrackItems`, `goNextOrOverview`) | PRESENT | |
| useTranslate | `t` (typed) and `tVariable`. | `core/localization/translate_ref.dart` (`ref.t`, `ref.tr`) | PRESENT | |
| useUser | `checkAuth`: with a token, fetch `/users/me` and permissions, then set user, permissions and authenticated; on any failure, logout. `handleUserLogout`: **unregister push token**, then `handleLogout`, then `resetApiState`. | `core/auth/auth_state.dart`, `features/account/data/account_repository.dart` `currentUserProvider`, `core/permissions/permissions_repository.dart` | PARTIAL | v3: launch now holds `/splash` until `/users/me` settles (`core/routing/app_router.dart:89-95,148`). Remaining: RN `useUser.ts:44-63` logs out on ANY `/users/me` failure; Flutter moves on (no logout on non-401) by a recorded team decision (`app_router.dart:90-92`, `app_shell_screen.dart:99-101`). Deliberate divergence; close as won't-fix if product confirms. |
| useVideoWatchProgress | Counts unique watched seconds (a jump over 2s counts as a seek). Reports every 10s or on a +10% change; flushes on unmount. | `features/courses/data/video_watch_progress.dart` | PRESENT | v3 spot-check: `video_watch_progress.dart:14,65,107` (10s/+10%, flush). |
| useVoiceNoteRecorder | WAV dictation 16k mono, start/pause/resume/stop/reset, streamed to file. **Auto-stops at 24MB** (upload cap). Deletes the file on reset; releases the mic on unmount. | `features/calllog/presentation/voice_note_recorder.dart` (`record` `AudioEncoder.wav`) | PRESENT | v3 (`bf5d1c5`): 24MB auto-stop ported: `maxRecordingBytes = 24*1024*1024` (`voice_note_recorder.dart:41`), bytes derived from 16k mono 16-bit duration (`:37,47`), ticker stops at cap (`:65-74`). v2 gap 22 closed. |

---

#### Section B — App shell, entry, services, contexts, utils

| Area | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| index.js | `registerGlobals()` for LiveKit WebRTC. | livekit_client needs none | N/A | |
| index.js | `messaging().setBackgroundMessageHandler` → `displayRemoteMessage`, registered at module scope. | `main.dart` `FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler)`; `core/push/push_notification_service.dart` | BLOCKED-EXTERNAL | v3: code done (`main.dart:43-49`, `push_notification_service.dart:184`). Firebase files are fetched by CI from S3 (`.github/workflows/build-ios-production.yml:62`, `build-android-production.yml:80`); prod identity = RN's, so RN's Firebase apps apply. Blocked on repo secrets `*_GOOGLE_SERVICES_S3_URI_PROD` + AWS OIDC trust (docs/RELEASE.md:116-127). |
| index.js | `notifee.onBackgroundEvent` PRESS on leaderboard id → `navigateToLeaderboard`; reminder → no-op. | `initializeLocalNotifications` `onDidReceiveNotificationResponse` covers foreground and background taps | PRESENT | |
| App.tsx | Redux `Provider`. | `ProviderScope(retry: appRetryPolicy)` | PRESENT | Flutter adds a retry policy (network/5xx only). |
| App.tsx | GestureHandlerRootView / SafeAreaProvider. | Flutter built-ins | N/A | |
| App.tsx | Translucent StatusBar; dark content after splash. | `main.dart` `AnnotatedRegion(SystemUiOverlayStyle.dark)` | PRESENT | v3: plus RN splash `StatusBar.setHidden(true)` then show 1s after the Lottie (`core/routing/launch_splash.dart:20-31,88-92`). |
| App.tsx | ToastProvider above the navigator, so toasts survive the auth stack swap. | `core/widgets/toast/toast_host.dart` (`ToastHost` in `main.dart:154`) | PRESENT | v3 (`05d78c1`/`aedd4b1`): RN toast host (success/error, top/bottom) `core/widgets/toast/toast_host.dart:14,96-131`, mounted above the navigator at `main.dart:154`; SnackBars replaced. |
| App.tsx / ErrorBoundary | Catches render errors, shows a fallback with a reset that remounts the navigator, `crashlytics().recordError`. | `core/errors/crash_reporting.dart:24-51`, `core/errors/error_boundary.dart` (`AppErrorBoundary` in `main.dart`) | PRESENT | v2 (`0885d07`). v3 spot-check: `main.dart:52,155-159`. Crashlytics reporting only works once Firebase files are supplied (see BLOCKED-EXTERNAL rows); fallback UI works without. |
| App.tsx | NetworkLogs overlay in development. | — | N/A | Dev only. |
| localization/i18n.ts | Synchronous English init; restores the saved UI language (`ally:ui:language`); 5 languages. | `core/localization/localization_controller.dart` (`build`, SharedPreferences `ui_language`) | PRESENT | v3: RN's `ally:ui:language` is copied into `ui_language` once on the first prod launch (`core/migration/legacy_session_migration.dart:77-81`), so the key-name difference no longer loses the setting. 5 locales bundled. |
| localization/dynamic.ts | Behind `LANGUAGE_SELECTOR_FLAG`: fetch the CDN manifest; apply the cached bundle first; re-fetch namespaces when the version moves; cache per (version, lang); refresh every 30s and on foreground; network failure falls back to cache. | `localization_controller.dart` (`refresh`, `_pollTimer`, `didChangeAppLifecycleState`) | PRESENT | |
| dynamic.ts | On `languageChanged`: refresh and apply **that language's** cached or fetched resource. | `localization_controller.dart:140-170` | PRESENT | v2 (`8e0a859`): reuses the cache only if it holds this language for the current version, else fetches. |
| LanguageSelectorSheet | `changeLanguage`, persist, `forceRTL`, `api.util.resetApiState()` so content re-fetches in the new language. | `core/network/api_client.dart:46-51` | PRESENT | v3 spot-check: `api_client.dart:50-52`. |
| services/api.ts | Injects `languageCode` (the active UI language) into the allowlisted content endpoints: scenarios, paths, cases, simulation details, checklist, skills, reviews, badges, leaderboard, endScenarioSession, learn tracks, enrollTrack. | `core/network/language_code_interceptor.dart:27-81`, added in `api_client.dart` | PRESENT | v3 spot-check: allowlist incl. scenarios, badges, leaderboard, enrollTrack (`language_code_interceptor.dart:28-46`). |
| services/api.ts | `/api/v1` prefix, with `/api/v2` for generate-otp, verify-otp and learn/scenarios (exact match). | `core/network/auth_interceptor.dart`, `api_routes.dart` | PRESENT | |
| services/api.ts | Bearer token from storage on every request. | `auth_interceptor.dart` `onRequest` | PRESENT | |
| services/api.ts | 401 → refresh with the refresh token → store new tokens → retry. No tokens, or refresh fails, logs out. | `auth_interceptor.dart` (single-flight `_refreshFuture`) | PRESENT | Better than RN: concurrent 401s share one refresh. |
| services/api.ts | Unrecoverable 401 → `handleLogout` + `resetApiState` + `auth.sessionExpired` toast. | `auth_state.dart` `sessionExpired()` | PRESENT | |
| RootNavigator | Swaps stacks on `isAuthenticated` (authed: CallLog, Listening, …; unauthed: Splash, SuspendedAccount). | `core/routing/app_router.dart` `computeRedirect` + `_RouterRefreshListenable` | PRESENT | |
| Splash | `checkAuth()` on launch; holds the UI while loading. | `core/routing/launch_splash.dart` + `computeRedirect` (`isSplashFinished`, `isUserLoading`) | PRESENT | v3 (`e063d45`): `/splash` plays RN's Lottie on every cold start and holds until the animation ends AND (signed in) `/users/me` settles (`launch_splash.dart:72-109`, `app_router.dart:93-95,148`). Logout-on-failure divergence tracked under useUser. |
| Splash | Authenticated with `profileCompleted === false` → CompleteProfile. | `computeRedirect` (`profileCompleted` gate) | PRESENT | |
| Splash | Authenticated with `VIEW_COUNSELOR_CHAT` → `checkCounselorChat`: active goes to [CallLog, Listening], otherwise CallLog. | `main.dart` auth listener → `checkForActiveChat` | PRESENT | |
| Splash | Force-update modal blocks all post-login routing. | `core/app_update/force_update_modal.dart:22` | PRESENT | v2: `ForceUpdateGate` overlays every route (incl. login) and swallows touches. |
| Splash | Login: a suspended error routes to SuspendedAccount (unauth stack). | `login_screen.dart` `_isSuspendedUserError` → `/suspended`; `computeRedirect` `isSuspended` | PRESENT | |
| Splash | Hardware back on the OTP step returns to email. | `login_screen.dart` `PopScope` | PRESENT | |
| RootNavigator | On auth, `getSummaryFields()` loads the tenant's visible summary fields into the store (`setSummaryVisibleFields`), used by CallSummaryDetails, SectionWrapper and VoiceNoteSection. | `core/settings/settings_repository.dart:75-141`, `call_summary_fields.dart:533-541` | PRESENT | v2 (`0de134b`): `GET /settings/summary-fields` → `summaryVisibleFieldsProvider` (kept alive); filters sections and voice-note targets. |
| RootNavigator + utils/deeplink.ts | Universal links `https://{ALLY_WEB_URL host}/summary/:id` → reset to [CallLog, CallSummary(callId, fromLogs)], kept pending until authenticated and summary fields are loaded; suppresses the active-chat auto-route while a link is in progress. | `core/deeplink/deep_link_coordinator.dart`, `deep_link_binding.dart`, `deep_link.dart` | DEVICE-CHECK | v3 (`c536efa`): `app_links` stream created before `runApp` (`main.dart:64,69`); `deepLinkBindingProvider` (`core/deeplink/deep_link_binding.dart:21-51`); parser = RN `isSupportedDeepLink`/`getCallIdFromUrl` (`deep_link.dart:58-108`); summary held until signed in AND summary fields load (`deep_link_coordinator.dart:99-114`); opens `/home` then pushes `/call-log/:id`, which no longer needs an extra (`app_router.dart:312-320`). RN's `isDeepLinkInProgress` guard is computed once at mount (`RootNavigator.tsx:112-116`), always false, so not porting it is correct. Cold/warm delivery on iOS goes through app_links 7.2.2's `FlutterSceneLifeCycleDelegate`; only provable on device. |
| RootNavigator + deeplink.ts | `/course/:uuid` → CourseOverview once past Splash and CompleteProfile; kept pending through login; dropped if on Listening; launch URL handled once. | `core/deeplink/deep_link_coordinator.dart` (`openPendingCourse`) | DEVICE-CHECK | v3: held through splash/login/complete-profile, dropped on listening routes, re-checked on every route change (`deep_link_coordinator.dart:61,88-97`, `deep_link_binding.dart:38-41`) → `push('/courses/$trackId')` (`:81-84`). Device-only proof. |
| Native link claims | AASA `paths` and an Android `autoVerify` intent-filter `pathPrefix` for /summary and /course. | `AndroidManifest.xml:60-65`, `ios/Runner/Runner.entitlements` | DEVICE-CHECK | v3 (normalised: prod AASA `W3ZL4N9N9J.com.helloally.app` and assetlinks for `com.helloally.app` are already hosted, see §10c r23): Android `autoVerify` filter for `/summary`,`/course` on `${appLinkHost}` (`android/app/src/main/AndroidManifest.xml:60-65`, hosts `android/app/build.gradle.kts:56,62`), `launchMode=singleTask` (`:36`), `flutter_deeplinking_enabled=false`; iOS `applinks:` in `ios/Runner/Runner.entitlements`, wired via `CODE_SIGN_ENTITLEMENTS`. Needs AASA/`assetlinks.json` on the web host to list the Flutter build's team/cert (same as RN's only if the same signing key/team is used). |
| RootNavigator | App-wide socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` → `checkCounselorChat` → auto-route to Listening (an incoming conference call is answered from the phone with no screen open). | `core/chat/cloud_telephony_listener.dart`, `main.dart` auth listener | PRESENT | v3 spot-check: `cloud_telephony_listener.dart:35-66`, started `main.dart:131-133`. Inherits the socket retry fix. |
| useCounselorChat via RootNavigator | Foreground re-check for an active chat. | `main.dart` `didChangeAppLifecycleState(resumed)` | PRESENT | |
| RootNavigator | Leaderboard reminder when authenticated and `VIEW_COMMUNITY_LEADERBOARD` and enabled (null means ON): create channel, request permission, schedule weekly (Mon 11:00 from env). | `core/push/leaderboard_notification.dart` (`leaderboardNotificationSyncProvider`, `zonedSchedule` `dayOfWeekAndTime`) | PRESENT | Flutter also cancels it on logout; RN doesn't. |
| RootNavigator + pushNotificationService | When authenticated: create the `reminders` channel, request notification permission, register the FCM token (`POST /notifications/device-tokens` with platform), re-register on `onTokenRefresh`, show foreground messages via Notifee. | `core/navigation/app_shell_screen.dart` initState → `PushNotificationService.initializeAndRegister` | BLOCKED-EXTERNAL | v3: code is a full port (`push_notification_service.dart:225-270`, called from `app_shell_screen.dart:63`); only the Firebase config (CI S3 secrets) is missing. |
| pushNotificationService | `unregisterDeviceForPush` on logout: `DELETE` device token, then `messaging().deleteToken()`. | `core/push/push_notification_service.dart:237-260`, called from `core/auth/auth_state.dart:75` | BLOCKED-EXTERNAL | v3: code done (`push_notification_service.dart:281-297`, `auth_state.dart:70-80`); needs a real FCM token, i.e. the Firebase files. Reclassified from PRESENT (vocabulary only). |
| pushNotificationService | `displayRemoteMessage`: data-only `{title, body}`, skipped when body is empty; `reminders` channel; tap goes to the default action. | `displayReminderNotification` | BLOCKED-EXTERNAL | v3: code done (`push_notification_service.dart:43-72`); only fed by FCM (`onMessage`, background handler), so inert without Firebase files. Reclassified from PRESENT (vocabulary only). |
| RootNavigator | Foreground notification tap: leaderboard id → jump to the Leaderboard **tab**; reminder → Simulations or Notifications. | `notification_navigation.dart:50`, `push_notification_service.dart:127`, `core/navigation/home_tab_navigation.dart` | PRESENT | v2: leaderboard reminder now selects the Leaderboard **tab** (`homeTabLocation` → `goToHomeTab`). `router.go` still replaces the stack. |
| RootNavigator | Killed-app initial notification (authenticated only): reminder routing; leaderboard routing deduped through `LEADERBOARD_NOTIF_HANDLED_TS` (scheduledAt); waits until off Splash. | `initializeLocalNotifications` → `getNotificationAppLaunchDetails` | PRESENT | v3 (`0f7839c`): `HANDLED_TS` dedupe ported (`push_notification_service.dart:107-141`, key `LEADERBOARD_NOTIF_HANDLED_TS`, payload `scheduledAt` at `leaderboard_notification.dart:128-131`), same semantics as `RootNavigator.tsx:358-370`. v2 gap 45 (cold-start dedupe) closed. |
| utils/notificationNavigation | `isReminderNotification` (type `ENGAGEMENT_REMINDER`); `handleReminderNavigation` (`screen` hint is Simulations, otherwise Notifications). | `core/push/notification_navigation.dart` | PRESENT | |
| notificationService | `getNextScheduledNotificationTime` from env day, hour and minute; weekly trigger; cancel. | `leaderboard_notification.dart` `nextWeeklyOccurrence`, `cancel` | PRESENT | |
| TabNavigator | Tabs filtered by permission; ACHIEVEMENTS only for reviewer-only users; initial tab is `getFirstVisibleTab`; unread-review dot (sim plus scribe unread count); lazy tabs; nothing renders while user is loading. | `core/navigation/app_shell_screen.dart`, `tab_config.dart`, `app_bottom_tab_bar.dart`, `unreadReviewCountProvider` | PRESENT | v3 (`110c8e1`): permissions failure now shows translated `common.somethingWentWrong` + Retry (`app_shell_screen.dart:99-115`); Community re-opens on every tap (`:80-89`). |
| DrawerNavigator | Drawer with logout confirmation, then `handleUserLogout`. | `core/navigation/app_drawer.dart` `_confirmLogout` | PRESENT | v3: stale v2 note removed: drawer logout → `AuthController.logout` deregisters push first (`app_drawer.dart:175-187`, `auth_state.dart:70-80`). |
| utils/navigation.ts | `navigateToTab` / `navigateToLearnTab` / `navigateToCallLogTab` reset into a specific tab (used by path/case/course/feedback/CallSummary exits). | `core/navigation/home_tab_navigation.dart` (`goToHomeTab`) | PRESENT | v3 (`93ebfa9`): every exit now uses `goToHomeTab`: feedback (`simulation_feedback_screen.dart:254,264`), course Back to Learn (`course_item_player_screen.dart:292`), Scribe exit (`scribe_recording_screen.dart:543`), path widgets (`learning_path_widgets.dart:304`). No `go('/home')` left outside the deep-link reset (`deep_link_binding.dart:74`) and complete-profile. |
| RootNavigator | `gestureEnabled: false` on CallSummary, CourseItemPlayer, CompleteProfile, SimulationAssistant and SimulationFeedback. | `PopScope` on call_summary, roleplay_voice, simulation_feedback; router redirect pins complete-profile | PRESENT | |
| contexts/ReviewApiContext | Swaps every comment, thread and reaction hook between the simulation and scribe review APIs. | `ReviewType` parameter + `ScribeReviewsRepository` / `ScribeReactionsRepository` (`review_details_screen.dart`, `reactions_screen.dart`) | PRESENT | |
| Keep-awake (useListeningCommon, SimulationAssistantScreen) | `activateKeepAwake` while listening or recording and during a live roleplay; deactivated on exit. | `core/realtime/keep_awake.dart`; `scribe_recording_screen.dart:149`, `conference_listening_screen.dart:89`, `roleplay_voice_screen.dart:235` | PRESENT | v3 spot-check: `keep_awake.dart:13-31` (`WakelockPlus`). |
| utils/asyncStorage | JSON get/set/remove over AsyncStorage. | SharedPreferences, plus `core/network/token_storage.dart` (secure storage) | PRESENT | |
| AsyncStorageKeys.ACCESS_TOKEN / REFRESH_TOKEN | Token pair. | `token_storage.dart` (same key names, Keychain/Keystore) | PRESENT | v3: RN's tokens are carried over on the first prod launch (new row B63). |
| AsyncStorageKeys.LEARN_ACCESS_TOKEN | — | — | N/A | Never read or written in RN. |
| AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED | Toggle. | `leaderboardNotificationPrefsKey` (same name) | PRESENT | |
| AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS | Cold-start tap dedupe. | `core/push/push_notification_service.dart` (`claimColdStartNotificationTap`) | PRESENT | v3: `push_notification_service.dart:116,136-140` (same key, SharedPreferences). |
| AsyncStorageKeys.ACTIVE_TRACK_CONTEXT | Set when a course roleplay or game launches; CourseItemPlayer refetches the track on focus to pick up completion. | `course_item_player_screen.dart` `_refetchTrackOnReturn` (in memory, route-aware) | PRESENT | Doesn't survive an app kill (RN's does). |
| AsyncStorageKeys.UI_LANGUAGE / I18N_VERSION | UI language plus dynamic version cache. | `localization_controller.dart` (`ui_language`, `i18n_version`) | PRESENT | |
| AsyncStorageKeys.AUDIO_PLAYBACK_RATE | Remembers the feedback-screen audio speed. | `features/reviews/presentation/simulation_audio_player.dart` (`_rateKey`) | PRESENT | v3 (`930992c`): saved/restored under RN's own key `ally:audio:playback-rate` (`simulation_audio_player.dart:62-63,129`). Not migrated from RN (`legacy_session_migration.dart:16` comment is stale). Trivial. |
| utils/logger | Console output only in development. | `debugPrint` | N/A | |
| utils/error.ts | `getErrorDetails` (message, else error, else "somethingWentWrong"), `isBackendApiError`. | `core/network/error_details.dart` | PRESENT | v3 (`05d78c1`/`aedd4b1`): shared `core/network/error_details.dart:33-66` (`getErrorDetails`, `isBackendApiError`), used in 14 files; translator registered at `main.dart:117`. No raw `$error`/`$e` reaches UI any more (only `debugPrint`). v2 gap 40 closed. |
| utils/error.ts | `isSuspendedUserError` (403 + `USER_SUSPENDED` or "User suspended"). | `login_screen.dart` `_isSuspendedUserError` | PRESENT | v3: now shared `error_details.dart:70-74`; used by `login_screen.dart:262`. |
| utils/fileOperations | `saveFile`: summary export `.txt` to iOS Documents/CallSummary or Android Downloads, plus `scanFile`. | `features/calllog/data/summary_file_export.dart:40-76` (+ MainActivity channel) | PRESENT | v2: `.txt` to iOS Documents/CallSummary or Android Downloads + media scan. |
| utils/imageUpload | `uploadImageToS3` (PUT blob to the presigned URL). | `account_repository.dart` (presign, then PUT) | PRESENT | |
| utils/bugReportContext | screen, appVersion, device label, os, timestamp. | `bug_report_repository.dart` `_buildContext` (PackageInfo) | PRESENT | |
| utils/version.ts | `getAppVersion`, semver `isVersionLower`. | `core/app_update/force_update.dart:26` | PRESENT | v2: `isVersionLower` ported. |
| utils/common `openAppStore` | Opens the platform store URL (ForceUpdateModal). | `core/app_update/force_update.dart:84` | PRESENT | v3: listings are now this app's own (prod flavor = `com.helloally.app`). |
| ListeningScreen NetworkDisconnected | Offline vs socket copy; Try-again hidden while offline. | `network_disconnected.dart:43` | PRESENT | v2: `isOffline` now comes from `isOfflineProvider`. |
| B63 RN → Flutter storage migration (new) | The store update replaces the RN app in place (same bundle id), so its AsyncStorage session must carry over or every user is signed out. | `core/migration/legacy_session_migration.dart:43-121`, `rn_async_storage.dart:22-72`, Android `MainActivity.kt:40-75` (`ally/legacy_rn_storage`), run from `main.dart:60` (prod flavor only) | DEVICE-CHECK | v3 (`ece2b0a`): reads RN AsyncStorage 2.x (iOS `Application Support/<bundle>/RCTAsyncLocalStorage_V1/manifest.json` + MD5 overflow files; Android SQLite `RKStorage.catalystLocalStorage`), JSON-decodes, moves ACCESS/REFRESH tokens into secure storage (pair only, never over an existing session), `ally:ui:language`, `LEADERBOARD_NOTIFICATION_ENABLED`; one-shot flag; RN data untouched. Identity is RN's on both platforms (`ios/Flutter/prod.xcconfig:6`, `android/app/build.gradle.kts:59-62`). Code complete; proof needs an install-over-RN upgrade on a device signed with RN's team/upload key. Not migrated (trivial): `ally:audio:playback-rate`, `HANDLED_TS`. |
| B64 config/env `I18N_BASE_URL` (new) | Dynamic translation CDN; RN default `''` (`config/env.ts:82`), real value from `.env`. | `core/config/app_config.dart:62-66` | PRESENT | v3: `--dart-define` wins; else prod flavor → `https://api.helloally.ai/i18n` (manifest returned 200 on 10-28), dev flavor → retired `api.helloally.dev/i18n` (falls back to bundled strings; test-only). v2 gap 42 closed for the store build. |
| B65 utils/articleSegments (new) | `splitArticleHtml` on `data-ally-question` markers for inline article questions. | `features/courses/presentation/article/article_player.dart:50-54` | PRESENT | Discovery. |
| B66 utils/callLog (new) | `getLogSourceLabelConfig(provider)` label/colour. | `features/calllog/presentation/call_log_row.dart:56` | PRESENT | Discovery. |
| B67 utils/callSummary (new) | `mapTagsToString` (`tag` joined by ", "); `getEstimatedSummaryGenerationTime`. | `call_log_repository.dart:251-255`; `summary_generation_progress.dart:30-33` | PRESENT | Discovery. |
| B68 utils/common (new) | `isValidEmail`, `copyToClipboard`, `playNotificationSound`, `BADGE_CATEGORY_MAP`, `formatAsPercentage`/`formatAsStringOrDash`, `stringToUint8` (LiveKit data). | `login_screen.dart` (email check), `simulation_details_screen.dart:64`, `roleplay/presentation/simulation_sound_player.dart`, `achievements_screen.dart:17`, `livekit_room_service.dart:29` | PRESENT | Discovery. `tryParseJson`/`uint8ToString`/`calculateAverageForObjectArray` have no RN caller. Formatter parity owned by feature sections. |
| B69 utils/credits (new) | `areCreditsLow`, `getCreditUsagePercentage`. | `simulation_models.dart:262-268`; `app_drawer.dart:309-317`; `learning_path_detail_view.dart:143` | PRESENT | Discovery. |
| B70 utils/customFieldDate (new) | YYYY-MM-DD storage contract, spoken-date parsing, display. | `features/calllog/data/voice_custom_fields.dart`, `summary_display_format.dart` | PRESENT | Discovery; detail in §2 call summary. |
| B71 utils/date (new) | formatDate/Time, MM:SS, ordinal, relative time, duration. | `call_transcript_tab.dart:12`, `simulation_transcript_repository.dart:33`, `summary_display_format.dart:9`, `review_formatting.dart` | PRESENT | Discovery; per-use parity in feature sections. |
| B72 utils/html (new) | `decodeHtmlEntities`, `htmlToPlainText`, `htmlToMultilineText`. | `core/widgets/html_rich_text.dart`, course screens | PRESENT | Discovery. |
| B73 utils/quizAnswerState + quizHelpers (new) | Quiz answer state, `toAnswerInput`, `isAnswered`, fill-blank split, matching pairs. | `features/courses/data/quiz_answer_state.dart`, `quiz/quiz_question_widget.dart` | PRESENT | Discovery. |
| B74 utils/reviews (new) | `splitByCommentRanges`, top reactions, reaction action maths. | `features/reviews/data/review_models.dart:416-417`, `review_widgets.dart` | PRESENT | Discovery. |
| B75 utils/simulation (new) | `isShortSession`, `decodeFeedbackPayloadToJson`, `getTriggerWarningNames`, `parseMaxTimeSec`. | `simulation_models.dart:61,478-495`, `livekit_room_service.dart:29`, `simulation_details_modal.dart:330` | PRESENT | Discovery. |
| B76 utils/trackItemMeta + trackNavigation (new) | Item meta (icon/label/duration); `findNextItemId`. | `features/courses/data/course_models.dart`, `course_detail_screen.dart` | PRESENT | Discovery. |
| B77 utils/validation (new) | `isNumeric` for OTP input. | `login_screen.dart:998` (`digitsOnly`) | PRESENT | Discovery. |
| B78 utils/fieldRenderer (new) | `getFieldValue`/`formatFieldValue`/`renderField` for summary fields. | `features/calllog/presentation/call_summary_screen.dart` | PRESENT | Discovery; UI detail in §2. |
| B79 utils/trackCompletion (new) | `applyCompletionToDetailDraft`. | — | N/A | Discovery: no RN caller outside `utils/index.ts`. |

---

#### Section C — Store (`src/store/`)

| Slice / item | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| store.ts | `configureStore` combining user, chat, summary, credits and the RTK Query api. | Riverpod `ProviderScope` with per-feature providers | PRESENT | |
| store.ts | `setupListeners` enables `refetchOnFocus` / `refetchOnReconnect` (used by badges). | `core/navigation/screen_focus_listener.dart` | PRESENT | v3: RN uses `refetchOnReconnect`/`refetchOnFocus` only in useBadgePopup and the two ReviewDetails screens (grep). Both now refetch on reconnect (`badge_popup.dart:191-195`, `review_details_screen.dart:317-320`) and on app resume (`badge_popup.dart:88-89`, `review_details_screen.dart:108-109`). v2 gap 44 (refetch half) closed. |
| api tagTypes | Tag invalidation keeps 21 cache families fresh after mutations (credits, unread counts, notifications, track detail, discussion, …). | repository `onInvalidate` tag callbacks | PRESENT | v2 (`8e6ad33`, `2c523b3`): per-repository cache tags mirror RN invalidations (e.g. `SimulationCacheTag` in `simulations_repository.dart:197-215`). |
| userSlice.initialState | `loading: true` until the token check finishes. | `AuthState.unknown` (`isRestored: false`) | PRESENT | |
| userSlice.setAuthenticated | Flag drives the stack swap. | `AuthController.state.isAuthenticated` | PRESENT | |
| userSlice.setLoading | Ends the launch wait. | `AuthState.isRestored` | PRESENT | |
| userSlice.setUser / clearUser | Current user from `/users/me`. | `currentUserProvider` (returns a never-completing future when signed out; refetches on auth change) | PRESENT | |
| userSlice.setPermissions | Permissions array drives tabs, drawer and gates. | `userPermissionsProvider` (`/authorization/permissions`), rebuilt through `apiClientProvider` on auth change | PRESENT | |
| userSlice.storeTokens (thunk) | Writes ACCESS and REFRESH tokens to AsyncStorage. | `TokenStorage.storeTokens` (secure storage) via `AuthController.signIn` and the interceptor refresh | PRESENT | Encrypted storage (deliberate). v3: prod flavor now has RN's bundle id/applicationId, and RN tokens are migrated once (§4b B63). |
| userSlice.handleLogout (thunk) | Removes tokens, `setAuthenticated(false)`, `clearUser`, `setPermissions([])`. | `AuthController.logout()` (`TokenStorage.clear`, state false), with user and permissions providers rebuilt | PRESENT | |
| useUser.handleUserLogout | Best-effort **push token deregistration** (DELETE device token + FCM `deleteToken`) while auth is still valid, then logout. | `auth_state.dart:72-80` → `PushNotificationService.unregister` | PRESENT | v2. |
| useUser.handleUserLogout | `api.util.resetApiState()` drops every cached query. | `apiClientProvider` watches `isAuthenticated`; every repository watches it, so the cascade rebuilds | PRESENT | |
| api.ts handleUserLogout | Session expiry: logout + reset + toast `auth.sessionExpired`. | `AuthController.sessionExpired()` (snackbar, no toast if never signed in) | PRESENT | |
| useUser.checkAuth failure | Any `/users/me` failure logs out. | none | PARTIAL | v3: unchanged divergence, now a recorded team decision (`app_router.dart:90-92`, `app_shell_screen.dart:99-101`). See useUser. |
| Logout side effects: socket | Sockets close through screen unmount and focus cleanup (userId goes undefined). | Screens dispose `SocketService` when the redirect unmounts them; `socketServiceProvider` disposes on scope teardown | PRESENT | |
| Logout side effects: analytics | RN has **no** PostHog, and no Crashlytics `setUserId` or reset. | — | N/A | Nothing to port. v3: Flutter wires Crashlytics only for error reporting (`core/errors/crash_reporting.dart`); no user id, like RN. |
| Logout side effects: chat / credits / summary | RN does **not** clear `chat.currentChat`, credits or summary on logout. | `currentChatProvider` also isn't cleared; credits rebuild through apiClient | N/A | Parity, including RN's latent leak. |
| chatSlice.setCurrentChat | Set from the counsellor-chat discovery. | `core/chat/current_chat_provider.dart` `set(chat)` from `active_chat_discovery.dart` | PRESENT | |
| chatSlice.setCurrentChatId | On `USER_JOINED`, MicrophoneListeningScreen records the chat id (merge, not replace), so a slow refetch can't strand the session. | `scribe_recording_screen.dart:379`, `conference_listening_screen.dart:147` | PRESENT | v2 (`d4ae9eb` chatId race fix): Scribe/Conference write the chat into `currentChatProvider`. |
| chatSlice.clearCurrentChat | Cleared when no active chat is found (except on Breathing, CallSummary or Listening) and in CallSummary `handleGoBack` (not from logs). | `active_chat_discovery.dart` `isExemptFromClearingCurrentChat`; `box_breathing_screen.dart:187` | PRESENT | |
| chat.currentChat consumers | CallLog hides the start FAB and filters the live chat out of the list; CallSummary falls back to its chatId; Listening reads provider and startedAt. | `call_log_screen.dart:288`, `call_log_repository.dart:750`, `box_breathing_screen.dart:194` | PRESENT | |
| creditsSlice.setCredits / clearCredits | Set after fetch when the user has `EDIT_SCENARIO_SESSION`; cleared otherwise. | `simulationCreditsProvider`; drawer gated by `editScenarioSession` | PRESENT | |
| Credits refresh | Re-fetched on every mount of Simulations, SimulationDetails, Path, Case and drawer; `refreshCredits` exposed. | `simulations_repository.dart:206` | PRESENT | v2: invalidated by `endScenarioSession`; screens watch the provider. |
| summarySlice.setSummaryData | Summary response shared across the CallSummary component tree (set in `getCallSummary` `onQueryStarted`). | `callSummaryProvider(chatId)` family | PRESENT | |
| summarySlice.setFormData / markFormDataSaved | Shared form and a merged saved-baseline: only keys actually written are marked clean, so edits made during a save stay dirty. | `features/calllog/data/summary_form_state.dart` | PRESENT | v2: see useCallSummaryForm. |
| summarySlice.setSummaryVisibleFields / selectSummaryVisibleFields | Tenant-configured visible summary fields filter the sections and voice-note targets. | `settings_repository.dart:141` (`summaryVisibleFieldsProvider`) | PRESENT | v2. |
| summarySlice.clearSummaryStates | Clears summary, form and saved data when CallSummary unmounts. | Local `State` is discarded on dispose | PRESENT | |
| summarySlice selectors | selectSummary, selectCallDetails, selectCallInfo (chatId, counselorId, duration, provider, mode, summaryName), selectMetrics. | `CallSummaryDetails` model fields in `call_log_repository.dart`; metrics fields `listeningShare`, `reflectiveQuestionsAsked`, `emotionalLift` in `call_summary_fields.dart` | PRESENT | `selectMetrics` itself has no `.tsx` consumer in RN. |
| store/hooks.ts (new) | Typed `useAppDispatch`/`useAppSelector`. | Riverpod `ref.watch/read` | N/A | Discovery: typing wrapper only. |

---

#### Top gaps by user impact (v3)

No MISSING rows and no true code gap left in this section beyond one decided divergence.

1. **Firebase config for the store build** (BLOCKED-EXTERNAL): push registration, FCM display, logout deregistration, background handler, Crashlytics. CI fetches the files from S3; needs `IOS/ANDROID_GOOGLE_SERVICES_S3_URI_PROD` + AWS OIDC trust for this repo.
2. **Deep links** (DEVICE-CHECK + BLOCKED-EXTERNAL): Dart handler, manifest filter and entitlements are done. Needs AASA/`assetlinks.json` matching the Flutter build's signing, then cold/warm checks on device.
3. **RN session migration** (DEVICE-CHECK): code complete; prove with an over-the-top upgrade from the RN store build on iOS and Android.
4. **Google sign-in client ids** (BLOCKED-EXTERNAL): `ENV_VALUES_*` secret must be copied to this repo. Apple sign-in: device check.
5. **Logout on any `/users/me` failure** (PARTIAL ×2): team decided against it (`app_router.dart:90-92`). Close as won't-fix or port.
6. Low: no in-flight guard on `checkForActiveChat`; voice-note setting fetched before the counsellor check; dev flavor's `I18N_BASE_URL` default is the retired dev host.

---

## §5 Backend endpoints (actually called by RN) and transport

### Endpoints and transport parity ledger (RN to Flutter)

- RN source of truth: `ally-platform/ally-mobile/src` (services/*.ts, constants/general.ts `API_ROUTES`, plus raw fetch/XHR/socket.io/LiveKit callers).
- **v3 re-audit (2026-10-28): Flutter worktree @ f770200** (56 commits since v2's 227db3a), RN @ 7a8ce0c19. Every non-PRESENT row re-read; 55 PRESENT endpoint rows spot-checked (method, path, query/body, caller); endpoint diff re-run (`v3/scripts/endpoints_out.txt`, `fl_calls_out.txt`, `callers_out.txt`). Changed notes prefixed **v3:**.
- **v2 re-audit (2026-10-28): Flutter master @ 227db3a.** Every PARTIAL/MISSING/MERGED row below was re-read on master; v1 statuses are kept in brackets as `(v2: was …)`. v1 note follows.
- Flutter (v1): `ally-mobile-flutter` **master @ e248a07**, the tip at 18:52 on 2026-10-28. `parity/feedback` was merged into master at 18:52 and the branch deleted, so Ask-AI and event-checklist now count as PRESENT on master. The only open in-flight branch is **`parity/reviews` @ a91ed21**. I also checked `feature/simkit`, which is already merged.
- "Called" means an RTK endpoint whose generated hook or `.endpoints.X.initiate` is referenced from non-test code under `src/`, or a raw call. Hooks that are only exported from `hooks/index.ts` and never invoked (`useLanguageDropdown`, `useSimulationTransition`) count as unused, so the endpoints that only they reach are listed as DEAD (transitive).
- Paths are shown without the `/api/v1` prefix. Both apps prepend `/api/{v1|v2}`, and v2 applies only to exact `/auth/generate-otp`, `/auth/verify-otp` and `/learn/scenarios`. Flutter matches this (`auth_interceptor.dart` `_isV2` uses exact equality).
- **(lang)** means the endpoint is in RN `LANGUAGE_CODE_ENDPOINTS`. RN `baseQuery` injects `languageCode=<i18n.resolvedLanguage>` into query params on GETs and into the body on mutations. **v2:** Flutter now has the same 18-entry allowlist in `core/network/language_code_interceptor.dart:27-46` (GET → query param, mutation → JSON body, caller value wins), registered before `AuthInterceptor` in `api_client.dart:55`. All (lang) rows are PRESENT on that axis.

#### Tallies

| Status | v3 | (v2) |
|---|---|---|
| PRESENT | 150 table rows = 149 v2 rows + 1 new 7a8ce0c19 contract row (covers the 150 called endpoints: the force-update row is GET ios + android) | (148) |
| PARTIAL | 0 | (2) |
| MISSING | 0 | (0) |
| BLOCKED-EXTERNAL / DEVICE-CHECK | 0 / 0 | (n/a) |
| DEAD (defined in RN, never called) | 25 (21 direct + 4 transitive) | (25) |
| **Endpoint-table rows** | 150 | (149 rows / 150 endpoints) |

Transport / realtime / cache (§5.2–5.4, counted separately): **v3 all PRESENT or divergent-by-design, plus 1 new DEVICE-CHECK row (RN session carry-over).** The three v2 PARTIALs are closed: error normalisation (`core/network/error_details.dart:33`), socket retry-after-failure (`core/realtime/socket_service.dart:27,110-127`), review-details resume/reconnect/edit refetch (`features/reviews/presentation/review_details_screen.dart:108-113,309-311,318-320`). Divergent-by-design rows (not gaps): Retry policy, Timeouts (Dio `receiveTimeout 90s`, `core/network/api_client.dart:27`), Network logger.

**v3 spot-check of PRESENT rows (55):** generateOtp, verifyOtp, loginWithGoogle, completeProfile, profile-image-url + S3 PUT + PATCH/DELETE profile-image, getForceUpdateConfig, createBugReport, search, getLeaderboard, getMyRank, getNotifications, markAll, registerDeviceToken, deleteDeviceToken, getCallLogs, getCallTags, getSimulationLogs, archiveCallLog, updateCallInfo, deleteSummary PUT, exportCallSummary (plain), updateNotes, enhance, retrySummary, summary-feedback body, createNote, generate-from-audio (multipart), saveNoteTranscript, getChatMessages, custom-field values PUT, getPlaces/searchPlaces, addFeedback/updateFeedback, enrollTrack, journal draft/submit, video-progress, quiz-attempts, branching, bucket-sort place, startScenarioSession, endScenarioSession, simulation feedback body, getSimulationMessages, getReviews, createReview, createScribeReview, updateReviewStatus, getThreads, review_api comments/reactions, Ask-AI history/stream. All match RN; every repository method has a live caller (`v3/scripts/callers_out.txt`) except the RN-dead extras listed in §5.5. **No regressions.**

---

#### 1. Endpoint rows

##### Auth and account
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter method + path + file | Status |
|---|---|---|---|---|---|
| generateOtp | POST /v2 /auth/generate-otp | `{email, allowedRoles: ALLOWED_ROLES, appType:'APP'}` | SplashScreen EmailLogin, OtpVerification (resend) | `AuthRepository.generateOtp` same body, `features/auth/data/auth_repository.dart` | PRESENT |
| verifyOtp | POST /v2 /auth/verify-otp | `{email, otp, allowedRoles}` | OtpVerification (403 USER_SUSPENDED routes to Suspended) | `AuthRepository.verifyOtp`; 403 check in `login_screen.dart:55-65` | PRESENT |
| loginWithGoogle | POST /auth/google | `{idToken, allowedRoles}` | hooks/useGoogleLogin | `AuthRepository.loginWithGoogle` | PRESENT. Caveat: `AppConfig.googleWebClientId` defaults to `''` ("until this app's package has an OAuth client"), so Google sign-in only works when the dart-define is supplied. |
| loginWithApple | POST /auth/apple | `{identityToken, authorizationCode, fullName{givenName,familyName}, allowedRoles}` | hooks/useAppleLogin | `AuthRepository.loginWithApple` (omits `fullName` when both names are null) | PRESENT |
| getUser | GET /users/me | none; tag `User` | hooks/useUser (+ forced refetch after profile mutations) | `AccountRepository.getUser`, `currentUserProvider` (`features/account/data/account_repository.dart`) | PRESENT |
| getPermissions | GET /authorization/permissions | none | hooks/useUser | `PermissionsRepository.getPermissions` (`core/permissions/permissions_repository.dart`) | PRESENT |
| getProfileImagePresignedUrl | POST /users/profile-image-url | `{fileName, fileSize, contentType}` | hooks/useProfileImage | `AccountRepository.uploadProfileImage` step 1 | PRESENT |
| (raw) S3 upload | PUT `<presignedUrl>` | blob, `Content-Type` | utils/imageUpload.ts | `Dio().put(presignedUrl, file.openRead(), Content-Length + Content-Type)` | PRESENT |
| updateProfileImage | PATCH /users/profile-image | `{profileImageUrl}`; then refetch User | hooks/useProfileImage | `AccountRepository.uploadProfileImage` step 3 / `updateProfileImage`; screen invalidates `currentUserProvider` | PRESENT |
| deleteProfileImage | DELETE /users/profile-image | body `{profileImageUrl}` | hooks/useProfileImage | `AccountRepository.deleteProfileImage` (DELETE with body) | PRESENT |
| completeProfile | PATCH /users/me/complete-profile | `{name, phone?}` | CompleteProfileScreen | `AccountRepository.completeProfile`; invalidates `currentUserProvider` | PRESENT |
| getLogoUrl | GET /users/tenant | none | LogoutScreen/CustomDrawerContent | `AccountRepository.getTenant`, `tenantInfoProvider` (app_drawer) | PRESENT |
| getForceUpdateConfig | GET /app-version/ios or /app-version/android | none | hooks/useForceUpdate (SplashScreen) | `core/app_update/force_update.dart:11-12` (`/app-version/{ios,android}`, `minimumSupportedVersion`) + force-update gate | PRESENT (v2: was MISSING) |

##### Analytics, bug report, search
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getDashboards | GET /analytics/dashboard | none | UserAnalyticsScreen | `AnalyticsRepository.getDashboards` | PRESENT |
| getDashboardUrl | GET /analytics/dashboard/:id | none | UserAnalyticsScreen (lazy) | `AnalyticsRepository.getDashboardUrl` | PRESENT |
| createBugReport | POST /product-roadmap/bug-reports | `{description, context:{screen?, appVersion, device, os, clientTimestamp}}` | hooks/useBugReport, BugReportScreen | `BugReportRepository.createBugReport` (same keys; `device` is the generic "iPhone"/"Android device" string rather than the model label); 429 handled in screen | PRESENT |
| getSearchResults | POST /reference-document/search | `{query, limit, filters?{category}, excludedIds?}` | hooks/useSearch (Search screen + listening-screen search) | `SearchRepository.search` (pageSize 6, same body) | PRESENT |

##### Badges, progress, leaderboard, notifications
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getAvailableBadges (lang) | GET /badges/me/available | none (+languageCode) | AchievementsScreen | `AchievementsRepository.getBadges` (`achievements_repository.dart:93`); `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getBadges | GET /badges/me?viewedStatus=UNVIEWED | `{viewedStatus}`; polled every 60s, refetchOnFocus/Reconnect | hooks/useBadgePopup, BadgePopup (app-wide unlock celebration) | `AchievementsRepository.getUnviewedBadges` (`achievements_repository.dart:99-103`, `viewedStatus=UNVIEWED`); polled + resume refetch in `achievements/presentation/badge_popup.dart:87,104` | PRESENT (v2: was MISSING) |
| markBadgeAsViewed | PATCH /badges/me/:badgeId/viewed | none; invalidates Badges lists | hooks/useBadgePopup (on popup dismiss) | `AchievementsRepository.markBadgeAsViewed`, called on badge tap in `achievements_screen.dart:250` (different trigger because there is no popup) | PRESENT (endpoint; trigger differs) |
| getProgressSummary | GET /progress/me/summary | none | hooks/useProgressSummary (header widget) | `ProgressRepository.getProgressSummary` | PRESENT |
| getProgress | GET /progress/me | none | ProgressScreen | `ProgressRepository.getProgress` | PRESENT |
| getProgressEnabled | GET /progress/me/enabled | none | hooks/useProgressSummary | `ProgressRepository.getProgressEnabled` | PRESENT |
| getLeaderboard (lang) | GET /community/leaderboard | `{window, limit=50, offset=0, sortBy='score', order='DESC'}` | hooks/useLeaderboard | `LeaderboardRepository.getLeaderboard` (`leaderboard_repository.dart:107-115`) sends `sortBy:score, order:DESC`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2). Page size is 30 (`kLeaderboardPageSize`) vs RN 50; both page by offset, so only the request count differs. |
| getMyRank | GET /community/leaderboard/my-rank | `{window}` | hooks/useLeaderboard | `LeaderboardRepository.getMyRank` | PRESENT |
| getNotifications | GET /notifications | `{limit=25, offset}` | NotificationsScreen | `NotificationsRepository.list` + loadMore | PRESENT |
| markNotificationRead | PATCH /notifications/:id/read | none | NotificationsScreen | `markRead`; invalidates `notificationsControllerProvider` | PRESENT |
| markAllNotificationsRead | PATCH /notifications/read-all | none | NotificationsScreen | `markAllRead` | PRESENT |
| registerDeviceToken | PUT /notifications/device-tokens | `{token, platform:'IOS'/'ANDROID'}` | services/pushNotificationService (initiate on login + token refresh) | `NotificationsRepository.registerDeviceToken` via `core/push/push_notification_service.dart:210,216` | PRESENT |
| deleteDeviceToken | DELETE /notifications/device-tokens/:encodedToken | none | `unregisterDeviceForPush`, called from hooks/useUser logout | `NotificationsRepository.deleteDeviceToken` (`notifications_repository.dart:58-59`, URI-encoded) via `PushNotificationService.unregister`, called from logout `core/auth/auth_state.dart:73` | PRESENT. v3: spot-checked. |

##### Scribe: live chat, call log, call summary, notes
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getCounsellorChat | GET /chats/counsellor-chat | none | useCounselorChat (RootNavigator, SplashScreen, CallLogScreen, useListeningCommon) | `ChatRepository.getCounsellorChat` (`scribe/data/chat_repository.dart:19`); callers `core/chat/active_chat_discovery.dart:55`, `calllog/presentation/call_log_screen.dart:219,238-247` (before `/scribe`), `scribe_recording_screen.dart:391,428`, `conference_listening_screen.dart:142,155`; app-wide telephony `USER_JOINED` → `checkForActiveChat` (`main.dart:128-133`) | PRESENT. v3: v2 gap 27 (no check before `/scribe`) CLOSED (`call_log_screen.dart:219`); stale "socket trigger missing" note removed. |
| endCall | POST /chats/:chatId/end | none | useListeningCommon | `ChatRepository.endCall` | PRESENT |
| addFeedback | POST /chats/messages/:messageId/feedback | `{rating}` | NudgeSection | `ChatRepository.addFeedback` | PRESENT |
| updateFeedback | PATCH /chats/messages/feedback/:feedbackId | `{rating}` | NudgeSection | `ChatRepository.updateFeedback` | PRESENT |
| updateNotes | POST /chats/:chatId/notes | `{content}` (1s debounce) | hooks/useSummaryState, CallSummaryScreen `onNoteChange` / AddNotesSection (notes typed while the summary is generating) | `CallLogRepository.updateNotes` (`call_log_repository.dart:636`), 1s debounce in `call_summary_screen.dart:777` / `summary_generation_progress.dart:303` | PRESENT (v2: was MISSING) |
| getCallLogs | GET /chats/call-logs | `{limit, offset, archive, fieldFilters?, startDate?, endDate?, minDuration?, maxDuration?, tags?, mode?, status?, source?}` | CallLogScreen | `CallLogRepository.getCallLogs` + `CallLogFilterState.toQueryParameters` (all filter keys) | PRESENT |
| getCallTags | GET /chats/tags | `{offset:0}` | CallLogScreen (filter sheet) | `CallLogRepository.getAllTags` sends `{search?}` | PRESENT (param difference is harmless) |
| archiveCallLog | PATCH /chats/call-logs/:id/archive | `{archive}` | useCallSummaryActions | `CallLogRepository.archiveCallLog` | PRESENT |
| getSimulationLogs | GET /learn/scenario-sessions | `{limit, offset, sortBy:'createdAt', order:'DESC'}` | CallLogScreen (Role play tab) | `CallLogRepository.getSimulationLogs` (`call_log_repository.dart:573-575`) sends `{limit, offset, sortBy:createdAt, order:DESC}` | PRESENT (v2) |
| getCallSummary | GET /chats/:chatId | none; `onQueryStarted` stores in redux | hooks/useSummaryState | `CallLogRepository.getCallSummary` / `getCallLogItem`; 403 handled (`call_summary_screen.dart:964`) | PRESENT |
| updateCallSummary | PUT /chats/:chatId/call-details | `{summary: <changed fields, cleared=null>}`; "Delete summary" sends `{summary:{}}` | useCallSummaryForm, VoiceNoteSection, useCallSummaryActions (delete) | `CallLogRepository.updateCallSummary`; delete summary `PUT {summary:{}}` at `call_log_repository.dart:617`, wired from `call_summary_actions.dart:94` | PRESENT (v2) |
| exportCallSummary | GET /chats/:chatId/export-summary (`responseHandler: text`) | none; result saved to a file | useCallSummaryActions (3-dot menu, Export) | `CallLogRepository.exportCallSummary` (`call_log_repository.dart:625`) + `summaryFileSaverProvider` in `call_summary_actions.dart:59-71` | PRESENT (v2: was MISSING) |
| updateCallInfo | PATCH /chats/:chatId/call-info | `{summaryName}` | useCallSummaryActions (rename) | `CallLogRepository.updateSummaryName` | PRESENT |
| enhanceCallSummary | POST /chats/enhance | `{content}` returns `{enhanced_content}` | SectionWrapper | `CallLogRepository.enhanceCallSummary`, used at `call_summary_screen.dart:785` (the screen doc comment saying "not ported" is stale) | PRESENT |
| addSummaryFeedback | POST /chats/:chatId/summary-feedback | `{rating, feedback:{issues[], comment}}` | useCallSummaryActions | `CallLogRepository.addSummaryFeedback` | PRESENT |
| retrySummary | POST /chats/:chatId/retry-summary | none | CallSummaryScreen | `CallLogRepository.retrySummary` | PRESENT |
| getChatMessages | GET /chats/:chatId/messages | `{limit:20, offset, sortOrder:'ASC', sortBy: WEBRTC ? 'createdAt' : 'startSeconds', type?}`, infinite scroll | hooks/useCallTranscriptDetails (CallTranscript tab) | `CallLogRepository.getChatMessages` (`call_log_repository.dart:764-786`): `limit:20, offset, sortOrder:ASC, sortBy` (`createdAt` for WEBRTC, `call_log_repository.dart:1022`) | PRESENT (v2). Built differently: walks every page up front instead of RN infinite scroll. |
| getCustomFieldDefinitions | GET /custom-fields/definitions | none | CallLogScreen, CallSummaryDetails, VoiceNoteSection | `CustomFieldsRepository.getDefinitions` | PRESENT |
| getCustomFieldValues | GET /custom-fields/values/:chatId | none | CallSummaryDetails | `CustomFieldsRepository.getValues` | PRESENT |
| upsertCustomFieldValues | PUT /custom-fields/values/:chatId | `{values:[{fieldDefinitionId, value|null}]}` | CallSummaryDetails, VoiceNoteSection | `CustomFieldsRepository.upsertValues` (sends explicit null) | PRESENT |
| getCustomFieldsEnabled | GET /settings/custom-fields-enabled | none | CallSummaryDetails, VoiceNoteSection | `SettingsRepository.getCustomFieldsEnabled` (`core/settings/settings_repository.dart`) | PRESENT |
| createNote | POST /chats/note | none | CallLogScreen | `CallLogRepository.createNote` | PRESENT |
| generateNoteFromAudio | POST /chats/note/generate-from-audio (multipart) | parts `audio` (dictation.wav, audio/wav), `fields` (JSON: built-in **plus tenant custom fields**), `languageHint?` | VoiceNoteSection | `CallLogRepository.generateNoteFromAudio` (`call_log_repository.dart:738`); custom fields via `voice_custom_fields.dart` + `voice_note_section.dart:150-166` | PRESENT (v2) |
| saveNoteTranscript | PUT /chats/:chatId/transcript | `{transcript}` | VoiceNoteSection | `CallLogRepository.saveNoteTranscript` | PRESENT |
| getSummaryFields | GET /settings/summary-fields | none; `onQueryStarted` dispatches `setSummaryVisibleFields` | RootNavigator (on auth), CallSummaryScreen | `SettingsRepository` (`core/settings/settings_repository.dart:80`), applied in `call_summary_screen.dart:1159` and `call_summary_fields.dart:533` | PRESENT (v2: was MISSING) |
| getNudgeStatus | GET /settings/nudge-status | none | Microphone/Conference listening screens | `SettingsRepository.getNudgeStatus` | PRESENT |
| getVisibleChatTypes | GET /settings/chat-types | none | CallLogScreen | `SettingsRepository.getVisibleChatTypes` | PRESENT |
| getScribeNoteCreationEnabled | GET /settings/scribe-note-creation-enabled | none | hooks/useScribeNoteCreationEnabled | `SettingsRepository` | PRESENT |
| getScribeVoiceNoteEnabled | GET /settings/scribe-voice-note-enabled | none | hooks/useScribeVoiceNoteEnabled | `SettingsRepository` | PRESENT |
| getPlaces | GET /places | `{page=1, limit=50}` | components/SearchableLocationDropdown via utils/fieldRenderer (summary "location" field) | `PlacesRepository.getPlaces` (`calllog/data/places_repository.dart:36`), used by `searchable_location_dropdown.dart:134` | PRESENT (v2: was MISSING) |
| searchPlaces | GET /places/search | `{query}` | SearchableLocationDropdown | `PlacesRepository.searchPlaces` (`places_repository.dart:45`), used by `searchable_location_dropdown.dart:167` | PRESENT (v2: was MISSING) |

##### Courses (learn tracks) and discussion
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter (`features/courses/data/courses_repository.dart` unless noted) | Status |
|---|---|---|---|---|---|
| getLearnTracks (lang) | GET /learn/tracks | none; unwraps `data` | SimulationsScreen | `getLearnTracks`, `learnTracksProvider`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getLearnTrackDetail (lang) | GET /learn/tracks/:trackId | none | CourseOverviewScreen, CourseItemPlayerScreen | `getLearnTrackDetail`, `trackDetailProvider`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getLearnTrackProgress | GET /learn/tracks/:trackId/progress | none | CourseProgressScreen, CourseProgressSheet | `getLearnTrackProgress`, `trackProgressProvider` | PRESENT (goes stale; see §4) |
| getNextTrackItem | GET /learn/tracks/:trackId/next-item | none | CourseProgressScreen, CourseOverviewScreen | `getNextTrackItem` (imperative) | PRESENT |
| enrollTrack (lang) | POST /learn/tracks/:trackId/enroll | body `{languageCode}` (injected) | CourseOverviewScreen | `CoursesRepository.enrollTrack` (`courses_repository.dart:97`); interceptor adds body `{languageCode}` | PRESENT (v2) |
| startTrackItem | POST /learn/tracks/items/:itemId/start | none | CourseItemPlayerScreen, Quiz/Branching/BucketSort players | `startTrackItem` | PRESENT |
| markArticleRead | POST .../items/:itemId/article-read | none | ArticlePlayer | `markArticleRead` | PRESENT |
| submitArticleQuestionAnswer | POST .../items/:itemId/article-questions/:qid/answer | `{selectedOptionId}` | ArticleQuestionCard | `submitArticleQuestionAnswer` | PRESENT |
| reportVideoProgress | POST .../items/:itemId/video-progress | `{watchedPct}` (+ optimistic `maxWatchedPct` patch) | VideoItemPlayer | `reportVideoProgress` | PRESENT |
| submitInterjectionAnswer | POST .../items/:itemId/interjections/:iid/answer | `QuizAnswerInput` | VideoInterjectionModal | `submitInterjectionAnswer(answer.toJson())` | PRESENT |
| submitQuizAttempt | POST .../items/:itemId/quiz-attempts | `{answers: QuizAnswerInput[]}` | QuizItemPlayer | `submitQuizAttempt` | PRESENT |
| regradeQuizAttempt | POST .../items/:itemId/quiz-attempts/:attemptId/regrade | none | QuizItemPlayer (PENDING_GRADING results) | `CoursesRepository.regradeQuizAttempt` (`courses_repository.dart:200-205`), called from `quiz/quiz_player.dart:126` | PRESENT (v2: was MISSING) |
| recordGameResult | POST .../items/:itemId/game-result | `{score}` | GamePlayer | `recordGameResult` | PRESENT |
| recordBranchingResult | POST .../items/:itemId/branching-result | `{path: string[]}` | BranchingScenarioPlayer | `recordBranchingResult` | PRESENT |
| placeBucketSortItem | POST .../items/:itemId/bucket-sort/place | `{sortItemId, bucketId}` | BucketSortPlayer | `placeBucketSortItem` | PRESENT |
| restartBucketSort | POST .../items/:itemId/bucket-sort/restart | none | BucketSortPlayer | `restartBucketSort` | PRESENT |
| saveJournalDraft | POST .../items/:itemId/journal | `{responses:[{promptId, response}]}` | JournalPlayer | `saveJournalDraft` | PRESENT |
| submitJournal | POST .../items/:itemId/journal/submit | none | JournalPlayer | `submitJournal` | PRESENT |
| setTrackLanguage | PUT /learn/tracks/:trackId/language | `{languageCode}` | CourseLanguageSheet | `setTrackLanguage`; invalidates `trackDetailProvider` | PRESENT |
| startTrackItem response (ROLEPLAY) — **new v3 row (RN 7a8ce0c19)** | POST /learn/tracks/items/:itemId/start → `completionCriteria.assessmentMode`, `assessmentSubmittedAt?` | response fields | RoleplayCasePlayer (`types/courses.ts` `TrackCompletionCriteria.assessmentMode`, `StartRoleplayItemPayload.assessmentSubmittedAt`) | parsed in `courses/data/start_item_payload.dart:623-624,635-639` and `course_models.dart:120-133`; consumed by `courses/presentation/roleplay/roleplay_case_player.dart:56-57,128-173` | PRESENT (v3 new) |
| getDiscussion | GET /learn/track-items/:itemId/discussion | none | components/DiscussionThread | `DiscussionRepository.getDiscussion` (`discussion_repository.dart`) | PRESENT |
| createDiscussionPost | POST /learn/track-items/:itemId/discussion/posts | `{content}` | DiscussionThread | `createPost` | PRESENT |
| replyToDiscussionPost | POST /learn/discussion/posts/:postId/replies | `{content}` | DiscussionThread | `replyToPost` | PRESENT |
| editDiscussionPost | PUT /learn/discussion/posts/:postId | `{content}` | DiscussionThread | `editPost` | PRESENT |
| deleteDiscussionPost | DELETE /learn/discussion/posts/:postId | none | DiscussionThread | `deletePost` | PRESENT |
| lockDiscussionPost | PUT /learn/discussion/posts/:postId/lock | `{locked}` | DiscussionThread | `lockPost` | PRESENT |
| lockDiscussion | PUT /learn/track-items/:itemId/discussion/lock | `{locked}` | DiscussionThread | `lockDiscussion` | PRESENT |

##### Simulations, role play, feedback, Ask-AI
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter (`features/simulations/data/simulations_repository.dart` unless noted) | Status |
|---|---|---|---|---|---|
| getScenarios (lang) | GET /v2 /learn/scenarios | none; unwraps `data` | SimulationsScreen | `getScenarios` (v2 via exact match); interceptor runs before `AuthInterceptor`, so it matches the un-versioned path | PRESENT (v2) |
| getScenarioById (lang) | GET /learn/scenarios/:id | none | RoleplayCasePlayer (course) | `getScenarioById`, `scenarioByIdProvider`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getSimulationPaths (lang) | GET /learn/scenario-paths | none; unwraps `data` | SimulationsScreen | `getScenarioPaths`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getSimulationPathDetails (lang) | GET /learn/scenario-paths/:pathId | none; scenarios sorted by `order` | hooks/useLearningPathDetails | `getSimulationPathDetails`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| createPathSession | POST /learn/scenario-paths/:pathId/create-session | none | useLearningPathDetails | `createPathSession`; screen invalidates path details | PRESENT |
| getScenarioSessionByPathItem | GET /learn/scenario-session/scenario-path-session-item/:id | none | useLearningPathDetails | `getScenarioSessionByPathItem` | PRESENT |
| getCases (lang) | GET /learn/cases | none | SimulationsScreen | `getCases`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getCaseDetails (lang) | GET /learn/cases/:caseId | none | RoleplayCasePlayer, useLearningPathDetails | `getCaseDetails`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| createCaseSession | POST /learn/cases/:caseId/create-session | none | useLearningPathDetails | `createCaseSession` | PRESENT |
| getScenarioSessionByCaseItem | GET /learn/scenario-session/case-session-item/:id | none | useLearningPathDetails | `getScenarioSessionByCaseItem` | PRESENT |
| getSimulationCredits | GET /simulation-credits | none; tag `SimulationCredits` | hooks/useSimulationCredits (drawer, details screens) | `getSimulationCredits`, `simulationCreditsProvider` | PRESENT (never refreshed; see §4) |
| startScenarioSession | POST /learn/scenario-session-start | `{scenarioId, scenarioPathSessionItemId?, caseSessionItemId?, trackItemProgressId?, languageId?}` returns `{scenarioSession.id, accessToken{token, serverUrl}, scenario}` | hooks/useStartSimulation | `startScenarioSession` (same body); `SessionData.fromJson` reads `accessToken.token/serverUrl` | PRESENT |
| endScenarioSession (lang) | POST /learn/scenario-session/:id/end | body `{enableRecommendations:true, languageCode}` | ActiveSimulationModal, SimulationAssistantScreen | `SimulationsRepository.endScenarioSession` (`simulations_repository.dart:117-123`) body `{enableRecommendations:true}` + interceptor `languageCode`; invalidates credits/paths/cases (`:207-213`) | PRESENT (v2) |
| getSimulationDetails (lang) | GET /learn/scenario-session/:id | `{enableRecommendations:true}` | SimulationFeedbackScreen | `getSimulationDetails` (`simulations_repository.dart:33`, `enableRecommendations`); `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| addSimulationFeedback | POST /learn/scenario-session/:id/feedback | `{rating, feedback, tags?}` | SimulationFeedbackScreen | `addSimulationFeedback` | PRESENT |
| getEventChecklist (lang) | GET /learn/scenario-session/:id/event-checklist | none | EventChecklist (feedback screen) | `getEventChecklist`, `eventChecklistProvider`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2) |
| getSimulationMessages | GET /learn/scenario-session/:id/messages | `{limit:10, offset, sortBy:'startSeconds', sortOrder, languageCode?}` (`languageCode` = transcript-translation dropdown) | useSimulationTranscriptDetails (SimulationTranscript) | `SimulationTranscriptRepository.getMessages` (`simulation_transcript_repository.dart:56-66`) incl. optional `languageCode` from the transcript-language dropdown | PRESENT (v2) |
| getSimulationSessionRecording | GET /learn/scenario-session/:id/recording | none returns recording URL | hooks/useSimulationSessionRecordingUrl (TranscriptTab audio player) | `simulation_transcript_repository.dart:81-88` (`presignedUrl`), player in `simulation_transcript_tab.dart:34` | PRESENT (v2: was MISSING) |
| (raw) Ask-AI history | GET /learn/scenario-sessions/:id/chat/history | Bearer; own 401-refresh-retry | AskAI/chatSessionManager.loadHistory | `AskAiChatApi.getHistory` (`core/widgets/ask_ai_chat/ask_ai_chat_api.dart`) through shared Dio and interceptor | PRESENT |
| (raw) Ask-AI stream (SSE) | POST /learn/scenario-sessions/:id/chat/stream | `{message}`, `Accept: text/event-stream`; XHR `onprogress` parse of `data: {type: START\|TOKEN\|CITATIONS\|DONE\|ERROR}` | chatSessionManager.startStream | `AskAiChatApi.streamChat` (`ResponseType.stream` + `SseEventParser`); 401 refreshed by `AuthInterceptor`; error copy matches RN | PRESENT |
| (raw) Review/feedback audio | GET `<audioUrl>` (S3) | none | SimulationAudioPlayer (review card/details) | `simulation_audio_player.dart` `setSourceUrl(audioUrl)` | PRESENT |

##### Reviews (simulation + scribe), threads, reactions
Master files: `features/reviews/data/reviews_repository.dart`, `scribe_reviews_repository.dart`, `features/reactions/data/reactions_repository.dart`. The branch `parity/reviews` adds a unified `features/reviews/data/review_api.dart` (`ReviewApi`, base switches on `ReviewType`). I verified that it covers the rows marked IN PROGRESS.

| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getReviews (lang) | GET /scenario-session-reviews | `{sortBy, readFilter, limit:10, offset, order:'DESC'}`, infinite scroll | ReviewScreen / ReviewList / useReviews | `ReviewsRepository.getReviews` (`reviews_repository.dart:26-37`): paginated `limit:10, offset`, `order:DESC`; `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PRESENT (v2: was MERGED) |
| getScribeReviews | GET /scribe-session-reviews | same shape | ReviewScreen | `ScribeReviewsRepository` (`scribe_reviews_repository.dart:22-33`): paginated, `order:DESC` | PRESENT (v2: was MERGED) |
| getReviewById (lang) | GET /scenario-session-reviews/:id | none; `keepUnusedDataFor:0`, refetchOnFocus/Reconnect | SimulationFeedbackScreen, SimulationReviewDetailsScreen | `ReviewsRepository.getReview` (`reviews_repository.dart:46-50`), `reviewDetailProvider`; interceptor `languageCode`. v3: refetch on app resume (`review_details_screen.dart:108-113`), on back-online (`:318-320`, `isOfflineProvider`), and after edit-note returns (`:309-311`) | PRESENT. v3: was PARTIAL (v2 gap 38 CLOSED, f87fa32). |
| getScribeReviewById | GET /scribe-session-reviews/:id | none | ScribeReviewDetailsScreen | `getScribeReview` | PRESENT |
| createReview | POST /scenario-session-reviews | `{scenarioSessionId, note}` | ShareSimulationScreen | `ReviewsRepository.createReview` | PRESENT |
| createScribeReview | POST /scribe-session-reviews | `{scribeSessionId:number, note}` | ShareCallLogScreen | `ScribeReviewsRepository.createReview` | PRESENT |
| updateReviewStatus | PATCH /scenario-session-reviews/:id | `{status, note?}` | ReviewApiContext, ShareSimulationScreen, useToggleReviewPrivacy | `updateReviewStatus` | PRESENT |
| updateScribeReviewStatus | PATCH /scribe-session-reviews/:id | `{status, note?}` | ReviewApiContext, CallSummaryScreen, ShareCallLogScreen, ScribeReviewDetailsScreen | `updateReviewStatus` (scribe) | PRESENT |
| markSimulationReviewAsRead | PATCH /scenario-session-reviews/:id/mark-read | none | SimulationReviewDetailsScreen | `markAsRead` (called from `review_screen.dart` on open) | PRESENT |
| markScribeReviewAsRead | PATCH /scribe-session-reviews/:id/mark-read | none | ScribeReviewDetailsScreen | `markAsRead` (scribe) | PRESENT |
| getUnreadSimulationReviewCount | GET /scenario-session-reviews/unread-count | none | navigation/TabNavigator (Reviews tab dot) | `getUnreadCount`, `unreadReviewCountProvider` (`app_shell_screen.dart:60`) | PRESENT |
| getUnreadScribeReviewCount | GET /scribe-session-reviews/unread-count | none | navigation/TabNavigator (dot = sim + scribe) | `ScribeReviewsRepository.getUnreadCount` (`scribe_reviews_repository.dart:45`), summed into `unreadReviewCountProvider` (`reviews_repository.dart:143-146`) | PRESENT (v2: was MISSING) |
| getMessages | GET /scenario-session-reviews/:id/messages | `{offset, limit, sortOrder?, sortBy?}` | SimulationReviewDetailsScreen (transcript under review) | `ReviewApi.getMessages` (`reviews/data/review_api.dart:49-52`) | PRESENT (v2: was MERGED) |
| getScribeMessages | GET /scribe-session-reviews/:id/messages | same | ScribeReviewDetailsScreen | `ReviewApi.getMessages` (scribe `_base`, `review_api.dart:38`) | PRESENT (v2: was MERGED) |
| addReviewComment | POST /scenario-session-reviews/:id/comments | `{threadId?, parentCommentId?, messageId?, selection?, content}` | ReviewApiContext, SimulationReviewDetailsScreen | `ReviewApi.addComment` (`review_api.dart:120-136`) with `threadId, parentCommentId, messageId, selection, content`; badges invalidated | PRESENT (v2: was MERGED) |
| addScribeReviewComment | POST /scribe-session-reviews/:id/comments | same | ReviewApiContext, ScribeReviewDetailsScreen | `ReviewApi.addComment` (scribe base) | PRESENT (v2: was MERGED) |
| getThreadComments | GET /scenario-session-reviews/threads/:threadId/comments | `{offset, limit}` | ReviewApiContext | `ReviewApi.getThreadComments` (`review_api.dart:99-102`) | PRESENT (v2: was MERGED) |
| getScribeThreadComments | GET /scribe-session-reviews/threads/:threadId/comments | same | ReviewApiContext | `ReviewApi.getThreadComments` (scribe base) | PRESENT (v2: was MERGED) |
| getGeneralReviewComments | GET /scenario-session-reviews/:id/comments | `{offset, limit}` (paginated) | ReviewApiContext | `ReviewApi.getGeneralComments` (`review_api.dart:71-74`, paginated) | PRESENT (v2: was MERGED) |
| getScribeGeneralReviewComments | GET /scribe-session-reviews/:id/comments | same | ReviewApiContext | `ReviewApi.getGeneralComments` (scribe base) | PRESENT (v2: was MERGED) |
| getGeneralCommentsOverview | GET /scenario-session-reviews/:id/comments-overview | `{offset:0, limit:2, sortOrder:'DESC', sortBy:'createdAt'}` | ReviewList, ReviewCard (comment preview on list cards) | `ReviewApi.getCommentsOverview` (`review_api.dart:61-64`, identical params) | PRESENT (v2: was MERGED) |
| getScribeGeneralCommentsOverview | GET /scribe-session-reviews/:id/comments-overview | same | ReviewList | `ReviewApi.getCommentsOverview` (scribe base) | PRESENT (v2: was MERGED) |
| updateCommentVisibility | PATCH /scenario-session-reviews/comments/:id/visibility | `{hidden}` | ReviewApiContext | `updateCommentVisibility` | PRESENT |
| updateScribeCommentVisibility | PATCH /scribe-session-reviews/comments/:id/visibility | `{hidden}` | ReviewApiContext | scribe `updateCommentVisibility` | PRESENT |
| updateComment | PATCH /scenario-session-reviews/comments/:id | `{content}` | ReviewApiContext | `updateComment` | PRESENT |
| updateScribeComment | PATCH /scribe-session-reviews/comments/:id | `{content}` | ReviewApiContext | scribe `updateComment` | PRESENT |
| deleteComment | DELETE /scenario-session-reviews/comments/:id | none | ReviewApiContext | `deleteComment` | PRESENT |
| deleteScribeComment | DELETE /scribe-session-reviews/comments/:id | none | ReviewApiContext | scribe `deleteComment` | PRESENT |
| getThreads | GET /scenario-session-reviews/:id/threads | `{offset, limit, includeMessage:true}` | ReviewApiContext, SimulationFeedbackScreen, useHideReviewDetails | `ReviewsRepository.getThreads` | PRESENT |
| getScribeThreads | GET /scribe-session-reviews/:id/threads | same | ReviewApiContext, CallSummaryScreen | `ScribeReviewsRepository.getThreads` (`call_summary_screen.dart:271`) | PRESENT |
| getCommentReplies | GET /scenario-session-reviews/comments/:id/replies | `{offset, limit}` | ReviewApiContext | `getCommentReplies` (`thread_detail_screen.dart:117`) | PRESENT |
| getScribeCommentReplies | GET /scribe-session-reviews/comments/:id/replies | same | ReviewApiContext | scribe `getCommentReplies` | PRESENT |
| getReactions | GET /scenario-session-reviews/:id/reactions | `{reaction?, offset, limit}` | ReviewApiContext | `ReactionsRepository.getReactions` (`reactions_screen.dart`) | PRESENT |
| getScribeReactions | GET /scribe-session-reviews/:id/reactions | same | ReviewApiContext | `ScribeReactionsRepository.getReactions` | PRESENT |
| getReactionsCount | GET /scenario-session-reviews/:id/reactions/count | none | ReviewApiContext, SimulationFeedbackScreen, useHideReviewDetails | `getReactionsCount` | PRESENT |
| getScribeReactionsCount | GET /scribe-session-reviews/:id/reactions/count | none | ReviewApiContext, CallSummaryScreen | scribe `getReactionsCount` | PRESENT |
| addReactionToComment | POST /scenario-session-reviews/comments/:id/reactions | `{reaction, action: ADD\|REMOVE\|UPDATE}` | ReviewApiContext | `addReactionToComment` (`thread_detail_screen.dart:167`) | PRESENT |
| addScribeReactionToComment | POST /scribe-session-reviews/comments/:id/reactions | same | ReviewApiContext | scribe `addReactionToComment` | PRESENT |
| addReactionToReview | POST /scenario-session-reviews/:id/reactions | `{reaction, action}`; invalidates `Badges` | ReviewApiContext (react to the whole review) | `ReviewApi.addReactionToReview` (`review_api.dart:172`), called at `review_details_screen.dart:184`; invalidates `badgesProvider` (`review_api.dart:202`) | PRESENT (v2: was MERGED) |
| addScribeReactionToReview | POST /scribe-session-reviews/:id/reactions | same | ReviewApiContext | `ReviewApi.addReactionToReview` (scribe base) | PRESENT (v2: was MERGED) |

##### Dynamic translations CDN (raw)
| RN | Method + path | Shape | RN call site | Flutter | Status |
|---|---|---|---|---|---|
| (raw) i18n sync | GET `${I18N_BASE_URL}/manifest.json`, then GET `${base}/${currentVersion}/${lang}/${ns}.json` per namespace | no auth; cached per version+lang; refresh on start, AppState active, every MANIFEST_RECHECK_MS, `languageChanged` | localization/dynamic.ts | `LocalizationController._refresh` (`core/localization/localization_controller.dart:150-185`), bare Dio; language-change cache check `:163-170` | PRESENT. v3: was PARTIAL. v2 gap 42 CLOSED: `AppConfig.i18nBaseUrl` (`core/config/app_config.dart:62-66`) = dart-define if set, else prod flavor → `https://api.helloally.ai/i18n` (probed 2026-10-28: manifest 200, `currentVersion v150`, 5 langs); prod CI passes RN's `.env` via `--dart-define-from-file` (`.github/workflows/build-ios-production.yml:130`, `build-android-production.yml:139`). Non-prod flavor still falls back to retired `api.helloally.dev/i18n` (fails silently into cached/bundled strings; dev-only). |

---

#### 2. Transport layer

| Concern | RN (`services/api.ts` etc.) | Flutter (`core/network/*`) | Status |
|---|---|---|---|
| Base URL | `env.API_BASE_URL + '/api/'` + `v1`/`v2` per exact-match list | `AppConfig.requireApiBaseUrl + '/api'`; interceptor prefixes `/v1` or `/v2` with exact match (`auth_interceptor.dart:47`) | PRESENT |
| Auth header | `authorization: Bearer <ACCESS_TOKEN>` from AsyncStorage in `prepareHeaders` | Same header from `flutter_secure_storage` (`token_storage.dart`, same key names) | PRESENT. v3: storage differs (Keychain/Keystore vs AsyncStorage) but see the new carry-over row below. |
| **new v3:** RN session carry-over on app swap | n/a (RN is the incumbent; tokens in AsyncStorage `ACCESS_TOKEN`/`REFRESH_TOKEN`) | `core/migration/legacy_session_migration.dart:43-100` + `rn_async_storage.dart`: one-time copy of the token pair, UI language and leaderboard flag when this app has none; run in prod flavor only (`main.dart:60`, ece2b0a) | DEVICE-CHECK: needs an RN-store-build → Flutter-store-build upgrade on a real iOS and Android device (same bundle id) to prove the AsyncStorage read. |
| 401 refresh | On 401: no tokens means logout; else POST `/auth/refresh {refreshToken}` (through the same baseQuery, with the old bearer); store tokens; retry the original once; on failure, logout. No de-duplication. | Same contract; a bare `refreshDio` posts `/v1/auth/refresh`; concurrent 401s share one `_refreshFuture` (single-use refresh token race fixed); the retry goes via `refreshDio` (keeps `ResponseType.stream`) | PRESENT (Flutter is stricter: if the retried request 401s again it also logs out, where RN would just return the error) |
| Logout on refresh failure | `handleLogout()` + `api/resetApiState` + toast `auth.sessionExpired` | `AuthController.sessionExpired()`: clear tokens, auth false, toast `auth.sessionExpired`; `apiClientProvider` watches auth (cache reset) | PRESENT. v3: explicit logout deletes the device token at `core/auth/auth_state.dart:73`; session-expiry doesn't, same as RN. |
| Retry | None (RTK default) | Riverpod `appRetryPolicy`: provider reads only, max 3, 400ms doubling, skips 4xx/cancel; mutations not retried | Divergent by design (OK) |
| Timeouts | None on RTK fetch; Ask-AI XHR has no explicit timeout; socket `timeout:10000` | Dio `connectTimeout 20s`, `receiveTimeout 90s` (inter-chunk); socket `setTimeout(10000)` | Divergent: an LLM endpoint (enhance, retry-summary, generate-from-audio) that is silent for more than 90s fails in Flutter but would succeed in RN |
| Language headers / params | No `Accept-Language`; injects `languageCode` param/body for 18 allowlisted endpoints (`languageCodeEndpoints.ts`) | `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart`), same 18 endpoints | PRESENT (v2: was PARTIAL) |
| App-version header | None. App version is sent only in bug-report `context` and the `SCRIBE_START_DIAGNOSTIC` socket payload. | None; bug-report `context.appVersion` sent; `SCRIBE_START_DIAGNOSTIC` emitted with `appVersion` (`scribe_recording_screen.dart:179-198`) | PRESENT (v2: was PARTIAL) |
| Tenant header | None (tenant comes from the JWT) | None | PRESENT (parity) |
| 403 suspended | `isSuspendedUserError`: 403 && (`error==='USER_SUSPENDED'` or `message==='User suspended'`) checked only at OTP/Google/Apple sign-in, then `SuspendedAccount` screen. Not global. | `login_screen.dart:55-65` same predicate after all three sign-in methods, then `/suspended`; router allows `/suspended` while unauthenticated | PRESENT |
| Other 403 | CallSummaryScreen hides transcript tab on 403 | `call_summary_screen.dart:964` 403 branch; `course_detail_screen.dart:88` 403 | PRESENT |
| Error normalisation and toast | `getErrorDetails`: `data.message \|\| data.error \|\| t('common.somethingWentWrong')` used by screens with `showToast` | v3: shared port `core/network/error_details.dart:33-57` (`getErrorDetails`, `isBackendApiError`, `isSuspendedUserError`; NestJS `message[]` joined), 28 call sites; RN-style toast host (05d78c1/aedd4b1). Re-grep of every `AsyncValue.error` builder (21) and `$e`/`$error`/`toString()` interpolation: no raw exception text reaches UI (all use `getErrorDetails(...).message` or a translated key, e.g. `call_log_screen.dart:297`, `call_summary_screen.dart:1168-1170`, `profile_settings_screen.dart:299`, `app_shell_screen.dart:102-117`); remaining `$e` only in `debugPrint` | PRESENT. v3: was PARTIAL (v2 gap 40 CLOSED). |
| Network logger | `NetworkLogs` overlay in development | none | n/a (dev only) |

#### 3. Realtime: socket.io and LiveKit

| Item | RN | Flutter | Status |
|---|---|---|---|
| Client config | `io(API_BASE_URL + path, {path:'/socket.io', transports:['websocket','polling'], auth: cb with fresh token, reconnection 5 attempts 1-5s, timeout 10s, forceNew, autoConnect:false})` + retry timer after an open failure (`RETRY_AFTER_FAILURE_MS` 2000) | `core/realtime/socket_service.dart:27-142`: identical options; v3: `retryAfterFailure` 2000ms timer in `catch` (`:110-127`), cancelled by `disconnect()` via `_generation` (`:130-136`), same as RN `useSocket.ts:180-187`. Used by mic/conference (`socketServiceProvider` `:147`) and the telephony listener's own instance (`core/chat/cloud_telephony_listener.dart:73`) | PRESENT. v3: was PARTIAL (v2 gap 44 retry part CLOSED, 3cb9e36/5a37e28). |
| Microphone namespace (`MICROPHONE_SOCKET_PATH` = /microphone-chat) listeners | `SESSION_CREATED`, `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `MESSAGE_RECEIVED`, `UTTERANCE_ENDED` | `scribe_recording_screen.dart:176-185`: all six | PRESENT |
| Microphone emits | `AUDIO_MESSAGE {audioData: base64 chunk, chatId}`, `START_AUDIO_CHAT {isLinear16Encoded:true, platform:'MOBILE', sampleRate:16000, mode:'SCRIBE'}` | `scribe_recording_screen.dart:227,237`: same payloads | PRESENT |
| `SCRIBE_START_DIAGNOSTIC` emit | `{afterMs, appVersion, ...gates}` at 5s/15s when the recording has not started | Emitted at 5s/15s with the RN gate fields (`scribe_recording_screen.dart:170-198`) | PRESENT (v2: was MISSING) |
| Cloud-telephony namespace (`CLOUD_TELEPHONY_PATH`) on ConferenceListeningScreen | on: `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `AUDIO_STREAM`; emits `AUDIO_CHAT_PAUSED/RESUMED {chatId}` behind a button that is hidden (`showPauseResumeButton={false}`), so effectively dead | `conference_listening_screen.dart:130-138`: same four listeners; no pause emit (parity, since RN hides it) | PRESENT |
| **App-wide** cloud-telephony socket | `RootNavigator.tsx:170` keeps a socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` calls `checkCounselorChat()` | `core/chat/cloud_telephony_listener.dart:23-74` (drops on pause, reconnects on resume), started on sign-in `main.dart:128-133`, lifecycle `main.dart:105`, stopped on sign-out `main.dart:135` | PRESENT. v3: re-verified. |
| LiveKit token/room | Comes from the `startScenarioSession` response `accessToken.{token, serverUrl}` (no separate token endpoint; `/rooms` `listRooms` is DEAD) | `SessionData.fromJson` reads the same fields; `LiveKitRoomService.connect(url, token)` | PRESENT |
| LiveKit room events | `Connected`, `Disconnected` (navigate to feedback), `ParticipantConnected` (ringing until agent audio, grace timer), `ActiveSpeakersChanged`, `DataReceived`; `ParticipantEvent.IsSpeakingChanged` | `livekit_room_service.dart:105-118` adds `ParticipantConnectedEvent` + `RoomDisconnectedEvent`; `roleplay_voice_screen.dart:460` (agent joined) and `:508` (room closed → Feedback); `cap-ended` no-op like RN | PRESENT (v2: was PARTIAL) |
| LiveKit data publish | `localParticipant.publishData` (pause/resume control) | `LiveKitRoomService.publishData` | PRESENT |

#### 4. Cache invalidation (RN tags vs Flutter refresh after mutations)

| RN mutation, then what it invalidates | Flutter after the same action | Gap |
|---|---|---|
| endScenarioSession: `SimulationCredits`, `SimulationPaths`, `SimulationPathDetails`, `Cases`, `CaseDetails` | `simulations_repository.dart:200-215` invalidation callback: credits, paths, path details, cases, case details (8e6ad33) | PRESENT (v2) |
| Course mutations (enroll, startTrackItem, articleRead, quiz submit/regrade, branching, bucket place, journal submit, setTrackLanguage; conditional on articleQuestion/videoProgress completion): `LearnTracks`, `LearnTrackDetail` (also feeds progress), `LearnTrackNext` | `courses_repository.dart:285-292` invalidates `learnTracksProvider`, `trackDetailProvider`, `trackProgressProvider`; video/article-question only on completion | PRESENT (v2) |
| createPathSession: `SimulationPathDetails` + `SimulationPaths`; createCaseSession: `CaseDetails` + `Cases` | details + list providers invalidated (`simulations_repository.dart:207-213`) | PRESENT (v2) |
| addReviewComment / deleteComment / addReactionToReview: `Badges` (+ `ReviewDetails`, `ReviewMessages`, `GeneralComments`, `ReviewThreads`) | general-comment add invalidates `generalCommentsProvider` + `reviewDetailProvider`; thread replies refresh in `thread_detail_screen`; `ReviewApi` `onBadgesChanged` invalidates `badgesProvider` (`review_api.dart:202`) | PRESENT (v2) |
| markBadgeAsViewed: badge lists | `badge_popup.dart:168-170` marks viewed then invalidates `badgesProvider` | PRESENT (v2) |
| updateProfileImage / deleteProfileImage / completeProfile: refetch `User` | `ref.invalidate(currentUserProvider)` | PRESENT |
| discussion mutations: `CourseDiscussion` | `ref.invalidate(discussionProvider(itemId))` | PRESENT |
| markNotificationRead / markAll: `Notifications` + `UnreadNotificationCount` | `ref.invalidate(notificationsControllerProvider)` (the unread-count endpoint is unused in both apps) | PRESENT |
| markSimulation/ScribeReviewAsRead: (no tags in RN either) | v3: Flutter invalidates `unreadReviewCountProvider` after mark-read (`review_details_screen.dart:93`, `review_screen.dart:277`) | PRESENT (Flutter refreshes the dot; RN leaves it stale) |
| Polling / refetchOnFocus / refetchOnReconnect: `getBadges` every 60s + focus/reconnect; review details refetchOnFocus/Reconnect | `getBadges`: 60s poll + resume + back-online refetch (`badge_popup.dart:89,106,193`); review details resume/back-online/after-edit (`review_details_screen.dart:108-113,309-311,318-320`); lists refetch on focus (`core/navigation/screen_focus_listener.dart`); offline signal `core/realtime/connectivity.dart:13` (connectivity_plus) | PRESENT. v3: was PARTIAL (v2 gap 44 reconnect part + gap 38 CLOSED). Note: RN `setupListeners` relies on `window` focus/online events, so these RTK flags are largely inert on RN; Flutter is at least as fresh. |

#### 5. DEAD RTK endpoints (defined in RN, never called)

Direct, with zero hook or initiate references outside tests:
`badgesApi.getBadgeCount` (GET /badges/me/count) · `callSummaryApi.getTags` (POST /chats/summary/tag-positivity-ratings) · `coursesApi.getTrackLanguages` (GET /learn/tracks/:id/languages) · `discussionApi.getDiscussionModeratorTenants` (GET /learn/track-items/:id/discussion/tenants) · `generalCommentsApi.getGeneralComments`, `addGeneralComment`, `deleteGeneralComment`, `updateGeneralComment`, `updateGeneralCommentVisibility` (/scenario-session-reviews/:id/general-comments, /general-comments/:id[/visibility]) · `scribeGeneralCommentsApi.getScribeGeneralComments`, `addScribeGeneralComment`, `deleteScribeGeneralComment`, `updateScribeGeneralComment`, `updateScribeGeneralCommentVisibility` · `notificationsApi.getUnreadNotificationCount` (GET /notifications/unread-count; Flutter also defines `unreadCount()` and never calls it) · `reviewsApi.getReview` · `searchApi.getCategories` (GET /reference-document/categories) · `simulationSummaryApi.getSimulationSkills` (GET /learn/scenario-session/:id/skills) · `simulationSummaryApi.getChatHistory` (the live path is the raw fetch in chatSessionManager) · `simulationsApi.listRooms` (GET /rooms) · `userApi.updateUserPreferences` (POST /users/preferences).

Transitive, reachable only from the unused hooks `useLanguageDropdown` / `useSimulationTransition`:
`simulationsApi.getAvailableLanguages` (GET /learn/scenario-languages?active&hasVoices) · `userApi.getUserPreferences` (GET /users/me/preferences) · `simulationsApi.getUpcomingScenario` (GET /learn/scenario-paths/:id/upcoming-scenario) · `simulationsApi.getUpcomingCaseScenario` (GET /learn/cases/:id/upcoming-scenario).

**Flutter-only calls to RN-dead endpoints:** v3: **none.** `features/preferences/` and the `/preferences` route were removed in 9b76a8a; the endpoint diff no longer finds `/users/me/preferences`, `/users/preferences` or `/learn/scenario-languages` in Flutter `lib/` (v2 item 49, route half, CLOSED).

**v2:** Flutter now also ports (but never calls from UI) two RN-dead endpoints for API parity: `CoursesRepository.getTrackLanguages` (`courses_repository.dart:77-80`) and `DiscussionRepository.getModeratorTenants` (`discussion_repository.dart:30`). DEAD count unchanged. v3: still defined-but-uncalled in Flutter (no UI caller): `CoursesRepository.getTrackLanguages` (`courses_repository.dart:78`), `DiscussionRepository.getModeratorTenants` (`discussion_repository.dart:30`), `NotificationsRepository.unreadCount` (`notifications_repository.dart:34`), plus `CallLogRepository.getCallLogItem` (`call_log_repository.dart:617`, same GET as getCallSummary). Harmless; cleanup candidates.

---

## §7 Translation keys

Method (`scratchpad/scripts/i18n.py`; raw output in `inventory/i18n.json`):
- RN keys are collected from `t('…')`, `i18n.t`, `i18nKey=`, `*Key:` props, and from any string literal in non-test `src/**/*.ts(x)` that exactly matches an RN `en.json` key (this catches constant maps).
- Both locale trees are flattened to dotted keys.
- Flutter locales live in `assets/locales/{en,hi,kn,mr,ta}.json`.

Counts:

| Set | en | hi | kn | mr | ta |
|---|---|---|---|---|---|
| RN keys | 1461 | 1461 | 1461 | 1461 | 1461 |
| Flutter keys (v1) | 1566 | 1458 | 1458 | 1458 | 1458 |
| Flutter keys (v2, 227db3a) | 1566 | 1566 | 1566 | 1566 | 1566 |
| RN keys (v3, 7a8ce0c19) | 1461 | 1461 | 1461 | 1461 | 1461 |
| Flutter keys (v3, f770200) | 1567 | 1567 | 1567 | 1567 | 1567 |

- RN static keys referenced from code: **848**. All 848 exist in Flutter `en.json`, so **0 are missing**.
- Dynamic key templates in RN: **13 families**. All expansions exist in Flutter `en.json` because it is a superset of RN `en.json`.
- RN `en.json` keys absent from Flutter `en.json`: **1** (`auth.login.otp.expires`, replaced by `_one`/`_other` plural keys).
- English value drift: 0. hi/kn/mr/ta value drift on shared keys: 0.
- Flutter-only keys: **106**. In hi/kn/mr/ta, Flutter is missing **108** of its own en keys (106 Flutter-only plus the 2 plural keys).
- Flutter `t()` references not present in `en.json`: **0** (509 distinct literal refs checked).
- **v3 (f770200, `v3/scripts/i18n_v3.py`):** RN static keys used in code: 848 (incl. the 5 new 7a8ce0c19 `courses.roleplay.assessment*` keys); missing in Flutter en/hi/kn/mr/ta: **0/0/0/0/0**. RN locale keys absent from Flutter per locale: 1 each (`auth.login.otp.expires` → `_one/_other`). RN↔Flutter value drift on shared keys: **0 in all 5 locales**. Flutter hi/kn/mr/ta vs Flutter en: 0 missing, 0 extra; identical-to-en values 7/5/5/5 (brand/proper nouns + URL + `drawer.dev`). Flutter `t()/tr()` literal refs: 570, all resolve in all 5 locales. 13 RN dynamic key families: every expansion present in all 5 Flutter locales. Flutter-only keys: 107 (+1 `home.noAccessibleTabs`).
- **v2 (227db3a):** hi/kn/mr/ta now have every en key (0 missing, 0 extra; 59825bd added a completeness test). RN hi/kn/mr/ta value drift on shared keys: still 0. 569 distinct `t()/tr()` literal refs, all resolve (plural `_one/_other` handled by 53959d0, English fallback per key). Untranslated (identical-to-en) values: 5–7 per language, all brand/proper nouns.

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | Static keys referenced from RN code exist in Flutter en | 848 keys | `assets/locales/en.json` | PRESENT | 0 missing. |
| 2 | Dynamic key families | `months.${variant}` (utils/date.ts); `postSim.debrief.section.${key}` (SupervisorNote); `callSummary.archiveActionModal.${key}.{header.title,header.subtitle,description,confirm,cancel}` (ArchiveActionModal); `courses.progressDashboard.classification.${c}` (SkillCategoryRow); `courses.language.fallback.${reason}` (CourseItemRow); `courses.branching.outcome.${outcome}` (BranchingScenarioPlayer); `simulations.${tabLabel}` (SimulationsScreen); `postSim.feedback.dialog.rating.tags.${rating}` (FeedbackPopup) | all subtrees present in en.json | PRESENT | Whether each Flutter widget actually builds these keys is covered per screen in §2. |
| 3 | OTP expiry string | `auth.login.otp.expires` (one key, translated in all 5 languages) | `auth.login.otp.expires_one/_other` in all 5 locales (`login_screen.dart:850`) | PRESENT (v2: was PARTIAL) | |
| 4 | RN-translated keys dropped from Flutter hi/kn/mr/ta | RN hi/kn/mr/ta have `courses.breathing.{title,defaultIntro,start,cycleProgress}` | present in all 5 Flutter locales, values equal RN | PRESENT (v2: was PARTIAL) | |
| 5 | Flutter-only keys **referenced in code** with no hi/kn/mr/ta translation (33) | — | all 33 now in hi/kn/mr/ta (`assets/locales/*.json`) | PRESENT (v2: was MISSING) | The table below is kept for history. |
| 6 | Flutter-only keys not referenced in code (75) | — | `home.*` (17, the Phase-0 dev shell), `scribe.*` and `conferenceListening.*` debug labels, older `review.*`/`callSummary.*`/`simulations.*`/`postSim.feedback.*` drafts | N/A | Cleanup candidates, no user impact. |
| 7 | All five languages present for RN keys | 5 × 1461 | 5 files, RN keys complete except rows 3 and 4 | PRESENT | |
| 8 | Dynamic CDN translation sync (`localization/dynamic.ts`, gated by `LANGUAGE_SELECTOR_FLAG`) | `I18N_BASE_URL` manifest + namespaces | `core/localization/localization_controller.dart:150-185`; base URL `core/config/app_config.dart:62-66` | PRESENT | v3: was PARTIAL. Prod flavor default `https://api.helloally.ai/i18n` (live, manifest v150) and prod CI passes RN's `.env` (v2 gap 42 CLOSED). See §5 CDN row. |
| 9 | Hardcoded English UI literals in Flutter outside `t()` | RN also hardcodes some (`SUMMARY_STATUS_CONFIG`, summary field labels, `fieldFilters.ts` options, `TRANSCRIPT_LANGUAGE_OPTIONS`) | v3 grep (82 hits, `v3/scripts/literals.txt`): all mirror RN literals — `call_summary_fields.dart:102-525`, `status_badge.dart:36-43`, `call_log_filter_sheet.dart:14-23` (= RN `CallLog/utils/fieldFilters.ts:46-82`), `custom_fields_filter.dart:39`, `simulation_transcript_tab.dart:515` (= RN `constants/general.ts:58`), `call_summary_screen.dart:2002` 'Select', emoji-keyboard 'Search' (rn-emoji-keyboard default), 'Ally' app titles. The v2 Flutter-only literals are fixed: `app_shell_screen.dart:147` → `home.noAccessibleTabs`; `call_log_screen.dart:527,605` → `accessibility.filter/refresh` | PRESENT | v3: was PARTIAL. |
| 10 | **new v3:** RN 7a8ce0c19 assessment-mode keys `courses.roleplay.{assessmentIntro,assessmentNotice,assessmentSubmitted,assessmentNotPassed,assessmentLocked}` | RN en/hi/kn/mr/ta + `RoleplayCasePlayer.tsx` | all 5 Flutter locales (en.json:857-861), values equal RN in every locale; used at `courses/presentation/roleplay/roleplay_case_player.dart:131,142,165-166,173` | PRESENT | |
| 11 | **new v3:** RN-live accessibility-label keys never rendered by Flutter | `courses.branching.recapLabel` (`BranchingScenarioPlayer.tsx:285`), `courses.branching.trailLabel` (`:386`), `courses.bucketSort.bucketA11y` (`BucketSortPlayer.tsx:178`) | keys exist in all locales but no `Semantics` label in `courses/presentation/branching/branching_scenario_player.dart` or `bucket_sort/bucket_sort_player.dart` | PARTIAL | Screen-reader only; no visible-text impact. |
| 12 | **new v3:** RN-referenced keys with no literal ref in Flutter `lib/` (69) | `v3/scripts/i18n_v3.json` `rn_used_not_lit_ref_in_flutter` | Classified: built from a prefix/template in Flutter (TermsAndAgreement ×15 `terms_and_agreement_modal.dart:387`; `callFeedback.ratings.$n` `feedback_popup.dart:87`; `*.deleteConfirmation.*` `review_comment_sheets.dart:180-186`; `summary.duration.$name` `summary_display_format.dart:17`); RN-dead or unreachable in RN (AskAI/AskAiInitialState, SessionGlimpse, KeyConcernSection, NotesSection, SummaryDropdown, PrivacyToggle, SecurityCarousel, `REVIEW_FILTERS`, `onUpdateSummary` toast, VoiceNotePanel fallback, conference end-call copy behind `showEndSessionButton={false}`, `fileOperations`/`invalidResponseFormat` thrown-not-shown); hidden in RN layout (`search.headerDescription`, documented `search_screen.dart:475-483`); gated empty states (`simulationPage.noRemindersYet` tab only shown with reminders `session_info_tabs.dart:34`; `calls.filters.noFields`, built-ins always present); a11y labels → row 11 | N/A | Informational; only row 11 is a code gap. |

§7 tally v3: 12 rows — PRESENT 9, PARTIAL 1 (row 11), MISSING 0, BLOCKED-EXTERNAL 0, DEVICE-CHECK 0, N/A 2 (rows 6, 12). (v2: 9 rows — 6/2/0/1.)

The 33 referenced but untranslated Flutter keys as of v1 (all translated in v2), grouped by feature:

| Feature | Keys |
|---|---|
| Auth | `auth.login.apple.button`, `auth.login.apple.error` |
| Courses / video | `courses.video.loadFailed`, `courses.video.interjection.submitError` |
| Courses / quiz | `courses.quiz.question.{answerAllError,submitError,minWordsHint,unsupportedType,resultBanner}`, `courses.quiz.results.{attemptsUsedNoMax,scoreSummary}` |
| Courses / breathing | `courses.breathing.{title,defaultIntro,start,cycleProgress}` (RN has translations; see row 4) |
| Preferences | `preferences.title`, `preferences.defaultLanguage` |
| Reviews | `review.error.loadReviewFailed`, `review.error.loadReactionsFailed` |
| Simulations / session | `simulations.viewFeedback`, `errors.loadSession` |
| Notifications | `notifications.{title,markAllRead,empty,loadError}` |
| Role-play voice | `roleplayVoice.connect`, `roleplayVoice.disconnect` |
| Scribe | `scribe.title`, `scribe.notificationTitle`, `scribe.notificationText` (Android foreground-service notification) |
| Conference listening | `conferenceListening.title`, `conferenceListening.waitingForClient`, `conferenceListening.callEnded` |

Note: RN `notifications.*` titles come from other RN keys. Before translating, check whether the Flutter screen should reuse the RN key instead of a Flutter-only one.

---



## §8 Assets

v3: re-audited 2026-10-28 against Flutter `f770200` (RN unchanged at `7a8ce0c19`). Script: `v3/scripts/assets3.py` → `assets3.out` (exact-boundary match `[/'"]<file>['"]` over `lib/**/*.dart`).

Method (unchanged from v2):
- RN: an asset counts as used when a non-test RN `src` file imports its export name **and that file is rendered** (v2 render-path trace).
- Flutter: referenced when `lib/**/*.dart` contains the file name with an exact boundary. Literal paths only (no interpolated `assets/...$x`).
- Status is per **file**; per-site parity is in **8b**.

Overview:
- v3: Flutter ships **135 RN-rendered asset files**, every one referenced in `lib/`, plus all 7 fonts (`pubspec.yaml:230+`, 7 `asset: assets/fonts/` entries). The 19 v2 PARTIAL files are now all referenced (calls-summary section icons `call_summary_screen.dart:94-111`, drawn `:1473`; `goldenShield.svg` `:1252`; `play.svg` `voice_note_section.dart:441`).
- v3: the 26 RN-dead files were **deleted** in `81622e1` (with `core/widgets/app_chat_input.dart`, `core/widgets/emoji_insert_picker.dart`). No file in `lib/`, `test/` or `pubspec.yaml` references any of them (grep empty). `pubspec.yaml` declares `assets/icons/`, `images/`, `animations/` as directories, so no stale entries.
- Flutter-only asset dirs (no RN file to compare): `assets/locales/*.json` (RN locale JSON, §7), `assets/games/*.html` (RN `*Html.ts` game bundles), `assets/emoji_keyboard/` (rn-emoji-keyboard data/icons, §10e r80), `assets/icon/icon.png` (launcher-icon source).

| Bucket | Count | Status |
|---|---|---|
| RN-rendered and Flutter-referenced | 135 files + 7 fonts = 142 | PRESENT [v2: 123] |
| RN-rendered, shipped but never referenced | 0 | — [v2: 19 PARTIAL] |
| RN-rendered and not shipped | 0 | — [v2: 0] |
| RN-dead, deleted from Flutter in `81622e1` | 26 | N/A [v2: 26 N/A, shipped] |
| **Total** | **168** | |

### Status changes since v2 (19)

**PARTIAL → PRESENT (19)**
- 17 call-summary section icons (`callDetails`, `sessionSummary`, `flow`, `keyConcern`, `tableEye`, `magnifyEye`, `assessment`, `smile`, `brightnessAlert`, `prescriptions`, `handShare`, `newsStand`, `headsetMic`, `tag`, `database`, `intake`, `ongoingRisks`): `call_summary_screen.dart:94-110` (`_sectionIcons`), rendered `:1473`.
- `icons/goldenShield.svg`: `call_summary_screen.dart:1252`.
- `icons/play.svg`: `voice_note_section.dart:441`.

### N/A (26). RN-dead; v3: deleted from Flutter (`81622e1`), no references remain

`icons/{infoBlack,bars,callEnd,callHighlights,demogs,forward10,headphone,keyEvents,lightBulb,profileIcon,replay10,rightArrow,thumbUp,call,transcript,simulation,arrowUpRight}.svg`, `images/{listenLive,joinCall,carousel1..4,conversation}.png`, `animations/{listen,botThinking}.json`. Rows kept as N/A for the count only; no action.

### PRESENT spot-check (27 files + fonts, no regressions)

`google.svg` `auth/presentation/login_screen.dart:1114`; `splashAnimation.json` `core/routing/launch_splash.dart:14`; `rank1.svg` `leaderboard/presentation/leaderboard_screen.dart:38`; `badgeIcon.svg` `leaderboard_screen.dart:459`; `breathingBackground.png` `boxbreathing/presentation/box_breathing_screen.dart:220`; `breath.mp3` `breath_sound_player.dart:51`; `start/endSimulation.mp3` `roleplay/presentation/simulation_sound_player.dart:11-12`; `logOut.png` `core/navigation/app_drawer.dart:181`; `suspendedAccount.svg` `suspended_account_screen.dart:34`; `emptyReviews.svg` `review_screen.dart:97`; `noCallRecords.svg` `call_log_screen.dart:797`; `summaryGenerated.png` `summary_generation_progress.dart:178`; `summaryFailed.png` `:153` + `call_summary_screen.dart:2300`; `summaryLoading.json` `summary_generation_progress.dart:185`; `shieldWithTick.svg` `:245`; `page.svg` `:366`; `edit/export/contract/unarchive.svg` `call_summary_screen.dart:464/471/477/483`; `thumb.svg` `nudge_section.dart:170`; `networkDisconnected.svg` `network_disconnected.dart:96`; `endSession.svg` `scribe_recording_screen.dart:611`, `roleplay_voice_screen.dart:949`; `forceUpdateAlert.svg` `force_update_modal.dart:98`; `goldenShield.svg`, `play.svg` (above); 7 fonts in `pubspec.yaml`.

---

### 8b Icon/asset visual sweep

v3: `lib/` now contains **zero** `Icons.*` / `CupertinoIcons` uses (`grep -rn "Icons\." lib` empty; `cupertino_icons` dropped in `e786616`). Every v2 row was re-read at its Flutter site; all 33 now draw RN's asset.

**Totals: 33 rows, 33 PRESENT** [v2: 33 gap rows — 31 Material substitutes, 2 nothing rendered].

| # | Screen / component | RN asset (RN file that renders it) | v3 Flutter file:line | Status |
|---|---|---|---|---|
| 1 | Call summary, section header: Features & demographics | `callDetails.svg` (`constants/summary.ts:333`) | `call_summary_screen.dart:94`, drawn `:1473` | PRESENT (v3) |
| 2 | … Session summary | `sessionSummary.svg` | `call_summary_screen.dart:95` | PRESENT (v3) |
| 3 | … Flow | `flow.svg` | `:96` | PRESENT (v3) |
| 4 | … Key concern | `keyConcern.svg` | `:97` | PRESENT (v3) |
| 5 | … Objective observations | `tableEye.svg` | `:98` | PRESENT (v3) |
| 6 | … Subjective observations | `magnifyEye.svg` | `:99` | PRESENT (v3) |
| 7 | … Assessment | `assessment.svg` | `:100` | PRESENT (v3) |
| 8 | … Dominant feelings | `smile.svg` | `:101` | PRESENT (v3) |
| 9 | … Issues worked on | `brightnessAlert.svg` | `:102` | PRESENT (v3) |
| 10 | … Key therapeutic techniques | `prescriptions.svg` | `:103` | PRESENT (v3) |
| 11 | … Referrals provided | `handShare.svg` | `:104` | PRESENT (v3) |
| 12 | … Homework recommended | `newsStand.svg` | `:105` | PRESENT (v3) |
| 13 | … Plan for next call | `headsetMic.svg` | `:106` | PRESENT (v3) |
| 14 | … Tags | `tag.svg` | `:107` | PRESENT (v3) |
| 15 | … Metrics | `database.svg` | `:108` | PRESENT (v3) |
| 16 | … Intake | `intake.svg` | `:109` | PRESENT (v3) |
| 17 | … Ongoing risks | `ongoingRisks.svg` | `:110` | PRESENT (v3) |
| 18 | … Additional notes | `notes.svg` | `:111` | PRESENT (v3) |
| 19 | Call summary, section caret | `arrowDown.svg`/`arrowRight.svg` 10×10 (`SectionHeader.tsx:90,92`) | `call_summary_screen.dart:1463` (10×10) | PRESENT (v3) |
| 20 | Call summary, privacy banner | `goldenShield.svg` | `call_summary_screen.dart:1252` | PRESENT (v3) |
| 21 | Call summary, unauthorized state | `images/summaryFailed.png` (`SummaryUnauthorized.tsx:21`) | `call_summary_screen.dart:2300` | PRESENT (v3) |
| 22 | Call summary, "view review" button | `chatBubble.svg` (`CallSummaryScreen.tsx:531`) | `call_summary_screen.dart:651` | PRESENT (v3) |
| 23 | Voice-note "Record" CTA | `mic.svg` (`VoiceNoteSection.tsx`) | `voice_note_section.dart:282` | PRESENT (v3) |
| 24 | Voice-note panel, pause | `pause.svg` (`VoiceNotePanel.tsx:107`) | `voice_note_section.dart:434` | PRESENT (v3) |
| 25 | Voice-note panel, resume | `play.svg` (`VoiceNotePanel.tsx:117`) | `voice_note_section.dart:441` | PRESENT (v3) |
| 26 | Voice-note panel, recording mic | `mic.svg` (`VoiceNotePanel.tsx:141`) | `voice_note_section.dart:471` | PRESENT (v3) |
| 27 | Voice-note panel, discard | `delete.svg` (`VoiceNotePanel.tsx:156`) | `voice_note_section.dart:481` | PRESENT (v3) |
| 28 | Bug report, back button | `leftArrowIcon.svg` (`BugReportScreen.tsx:83`) | `bug_report_screen.dart:109` (`BackTitleHeader` → `core/widgets/back_title_header.dart:71`) | PRESENT (v3) |
| 29 | Tab screen header info tooltip | `info.svg` (`TabScreenHeader.tsx:86`) | `core/widgets/info_tooltip_icon.dart:27`, used `tab_screen_header.dart:114` | PRESENT (v3) |
| 30 | Achievements tooltips | `info.svg` (`AchievementsScreen.tsx:131,217`) | `info_tooltip_icon.dart:27`, used `achievements_screen.dart:110,238` | PRESENT (v3) |
| 31 | Search tab ResourceArticleCard expand | `downArrow.svg` (`ResourceArticleCard.tsx`) | `features/search/presentation/resource_article_card.dart:156`, used `search_screen.dart:339` | PRESENT (v3) |
| 32 | Course progress role-play row chevron | `chevronRight.svg` (`RoleplaySessionRow.tsx:53`) | `courses/presentation/course_progress_body.dart:568` | PRESENT (v3) |
| 33 | Simulation feedback summary "help" → SimulationDetailsModal | `help.svg` (`SimulationSummary.tsx:76`) | `simulations/presentation/widgets/feedback/feedback_widgets.dart:363` (opens `simulation_info_modal.dart`) | PRESENT (v3) |

v3 discovery: re-ran (RN rendered file → asset) vs Flutter references for all 135 files. Where RN uses an asset in more files than Flutter, the Flutter sites are shared widgets (e.g. `dataUnavailable.svg` via `LearningPathLoadError`, `learning_path_widgets.dart:59`, used by course overview/progress/case/path screens; `noCredits.svg` via shared `start_simulation_modals.dart:340`; `leftArrowIcon.svg` via `BackTitleHeader`/`TabScreenHeader`). Remaining RN-only importers are RN-dead (`NetworkLogs`, `SummaryDropdown`, `FeedbackDropdown`, `AskAI`). No new site gaps.

Flutter-only Material glyphs: v3 none (v2's `Icons.circle`/`Icons.stop` in `voice_note_section.dart` and `app_chat_input.dart` are gone).

## §9 Config / env / flags

RN: `react-native-config` reads `env/.env*` via `src/config/env.ts`. Flutter: `--dart-define(-from-file)` (CI writes RN's `ENV_VALUES_*` to `.env`, `.github/workflows/build-*-production.yml`) read by `lib/core/config/app_config.dart`; flavor via `appFlavor` (`dev`|`prod`).

**v3 tally: 17 rows — PRESENT 12, PARTIAL 0, MISSING 0, BLOCKED-EXTERNAL 4, DEVICE-CHECK 0, N/A 1** [v2: 15 rows — PRESENT 7, PARTIAL 5, MISSING 2, N/A 1].

| # | RN var (required?) | RN consumers | Flutter equivalent & default | Status | Notes |
|---|---|---|---|---|---|
| 1 | `ENVIRONMENT` (req.) | NetworkLogs gate, logger, drawer "(Dev)" | `AppConfig.environment` (`app_config.dart:112-115`; `development` in debug/dev flavor) | PRESENT | |
| 2 | `API_BASE_URL` (req.) | `services/api.ts` | `AppConfig.apiBaseUrl` (`requireApiBaseUrl` throws) | PRESENT | |
| 3 | `API_VERSION` (req.) | unused | hardcoded v1/v2 | N/A | Dead in RN. |
| 4 | `ALLY_WEB_URL` (req.) | deep-link allowlist, CallLog "Learn more", SimulationDetails copy-link | `AppConfig.allyWebUrl` (`app_config.dart:32-35`) | PRESENT | v3: allowlist `core/deeplink/deep_link.dart:58-59` (RN `deeplink.ts:7,17-23`); Learn more `call_log_screen.dart:249-253`; copy-link `simulation_details_screen.dart:65`. [v2 PARTIAL] |
| 5 | `MICROPHONE_SOCKET_PATH` (req.) | `useSocket.ts` | default `/microphone-chat` | PRESENT | |
| 6 | `CLOUD_TELEPHONY_PATH` (req.) | telephony socket | default `/cloud-telephony-chat` | PRESENT | App-wide socket parity is §4b. |
| 7 | `GOOGLE_WEB_CLIENT_ID` (req.) | `useGoogleLogin` `webClientId` | `AppConfig.googleWebClientId` → `serverClientId` (`login_screen.dart:164-169`) | BLOCKED-EXTERNAL | v3 (normalised): same value as RN via `ENV_VALUES_*`; prod flavor has RN's package id + signing key, so RN's OAuth clients apply. Needs on-device sign-in proof (and the env secret, §9 r16). [v2 PARTIAL] |
| 8 | `GOOGLE_IOS_CLIENT_ID` (req.) | `useGoogleLogin` `iosClientId` | `AppConfig.googleIosClientId` → `clientId` (`login_screen.dart:166-167`); Info.plist `GIDClientID` (`ios/Runner/Info.plist:41-42`) from `ios/Flutter/prod.xcconfig` (RN's value) | BLOCKED-EXTERNAL | v3 (normalised): config complete in repo; Dart-side `GOOGLE_IOS_CLIENT_ID` comes from the `ENV_VALUES_*` secret (§9 r16), then device check. [v2 PARTIAL] |
| 9 | `NOTIFICATION_SCHEDULE_DAY` (1) | weekly reminder | `leaderboard_notification.dart` default 1 | PRESENT | |
| 10 | `NOTIFICATION_SCHEDULE_HOUR` (11) | same | default 11 | PRESENT | |
| 11 | `NOTIFICATION_SCHEDULE_MINUTE` (0) | same | default 0 | PRESENT | |
| 12 | `LANGUAGE_SELECTOR_FLAG` | `i18n.ts` sync, ProfileSettings language row | `AppConfig.languageSelectorEnabled` (`app_config.dart:72-75`, default `true`); gates sync `localization_controller.dart:113,140` and row `profile_settings_screen.dart:318` | PRESENT | v3: row now gated (`28ff515`). Default `true` = RN prod value; `env/example.env` sets `false`. [v2 PARTIAL] |
| 13 | `I18N_BASE_URL` (default `''`) | `localization/dynamic.ts` | `app_config.dart:62-66`: define, else prod flavor `https://api.helloally.ai/i18n`, else `https://api.helloally.dev/i18n` | PRESENT | v3: prod flavor fixed. Residual (dev flavor only, low): fallback is the retired `.dev` host; sync fails silently to bundled JSON. [v2 PARTIAL] |
| 14 | Android `${appLinkHost}` (per flavor) | App Links filter | `android/app/build.gradle.kts:56` (`app.dev.helloally.ai`), `:62` (`app.helloally.ai`); used `AndroidManifest.xml:64-65` | PRESENT | v3 (`c536efa`). [v2 MISSING] |
| 15 | Per-env Firebase config | Firebase, FCM, Crashlytics | not in git by design; CI pulls from S3 (`build-android-production.yml:80`, `build-ios-production.yml:62`); conditional apply `build.gradle.kts:110-115`; iOS copy+bundle-id check `project.pbxproj:261-274` | BLOCKED-EXTERNAL | v3: code ready; needs `*_GOOGLE_SERVICES_S3_URI_*` secrets on the Flutter repo (`gh secret list -R HelloAllyTech/ally-mobile-flutter` is empty). [v2 MISSING] |
| 16 | (new) CI env + signing secrets (`ENV_VALUES_PRODUCTION/DEVELOP`, keystore, provisioning, App Store keys) | RN `HelloAllyTech/ally-mobile` repo secrets | workflows reference the same names | BLOCKED-EXTERNAL | v3 new: Flutter repo has no repo secrets; copy RN's 28. |
| 17 | (new) Build flavors dev/prod | RN `productFlavors` (`android/app/build.gradle:38-53`) | `pubspec.yaml` `default-flavor: dev`; `build.gradle.kts:50-64`; `ios/Flutter/{dev,prod}.xcconfig` | PRESENT | v3 new (`afdccc1`). Dev ids differ from RN's dev on purpose (§10 r98). |

Flutter-only flags: none. `NetworkLogs`/logger dev-only (N/A).

---

## §10 Native / platform

**v3 tally: 100 rows (83 + 17 new in 10f) — PRESENT 63, PARTIAL 5, MISSING 0, BLOCKED-EXTERNAL 7, DEVICE-CHECK 3, N/A 22** [v2: 83 rows — PRESENT 49, PARTIAL 8, MISSING 8, N/A 18].

### 10a iOS `Info.plist` (RN `ios/ally/Info.plist` vs Flutter `ios/Runner/Info.plist`)

| # | Key | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | `CFBundleDisplayName` / bundle id | `Ally` / `com.helloally.app` | `$(APP_DISPLAY_NAME)` (`Info.plist:10-11`); prod `Ally` / `com.helloally.app` (`ios/Flutter/prod.xcconfig`) | PRESENT | v3: release identity = RN's for prod flavor. [v2 PARTIAL] |
| 2 | `CFBundleURLTypes` (2 reversed client ids) + `GIDClientID` | present | `Info.plist:31-42`, values `prod.xcconfig` (= RN) | PRESENT | v3. [v2 MISSING] |
| 3 | `NSMicrophoneUsageDescription` | present | `Info.plist:69-70` | PRESENT | |
| 4 | `NSPhotoLibraryUsageDescription` | present | `Info.plist:71-72` | PRESENT | |
| 5 | `NSCameraUsageDescription` | present ("video communication") | absent | PARTIAL | v3: re-classified. App never uses the camera, but `livekit_client`/`flutter_webrtc` link AVCaptureDevice capture APIs, which is why RN kept the key; App Store upload can be rejected (ITMS-90683 missing purpose string). Add the key to `ios/Runner/Info.plist`. [v2 N/A] |
| 6 | `NSLocationWhenInUseUsageDescription` | empty string | absent | N/A | No location APIs. |
| 7 | `UIBackgroundModes` | `remote-notification` | `audio`, `remote-notification` (`Info.plist:62-68`) | PRESENT | |
| 8 | ATS `NSAllowsLocalNetworking` | true | absent | N/A | Dev-only. |
| 9 | `UIAppFonts` | 7 fonts | fonts via pubspec | PRESENT | |
| 10 | `UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`, `UISupportsDocumentBrowser` | true | `Info.plist:51-56` | PRESENT | |
| 11 | `ITSAppUsesNonExemptEncryption` false | present | `Info.plist:99-100` | PRESENT | |
| 12 | `UIRequiredDeviceCapabilities` arm64 | present | absent | N/A | |
| 13 | Orientation / device family | Portrait, iPhone-only | Portrait (`Info.plist:108-111`); `TARGETED_DEVICE_FAMILY = 1` all configs (`project.pbxproj:406,533,587`) | PRESENT | v3: iPad no longer targeted (`~ipad` list is now inert). [v2 PRESENT with iPad residual] |
| 14 | `UIViewControllerBasedStatusBarAppearance` false | present | absent | N/A | |
| 15 | `UIApplicationSceneManifest` | SceneDelegate | `FlutterSceneDelegate` (`Info.plist:73-93`) | PRESENT | |
| 16 | `PrivacyInfo.xcprivacy` | present | `ios/Runner/PrivacyInfo.xcprivacy` (in Resources, `project.pbxproj:251`) | PRESENT | v3: content identical to RN (plist JSON diff empty). |

### 10b iOS entitlements (RN `ios/ally/ally.entitlements`; v3: Flutter `ios/Runner/Runner.entitlements`, `CODE_SIGN_ENTITLEMENTS` on all 6 Runner configs, `project.pbxproj:417,598,620,641,…`)

| # | Entitlement | RN | Flutter | Status |
|---|---|---|---|---|
| 17 | `aps-environment` | development | `Runner.entitlements:8-9` | PRESENT: v3. [v2 MISSING] Push delivery: §10e r49. |
| 18 | `com.apple.developer.applesignin` | Default | `Runner.entitlements:10-13` | PRESENT: v3. [v2 MISSING] Device sign-in: §10e r43. |
| 19 | associated-domains `applinks:app.dev.helloally.ai`, `applinks:app.helloally.ai` | present | `Runner.entitlements:14-18` | PRESENT: v3. [v2 MISSING] Prod AASA lists `W3ZL4N9N9J.com.helloally.app` `/summary/*`, `/course/*` (fetched). |

### 10c iOS AppDelegate / SceneDelegate

| # | Behaviour | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 20 | Firebase configure at launch | `FirebaseApp.configure()` | `Firebase.initializeApp()` guarded (`lib/main.dart:44`) | BLOCKED-EXTERNAL | v3: only the config file is missing (§9 r15). [v2 PARTIAL] |
| 21 | Scene lifecycle | custom SceneDelegate | `FlutterSceneDelegate` (`ios/Runner/SceneDelegate.swift`) | PRESENT | |
| 22 | `GoogleService-Info.plist` / `google-services.json` | present (CI) | CI download + `project.pbxproj:261-274`, `build.gradle.kts:110-115` | BLOCKED-EXTERNAL | v3: wiring done; secrets absent. [v2 MISSING] |
| 23 | Cold-start URL / universal link | `urlContexts`, `NSUserActivityTypeBrowsingWeb` → RCTLinkingManager | `app_links` 7.2.2 (`FlutterSceneLifeCycleDelegate`, handles `willConnectTo`), `main.dart:64` → `core/deeplink/deep_link_binding.dart:43-47`; `FlutterDeepLinkingEnabled=false` (`Info.plist:46-47`) | DEVICE-CHECK | v3 (`c536efa`). Needs a device to prove links open the app. [v2 MISSING] |
| 24 | Warm deep links (`openURLContexts`, `continue userActivity`) | present | `app_links` scene `openURLContexts`/`continue` handlers → same stream | DEVICE-CHECK | v3. [v2 MISSING] |
| 25 | `UNUserNotificationCenter` delegate | RN Firebase / notifee | `AppDelegate.swift` | PRESENT | |
| 26 | `CommentableTextView` native module | Swift/ObjC + Kotlin | `features/reviews/presentation/review_conversation.dart` | PRESENT | |

### 10d Android (RN `android/app` vs Flutter `android/app`)

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 27 | applicationId / label | `com.helloally.app`, `Ally` (prod) | prod flavor `com.helloally.app`, `Ally` (`build.gradle.kts:58-62`); manifest `@string/app_name` (`AndroidManifest.xml:28`) | PRESENT | v3. [v2 PARTIAL] |
| 28 | `INTERNET` | ✓ | `AndroidManifest.xml:18` | PRESENT | |
| 29 | `RECORD_AUDIO` | ✓ | `:16` | PRESENT | |
| 30 | `MODIFY_AUDIO_SETTINGS` | ✓ | `:17` | PRESENT | |
| 31 | `POST_NOTIFICATIONS` | ✓ | `:19` | PRESENT | |
| 32 | `RECEIVE_BOOT_COMPLETED` | ✓ | `:21` + boot receiver `:90-97` | PRESENT | |
| 33 | `SCHEDULE_EXACT_ALARM` | ✓ | absent; inexact schedule (`leaderboard_notification.dart:126`) | PRESENT (by design) | |
| 34 | `WRITE_EXTERNAL_STORAGE` (max 28) + `requestLegacyExternalStorage` | ✓ | `:15`, `:32` | PRESENT | |
| 35 | Foreground service (mic) + `WAKE_LOCK` + battery-opt | absent | `:22-25`, service `:82-85` | N/A | Flutter addition; keep. |
| 36 | App Links filter `autoVerify`, `${appLinkHost}`, `/summary`, `/course` | ✓ | `AndroidManifest.xml:60-66`; `flutter_deeplinking_enabled=false` `:70` | PRESENT | v3. Prod `assetlinks.json` already lists `com.helloally.app` with RN's cert (fetched). [v2 MISSING] |
| 37 | `launchMode` | `singleTask` | `singleTask` (`:36`) | PRESENT | v3. [v2 PARTIAL] |
| 38 | `screenOrientation="portrait"` | ✓ | `:37` | PRESENT | |
| 39 | `allowBackup="false"` | ✓ | `:31` | PRESENT | |
| 40 | `windowSoftInputMode` | `adjustPan` | `adjustResize` | N/A | |
| 41 | `supportsRtl` | true | default | N/A | |

### 10e Native modules (`package.json` dependencies) → Flutter plugins

v3: `package.json` dependencies re-listed (60 packages); every one is covered below.

| # | RN package (used in) | Flutter plugin / approach | Status | Notes |
|---|---|---|---|---|
| 42 | `@gorhom/bottom-sheet` | `showModalBottomSheet` / `DraggableScrollableSheet` | PRESENT | |
| 43 | `@invertase/react-native-apple-authentication` | `sign_in_with_apple` | DEVICE-CHECK | v3: entitlement now present (r18); needs on-device sign-in. [v2 PARTIAL] |
| 44 | `@livekit/react-native` + webrtc + `livekit-client` | `livekit_client` | PRESENT | v3: audio session configured before connect (`roleplay_voice_screen.dart:247`, `39f4ee2`). Bluetooth permissions: r88. |
| 45 | `@notifee/react-native` | `flutter_local_notifications` | PRESENT | Same channel ids (`leaderboard`, reminders). |
| 46 | `@react-native-async-storage/async-storage` | `shared_preferences` + `flutter_secure_storage` | PRESENT | v3: RN session migrated on first prod launch (`core/migration/legacy_session_migration.dart:103`, iOS manifest reader `rn_async_storage.dart`, Android `MainActivity.kt` `ally/legacy_rn_storage`; `main.dart:60`). |
| 47 | `@react-native-clipboard/clipboard` | `Clipboard` | PRESENT | |
| 48 | `@react-native-community/netinfo` | `connectivity_plus` (`core/realtime/connectivity.dart`) | PRESENT | |
| 49 | `@react-native-firebase/app` + `messaging` | `firebase_core` + `firebase_messaging` | BLOCKED-EXTERNAL | v3: only config files/secrets missing (§9 r15). Push delivery then DEVICE-CHECK. [v2 PARTIAL] |
| 50 | `@react-native-firebase/crashlytics` | `firebase_crashlytics` (`core/errors/crash_reporting.dart:40-42`) | PRESENT | Symbol upload: §11 r5. |
| 51 | `@react-native-google-signin/google-signin` | `google_sign_in` | BLOCKED-EXTERNAL | v3 (normalised): needs the `ENV_VALUES_*` secret (§9 r16), then device check. Client ids + plist done (§9 r7/8, §10 r2). [v2 PARTIAL] |
| 52 | `@react-native-masked-view/masked-view` | `ShaderMask` | PRESENT | |
| 53 | `@react-navigation/*` | `go_router` + custom shell | PRESENT | |
| 54 | `@react-navigation/stack` | — | N/A | |
| 55 | `@reduxjs/toolkit` + `react-redux` | `flutter_riverpod` | PRESENT | |
| 56 | `@sayem314/react-native-keep-awake` | `wakelock_plus` (`core/realtime/keep_awake.dart`) | PRESENT | |
| 57 | `@shopify/react-native-skia` | — | N/A | |
| 58 | `@wuba/react-native-echarts` + `echarts` | — | N/A | |
| 59 | `i18next` + `react-i18next` | `localization_controller.dart` | PRESENT | |
| 60 | `lodash` | — | N/A | |
| 61 | `lottie-react-native` | `lottie` | PRESENT | v3: `botThinking.json` deleted (RN-dead). |
| 62 | `react-native-audio-api` | `audioplayers` | PRESENT | |
| 63 | `react-native-calendars` | — | N/A | |
| 64 | `react-native-chart-kit` | — | N/A | |
| 65 | `react-native-confetti-cannon` | `confetti` | PRESENT | |
| 66 | `react-native-config` | `--dart-define` / `AppConfig` | PRESENT | |
| 67 | `react-native-fs` | `path_provider` + `dart:io` + `MainActivity.kt` `ally/file_export` | PRESENT | |
| 68 | gesture-handler / reanimated / screens / safe-area / keyboard-aware / size-matters / linear-gradient / svg / tab-view | framework, `rn_scale.dart`, `flutter_svg`, `TabBar` | PRESENT | |
| 69 | `react-native-image-picker` | `image_picker` | PRESENT | jpeg/png restriction landed (`28ff515`). |
| 70 | `react-native-live-audio-stream` | `record` | PRESENT | |
| 71 | `react-native-network-logger` | — | N/A | |
| 72 | `react-native-pager-view` | — | N/A | |
| 73 | `react-native-permissions` | `permission_handler` (`core/realtime/microphone_permission.dart`) | PRESENT | |
| 74 | `react-native-reanimated-carousel` | — | N/A | |
| 75 | `react-native-sound-player` | `audioplayers` | PRESENT | |
| 76 | `react-native-version-check` | `package_info_plus` + `core/app_update/force_update.dart` | PRESENT | v3: store URLs (`force_update.dart:18-19`) now match the prod identity. |
| 77 | `react-native-video` | `video_player` | PRESENT | |
| 78 | `react-native-walkthrough-tooltip` | `info_tooltip_icon.dart`, `listening_chrome.dart` `showPrivacyTooltip` | PRESENT | v3: AddNotesSection tooltip `summary_generation_progress.dart:385-404` (RN `AddNotesSection.tsx:65`). [v2 PARTIAL] |
| 79 | `react-native-webview` | `webview_flutter` | PRESENT | |
| 80 | `rn-emoji-keyboard` | `features/reviews/presentation/emoji_keyboard/emoji_keyboard.dart:56` + `assets/emoji_keyboard/` | PRESENT | v3: full port (`41744fd`); old `emoji_insert_picker.dart` deleted (`81622e1`), no callers left. |
| 81 | `socket.io-client` | `socket_io_client` | PRESENT | |
| 82 | (Flutter-only) foreground task, timezone, game bridge, `app_links`, `crypto` | — | N/A | |
| 83 | `react` / `react-native` | Flutter SDK | PRESENT | |

### 10f (v3 new) Launch screen, icons, merged permissions, build/release

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 84 | iOS native launch screen | `LaunchScreen.storyboard` dark bg (#1B282F) | template `ios/Runner/Base.lproj/LaunchScreen.storyboard`: white bg + 1×1 `LaunchImage` | PARTIAL | White flash before the dark Lottie splash (`launch_splash.dart:105` `AppColors.darkGreen`). |
| 85 | Android launch theme | `LaunchTheme` `windowBackground=#021922`, `windowDisablePreview` (`res/values/styles.xml`, `colors.xml`) | `res/drawable(-v21)/launch_background.xml` = `?android:colorBackground` on `Theme.Light` (white) | PARTIAL | Same white flash. |
| 86 | Android round icon | `android:roundIcon="@mipmap/ic_launcher_round"` (5 densities) | absent (`AndroidManifest.xml:30` icon only) | PARTIAL | Low: launchers fall back to `ic_launcher`. |
| 87 | Launcher icon artwork (Android mipmaps, iOS AppIcon) | Ally wordmark | visually identical (xxxhdpi and 1024 compared) | PRESENT | |
| 88 | `BLUETOOTH`, `BLUETOOTH_ADMIN` (merged from `@livekit/react-native` manifest) | ✓ | absent (`flutter_webrtc`/`livekit_client` declare none) | PARTIAL | Flutter role-play prefers Bluetooth output (`roleplay` audio session); on Android ≤11 Bluetooth routing needs these. Add to `AndroidManifest.xml` (maxSdk 30), then DEVICE-CHECK. |
| 89 | `CAMERA`, `SYSTEM_ALERT_WINDOW` (merged from livekit RN) | ✓ | absent | N/A | Unused by RN. |
| 90 | `ACCESS_NETWORK_STATE` | merged (netinfo/firebase) | merged (`connectivity_plus`, `firebase_messaging`) | PRESENT | |
| 91 | Android release signing | `ally-release.keystore` | same keystore from `ANDROID_RELEASE_KEYSTORE_BASE64` (`build.gradle.kts:66-92`) | BLOCKED-EXTERNAL | Secrets absent on Flutter repo (§9 r16). |
| 92 | iOS signing (team `W3ZL4N9N9J`, "Ally AppStore Distribution") | ✓ | `ios/Flutter/Release-prod.xcconfig`, `prod.xcconfig` | BLOCKED-EXTERNAL | Same; profile must include the 3 entitlements. |
| 93 | Version above RN (Android 107, iOS build 67) | — | CI computes `versionCode` (`build-android-production.yml:116-129`) / build number (`build-ios-production.yml:131`) | PRESENT | |
| 94 | minSdk / targetSdk / compileSdk | 24 / 36 / 36 | `flutter.minSdkVersion`=24, `targetSdkVersion`=36, compileSdk 37 | PRESENT | |
| 95 | R8/ProGuard (`minifyEnabled`, RN rules) | ✓ | Flutter default | N/A | RN rules are RN-specific. |
| 96 | iOS deployment target | 15.1 | 15.0 | PRESENT | |
| 97 | `CFBundleName` | `$(PRODUCT_NAME)` | `ally_mobile_flutter` | N/A | Not user-visible (display name set). |
| 98 | Dev flavor identity | `com.helloally.app.dev` "Ally - Dev" | `com.helloally.ally_mobile_flutter` / `com.helloally.allyMobileFlutter` "Ally Flutter" | N/A | Deliberate (`build.gradle.kts:43-57`, `dev.xcconfig`). |
| 99 | Dev-flavor Firebase app, OAuth clients, AASA/assetlinks for dev ids | for RN dev ids | not registered (AASA lists only `com.helloally.app`; assetlinks only RN ids) | BLOCKED-EXTERNAL | Low; dev/test builds only. |
| 100 | Debug `usesCleartextTraffic` | RN `src/debug/AndroidManifest.xml` | absent | N/A | Dev-only (as r8). |

---

## §11 Analytics / telemetry

**v3 tally: 5 rows — PRESENT 2, PARTIAL 1, MISSING 0, BLOCKED-EXTERNAL 1, DEVICE-CHECK 0, N/A 1** [v2: 4 rows — PRESENT 2, PARTIAL 1, N/A 1].

RN emits no product-analytics events (posthog/mixpanel/amplitude/segment/`logEvent`/`.track(`/Sentry searched). Telemetry only:

| # | RN telemetry | RN file | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | Crashlytics `recordError` from ErrorBoundary + fallback UI | `components/ErrorBoundary/ErrorBoundary.tsx` | `core/errors/crash_reporting.dart:40-42`, `core/errors/error_boundary.dart` | PRESENT | |
| 2 | Crashlytics native crash reporting | RN Firebase | `firebase_crashlytics`, init guarded on Firebase (`main.dart:44`) | BLOCKED-EXTERNAL | v3: config files only. [v2 PARTIAL] |
| 3 | `SCRIBE_START_DIAGNOSTIC` | `MicrophoneListeningScreen.tsx:450` | `socket_events.dart:17`, `scribe_recording_screen.dart:159-196` | PRESENT | |
| 4 | Dev logger | `utils/logger.ts` | `debugPrint` | N/A | |
| 5 | (v3 new) Crashlytics symbol upload: iOS dSYM run script, Android crashlytics Gradle plugin | `ios/ally.xcodeproj/project.pbxproj:309` (`FirebaseCrashlytics/run`); `android/build.gradle:19`, `android/app/build.gradle:6` | none in `ios/Runner.xcodeproj/project.pbxproj` or `android/*.gradle.kts` | PARTIAL | Native crashes arrive unsymbolicated/obfuscated. Dart errors unaffected. |

---


---

## Not determined / limits of this audit

- **v3 re-audit (2026-10-28, Flutter `f770200`, RN `7a8ce0c19`).** Every non-PRESENT, non-N/A row and every numbered v2 gap item was re-read in current code. About 385 PRESENT rows were spot-checked, with priority on the screens changed in waves 3–6.
- **Runtime behaviour was not exercised.** These are code-reading verdicts. The DEVICE-CHECK list names everything that needs hardware.
- **BLOCKED-EXTERNAL rests on one observation:** the Flutter GitHub repo shows no Actions secrets. The workflows reference the same secret names that RN uses.
- **Hardcoded English literals** were grepped, not audited exhaustively. Each of the remaining 82 hits mirrors an RN literal.
- **Scripts and raw outputs:**
  - `scratchpad/v3/scripts/` (`endpoints_out.txt`, `i18n_v3.json`, `assets3.py`/`assets3.out`, `literals.txt`)
  - the per-area v3 sources in `scratchpad/v3/out/{A..G}_{section,gaps}.md`
