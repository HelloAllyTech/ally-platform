# RN → Flutter PARITY LEDGER (ally-mobile → ally-mobile-flutter)

Audit date: 2026-10-28. Read-only audit; nothing was built, run or edited in either repo.

- **RN (source of truth):** `HelloAllyTech/ally-platform` → `ally-mobile/` at `7a8ce0c19` (`src/`, `ios/ally/*`, `android/app/src/main/AndroidManifest.xml`, `package.json`, `env/`, `src/config/env.ts`).
- **Flutter:** this repo, branch `master`.

## Branch state (read this first)

The audit started with three branches in flight. All three are now merged into Flutter `master`, and the branch refs are deleted:

| Branch | Merged into master | Notes |
|---|---|---|
| `feature/simkit` | `de796ac` | Merged before the audit started. Start-simulation modals, CoverVideoPreview, course ROLEPLAY/CASE player incl. assessment mode, CompleteProfile active-chat check. Counted as PRESENT throughout. |
| `parity/feedback` | `e248a07` | Merged mid-audit. The Learn, endpoints, hooks and components parts re-checked against the merged master and count its work as PRESENT. |
| `parity/reviews` | `bb6ca2b` (tip `e780dd4`) | Merged **after** the parts below were written. Rows verified on the branch tip were marked IN PROGRESS. `git diff e780dd4 master -- lib/features/reviews` is empty, so in this ledger they are re-labelled **MERGED**. That means the code exists on master, but each row's Notes may still list residual gaps (e.g. the review list sends no `order: DESC`, no `languageCode`, and no scribe unread count). Re-verify MERGED rows on master before ticking them off. |

Caveat: the account/shell part read `notifications_screen.dart` before `e780dd4` ("Notifications: restyle to RN NotificationsScreen") landed. Re-check its three Notifications PARTIAL rows, which concern visual and unread styling.

## Status key

- **PRESENT**: the same behaviour exists on master, possibly built differently. The row names the Flutter file.
- **PARTIAL**: some of the behaviour exists. The Notes say exactly what is missing.
- **MISSING**: nothing equivalent exists on master. Every MISSING and PARTIAL verdict comes from reading the Flutter code and searching `lib/` under several names, not from a single grep miss.
- **MERGED**: was IN PROGRESS on `parity/reviews`, now on master via `bb6ca2b`. Verified on the branch tip, not re-read on master.
- **N/A**: RN dead code (exported but never rendered or called), dev-only tooling, or a framework concern with no runtime behaviour.
- **DEAD**: an RN endpoint that is defined but never called. Listed for completeness and needs no port.

## Totals per section

| § | Section | Rows | PRESENT | PARTIAL | MISSING | MERGED (was in progress) | N/A / DEAD |
|---|---|---|---|---|---|---|---|
| 1 | Navigation (routes, params, tabs, drawer) | 47 | 32 | 9 | 3 | 0 | 3 |
| 2 | Screens: account/shell (16 screens/areas) | 211 | 151 | 26 | 9 | 0 | 25 |
| 2 | Screens: Scribe (CallLog, CallSummary, Listening, Breathing) | 156 | 80 | 43 | 15 | 1 | 17 |
| 2 | Screens: Learn (Simulations … SimulationFeedback) | 237 | 162 | 35 | 21 | 0 | 19 |
| 2 | Screens: Reviews (list, details, share) + review hooks | 77 | 26 | 4 | 3 | 42 | 2 |
| 3 | Shared components (`src/components`, 67 dirs → 72 rows) | 72 | 33 | 13 | 5 | 15 | 6 |
| 4 | Hooks (`src/hooks`, 53) | 53 | 22 | 14 | 6 | 3 | 8 |
| 4b | App shell / services / utils (push, deep links, boot) | 62 | 35 | 8 | 14 | 0 | 5 |
| 5 | Backend endpoints actually called by RN | 150 | 104 | 21 | 11 | 14 | 25 dead |
| 6 | Store (redux slices, login/logout side effects) | 28 | 18 | 4 | 4 | 0 | 2 |
| 7 | Translations (key families / language coverage) | 9 | 3 | 4 | 1 | 0 | 1 |
| 8 | Assets (161 RN asset files + 7 fonts) | 168 | 103 | 47 | 2 | 0 | 16 (RN-dead) |
| 9 | Config / env / flags (13 RN env vars + build placeholders) | 15 | 7 | 5 | 2 | 0 | 1 |
| 10 | Native / platform (Info.plist, entitlements, AppDelegate, manifest, native modules) | 83 | 30 | 16 | 19 | 0 | 18 |
| 11 | Analytics / telemetry | 4 | 0 | 1 | 2 | 0 | 1 |

Notes on counting:
- The same gap can appear in several sections. For example, `languageCode` shows up in §2, §4 and §5, force-update in §2, §3 and §4, and keep-awake in §2, §4 and §10. Do not add the MISSING columns together to get a count of distinct gaps; use the **Top gaps** list instead.
- "Android back on a tab root exits the app" appears four times in §2 (account). It is one fix.
- In §8 a file is PARTIAL when RN renders the asset and Flutter ships the file but never references it. Flutter usually substitutes a Material icon, so these are visual-parity gaps.

---

## Top gaps (deduplicated, ranked by user impact)

| # | Gap | Where in ledger | Status |
|---|---|---|---|
| 1 | **No `languageCode` on content endpoints.** RN `api.ts` `LANGUAGE_CODE_ENDPOINTS` injects it into ~18 endpoints (16 ported). Flutter never sends it, so hi/mr/ta/kn users get backend content (scenarios, paths, cases, tracks, reviews, badges, leaderboard, end-session) in the default language. | §5 transport, §4, §2 account | MISSING |
| 2 | **Firebase/native release plumbing absent.** No `GoogleService-Info.plist` / `google-services.json` and no `.entitlements` file (no `aps-environment`, Sign in with Apple, or associated domains). Push, Apple sign-in on device, and universal links cannot work. | §10 | MISSING |
| 3 | **Google sign-in iOS config.** No `GIDClientID` or reversed-client-id `CFBundleURLTypes` in Info.plist, and `GOOGLE_*_CLIENT_ID` default to empty so the button is disabled. The Flutter package id has no OAuth client. | §9, §10, §2 Splash | MISSING/PARTIAL |
| 4 | **Live role play never leaves the call screen when the agent or server ends the room** (no room-disconnected listener, `cap-ended` ignored). It also needs a manual "Connect" tap and has no agent-joined state. | §2 Learn (SimulationAssistant), §5 realtime | MISSING |
| 5 | **No app-wide cloud-telephony socket.** An incoming conference call (`USER_JOINED`) doesn't open Listening until the next resume or relaunch. In Listening, the `chatId` carried by the socket event is ignored, which causes false "Microphone failure" at 5s. | §4b, §2 Scribe | MISSING/PARTIAL |
| 6 | **Force update missing.** No `/app-version/{ios,android}` call, no ForceUpdateModal, no store link (`forceUpdateAlert.svg` unused). Old builds can't be retired. | §2, §3, §4, §5, §10 | MISSING |
| 7 | **Call summary tags saved as a comma-joined string instead of an array**, which overwrites stored tags. Separately, edits typed while a save is in flight are lost (`_dirtyKeys.clear()` after the await), and the form is filled only once per chat. | §2 Scribe, §4 | PARTIAL (data loss) |
| 8 | **Scribe starts paused with no "resume to listen" tooltip** (`_isMuteTooltipOpen` never set), so a whole session can be recorded with no audio sent. | §2 Scribe | PARTIAL |
| 9 | **No keep-awake** in live role play or Scribe (RN `@sayem314/react-native-keep-awake`). The screen locks mid-session. | §2, §4, §10 | MISSING |
| 10 | **No deep links**: `/summary/:id` and `/course/:uuid` universal links. No AASA entitlement, no Android `autoVerify` intent filter, no Dart link handler. | §4b, §10 | MISSING |
| 11 | **Logout never calls `deleteDeviceToken`**, so a logged-out device keeps getting the previous user's pushes. | §2, §4b, §6 | MISSING |
| 12 | **Tenant `/settings/summary-fields` ignored.** Every tenant sees all summary sections and fields, and the dictation field list is unfiltered. | §2 Scribe, §5 | MISSING |
| 13 | **Call transcript fetched with no limit, offset or sort.** Long calls are truncated to the backend's first page. | §2 Scribe, §5 | PARTIAL |
| 14 | **Call-log duration filter sends minutes; the backend expects seconds.** Clearing a box doesn't clear its filter. | §2 Scribe | PARTIAL (wrong results) |
| 15 | **Stale data after mutations.** Credits, path/case progress and course progress aren't refreshed after a role play or course item. Call-log lists and the review list don't refetch on focus. Leaderboard and Progress don't refresh. `endScenarioSession` sends no `enableRecommendations` body. | §2, §5 cache section | PARTIAL |
| 16 | **`pathId`/`caseId`/`languageId` not threaded** start → live → Feedback. Back from Feedback lands on `/home`, and "Try another" isn't hidden for path/case sessions. | §1, §2 Learn | PARTIAL |
| 17 | **Completed course items reopen as not completed.** `alreadyCompleted` is passed as an in-session flag: journals become editable, videos lose "Watched", articles ask to be marked read again. | §2 Learn | PARTIAL |
| 18 | **Android back on any tab exits the app**; RN goes to the first visible tab. | §1, §2 account | MISSING |
| 19 | **No connectivity detection** (RN NetInfo): offline shows as a socket error, and sockets don't reconnect on foreground. Mic-blocked shows plain text with no "Open Settings", and a simulation and credit are spent before the mic is checked. | §4, §10 | MISSING |
| 20 | **Session-recording playback missing on SimulationFeedback** (`GET …/recording`, player, transcript sync, tap-to-seek), as is the transcript translation dropdown. | §2 Learn, §5 | MISSING |
| 21 | **Badge-unlock popup (BadgePopup + confetti) missing app-wide.** | §3, §4, §2 | MISSING |
| 22 | **Crash reporting not wired.** `firebase_crashlytics` is in pubspec but there is no ErrorBoundary equivalent and no `FlutterError.onError`/`recordError`. | §3, §11 | MISSING |
| 23 | **Article/quiz players thin.** No inline questions, read-to-end gating, Resources sheet or question media. Quiz has no regrade for PENDING_GRADING, no paging, no confetti, and no correct answer or AI feedback in results. | §2 Learn, §5 | PARTIAL |
| 24 | **Call summary feature gaps.** Export summary missing (RN `saveFile` plus iOS `UIFileSharingEnabled`), delete summary missing, no places picker (SearchableLocationDropdown; location is free text), notes can't be typed while the summary generates. | §2 Scribe, §3, §5 | MISSING |
| 25 | **Portrait lock and app identity.** Flutter allows landscape (Info.plist and manifest have no portrait lock). Display name is "Ally Mobile Flutter" / `ally_mobile_flutter`. `allowBackup` is not false. There's no `ITSAppUsesNonExemptEncryption` and no `PrivacyInfo.xcprivacy`. | §10 | MISSING/PARTIAL |

Smaller items, each in its section: the Search result card has no expand or tags; the Community tab only works on first tap; the Review-tab unread dot ignores scribe and never refreshes; the course-discussion-reply notification opens the overview instead of the highlighted post; there is no start/end simulation sounds; the dynamic translations controller returns early after a language change, and its default URL points at the retired dev host; there are 33 referenced Flutter-only strings untranslated in hi/kn/mr/ta; `ALLY_WEB_URL` is hardcoded to prod; error text shows raw Dio exceptions.

---
## §1 Navigation — routes, params, tabs, drawer

RN: `src/navigation/{RootNavigator,DrawerNavigator,TabNavigator,types}.tsx`, `src/constants/{navigation,tabs}.ts*`. Flutter: `lib/core/routing/app_router.dart` (go_router), `lib/core/navigation/{app_shell_screen,app_bottom_tab_bar,app_drawer,tab_config}.dart`.

RN layout: a native stack with two branches. Signed out: Splash, SuspendedAccount. Signed in: Drawer → BottomTabs plus 26 stack screens. Flutter layout: a flat go_router list with a `computeRedirect` gate (`/splash` → `/login` | `/complete-profile` | `/home`; `/suspended` allowed while signed out).

| # | RN route (params; options) | Flutter route / file | Status | Notes |
|---|---|---|---|---|
| 1 | Drawer `BottomTabs {hideTabBar?}` (DrawerNavigator) | `/home` → `AppShellScreen` + `app_drawer.dart` | PRESENT | Drawer items, gating and version label are detailed in §2 account, sections 4–5. |
| 2 | `Splash` (signed-out branch; login lives inside it) | `/splash` (`_LaunchScreen`, blank until the session is restored) + `/login` (`login_screen.dart`) | PRESENT | |
| 3 | `SuspendedAccount` (signed-out branch) | `/suspended` → `suspended_account_screen.dart` | PRESENT | |
| 4 | `CompleteProfile` (`gestureEnabled:false`) | `/complete-profile`, forced by `computeRedirect` | PRESENT | |
| 5 | `Listening {isMicrophoneMode:true}` | `/scribe` → `ScribeRecordingScreen` | PRESENT | Falls back to `userId 'dev-user'` when the user hasn't loaded yet. |
| 6 | `Listening {isMicrophoneMode:false}` (conference) | `/conference-listening/:chatId` → `ConferenceListeningScreen` | PRESENT | The route exists, but nothing routes into it from the app-wide telephony socket (§4b). |
| 7 | `CallSummary {callId?, fromLogs?}` (`gestureEnabled:false`) | `/call-log/:id` → `CallSummaryScreen(log: state.extra as CallLogItem)` | PARTIAL | Requires an in-memory `CallLogItem` extra, so opening by id only (deep link, live flow from Breathing with no callId) throws. `fromLogs` isn't modelled. |
| 8 | `CallLog` (stack copy of the tab) | `/call-log` → `CallLogScreen` | PRESENT | |
| 9 | `Breathing` (post-call box breathing) | `/box-breathing?chatId=` | PRESENT | Exit target after a live session differs from RN (§2 Scribe). |
| 10 | `BreathingExercise {config, itemId, trackId}` (`animation:'fade'`) | `/breathing-exercise` (extra `BreathingExerciseContent`) | PRESENT | `itemId`/`trackId` aren't needed: completion happens in the player on mount, as in RN (§2 Learn, section 7). |
| 11 | `Simulations` | `/simulations` → `SimulationsScreen` | PRESENT | |
| 12 | `SimulationDetails {scenario}` | `/simulations/:scenarioId` (extra `Scenario?`) | PRESENT | Can also load by id. |
| 13 | `SimulationPathDetails {pathId}` | `/simulation-paths/:pathId` | PRESENT | |
| 14 | `CaseDetails {caseId}` | `/cases/:caseId` | PRESENT | |
| 15 | `CourseOverview {trackId}` | `/courses/:trackId` → `CourseDetailScreen` | PRESENT | |
| 16 | `CourseItemPlayer {trackId, itemId, highlightPostId?}` (`gestureEnabled:false`) | `/courses/item/:itemId` (extra `({trackId, TrackDetailItem item})`) | PARTIAL | `highlightPostId` isn't accepted or passed, though `discussion_post_tile.dart` supports it. The route needs the full item object as extra, so it can't be opened from a notification by id. |
| 17 | `CourseProgress {trackId}` | `/courses/:trackId/progress` | PRESENT | |
| 18 | `SimulationAssistant {sessionData, scenario?, pathId?, caseId?, languageId?}` (`gestureEnabled:false`) | `/roleplay` (extra map `{liveKitServerUrl, accessToken, scenarioSessionId, scenario}`) | PARTIAL | `pathId`, `caseId` and `languageId` aren't carried, so Feedback can't return to the path or case, or hide "Try another" (§2 Learn). |
| 19 | `SimulationFeedback {scenarioSessionId?, fromLogs?, pathId?, caseId?, languageId?}` (`gestureEnabled:false`) | `/simulations/feedback/:sessionId?fromLogs=` | PARTIAL | `pathId`, `caseId` and `languageId` are missing, and back lands on `/home`. |
| 20 | `Achievements` (stack; also a tab) | `/achievements` + tab `kTabAchievements` | PRESENT | |
| 21 | `Progress` | `/progress` | PRESENT | |
| 22 | `ProfileSettings` | `/profile` | PRESENT | |
| 23 | `BugReport` | `/bug-report` (extra `screenName`) | PRESENT | |
| 24 | `Reactions {reviewId, reviewType?}` | `/reactions/:reviewId` (extra `ReviewType`) | PRESENT | |
| 25 | `ReviewDetails {reviewId, isPrivate?}` | `/reviews/:reviewId` (extra `ReviewType.simulation`) | PARTIAL | `isPrivate` isn't passed (§2 Scribe S52). |
| 26 | `ScribeReviewDetails {reviewId, isPrivate?}` | `/reviews/:reviewId` (extra `ReviewType.scribe`) | PARTIAL | Same as row 25. |
| 27 | `ShareCallLog {reviewId?, scribeSessionId, sessionData, isEditNote?, note?}` | `/share-for-review/:id` (extra `ShareForReviewArgs{isScribe:true,…}`) | PRESENT | The screen behaviour itself is MERGED from parity/reviews (§2 Reviews A4). |
| 28 | `ShareSimulation {reviewId?, scenarioSessionId, scenarioData, isEditNote?, note?}` | `/share-for-review/:scenarioSessionId` | PRESENT | `isEditNote` is derived from `reviewId != null`. |
| 29 | `Notifications` | `/notifications` | PRESENT | |
| 30 | `LiveKitTest` (declared in `types.ts` / `SCREEN_NAMES`, never registered) | — | N/A | RN dead route. |
| 31 | Tab `Learn` (perm `EDIT_SCENARIO_SESSION`) → SimulationsScreen | `tab_config.dart` `kTabLearn` | PRESENT | |
| 32 | Tab `CallLog` (`VIEW_CALL_LOGS` or `VIEW_SCENARIO_SESSION`) | `kTabCallLog` | PRESENT | |
| 33 | Tab `Review` (`VIEW_SIMULATION_REVIEWS` or `VIEW_SCRIBE_REVIEWS`) + unread dot | `kTabReview`, `app_bottom_tab_bar.dart` | PARTIAL | The unread dot ignores the scribe unread count, is fetched only for `simulationReviewerAccess`, and never refreshes (§2 account, section 16). |
| 34 | Tab `UserAnalytics` (`VIEW_ANALYTICS_DASHBOARD`) | `kTabUserAnalytics` | PRESENT | |
| 35 | Tab `Leaderboard` (`VIEW_COMMUNITY_LEADERBOARD`) | `kTabLeaderboard` | PRESENT | The weekly-reminder tap pushes standalone `/leaderboard` instead of selecting the tab. |
| 36 | Tab `Achievements` (`VIEW_USER_BADGES`; reviewer-only layout via `isReviewerOnly`) | `kTabAchievements`, `isReviewerOnly()` | PRESENT | |
| 37 | Tab `Search` (`VIEW_REFERENCE_DOCUMENT`) | `kTabSearch` | PRESENT | |
| 38 | Tab `Community` (`VIEW_COMMUNITY`; opens external link) | `kTabCommunity` → `community_screen.dart` | PARTIAL | Opens the browser once from `initState`. Later taps do nothing and a blank tab stays selected. |
| 39 | Tab permission OR-semantics + `getFirstVisibleTab` initial tab | `tab_config.dart` `_hasAnyPermission`, `app_shell_screen.dart` | PRESENT | |
| 40 | Android hardware back on a tab root → first visible tab (`useTabBackToHomeHandler`, `useHardwareBackPressHandler`) | none (no `PopScope`/back handling in the shell) | MISSING | Back exits the app. Appears four times in §2 account; it's one fix. |
| 41 | "Reset to tab" exits (end of flow → Learn tab / CallLog tab via `navigation.reset`) | `context.go('/home')` only | MISSING | Returns to whichever tab was last selected (§4 hooks: `useAppNavigation`). |
| 42 | Universal-link routes `https://{ALLY_WEB_URL}/summary/:id` → [CallLog, CallSummary], `/course/:uuid` → CourseOverview (pending until auth/profile) | none | MISSING | §4b and §10 cover the native side too. |
| 43 | Notification-tap routing by push type (`RootNavigator` + `pushNotificationService`) | `core/push/notification_navigation.dart` | PARTIAL | COURSE_DISCUSSION_REPLY opens the overview, not the item with the post highlighted. The leaderboard reminder pushes a standalone route (§4b has per-type rows). |
| 44 | Auth-gated stack split (signed-out branch shows only Splash/Suspended) | `computeRedirect` in `app_router.dart` | PRESENT | Launch logs out only on a 401, while RN logs out on any `/users/me` failure (§2 account). |
| 45 | Drawer content (`CustomDrawerContent`, menu items, LogoutModal) | `app_drawer.dart`, logout modal | PRESENT | Logout doesn't delete the FCM device token (§2 account, section 5). |
| 46 | In-screen modals/sheets (CallLogFilterSheet, CourseProgressSheet, LanguageSelectorSheet, comment/thread sheets, start-simulation modals) | per-feature `showModalBottomSheet` | N/A | Not routes in RN either. Each is mapped in §2/§3. |
| 47 | Flutter-only routes with no RN stack equivalent: `/preferences`, `/reviews`, `/leaderboard`, `/community`, `/search` as standalone pushes | `app_router.dart` | N/A | `/preferences` calls three RN-DEAD endpoints (§5). Decide whether to keep or remove it. |


---

## §2 Screens

The four sub-parts below were each written by a separate auditor, and each keeps its own tallies and top-gaps list.

### Parity ledger — account / shell screens

Scope: SplashScreen (login), CompleteProfile, SuspendedAccount, Drawer (DrawerNavigator + CustomDrawerContent), LogoutModal, ProfileSettings, BugReport, Notifications, Achievements, Progress, UserAnalytics, Leaderboard, Community, Search, Reactions, TabNavigator.

- RN root: `ally-platform/ally-mobile/src/` (paths below are relative to it)
- Flutter root: `ally-mobile-flutter/lib/` on `master` (paths below are relative to it). Branches `parity/reviews` and `parity/feedback` were diffed against their merge base. Neither touches anything in this scope except `core/navigation/app_drawer.dart` (refactor only on parity/feedback, no behaviour change) and the Reactions entry point (moved into `review_widgets.dart` on parity/reviews). No row is IN PROGRESS.

#### Overall tally

**211 rows: 151 PRESENT / 26 PARTIAL / 9 MISSING / 0 IN PROGRESS / 25 N/A**

(The "Android back on a tab root" gap appears once each under UserAnalytics, Community, Search and TabNavigator because RN calls the hook per screen. It is one fix.)

**Analytics and tracking:** RN has no product analytics in this scope. Grepping all of `src/` for posthog, logEvent, trackEvent, `.capture(`, mixpanel, amplitude and `analytics()` finds nothing. The only telemetry is Crashlytics in the global `components/ErrorBoundary`. So each screen's analytics row is N/A, with no event names to list.

---

#### 1. SplashScreen (login) — `screens/SplashScreen/**`
Tally: 31 present / 6 partial / 1 missing / 0 in-progress / 1 n-a

Note: RN has no carousel in this folder. The 17 files are SplashScreen, EmailLogin, OtpVerification, OtpInput, TermsAndAgreementModal, plus their styles, types and tests. Google and Apple login live in `hooks/useGoogleLogin.ts`, `hooks/useAppleLogin.ts` and `components/Button/*LoginButton`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Lottie splash plays frames 0→200, then freezes at 0.99 | SplashScreen.tsx | features/auth/presentation/login_screen.dart | PRESENT | Same frame math. |
| Status bar hidden during the animation; dark-content 1s after it ends | SplashScreen.tsx | login_screen.dart (`SystemUiOverlayStyle.light`) | PARTIAL | The status bar is never hidden. Flutter shows a light status bar over the hero instead. |
| Signed-in user still sees the Lottie, then is routed | SplashScreen.tsx | core/routing/app_router.dart (`_LaunchScreen`, `computeRedirect`) | PARTIAL | Deliberate perf change: a returning user gets a blank `/splash` and goes straight to `/home` with no animation. |
| `checkAuth()` on launch: GET /users/me + /authorization/permissions; any failure → logout | hooks/useUser.ts | core/auth/auth_state.dart (`_restore`), features/account/data/account_repository.dart (`currentUserProvider`), core/permissions/permissions_repository.dart | PARTIAL | Restore only checks that a token exists. Only a 401 logs out (`sessionExpired`). An offline or 5xx `/users/me` keeps the session where RN would log out. Permissions load lazily in the shell. |
| Sheet slides up 60% and greeting fades in ("greetingLine1", "welcome" + appName) | SplashScreen.tsx | login_screen.dart (`_buildSheet`, `_buildTitle`) | PRESENT | |
| Gradient behind the sheet once it is fully open | SplashScreen.tsx | login_screen.dart (`_buildHeroGradient`) | PRESENT | |
| **Force-update modal** (`useForceUpdate`: minimumSupportedVersion > app version → blocking `ForceUpdateModal`, "Update" opens the store, all routing suppressed) | SplashScreen.tsx, hooks/useForceUpdate.ts, components/ForceUpdateModal | — (searched lib/ for force update, minimumSupportedVersion, isUpdateRequired: none) | MISSING | No app-config fetch, no version compare, no blocking modal. |
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
| Google Sign-In button (signOut first, idToken → POST google login, allowedRoles) | EmailLogin.tsx, hooks/useGoogleLogin.ts | login_screen.dart (`_signInWithGoogle`, `_GoogleLoginButton`), features/auth/data/auth_repository.dart | PARTIAL | The button is disabled when `GOOGLE_WEB_CLIENT_ID` is not set at build time. Per the repo's own doc, the Flutter package id has no OAuth client registered, so a real round-trip is not possible yet. |
| Google SDK errors: cancel/in-progress silent; toast "Google Play Services not available or outdated"; other → toast with `err.message` | hooks/useGoogleLogin.ts | login_screen.dart | PARTIAL | Every non-cancel SDK error shows the generic translated "auth.login.google.error". No Play-Services-specific message, no SDK message. |
| Apple Sign-In (iOS only; email + fullName scopes; identityToken/authorizationCode/fullName) | EmailLogin.tsx, hooks/useAppleLogin.ts | login_screen.dart (`_signInWithApple`, `_AppleLoginButton`), auth_repository.dart | PRESENT | |
| Apple SDK errors: cancel silent; others → toast with `err.message` | hooks/useAppleLogin.ts | login_screen.dart | PARTIAL | Shows the generic "auth.login.apple.error", not the SDK message. |
| Backend social-login error: suspended → SuspendedAccount; else toast with backend message or fallback | useGoogleLogin.ts, useAppleLogin.ts | login_screen.dart (`_handleSocialLoginError`) | PRESENT | Uses `push('/suspended')` where RN uses `replace`. |
| All inputs and buttons disabled while any login is loading | EmailLogin.tsx | login_screen.dart (`_isLoading`) | PRESENT | |
| Footer "By proceeding… Terms & Conditions … Privacy Policy" links open URLs | EmailLogin.tsx | login_screen.dart (`_buildTermsFooter`) | PRESENT | |
| Terms modal shown after social login, before tokens are stored | EmailLogin.tsx | login_screen.dart (`_completeSocialLogin`) | PRESENT | |
| OTP header "enterCode" + email | components/OtpVerification/OtpVerification.tsx | login_screen.dart (`_buildOtpStep`) | PRESENT | |
| 4-box OTP input: digits only, paste-fill, backspace to the previous box, dash in empty boxes | components/OtpInput/OtpInput.tsx | login_screen.dart (`_OtpInput`) | PRESENT | Single hidden field. Also adds iOS one-time-code autofill. |
| Error state: red box outlines + backend message box | OtpVerification.tsx, OtpInput.tsx | login_screen.dart | PRESENT | |
| Expiry text using minutes from `expiresIn` (default 10) | OtpVerification.tsx | login_screen.dart (expires_one/expires_other) | PRESENT | Flutter copy says "N minute(s)". RN's en string omits the unit. |
| Resend link with 60s countdown, disabled while counting or resending; resets OTP and expiry, refocuses the input | OtpVerification.tsx | login_screen.dart (`_resendOtp`, `_startResendCountdown`) | PRESENT | |
| Resend failure → error toast | OtpVerification.tsx | login_screen.dart | PRESENT | Fallback text is "common.somethingWentWrong". |
| Verify disabled until 4 digits or while the terms modal is up; spinner | OtpVerification.tsx | login_screen.dart | PRESENT | |
| 403 USER_SUSPENDED on verify → SuspendedAccount | OtpVerification.tsx, utils/error.ts | login_screen.dart (`_isSuspendedUserError`) | PRESENT | |
| Terms modal after OTP verify → store tokens → re-run auth routing | OtpVerification.tsx | login_screen.dart (`_verifyCode`) + auth_state.dart (`signIn`) | PRESENT | |
| TermsAndAgreementModal: non-dismissable, title, sections with bullets, bold/suffix/link segments | components/TermsAndAgreementModal/TermsAndAgreementModal.tsx | features/auth/presentation/terms_and_agreement_modal.dart | PRESENT | `PopScope(canPop:false)`. |
| "Scroll to bottom" button until scrolled (or content fits) | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Agree checkbox; Agree button enabled only when checked | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Footer link to the full T&C | TermsAndAgreementModal.tsx | terms_and_agreement_modal.dart | PRESENT | |
| Analytics events | — | — | N/A | None in RN. |

#### 2. CompleteProfileScreen — `screens/CompleteProfileScreen/CompleteProfileScreen.tsx`
Tally: 7 present / 0 partial / 0 missing / 0 in-progress / 1 n-a

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
Tally: 3 present / 1 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| EmptyState: suspended icon, "suspended.title", description line1+line2 | SuspendedAccountScreen.tsx | features/suspended/presentation/suspended_account_screen.dart | PRESENT | Flutter adds a missing space between the lines (fixes an RN typo). |
| "Go to login" outlined pill → reset to Splash | SuspendedAccountScreen.tsx | suspended_account_screen.dart (logout + `go('/login')`) | PRESENT | |
| Reached from OTP / Google / Apple suspended errors | OtpVerification.tsx, useGoogleLogin.ts, useAppleLogin.ts | features/auth/presentation/login_screen.dart; app_router.dart allows `/suspended` while signed out | PRESENT | |
| Navigation uses `replace`, so back cannot return to the login form | same | login_screen.dart (`context.push('/suspended')`) | PARTIAL | Flutter pushes, so back or swipe returns to the login sheet. |
| Suspension detected mid-session (403 on any API) | — | — | N/A | RN does not handle this either. |
| Analytics events | — | — | N/A | None. |

#### 4. Drawer — `navigation/DrawerNavigator.tsx` + `screens/LogoutScreen/components/CustomDrawerContent.tsx`, `MenuOption/`
Tally: 11 present / 0 partial / 0 missing / 0 in-progress / 1 n-a

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
Tally: 4 present / 0 partial / 1 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| IllustratedModal: logOut image, title normal + italic, "nav.logout.content", red "nav.logout.button", X to cancel | LogoutModal.tsx | core/navigation/app_drawer.dart (`_confirmLogout`), core/widgets/illustrated_modal.dart | PRESENT | |
| **Logout side effect: unregister this device's FCM token** (DELETE device token, then `messaging().deleteToken()`) | hooks/useUser.ts (`handleUserLogout`), services/pushNotificationService.ts (`unregisterDeviceForPush`) | features/notifications/data/notifications_repository.dart has `deleteDeviceToken()` but nothing calls it; core/push/push_notification_service.dart has no logout path | MISSING | A logged-out device keeps receiving reminder pushes. |
| Logout side effect: clear tokens, set unauthenticated, clear user and permissions | store/slices/userSlice.ts (`handleLogout`) | core/auth/auth_state.dart (`logout`) | PRESENT | |
| Logout side effect: `api.util.resetApiState()` drops cached data | hooks/useUser.ts | core/network/api_client.dart (`apiClientProvider` watches auth, so dependent providers rebuild) | PRESENT | |
| Navigator swaps to the auth stack (login) | navigation/RootNavigator.tsx | core/routing/app_router.dart (redirect on auth change) | PRESENT | |
| Weekly leaderboard reminder on logout | — | core/push/leaderboard_notification.dart (cancels on sign-out) | N/A | Flutter-only, deliberate. RN never cancels. |
| Analytics events | — | — | N/A | None. |

#### 6. ProfileSettingsScreen — `screens/ProfileSettingsScreen/**`, `hooks/useProfileImage.ts`, `hooks/useLeaderboardNotification.ts`, `components/LanguageSelectorSheet`
Tally: 13 present / 3 partial / 0 missing / 0 in-progress / 4 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back arrow + "profile.settings.title" | ProfileSettingsScreen.tsx | features/account/presentation/profile_settings_screen.dart (`BackTitleHeader`) | PRESENT | |
| Back with unsaved photo change → CustomModal "common.unsavedChanges" (Discard red / Cancel) → reset + goBack | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_handleBack`, core/widgets/confirmation_modal.dart) | PRESENT | |
| System back with unsaved changes | ProfileSettingsScreen.tsx (no handler; Android back discards silently) | profile_settings_screen.dart (`PopScope`) | PRESENT | Flutter also guards system back, a small improvement. |
| Avatar 116pt (image or initial on lightGray2); spinner overlay while saving | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_ProfileImageSection`) | PRESENT | |
| Upload hint text | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| "Upload Image" link opens the image sheet (disabled while saving) | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| Image sheet: title, "Change"/"Upload" option, "Remove" when an image exists | components/ProfileImageBottomSheet.tsx | features/account/presentation/profile_image_options_sheet.dart | PRESENT | |
| Gallery pick: quality 0.8, max 800×800, **jpeg/png only** | hooks/useProfileImage.ts | profile_settings_screen.dart (`_pickImage`, image_picker) | PARTIAL | No MIME restriction, so HEIC, GIF and others can be picked. The repo maps HEIC to `image/heic`. |
| Validation toasts: >2MB "Image size must be less than 2MB…", non-square "Image must be square…" | useProfileImage.ts | profile_settings_screen.dart | PRESENT | Prefixed with "errors.uploadProfileImage". |
| Save button only while unsaved; upload = presign → S3 PUT → PATCH URL → best-effort delete of the old image | useProfileImage.ts | profile_settings_screen.dart (`_save`), features/account/data/account_repository.dart (`uploadProfileImage`) | PRESENT | |
| Remove + Save → DELETE old image, PATCH '' | useProfileImage.ts | profile_settings_screen.dart, account_repository.dart | PRESENT | |
| Save error → toast "errors.uploadProfileImage" | useProfileImage.ts | profile_settings_screen.dart (`_showErrorToast`) | PRESENT | |
| Read-only Name and Email fields ("—" when empty) | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_Field`) | PRESENT | |
| Language row, gated by `env.LANGUAGE_SELECTOR_FLAG` | ProfileSettingsScreen.tsx, config/env.ts | profile_settings_screen.dart (`_LanguageField`) | PARTIAL | Always shown. `AppConfig.languageSelectorEnabled` exists but only gates the CDN sync. |
| Language sheet: en/hi/mr/ta/kn, selected dot, persist, forceRTL, **reset the API cache so localized content refetches** | components/LanguageSelectorSheet/LanguageSelectorSheet.tsx, services/api.ts + languageCodeEndpoints.ts | features/account/presentation/language_selector_sheet.dart, core/localization/localization_controller.dart | PARTIAL | UI strings switch, but nothing invalidates loaded content. Flutter only sends `languageCode` on course endpoints, not scenarios, reviews, badges or leaderboard (RN's allowlist covers 18 endpoints). |
| Leaderboard notification toggle (LEARNER only): persisted, schedules/cancels the weekly reminder | ProfileSettingsScreen.tsx, hooks/useLeaderboardNotification.ts | profile_settings_screen.dart (`LeaderboardNotificationToggleRow`), core/push/leaderboard_notification.dart | PRESENT | |
| Loading and error states for the user record | — (RN reads Redux user) | profile_settings_screen.dart | N/A | Flutter-only states. |
| Delete account | — | — | N/A | Not in RN. |
| Logout from this screen | — | — | N/A | RN only offers logout in the drawer. |
| Analytics events | — | — | N/A | None. |

#### 7. BugReportScreen — `screens/BugReportScreen/BugReportScreen.tsx`, `hooks/useBugReport.ts`, `utils/bugReportContext.ts`
Tally: 9 present / 2 partial / 0 missing / 0 in-progress / 1 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: LeftArrowIcon + ReplayPro "bugReport.title", bottom border | BugReportScreen.tsx | features/bugreport/presentation/bug_report_screen.dart | PARTIAL | Visual only: a Material `AppBar` with `Icons.arrow_back` and default title style, no RN header styling. |
| Prompt text | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Multiline input: placeholder, maxLength 1000, disabled while submitting | BugReportScreen.tsx | bug_report_screen.dart (`AppTextField`) | PRESENT | |
| Character counter "n/1000" | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Submit pinned in a bottom footer; disabled until the trimmed text is non-empty and ≤1000; spinner | BugReportScreen.tsx, useBugReport.ts | bug_report_screen.dart | PARTIAL | Logic matches, but the button sits inline under the field instead of pinned to the bottom. |
| Silent context: screen, appVersion, device, os, clientTimestamp | utils/bugReportContext.ts | features/bugreport/data/bug_report_repository.dart | PRESENT | |
| Previous screen name (deepest active route) | BugReportScreen.tsx | core/navigation/app_drawer.dart passes `activeTabName` | PRESENT | |
| Success → toast "bugReport.successMessage", clear, goBack | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| HTTP 429 → toast "bugReport.rateLimitMessage" | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| Other errors → error toast "errors.submitBugReport" | useBugReport.ts | bug_report_screen.dart | PRESENT | Appends the raw exception text. |
| Keyboard avoidance | BugReportScreen.tsx | bug_report_screen.dart (Scaffold resize) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 8. NotificationsScreen — `screens/NotificationsScreen/NotificationsScreen.tsx`
Tally: 8 present / 3 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: reminder push tap without a "Simulations" hint → Notifications (no in-app entry in RN) | utils/notificationNavigation.ts | core/push/notification_navigation.dart (`reminderRouteFor`), app_router `/notifications` | PRESENT | |
| Header: back + "Notifications" + "Mark all read" only when something is unread | NotificationsScreen.tsx | features/notifications/presentation/notifications_screen.dart | PRESENT | Flutter's title and button are translated; RN hardcodes English. |
| Hardware back → goBack | NotificationsScreen.tsx | default route pop | PRESENT | |
| Initial loading spinner | NotificationsScreen.tsx | notifications_screen.dart | PRESENT | |
| Empty: "You're all caught up — no notifications yet." | NotificationsScreen.tsx | notifications_screen.dart ("notifications.empty") | PRESENT | |
| Error state | — | notifications_screen.dart | N/A | RN has none and shows the empty state. Flutter shows "loadError: $error". |
| Row: title, body (max 3 lines), timeAgo ("just now", "Xm/h/d ago", date) | NotificationsScreen.tsx | notifications_screen.dart (`_timeAgo`, ListTile) | PARTIAL | Body is not capped at 3 lines. |
| Unread styling: blue dot + tinted row background | NotificationsScreen.tsx, styles.ts | notifications_screen.dart | PARTIAL | Flutter uses a bell icon and bold title instead. No dot, no tinted background. |
| Tap → mark read | NotificationsScreen.tsx | notifications_screen.dart (`_onItemTap`) | PRESENT | Invalidates the whole list, so pagination resets to page 1. |
| Tap course-discussion reply → CourseItemPlayer(trackId, itemId, highlightPostId) | NotificationsScreen.tsx | notifications_screen.dart → `/courses/:trackId` | PARTIAL | Opens the course overview, not the item, and does not highlight the post. `courses/presentation/discussion/discussion_thread.dart` already supports `highlightPostId`, so the code comment about missing discussion UI is stale. |
| Infinite scroll, page size 25 | NotificationsScreen.tsx | features/notifications/data/notifications_repository.dart (`NotificationsController.loadMore`) | PRESENT | |
| Pull-to-refresh | NotificationsScreen.tsx | notifications_screen.dart (RefreshIndicator) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 9. AchievementsScreen — `screens/AchievementsScreen/**`
Tally: 8 present / 0 partial / 2 missing / 0 in-progress / 2 n-a

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
| Localized badge text (`languageCode` injected on `getAvailableBadges`) | services/api.ts, services/languageCodeEndpoints.ts | achievements_repository.dart (`/badges/me/available`, no languageCode) | MISSING | Badge names and descriptions are always in the default language. |
| Tap card → mark badge viewed | — | achievements_screen.dart | N/A | Flutter-only, a substitute for the missing popup. |
| Badge-unlock celebration popup (global `BadgePopup`/`useBadgePopup`, marks viewed on dismiss) | components/BadgePopup, hooks/useBadgePopup.ts | — (searched lib/ for BadgePopup/unviewed; only the repo call exists) | MISSING | Cross-cutting, not screen-local; listed here because it is the badge-viewed path. |
| Analytics events | — | — | N/A | None. |

#### 10. ProgressScreen — `screens/ProgressScreen/ProgressScreen.tsx`, `hooks/useProgressSummary.ts`, `components/ProgressHeaderWidget`
Tally: 7 present / 3 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: level ring in every TabScreenHeader → Progress (hidden on Progress itself) | components/ProgressHeaderWidget/ProgressHeaderWidget.tsx | features/progress/presentation/progress_header_widget.dart, core/widgets/tab_screen_header.dart | PRESENT | |
| Gate: VIEW_USER_RANK AND org progress-enabled | hooks/useProgressSummary.ts | features/progress/data/progress_repository.dart (`canViewProgressProvider`) | PRESENT | |
| Header "progress.title" | ProgressScreen.tsx | features/progress/presentation/progress_screen.dart | PRESENT | |
| Hero: LevelIndicator (a11y "progress.a11y.level"), "hero.level", "hero.toNextLevel" / "hero.maxLevel", progress bar, "hero.xpTotal" | ProgressScreen.tsx | progress_screen.dart (`_Hero`) | PRESENT | |
| Stats: lifetime minutes, sessions, track items | ProgressScreen.tsx | progress_screen.dart (`_StatsGrid`) | PRESENT | |
| Link "progress.rank.link" → Leaderboard (tab jump; does nothing without leaderboard permission) | ProgressScreen.tsx | progress_screen.dart → `push('/leaderboard')` | PARTIAL | Pushes a standalone leaderboard even for users without VIEW_COMMUNITY_LEADERBOARD. |
| Link "progress.badges.link" → Achievements | ProgressScreen.tsx | progress_screen.dart → `/achievements` | PRESENT | |
| When the gate is false RN still renders both link cards | ProgressScreen.tsx | progress_screen.dart (`dashboard == null` → blank) | PARTIAL | Flutter shows a blank screen. |
| Loading; error shown before empty | ProgressScreen.tsx | progress_screen.dart | PRESENT | |
| Refetch on every mount (`refetchOnMountOrArgChange`) | ProgressScreen.tsx | progress_repository.dart (`progressDashboardProvider`, not autoDispose) | PARTIAL | Cached across visits. Flutter adds pull-to-refresh instead. |
| `useTabBackToHomeHandler` on this stack screen | ProgressScreen.tsx | default pop | N/A | Equivalent effect: back leaves Progress. |
| Analytics events | — | — | N/A | None. |

#### 11. UserAnalyticsScreen (tab) — `screens/UserAnalyticsScreen/UserAnalyticsScreen.tsx`
Tally: 10 present / 1 partial / 1 missing / 0 in-progress / 1 n-a

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
| WebView `startInLoadingState` spinner; a failed URL is silently omitted | UserAnalyticsScreen.tsx | user_analytics_screen.dart | PARTIAL | No page-load indicator inside the WebView. A failed URL shows raw error text in its card. |
| Reset URLs when the user changes | UserAnalyticsScreen.tsx | analytics_repository.dart (provider rebuilds on auth or user change) | PRESENT | |
| Android back on the tab → first visible tab (`useTabBackToHomeHandler`) | hooks/useTabBackToHomeHandler.ts | — (no PopScope or back interception in core/navigation/app_shell_screen.dart) | MISSING | Same gap as in TabNavigator. |
| Analytics events | — | — | N/A | None. |

#### 12. LeaderboardScreen (tab) — `screens/LeaderboardScreen/LeaderboardScreen.tsx`, `hooks/useLeaderboard.ts`
Tally: 11 present / 2 partial / 1 missing / 0 in-progress / 1 n-a

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
| My-rank refetch on every screen focus (`useFocusEffect` → refetchMyRank) | useLeaderboard.ts | leaderboard_repository.dart (`myRankProvider` only rebuilds on a window change) | PARTIAL | Badge count and rank go stale when returning to the tab. Pull-to-refresh does not refresh them either. |
| Localized content (`languageCode` on `getLeaderboard`) | services/languageCodeEndpoints.ts | leaderboard_repository.dart | MISSING | |
| Weekly leaderboard notification tap → jump to the Leaderboard tab | navigation/RootNavigator.tsx | core/push/notification_navigation.dart → `/leaderboard` | PARTIAL | Pushes a standalone route over the shell instead of selecting the tab. |
| Analytics events | — | — | N/A | None. |

#### 13. CommunityScreen (tab) — `screens/CommunityScreen/CommunityScreen.tsx`
Tally: 1 present / 1 partial / 1 missing / 0 in-progress / 1 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_COMMUNITY | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| **On every focus**: goBack (to the previous tab) + open https://community.helloally.ai/ externally | CommunityScreen.tsx (`useFocusEffect`) | features/community/presentation/community_screen.dart (`initState` post-frame) | PARTIAL | Runs once only. The shell keeps visited tabs mounted (IndexedStack), so later taps do nothing. `context.pop()` cannot pop inside the shell, so a blank Community tab stays selected. |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | — | MISSING | See TabNavigator. |
| Analytics events | — | — | N/A | None. |

#### 14. SearchScreen (tab) — `screens/SearchScreen/**`, `hooks/useSearch.ts`, `components/ResourceArticleCard`
Tally: 12 present / 2 partial / 1 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_REFERENCE_DOCUMENT (also the fallback first tab) | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Launch view: header with Ally logo (+ hamburger if first tab), search input, "search.suggestionsTitle" + 4 suggestion chips | SearchScreen.tsx, components/SearchHeader.tsx, SearchSuggestions.tsx, searchConfig.ts | features/search/presentation/search_screen.dart (`_buildSearchLaunch`, `_SearchHeader`, `_SuggestionChip`) | PRESENT | |
| Focus animation: header up 60, input up 50, over 300ms; suggestions hidden while focused | SearchScreen.tsx | search_screen.dart (TweenAnimationBuilder) | PRESENT | The class doc saying "not ported" is stale; the code does it. |
| Tap outside → dismiss keyboard and unfocus | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Autocomplete dropdown under the input while typing | components/SearchInput.tsx, useSearch.ts | search_screen.dart (`_SearchBar`, `_onTextChanged`) | PRESENT | Divergence: Flutter filters with a 250ms debounce. RN never calls `debounceSearch`, so it always lists all 4. |
| Suggestion tap → search | useSearch.ts | search_screen.dart (`_search`) | PRESENT | |
| Submit → POST search (limit 6), category counts | useSearch.ts | features/search/data/search_repository.dart (pageSize 6) | PRESENT | |
| Clear (X) → reset search state | SearchInput.tsx, useSearch.ts (`resetSearch`) | search_screen.dart (`_resetSearch`) | PARTIAL | Flutter returns to the launch view. RN stays on the results view and shows the empty-plus-suggestions state. |
| Category tabs "All (n)" + "Category (n)", shown when there are results | SearchScreen.tsx (CustomTabs) | search_screen.dart (ChoiceChip row) | PRESENT | Different widget style. |
| Category change → refetch with `filters.category`, scroll to top | useSearch.ts | search_screen.dart (`_selectCategory`) | PRESENT | |
| Infinite scroll via `excludedIds` | useSearch.ts | search_screen.dart (`_loadMore`) | PRESENT | |
| Initial loader and footer loader | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Empty: 'search.noResults "query"' + suggestions | components/SearchEmpty.tsx | search_screen.dart | PRESENT | |
| **Result card** (ResourceArticleCard): category chip, horizontal tag chips, heading, 3-line content, "common.viewMore" expand/collapse | components/ResourceArticleCard | search_screen.dart (plain `ListTile`) | PARTIAL | 2-line content with no expand, so the full article text can never be read. No tags. Category is a trailing Chip. |
| Error handling | useSearch.ts (logs, shows the empty state) | search_screen.dart (red "search.error: $e") | N/A | Flutter-only state. |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | — | MISSING | See TabNavigator. |
| Analytics events | — | — | N/A | None. |

#### 15. ReactionsScreen — `screens/ReactionsScreen/**`, `hooks/useReactions.ts`
Tally: 9 present / 0 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: ReactionsCount on a review → Reactions {reviewId, reviewType} | screens/ReviewScreen/components/ReactionsCount.tsx | features/reviews/presentation/review_card.dart → `/reactions/:id` (on `parity/reviews` this moves to review_widgets.dart:667) | PRESENT | |
| Simulation vs scribe API by reviewType | ReactionsScreen.tsx (ReviewApiProvider) | features/reactions/presentation/reactions_screen.dart, features/reactions/data/reactions_repository.dart | PRESENT | |
| Header: back + "review.reactionsModal.title" | ReactionsScreen.tsx | reactions_screen.dart (AppBar) | PRESENT | Material AppBar styling. |
| Filter tabs: "All {total}" + emoji bubble with count, zero counts dropped, sorted by count descending, underline on the selected tab | components/ReactionFilterTabs.tsx | reactions_screen.dart (`_buildFilterTabs`, `_FilterTab`) | PRESENT | Flutter hides the whole row (including "All") while counts load or when empty. |
| Row: avatar or initial with an emoji bubble overlay, name | components/ReactionListItem.tsx | reactions_screen.dart (`_ReactionRow`) | PRESENT | |
| Pagination: 20 per page, threshold 0.3 | useReactions.ts | reactions_screen.dart (`_onScroll`) | PRESENT | |
| Filter change resets to offset 0 | useReactions.ts | reactions_screen.dart (`_selectReaction`, generation guard) | PRESENT | |
| Footer loader | ReactionsScreen.tsx | reactions_screen.dart | PRESENT | |
| Empty "review.reactionsModal.noReactionsYet" | ReactionsScreen.tsx | reactions_screen.dart | PRESENT | |
| Error state | — | reactions_screen.dart ("review.error.loadReactionsFailed") | N/A | Flutter-only. |
| Analytics events | — | — | N/A | None. |

#### 16. TabNavigator — `navigation/TabNavigator.tsx`, `constants/tabs.tsx`, `hooks/useTabBackToHomeHandler.ts`, `hooks/useTabScreenHeader.ts`
Tally: 7 present / 2 partial / 1 missing / 0 in-progress / 0 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| 8 tabs (Learn, CallLog, Review, UserAnalytics, Leaderboard, Achievements, Search, Community) with active/inactive icons; shown if the user has ANY listed permission | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Achievements tab only for reviewer-only users (VIEW_USER_BADGES without VIEW_COMMUNITY_LEADERBOARD) | TabNavigator.tsx, constants/tabs.tsx | tab_config.dart (`visibleTabsFor`, `isReviewerOnly`) | PRESENT | |
| Initial tab = first visible, falls back to Search | constants/tabs.tsx | tab_config.dart (`getFirstVisibleTab`), app_shell_screen.dart | PRESENT | |
| Render nothing while the user is loading | TabNavigator.tsx | core/navigation/app_shell_screen.dart (spinner while permissions load) | PRESENT | |
| Floating pill bar (60pt, radius 40, 30pt bottom margin, shadow); wider side margins when fewer than 3 tabs | TabNavigator.tsx | core/navigation/app_bottom_tab_bar.dart | PRESENT | |
| Lazy tab mount, tabs stay mounted | TabNavigator.tsx (`lazy`) | app_shell_screen.dart (`_visitedTabNames` + IndexedStack) | PRESENT | |
| Review tab unread dot = simulation unread + scribe unread > 0 (RTK tag-invalidated when reviews are read) | TabNavigator.tsx, services/reviewsApi.ts, services/scribeReviewsApi.ts | app_shell_screen.dart, features/reviews/data/reviews_repository.dart (`unreadReviewCountProvider`) | PARTIAL | Only `/scenario-session-reviews/unread-count`; the scribe count is ignored. Only fetched for `simulationReviewerAccess`. Never invalidated, so the dot does not clear after reading. `parity/reviews` does not change this. |
| Android hardware back on a tab root → first visible tab instead of exiting (Search, Community, UserAnalytics) | hooks/useTabBackToHomeHandler.ts | — (searched lib/ for PopScope, BackButtonListener, first-tab logic; nothing in core/navigation) | MISSING | Back on any `/home` tab exits the app. |
| Hamburger only on the first visible tab's header | hooks/useTabScreenHeader.ts | core/navigation/drawer_menu_button.dart (`DrawerMenuScope`) | PRESENT | |
| Permissions fetch failure | (RN treats it as an empty permission list) | app_shell_screen.dart (raw `Text('$error')`) | PARTIAL | Raw error text with no retry. RN degrades to the fallback tab set. |


### Parity ledger — Scribe screens (CallLog, CallSummary, Listening, Breathing)

RN source of truth: `ally-platform/ally-mobile/src` (screens/CallLog, screens/CallSummaryScreen, screens/ListeningScreen, screens/BoxBreathingScreen + hooks useSummaryState, useCallSummaryActions, useCallSummaryForm, useCallTranscriptDetails, useListeningCommon, useListeningScreen, useLiveAudioStream, useSocketConnection, useSocket, useToggleReviewPrivacy, useHideReviewDetails, utils/fieldRenderer.tsx, constants/summary.ts).
Flutter: `ally-mobile-flutter` `master` (lib/features/calllog, lib/features/scribe, lib/features/boxbreathing, lib/core/realtime, lib/core/chat, lib/core/settings, lib/core/routing/app_router.dart). Branches checked: `parity/reviews` (touches share_for_review_screen + scribe_reviews_repository only), `parity/feedback` (no files in scope).
Every PARTIAL/MISSING below was confirmed by reading the named Flutter file(s), not a grep miss. Read-only audit; nothing built or run.

#### Tallies

| Screen | PRESENT | PARTIAL | MISSING | MERGED (was IN PROGRESS) | N/A | Rows |
|---|---|---|---|---|---|---|
| CallLog | 27 | 5 | 3 | 0 | 4 | 39 |
| CallSummaryScreen | 24 | 19 | 6 | 1 | 6 | 56 |
| ListeningScreen (Microphone + Conference) | 22 | 17 | 6 | 0 | 6 | 51 |
| BoxBreathingScreen ("Breathing") | 7 | 2 | 0 | 0 | 1 | 10 |
| **Overall** | **80** | **43** | **15** | **1** | **17** | **156** |

(Backend-call, toast and navigation appendices under each screen are cross-references and are not counted again in the tallies.)

Analytics: RN has **no** product-analytics calls in any of these screens/hooks (grep for track/capture/posthog/logEvent/analytics/mixpanel/amplitude/firebase across the four screens and their hooks returns nothing; the only "analytics" strings are i18n keys `analytics.types.*`). Each screen gets one N/A row for this. The only telemetry-like emit is the socket `SCRIBE_START_DIAGNOSTIC` event (Listening row L37).

---

#### 1. CallLog (`screens/CallLog/**`, 26 files)

Flutter: `lib/features/calllog/presentation/call_log_screen.dart`, `call_log_row.dart`, `call_log_filter_sheet.dart`, `call_tag_chip.dart`; `lib/features/calllog/data/call_log_repository.dart`, `custom_fields_filter.dart`, `custom_fields_repository.dart`; `lib/core/settings/settings_repository.dart`; `lib/core/widgets/illustrated_modal.dart`, `status_badge.dart`, `app_empty_state.dart`, `app_tab_view.dart`, `tab_screen_header.dart`.

Tally: PRESENT 27 · PARTIAL 5 · MISSING 3 · N/A 4

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| C1 | Header title "calls.header.title" + italic subtitle | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart (TabScreenHeader) | PRESENT | |
| C2 | Archive view mode: title `calls.menu.archives`, back arrow, no subtitle, `archive:true` list | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart (`_isViewingArchive`, `archivedCallLogsControllerProvider`) | PRESENT | |
| C3 | Actions menu (three dots → "Archives"), gated ARCHIVE_CALL_LOG + real tab + not in archive view | CallLogHeader.tsx (ActionsMenu) | call_log_screen.dart `_ActionsMenu` | PRESENT | |
| C4 | Refresh button with 600ms spin while fetching | CallLogHeader.tsx | call_log_screen.dart `_RefreshButton` | PRESENT | |
| C5 | Filter button + active-filter count badge (shown only for real/archived view + VIEW_CALL_LOGS) | CallLogHeader.tsx, utils/fieldFilters.ts `countActiveFilters` | call_log_screen.dart `_FilterButton`, call_log_repository.dart `CallLogFilterState.activeCount` | PARTIAL | Count semantics differ: RN counts the date range as 1 and duration range as 1; Flutter counts startDate, endDate, minDuration, maxDuration separately (a full date+duration filter shows 4 instead of 2). |
| C6 | Built-in filters: Date & Time (from/to), Duration (mins, min/max), Mode (Scribe/Dictation), Status (Generated/Processing/Error/No Audio), Channel (Live/Uploaded) → query params | CallLogFilterSheet.tsx, utils/fieldFilters.ts `getBuiltinFilterFields`/`buildBuiltinParams` | call_log_filter_sheet.dart, call_log_repository.dart `toQueryParameters` | PARTIAL | **Bug:** RN sends `minDuration/maxDuration = mins*60` (seconds; ally-be compares `details.callDuration` in seconds). Flutter sends the raw minutes value → filter returns wrong rows. Also clearing a date/duration text box does not clear the filter (`copyWith(x: null)` keeps the old value via `??`) until "Clear" is pressed. |
| C7 | Tags multiselect filter (options from GET /chats/tags, only if non-empty) | CallLogScreen.tsx (`useGetCallTagsQuery`), fieldFilters.ts | call_log_filter_sheet.dart `_tagsField`, call_log_repository.dart `getAllTags`/`callLogTagOptionsProvider` | PRESENT | Flutter additionally gates on VIEW_TAGS permission (RN gates the query on VIEW_CALL_LOGS; endpoint itself needs view:tags, so visible outcome is the same). |
| C8 | Tenant custom-field filters (filterable defs → multiselect/number/date/text), `fieldFilters` JSON param | fieldFilters.ts `getFilterFields`/`buildFieldFiltersParam`, CallLogFilterSheet.tsx | custom_fields_filter.dart, call_log_filter_sheet.dart `_customFieldsSection` | PRESENT | Flutter only shows them when `/settings/custom-fields-enabled` is true (RN fetches defs regardless). Class doc in call_log_screen.dart/call_log_repository.dart saying custom filters are "not ported" is stale. |
| C9 | Filter sheet draft lifecycle: reseed from applied state on open, Clear, Apply → refetch page 0 | CallLogFilterSheet.tsx, CallLogScreen.tsx `handleApplyFilters` | call_log_filter_sheet.dart, call_log_repository.dart `CallLogFilterController` (list controllers watch it) | PRESENT | |
| C10 | Real/Role-play pill tabs only when both VIEW_CALL_LOGS and VIEW_SCENARIO_SESSION | CallLogScreen.tsx (TabView) | call_log_screen.dart (AppTabView) | PRESENT | |
| C11 | `availableLogTypes` + initial-tab correction from permissions | CallLogScreen.tsx | call_log_screen.dart `_buildScreen` | PRESENT | |
| C12 | FeatureNotAvailable state (no TAB_PERMISSIONS): "Oops" title, `calls.appCurrentlyForCounsellors`, "Learn more" → `Linking.openURL(ALLY_WEB_URL)`, Alert `common.unableToOpenLink` on failure | CallLogScreen.tsx, components/FeatureNotAvailable/* | call_log_screen.dart (`_activeTab == null` branch) | MISSING | Flutter shows only a centred `calls.fallback.callEmptyTitle` text; no oops copy, no Learn-more CTA, no link-failure alert. |
| C13 | Real logs: GET /chats/call-logs, limit 10, offset paging, hasMore = page==10 | CallLogScreen.tsx, services/callsApi.ts | call_log_repository.dart `RealCallLogsController` (kCallLogPageSize=10) | PRESENT | |
| C14 | Simulation logs: GET /learn/scenario-sessions limit/offset | CallLogScreen.tsx, simulationsApi.ts | call_log_repository.dart `SimulationLogsController` | PRESENT | |
| C15 | Archived logs list (separate offset/hasMore) | CallLogScreen.tsx | call_log_repository.dart `ArchivedCallLogsController` | PRESENT | |
| C16 | Hide the ongoing call (`details.chatId === currentChat.chatId`) from the real list | CallLogScreen.tsx `fetchInitialRealLogs` | call_log_repository.dart `RealCallLogsController.build` | PRESENT | `currentChatProvider` is only set by active-chat discovery (core/chat/active_chat_discovery.dart), not by ScribeRecordingScreen itself. |
| C17 | Refetch all permitted lists on every screen focus (`useFocusEffect`) | CallLogScreen.tsx | call_log_screen.dart / call_log_repository.dart | PARTIAL | List providers are non-autoDispose `AsyncNotifierProvider`s; nothing invalidates them on return. After archiving/renaming in the summary, creating a note, or finishing a scribe session the list stays stale until manual refresh/pull/filter change. |
| C18 | Pull-to-refresh resets active list to page 0 | CallLogScreen.tsx `handleRefresh` | call_log_screen.dart `_InfiniteScrollListView` (RefreshIndicator) | PRESENT | |
| C19 | Infinite scroll (`onEndReachedThreshold 0.5`) + footer spinner | CallLogScreen.tsx | call_log_screen.dart `_InfiniteScrollListView` (200px threshold) | PRESENT | |
| C20 | First-page skeleton (CallLogSkeleton ×10) | CallLogScreen.tsx, components/CallLogSkeleton | call_log_screen.dart `_CallLogSkeleton` | PRESENT | Static blocks (no shimmer). |
| C21 | Empty state (NoCallLogsIcon, call vs sim titles, `audioCall.fallback.noActiveCallDesc`) | CallLogScreen.tsx (EmptyState) | call_log_screen.dart `_CallLogEmptyState` | PRESENT | |
| C22 | Error state = empty state (RN resets list to [] on failed fetch) | CallLogScreen.tsx | call_log_screen.dart (`error:` → `_CallLogEmptyState`) | PRESENT | |
| C23 | Row: title chain (summaryName → metadata.sessionName → chatId → `ID-{id}`), StatusBadge (incl. NO_AUDIO hexagon), eye icon only when enabled, date•time / scenario•date line | CallLogItem.tsx, StatusBadge.tsx | call_log_row.dart, core/widgets/status_badge.dart, call_log_repository.dart `CallLogItem.fromJson/logTitle` | PRESENT | |
| C24 | Single expanded row at a time (`expandedIdx`) via chevron; header greys when expanded | CallLogScreen.tsx `handleToggle`, CallLogItem.tsx | call_log_row.dart (`_expanded` per row) | PARTIAL | Expansion is per-row local state; several rows can be expanded simultaneously (RN collapses the previous one). |
| C25 | Expanded details: source label + colour (Live/Uploaded) `|`, Duration, Session score (hidden when 0), Mode, tag chips coloured by positivity_rating (clamped 1–5) | CallLogItem.tsx, Tag.tsx, constants TAG_COLORS, utils/callLog `getLogSourceLabelConfig` | call_log_row.dart, call_tag_chip.dart, call_log_screen.dart `_RealLogsList` | PRESENT | |
| C26 | Row disabled unless VIEW_CHAT_DETAILS (real/archived) / VIEW_SCENARIO_SESSION_DETAILS (sim) | CallLogScreen.tsx `renderItem` | call_log_screen.dart (`enabled:`) | PRESENT | |
| C27 | Nav real/archived row → CallSummary `{callId: details.chatId, fromLogs:true}` | CallLogScreen.tsx `handleItemPress` | call_log_screen.dart → `/call-log/:id` (extra CallLogItem), core/routing/app_router.dart | PRESENT | Route hard-requires `state.extra as CallLogItem` (see S1). |
| C28 | Nav sim row → SimulationFeedback `{scenarioSessionId, fromLogs:true}` | CallLogScreen.tsx | call_log_screen.dart → `/simulations/feedback/:id?fromLogs=true` | PRESENT | |
| C29 | Start-session FAB: shown if (START_CALL_PERMISSIONS or canCreateNote) and no current chat; grey when nothing offerable; when chat-types unknown, re-fetch and toast `common.somethingWentWrong` if nothing offerable | CallLogScreen.tsx | call_log_screen.dart `_StartSessionFab` + onPressed | PRESENT | |
| C30 | Re-ask GET /settings/chat-types on every focus (401-burst recovery) | CallLogScreen.tsx (`useFocusEffect(getVisibleChatTypes)`) | settings_repository.dart `visibleChatTypesProvider`; call_log_screen.dart | PARTIAL | Fetched once (FutureProvider); only re-asked when the FAB is pressed while the value is null. A cached failure/stale list is not refreshed on focus. |
| C31 | StartSessionModal: consent footer copy, "Start Scribe Mode" (if MICROPHONE_CHAT enabled), "Start Dictation Mode"/Create note (counsellor + scribe-note-creation-enabled), loading/disabled states, close X | StartSessionModal.tsx, CallLogScreen.tsx | call_log_screen.dart `_showStartSessionModal` (core/widgets/illustrated_modal.dart) | PRESENT | |
| C32 | Start Scribe: mic `check` → `request` each bounded to 30s, double-tap guard, BLOCKED/DENIED → microphone settings alert, error → toast `common.somethingWentWrong`, then navigate `Listening {isMicrophoneMode:true}` | CallLogScreen.tsx `handleVoiceRecording`, hooks/usePermissionAlert | call_log_screen.dart `_startScribeSession`, `_showMicrophoneSettingsAlert` → `/scribe` | PRESENT | |
| C33 | `checkCounselorChat()` (GET /chats/counsellor-chat) fired right before navigating to Listening | CallLogScreen.tsx, hooks/useCounselorChat | call_log_screen.dart | MISSING | Flutter navigates straight to `/scribe`; current-chat state is not primed. |
| C34 | Create note: POST /chats/note → close sheet → CallSummary `{callId, fromLogs:true}`; failure toast `calls.createNote.error` and sheet stays | CallLogScreen.tsx `handleCreateNote`, scribeNoteApi.ts | call_log_screen.dart `_createNote`, call_log_repository.dart `createNote` | PRESENT | |
| C35 | Android hardware back: exit app on first visible tab, else navigate to first visible tab | CallLogScreen.tsx (`useHardwareBackPressHandler`, `getFirstVisibleTab`) | call_log_screen.dart | MISSING | No PopScope/back handling on this screen; behaviour falls to the shell/router (not verified here). |
| C36 | `checkAuth()` on focus when no userData | CallLogScreen.tsx | — | N/A | Flutter auth/user state is app-global (core/auth); no per-screen re-check needed. |
| C37 | RetrySessionModal (max-active-users auto-retry) | components/RetrySessionModal/* | — | N/A | Lives in CallLog/components but is only used by SimulationDetails/SimulationPathDetails/CaseDetails screens (out of scope here). |
| C38 | Badge component | components/Badge/* | — | N/A | Exported but not rendered anywhere in RN. |
| C39 | Analytics/tracking | — | — | N/A | None in RN. |

Backend calls (CallLog): GET `/chats/call-logs` {limit, offset, archive, fieldFilters, startDate, endDate, minDuration, maxDuration, tags, mode, status, source} — Flutter PRESENT (minDuration/maxDuration unit bug, C6); GET `/chats/tags?offset=0` — PRESENT (no offset param sent); GET `/custom-fields/definitions` — PRESENT; GET `/learn/scenario-sessions` — PRESENT; GET `/settings/chat-types` — PRESENT; GET `/settings/scribe-note-creation-enabled` — PRESENT; POST `/chats/note` — PRESENT; GET `/chats/counsellor-chat` (pre-nav) — MISSING (C33).
Toasts/alerts (CallLog): `calls.createNote.error` (PRESENT), `common.somethingWentWrong` (PRESENT ×2), mic settings alert `simulationPage.allowMicrophone/microphonePrompt` (PRESENT), Alert `common.error`/`common.unableToOpenLink` (MISSING with C12).
Navigation targets: CallSummary, SimulationFeedback, Listening(isMicrophoneMode), first visible tab / exit app (C35 MISSING), external ALLY_WEB_URL (C12 MISSING).

---

#### 2. CallSummaryScreen (`screens/CallSummaryScreen/**`, 45 files + hooks)

Flutter: `lib/features/calllog/presentation/call_summary_screen.dart` (1880 lines), `voice_note_section.dart`, `voice_note_recorder.dart`; `lib/features/calllog/data/call_log_repository.dart`, `call_summary_fields.dart`, `custom_fields_repository.dart`; `lib/features/reviews/data/scribe_reviews_repository.dart`, `lib/features/reactions/data/reactions_repository.dart`, `lib/features/reviews/presentation/share_for_review_screen.dart`; `lib/core/widgets/confirmation_modal.dart`.

Tally: PRESENT 24 · PARTIAL 19 · MISSING 6 · IN PROGRESS 1 · N/A 6

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| S1 | Route params `callId`, `fromLogs`; `chatId = callId ?? currentChat.chatId` (live flow from Breathing passes none) | CallSummaryScreen.tsx | core/routing/app_router.dart `/call-log/:id`, call_summary_screen.dart | PARTIAL | Route does `state.extra as CallLogItem` — opening without `extra` (deep link/notification/restore) throws. No `fromLogs`/live-flow concept (affects S31, S48, S49). Breathing works around it by fetching the item first. |
| S2 | GET /chats/:id summary fetch + loading spinner | hooks/useSummaryState.ts, services/callSummaryApi.ts | call_log_repository.dart `callSummaryProvider`/`getCallSummary`; call_summary_screen.dart `_SummaryTab` | PRESENT | |
| S3 | Refresh on every re-focus after first (e.g. back from share/review screens) | CallSummaryScreen.tsx (`useFocusEffect` + `isFirstFocusRef`) | call_summary_screen.dart | PARTIAL | Only invalidated after its own actions (share/rename/archive/save/retry). Returning from the review-details FAB route does not refetch. |
| S4 | GET /settings/summary-fields (refetched on open) → `selectSummaryVisibleFields`: hide sections with no visible fields (except AdditionalNotes) and hide non-visible fields | CallSummaryScreen.tsx, CallSummaryDetails.tsx `renderSection`, SectionWrapper.tsx, services/settingsApi.ts | call_summary_screen.dart `_SectionCard` (comment: "not ported"); settings_repository.dart has no summary-fields call | MISSING | Every tenant sees all 18 sections and every field regardless of org form config. |
| S5 | Header: back arrow, "Session *Summary*" title, `#summaryName` or `-` | components/Header/Header.tsx | call_summary_screen.dart AppBar | PARTIAL | Header text and rename-dialog prefill read `widget.log.sessionName` (route extra), so after a successful rename the header keeps the old name until the screen is reopened. Material AppBar + TabBar rather than RN custom header. |
| S6 | Share switch visible only when summary available + status SUCCESS + transcript present + not archived | Header.tsx, CallSummaryScreen.tsx | call_summary_screen.dart `showShareSwitch` | PRESENT | |
| S7 | Share toggle: ON with no review or review <10 min old → ShareCallLog screen; otherwise PATCH scribe review status IN_REVIEW/HIDDEN, toasts `simulationPage.privacyUpdated` / `simulationPage.errorUpdatePrivacy`, then refresh | CallSummaryScreen.tsx `handleShareToggle`, hooks/useToggleReviewPrivacy.ts, services/scribeReviewsApi | call_summary_screen.dart `_handleShareToggle`, scribe_reviews_repository.dart `updateReviewStatus` | PRESENT | |
| S8 | ShareCallLog nav params `{scribeSessionId, reviewId, sessionData:{title (summaryName ‖ review.feedCard.sharedSimulationForReview), createdAt (details.startTime ‖ createdAt), duration (formatDurationFromSeconds)}, note}` | CallSummaryScreen.tsx `handleShareForReview` | call_summary_screen.dart → `/share-for-review/:id` | PARTIAL | Flutter passes `contextDateTime: null`, `contextDuration: null` (context card shows no date/duration) and title `log.sessionName` with no translated fallback. |
| S9 | ShareCallLog (scribe) screen itself | screens/ShareCallLog (out of folder, entry from here) | lib/features/reviews/presentation/share_for_review_screen.dart | MERGED (was IN PROGRESS on parity/reviews) | Branch `parity/reviews` rewrites share_for_review_screen.dart + scribe_reviews_repository.dart (scribe create → pushReplacement to review, context rows). Not merged to master. |
| S10 | Menu → Rename (CustomModal with input; PATCH /chats/:id/call-info `{summaryName}`; toasts `callSummary.info.summaryNameUpdateSuccess/Failed`) | SummaryModals.tsx, DeleteRenameModal.tsx, hooks/useCallSummaryActions.ts | call_summary_screen.dart `_showRenameDialog`, call_log_repository.dart `updateSummaryName` | PRESENT | AlertDialog instead of CustomModal; see S5 stale header. |
| S11 | Menu → Export (only when summary available): storage permission, GET /chats/:id/export-summary (string), save file, toasts `fileExportedSuccess` / `fileExportFailed` / invalid format | SummaryModals.tsx, useCallSummaryActions.ts `handleExport`, hooks/useStoragePermissions.ts, utils/fileOperations `saveFile` | call_summary_screen.dart (menu has rename/dataPolicy/archive only) | MISSING | No export-summary call anywhere in lib/. |
| S12 | Menu → Data policy (opens PRIVACY_POLICY_URL) | SummaryModals.tsx | call_summary_screen.dart (`launchUrl(_privacyPolicyUrl)`) | PRESENT | |
| S13 | Menu → Archive/Unarchive with ConfirmationModal (destructive for archive), PATCH /chats/call-logs/:id/archive, success/failed toasts | SummaryModals.tsx, ArchiveActionModal.tsx, useCallSummaryActions.ts `handleArchive` | call_summary_screen.dart `_handleArchiveToggle`, core/widgets/confirmation_modal.dart | PRESENT | Archive state change is not pushed to the call-log list (C17). |
| S14 | Delete summary (CustomModal → PUT call-details `{summary:{}}` → goBack after 2s) | DeleteRenameModal.tsx, useCallSummaryActions.ts `handleDelete` | — | N/A | Unreachable in RN: the menu options never set `activeModal='delete'`. |
| S15 | SummaryDropdown (summary/transcript switcher) | Header/SummaryDropdown.tsx | — | N/A | Not rendered by Header.tsx. |
| S16 | Tabs Summary / Transcript; Transcript tab only if chatId && !403 && VIEW_MESSAGES | CallSummaryScreen.tsx (`showTranscriptTab`) | call_summary_screen.dart (DefaultTabController length 2) | PARTIAL | Transcript tab always shown — no VIEW_MESSAGES gate, and still shown on a 403. RN tabs are lazy with a placeholder spinner. |
| S17 | 403 → SummaryUnauthorized (image, `summary.notFoundTitle/Desc`, back button) | SummaryUnauthorized.tsx | call_summary_screen.dart `_SummaryUnauthorizedView` | PRESENT | Lock icon instead of `summaryFailed` image. |
| S18 | Generation in progress: Lottie animation, ShinyText cycling SUMMARY_GENERATION_STEPS every 3s (full list live / tail from logs), transient "transcription deleted" shield row (5s), ETA `summaryLoading.estimatedTime`, live vs logs copy (`processingDescMain`/`…2`), success image + `summaryLoading.generated`, 3s "Setting up" hold after summary appears (`canShowSummary`) | SummaryGenerationProgress.tsx, useSummaryState.ts | call_summary_screen.dart `_GenerationProgressView` | PARTIAL | Only a spinner + `processingDescMain2` text. No steps, ETA, Lottie, transcription-deleted notice, generated state, or setting-up delay. |
| S19 | FAILED and NO_AUDIO states (no-audio tag, failed title) | SummaryGenerationProgress.tsx | call_summary_screen.dart `_GenerationProgressView` | PRESENT | Material icons instead of `summaryFailed` image. |
| S20 | Buttons under progress: "See if ready" (refresh) / "Retry" (POST /chats/:id/retry-summary + toasts `retryStarted`/`retryFailed`/server message) / "Setting up…" text, hidden for NO_AUDIO; "Check later" → clear currentChat + go to Call Log tab | CallSummaryScreen.tsx `renderSummaryButtons`, `handleRetrySummary`, `onViewCallLogs` | call_summary_screen.dart `_retrySummary`, `_refresh`, `_GenerationProgressView` | PARTIAL | "Check later" just `maybePop()` (no clear of current chat, no navigation to Call Log tab — from the live flow it returns to the breathing screen). |
| S21 | AddNotesSection while generating: collapsible "Add notes", info tooltip, debounced (1s) POST /chats/:id/notes `{content}` | SummaryGenerationProgress/AddNotesSection.tsx, useSummaryState.ts `handleNoteChange`, chatApi `updateNotes` | — (no `/notes` call or `summaryLoading.addNotes` usage in lib/) | MISSING | Counsellors cannot jot notes while the summary is generating. |
| S22 | AI-generated warning banner (GoldenShield) above sections | CallSummaryDetails.tsx | call_summary_screen.dart (amber banner) | PRESENT | |
| S23 | Exclusive accordion; toggling blocked while another section is editing; collapsing the editing section exits edit | CallSummaryDetails.tsx `toggleSection`, SectionHeader.tsx | call_summary_screen.dart `_toggleSection`, `_SectionCard` | PRESENT | Material icons for section icons. |
| S24 | Edit gate `section.canEdit && (MANAGE_CUSTOM_FIELD_DEFINITIONS admin || counselorId === me)` | SectionWrapper.tsx | call_summary_screen.dart `_SectionCard` (`canEdit`) | PRESENT | |
| S25 | Edit → Wand (canEnhance) / Tick (save) / Close (reset section) controls with animation | SectionHeader.tsx, SectionWrapper.tsx | call_summary_screen.dart `_SectionCard`, `_onTickPress`, `_onClosePress` | PRESENT | No fade/slide animation. |
| S26 | AI enhance: POST /chats/enhance `{content}` for the section's editable field; pulsing field while enhancing; toast `summary.enhanceFailed` on error/empty | SectionWrapper.tsx, EditableField.tsx | call_summary_screen.dart `_onWandPress`, call_log_repository.dart `enhanceCallSummary` | PRESENT | Spinner replaces wand instead of pulsing text. |
| S27 | Built-in field renderers: Text (read-only), InlineTextInput, MultilineTextInput (EditableField), Dropdown (CustomDropdown) with localized labels/options | utils/fieldRenderer.tsx, FieldRow.tsx, EditableField.tsx, GenericSectionContent.tsx, constants/summary.ts | call_summary_screen.dart `_FieldEditor`, call_summary_fields.dart | PRESENT | |
| S28 | Location = SearchableLocationDropdown (places search) | utils/fieldRenderer.tsx (`FieldType.SearchableDropdown`), services/placesApi.ts | call_summary_fields.dart (`location` as plain text) | PARTIAL | Free text only; no `/places/search` lookup. |
| S29 | Tags field edit → submit as array of names (`transformFormDataForSubmission` + `tagNames`) | hooks/useCallSummaryForm.ts, utils/formDataTransformer.ts | call_summary_screen.dart `_saveBuiltinFields`, call_log_repository.dart `updateCallSummary` | PARTIAL | **Bug:** Flutter sends `summary.tags` as the comma-joined display string. ally-be `normalizeTags` only accepts arrays, so the string passes through the merge and overwrites `summary.tags` with a string (breaks tag chips/filters everywhere). |
| S30 | Read transform: dominantFeelings array → ", " string; tags → names; additionalNotes from callInfo.notes; computed read-only fields | utils/formDataTransformer.ts `transformSummaryToFormData`, constants/summary.ts computeValue | call_log_repository.dart `CallSummaryDetails.fromJson` | PARTIAL | Tags/notes/computed fields handled; `dominantFeelings` arrays are not joined (rendered via `toString()` as `[a, b]`); duration/date/time computed fields shown raw (no formatting like RN's `formatDurationFromSeconds`/date formatters). |
| S31 | Global Save button: shown when `(!callId || hasChanges)` and feedback popup closed; after save, opens summary-feedback popup (if no feedback, EDIT_SUMMARY_FEEDBACK, not manual note) | CallSummaryScreen.tsx `onSaveButtonPress`, CallSummaryDetails.tsx | call_summary_screen.dart `_save` | PARTIAL | Shown only when dirty (never always-on for the live flow), never opens the feedback popup after save; adds a success snackbar RN doesn't show. |
| S32 | Unsaved edits survive refetch; seed per chat | useCallSummaryForm.ts | call_summary_screen.dart `_seedIfNeeded` | PRESENT | |
| S33 | Section close resets that section's built-in fields to saved values | useCallSummaryForm.ts `handleSectionFieldsReset` | call_summary_screen.dart `_resetSectionFields` | PRESENT | |
| S34 | Custom fields: `/settings/custom-fields-enabled` gate, GET definitions, GET values/:chatId (seed once), per-section PUT values/:chatId on tick, toast `summary.customFieldSaveFailed` | CallSummaryDetails.tsx, services/customFieldsApi.ts | call_summary_screen.dart `_seedCustomFieldsIfNeeded`/`_saveCustomFieldsForSection`, custom_fields_repository.dart, settings_repository.dart | PRESENT | |
| S35 | Custom field editPermission BOTH / ADMIN_ONLY / COUNSELLOR_ONLY | CustomFieldsSection.tsx `canEditField` | call_summary_screen.dart `_canEditCustomField` | PRESENT | |
| S36 | Custom field renderers TEXT, NUMBER (numeric kb), SINGLE_SELECT (dropdown by label), BOOLEAN (Yes/No → 'true'/'false'), MULTI_SELECT (modal with checkboxes, JSON array) | CustomFieldsSection.tsx | call_summary_screen.dart `_CustomFieldEditor` | PRESENT | |
| S37 | Custom field DATE: display via `formatCustomFieldDate`, edit value normalized by `normalizeCustomFieldDate` to YYYY-MM-DD | CustomFieldsSection.tsx (utils customFieldDate) | call_summary_screen.dart `_CustomFieldEditor` (date → plain TextFormField, hint YYYY-MM-DD) | PARTIAL | Raw stored value shown/edited; no formatting or normalization (ISO timestamps display verbatim; free text saved unvalidated). |
| S38 | Manual note detection latched for the screen's lifetime (`isManualNoteRef`) | useSummaryState.ts | call_log_repository.dart `CallSummaryDetails.isManualNote` (getter) | PARTIAL | Not latched: after the first save creates a summary object, `isManualNote` flips false on refetch → VoiceNoteSection disappears and the back-press AI-feedback prompt can trigger on a manual note. |
| S39 | VoiceNoteSection gate: `/settings/scribe-voice-note-enabled` + COUNSELOR_ACCESS + chatId + ≥1 voice field; "Record" CTA | VoiceNotePanel/VoiceNoteSection.tsx, hooks/useScribeVoiceNoteEnabled.ts | voice_note_section.dart | PRESENT | |
| S40 | VoiceNotePanel states: recording/paused (dot, m:ss, pause/resume, stop), stopped (discard, generate), generating (rotating transcribing/extracting/populating every 2.2s) | VoiceNotePanel/VoiceNotePanel.tsx | voice_note_section.dart `_VoiceNotePanel` | PRESENT | |
| S41 | Recorder + mic-permission error → toast `calls.createNote.voice.micDenied` / `generateError`, close panel | hooks/useVoiceNoteRecorder.ts, VoiceNoteSection.tsx | voice_note_recorder.dart, voice_note_section.dart `_onRecorderChanged` | PRESENT | |
| S42 | Generate: POST /chats/note/generate-from-audio (multipart audio + fields catalog of *visible* editable built-ins + editable custom fields), apply built-ins via PUT call-details (tags as names) | VoiceNoteSection.tsx `handleGenerate`/`applyGeneratedValues`, scribeNoteApi.ts | voice_note_section.dart `_handleGenerate`, `_voiceFieldCatalog`; call_summary_screen.dart `_applyVoiceValues` | PARTIAL | Catalog is all editable built-ins (no visible-fields filter, S4), no custom fields, and extracted `tags` are saved as a raw string (same corruption as S29). |
| S43 | Voice custom-field values: `encodeVoiceCustomValue` (select label match, multiselect JSON, boolean yes/no, spoken date → YYYY-MM-DD) + PUT custom-fields values + remount form | VoiceNoteSection.tsx | — | MISSING | Repository doc confirms custom fields are not sent/applied. |
| S44 | Transcript accumulation: seed from existing `details.transcript`, append new spoken text, PUT /chats/:id/transcript (best effort) | VoiceNoteSection.tsx (`transcriptRef`), scribeNoteApi `saveNoteTranscript` | voice_note_section.dart (`_transcript`), call_log_repository.dart `saveNoteTranscript` | PARTIAL | `_transcript` starts empty every time the screen opens — a second dictation session on an existing note PUTs only the new text and overwrites the earlier transcript. |
| S45 | Voice toasts: generated / nothingExtracted / noSpeech (NO_SPEECH_DETECTED) / generateError; keep panel for retry on failure | VoiceNoteSection.tsx | voice_note_section.dart | PRESENT | |
| S46 | Transcript tab UI: SummaryCard titled `callSummary.header.transcript`, per-item mm:ss time (WEBRTC: createdAt−start; else startSeconds), speaker label You/Client, blue/purple bordered cards, DICTATION mode = one merged white block, EmptyTranscript component | CallTranscript.tsx, CallTranscriptItem.tsx, hooks/useCallTranscriptDetails.ts | call_summary_screen.dart `_TranscriptTab` | PARTIAL | Plain chat bubbles (left/right by senderId == counselorId), no times, no labels, no dictation merge, `transcription.empty` text instead of EmptyTranscript. (A matching `CallTranscriptItem` widget exists in lib/features/scribe/presentation/call_transcript_item.dart but isn't used here.) |
| S47 | Transcript pagination: GET /chats/:id/messages {limit 20, offset, sortOrder ASC, sortBy createdAt (WEBRTC) / startSeconds}, load more on end reached, footer spinner | useCallTranscriptDetails.ts, services/callTranscriptApi.ts | call_log_repository.dart `getChatMessages` (no params) | MISSING | Single unparameterised request → backend default page/order only; long calls show a truncated and possibly mis-ordered transcript. |
| S48 | Back-press summary-feedback prompt: summary shown, not manual note, no feedback yet, EDIT_SUMMARY_FEEDBACK, and (≥30s on screen **or** not from logs) | CallSummaryScreen.tsx `onBackNavigation` | call_summary_screen.dart `_handleBackPress` | PARTIAL | Only the 30s condition; the live-flow (`!fromLogs`) immediate prompt is missing. |
| S49 | `handleGoBack`: from logs → goBack; live flow → reset stack to CallLog + `clearCurrentChat` | useCallSummaryActions.ts | call_summary_screen.dart (`context.pop()`) | MISSING | Always pops; from the live flow this returns to the breathing screen and leaves current-chat state set. |
| S50 | FeedbackPopup: stars, rating-dependent tag chips, issue chips (FEEDBACK_ISSUE_OPTIONS for 2–4), comment; POST /chats/:id/summary-feedback `{rating, feedback:{issues, comment, tags}}`; toasts `callFeedback.submitted` / `summaryLoading.summaryFeedbackSubmittedFailed`; close + go back | components/FeedbackPopup/FeedbackPopup.tsx, SummaryModals.tsx, CallSummaryScreen.tsx | call_summary_screen.dart `_SummaryFeedbackPopup`, `_submitFeedback`; call_log_repository.dart `addSummaryFeedback` | PARTIAL | Issue chips not rendered; selected rating tags are collected but never submitted (`onSubmit(rating, comment)`), and `issues` always `[]`. |
| S51 | View-review FAB (CommentIcon) when reviewId && !hideReviewDetails && VIEW_SCRIBE_REVIEW && !archived; hide private reviews with no threads (GET threads limit 1) and no reactions (GET reactions count) | CallSummaryScreen.tsx, hooks/useHideReviewDetails.ts | call_summary_screen.dart `_checkHideReviewDetails`, scribe_reviews_repository.dart, reactions_repository.dart | PRESENT | |
| S52 | FAB navigates to ScribeReviewDetails `{reviewId, isPrivate}` | CallSummaryScreen.tsx `handleViewReview` | call_summary_screen.dart → `/reviews/:id` (extra ReviewType.scribe) | PARTIAL | `isPrivate` not passed. |
| S53 | Clear summary Redux slice on unmount | useSummaryState.ts (`clearSummaryStates`) | — | N/A | Flutter keeps form state in the widget; nothing global to clear. |
| S54 | POST /chats/summary/tag-positivity-ratings (`useGetTagsMutation`) | services/callSummaryApi.ts | — | N/A | Exported but never called in RN (ratings moved server-side). |
| S55 | FlowSection, KeyConcernSection, NotesSection components | components/FlowSection, KeyConcern, CallSummaryDetails/NotesSection.tsx | — | N/A | Not rendered anywhere in RN. |
| S56 | Analytics/tracking | — | — | N/A | None in RN. |

Backend calls (CallSummary): GET `/chats/:id` PRESENT · GET `/settings/summary-fields` MISSING (S4) · PUT `/chats/:id/call-details` PRESENT (tags payload bug S29) · PATCH `/chats/:id/call-info` PRESENT · GET `/chats/:id/export-summary` MISSING (S11) · PATCH `/chats/call-logs/:id/archive` PRESENT · POST `/chats/enhance` PRESENT · POST `/chats/:id/retry-summary` PRESENT · POST `/chats/:id/summary-feedback` PARTIAL (S50) · POST `/chats/:id/notes` MISSING (S21) · GET `/chats/:id/messages` PARTIAL/MISSING params (S47) · GET `/settings/custom-fields-enabled`, GET `/custom-fields/definitions`, GET/PUT `/custom-fields/values/:chatId` PRESENT · GET `/settings/scribe-voice-note-enabled` PRESENT · POST `/chats/note/generate-from-audio` PARTIAL (S42) · PUT `/chats/:id/transcript` PARTIAL (S44) · PATCH `/scribe-session-reviews/:id` (status) PRESENT · GET scribe review threads (limit 1) PRESENT · GET scribe reactions count PRESENT.
Toasts: summaryNameUpdateSuccess/Failed, archive/unarchive success/failed, privacyUpdated/errorUpdatePrivacy, retryStarted/retryFailed, enhanceFailed, customFieldSaveFailed, callFeedback.submitted / summaryFeedbackSubmittedFailed, voice.* — all PRESENT; fileExportedSuccess / fileExportFailed MISSING (S11). Flutter adds `summaryUpdatedSuccess` snackbar and inline `summaryUpdateFailed` text (RN shows neither for the global save).
Navigation targets: ShareCallLog (PARTIAL S8, IN PROGRESS S9), ScribeReviewDetails (PARTIAL S52), CallLog tab reset (MISSING S49/S20), goBack (PRESENT).

---

#### 3. ListeningScreen (`screens/ListeningScreen/**`, 39 files) — Microphone (Scribe) + Conference

Flutter: `lib/features/scribe/presentation/scribe_recording_screen.dart`, `conference_listening_screen.dart`, `listening_controls.dart`, `nudge_section.dart`, `network_disconnected.dart`, `audio_waveform.dart`, `elapsed_timer.dart`, `dismissable_banner.dart`, `call_transcript_item.dart`; `lib/features/scribe/data/transcript_logic.dart`, `chat_models.dart`, `chat_repository.dart`; `lib/core/realtime/socket_service.dart`, `socket_events.dart`, `foreground_recording_service.dart`; `lib/core/chat/active_chat_discovery.dart`, `current_chat_provider.dart`; `lib/core/routing/app_router.dart` (`/scribe`, `/conference-listening/:chatId`).

Tally: PRESENT 22 · PARTIAL 17 · MISSING 6 · N/A 6

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| L1 | Mode routing: microphone if `isMicrophoneMode` param or chat provider MICROPHONE, else conference | ListeningScreen.tsx | app_router.dart (`/scribe`, `/conference-listening/:chatId`), active_chat_discovery.dart `targetRouteForActiveChat` | PRESENT | |
| L2 | Auto-start live mic stream on mount (16 kHz, mono, 16-bit, bufferSize 1024) | MicrophoneListeningScreen.tsx, hooks/useLiveAudioStream.ts | scribe_recording_screen.dart `_start` (record `startStream` pcm16) | PRESENT | |
| L3 | Mic permission on screen: request if needed; denied → settings alert (Cancel → goBack, OK → openSettings); re-check when app returns active | useLiveAudioStream.ts `checkPermission`, AppState listener | scribe_recording_screen.dart `_start` / `_buildBody` | PARTIAL | Denied → static red `errors.permission` text; no settings deep-link alert, no re-check on resume. |
| L4 | Socket.IO to MICROPHONE_SOCKET_PATH, websocket+polling, auth callback with fresh token, reconnection 5 / 1–5s | hooks/useSocket.ts, useSocketConnection.ts | core/realtime/socket_service.dart | PRESENT | |
| L5 | Mic socket not torn down on background (`disconnectOnBackground:false`) | MicrophoneListeningScreen.tsx | socket_service.dart (no lifecycle disconnect) | PRESENT | |
| L6 | SESSION_CREATED → once permission + session ready, emit START_AUDIO_CHAT `{isLinear16Encoded, platform MOBILE, sampleRate, mode SCRIBE}` | MicrophoneListeningScreen.tsx, utils/audioUtils.ts `getStartAudioChatPayload` | scribe_recording_screen.dart `_maybeEmitStartAudioChat` | PRESENT | |
| L7 | USER_JOINED: take `payload.chatId` immediately (`setCurrentChatId`), then hydrate via GET /chats/counsellor-chat | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_onUserJoined` | PARTIAL | Flutter ignores `payload.chatId` and waits for the GET — the exact race RN fixed (prod: chat created but client still had no id at 5s/15s → false "Microphone failure"). |
| L8 | 5s without chatId → MICROPHONE_FAILURE view | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_chatIdTimeoutTimer` | PRESENT | |
| L9 | AUDIO_MESSAGE `{audioData base64, chatId}` emitted when not paused and chatId known; never gated on socket.connected | MicrophoneListeningScreen.tsx `handleAudioData` | scribe_recording_screen.dart `_onAudioChunk` | PRESENT | |
| L10 | Web-microphone mode (chat provider MICROPHONE + platform WEB): no local streaming, pause disabled, no network/socket disconnect states | useListeningCommon.ts, useListeningScreen.ts, MicrophoneListeningScreen.tsx | scribe_recording_screen.dart | MISSING | Flutter always streams/emits START_AUDIO_CHAT; opening a web-started session on mobile would compete for the same chat. |
| L11 | Starts paused (`isCallPaused=true`) with mute tooltip visible ("Resume to let it listen") until resume or dismiss | MicrophoneListeningScreen.tsx, ListeningControls.tsx | scribe_recording_screen.dart (`_isMuteTooltipOpen = false`), listening_controls.dart | PARTIAL | Tooltip widget exists but `_isMuteTooltipOpen` initialises false and is never set true → the prompt never appears while the session silently sends no audio. |
| L12 | Pause/Resume debounced 500ms | MicrophoneListeningScreen.tsx (`useDebounce`) | scribe_recording_screen.dart `_togglePauseResume` | PARTIAL | No debounce (rapid taps toggle repeatedly). |
| L13 | MESSAGE_RECEIVED (TEXT) / UTTERANCE_ENDED interim-final merge, split by sender | useListeningCommon.ts `processTranscription`/`updateLastTranscription` | transcript_logic.dart, scribe_recording_screen.dart | PRESENT | |
| L14 | Rehydrate existing chat messages (TEXT, reversed, split mine/theirs) | MicrophoneListeningScreen.tsx | transcript_logic.dart `rehydrateTranscriptions` (on USER_JOINED) | PRESENT | |
| L15 | NUDGE event → 500ms loading → current nudge | MicrophoneListeningScreen.tsx, ConferenceListeningScreen.tsx | scribe_recording_screen.dart / conference_listening_screen.dart `_onNudge` | PRESENT | |
| L16 | Nudge shown only in non-focus mode and when GET /settings/nudge-status true | both screens | scribe_recording_screen.dart, conference_listening_screen.dart (`nudgeStatusProvider`) | PRESENT | |
| L17 | Nudge content rendered with CustomMarkdown; SkeletonLoader while loading; scrollable | NudgeSection.tsx, CustomMarkdown.tsx, SkeletonLoader.tsx | nudge_section.dart | PARTIAL | Plain `Text(nudge.content)` (markdown shows raw), spinner instead of skeleton, no scroll cap. |
| L18 | Nudge feedback: "Is this helpful?" always shown; thumbs only with EDIT_MESSAGE_FEEDBACK; POST /chats/messages/:id/feedback or PATCH /chats/messages/feedback/:feedbackId; skip same rating; leading debounce | NudgeSection.tsx, chatApi.ts | nudge_section.dart, chat_repository.dart | PARTIAL | Without permission Flutter hides the "Is this helpful?" text too; re-tapping the same rating re-submits. |
| L19 | CHAT_ENDED → replace with Breathing (only when focused) | useListeningCommon.ts `handleCallEndRedirection` | scribe_recording_screen.dart `_onCallEndedByServer` → `/box-breathing?chatId=` | PRESENT | |
| L20 | End-session confirmation (IllustratedModal, EndSessionIcon, mic copy `audioCall.endDialog.*`) | CallEndConfirmationModal.tsx | scribe_recording_screen.dart `_showEndConfirmation` (core/widgets/illustrated_modal.dart) | PRESENT | No EndSessionIcon illustration. |
| L21 | End call: stop stream, POST /chats/:id/end, navigate to Breathing on success **and** on error | useListeningCommon.ts `handleEndCall` + effect | scribe_recording_screen.dart `_endSession` | PARTIAL | On API error Flutter stays on the screen showing `errors.endSimulation: …` (recorder/foreground service already stopped). |
| L22 | Back: no live session → clear currentChat + goBack; live → open end confirmation | MicrophoneListeningScreen.tsx `handleHardwareBackPress`, useListeningCommon `handleGoBack` | scribe_recording_screen.dart `_handleBackPress`, PopScope | PRESENT | Doesn't clear `currentChatProvider` on leave. |
| L23 | "Connecting…" state with a Cancel button (dark theme) | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_buildBody` | PARTIAL | Spinner + text; no Cancel button (header back arrow is the only exit). |
| L24 | NetworkDisconnected view: icon, title/desc per SOCKET/NETWORK/MICROPHONE_FAILURE, "Try again" hidden when offline, "Go back" | NetworkDisconnected.tsx | network_disconnected.dart | PARTIAL | No illustration; caller hard-codes `isOffline:false`; SOCKET title uses `common.offline.socketTitle` vs RN `common.somethingWentWrong`. |
| L25 | Offline detection (NetInfo) → NETWORK type; socket disconnect classified NETWORK vs SOCKET by offline flag | hooks/useNetworkConnectivity.ts, MicrophoneListeningScreen.tsx | scribe_recording_screen.dart | MISSING | Every disconnect maps to `socket`; no connectivity monitoring. |
| L26 | Try again → clear disconnected state + go back | MicrophoneListeningScreen.tsx `handleTryAgain` | scribe_recording_screen.dart `_handleTryAgain` | PRESENT | |
| L27 | Focus layout: lock icon + privacy tooltip (`audioCall.privacy.*` 4 bullets) + "Taking notes", timer, waveform, `listeningScreen.microphoneModeNote` | MicrophoneListeningScreen.tsx `renderFocusMode`, useListeningScreen.ts | scribe_recording_screen.dart `_buildBody`, `_showPrivacyInfo` | PRESENT | Dialog instead of tooltip; bullets use `listeningScreen.dataSafeTooltip.*` keys instead of `audioCall.privacy.*`. |
| L28 | Non-focus layout: compact label/timer + waveform row, nudge, Search, transcript ScrollView auto-scrolling to end | MicrophoneListeningScreen.tsx `renderNonFocusMode` | scribe_recording_screen.dart `_buildBody`/`_buildTranscript` | PARTIAL | Transcript doesn't auto-scroll to newest; single column layout; Search missing (L29). |
| L29 | Search (reference-document search: input, "Try" suggestions, category tabs, ResourceArticleCard list, paging, empty state; dark theme) in non-focus mode | components/Search/Search.tsx, hooks/useSearch.ts, services/searchApi (`/reference-document/search`, `/categories`) | — (lib/features/search exists but is not embedded here) | MISSING | Explicitly scoped out in scribe_recording_screen.dart doc. |
| L30 | Live transcript item: mm:ss since chat start, speaker label You/Client, coloured by sender | MicrophoneListeningScreen.tsx `getElapsedSeconds`, CallTranscriptItem | scribe_recording_screen.dart `_buildTranscript`/`_elapsedLabel`, call_transcript_item.dart | PARTIAL | `speakerLabel` never passed (no You/Client), time shown as HH:MM:SS. |
| L31 | Timer HH:MM:SS from chat.startedAt | Timer/Timer.tsx, useListeningScreen.ts `startTime` | elapsed_timer.dart | PRESENT | |
| L32 | Waveform: 120ms frames from latest amplitudes, silent when paused, focus vs compact sizes, `shapeAmplitudes` edge taper, iOS gain | AudioWaveformContainer.tsx, AudioWaveform.tsx, utils/audioUtils.ts | audio_waveform.dart | PARTIAL | Taper shaping deliberately omitted (cosmetic, per file doc). |
| L33 | ListeningControls: CollapsibleButtonGroup (maximise/minimise toggle), pause/resume (icon+label, active variant), Focus (VIEW_REFERENCE_DOCUMENT), End session (red square), "data safe" shield footer | ListeningControls.tsx (components/CollapsibleButtonGroup) | listening_controls.dart | PARTIAL | Stacked full-width AppButtons, no collapse/maximise, no icons. |
| L34 | Keep screen awake while listening (activate/deactivateKeepAwake) | useListeningCommon.ts | — (no wakelock package; foreground service `allowWakeLock` is a CPU lock only) | MISSING | Screen can sleep/lock mid-session. |
| L35 | App returns to foreground → (500ms) GET /chats/counsellor-chat; none → redirect to Breathing | useListeningCommon.ts AppState effect | core/chat/active_chat_discovery.dart (global; treats listening routes as exempt and does nothing) | MISSING | A session ended while backgrounded leaves the counsellor on the live screen. |
| L36 | iOS swipe-back disabled for mic mode (`gestureEnabled:false`) | useListeningCommon.ts | scribe_recording_screen.dart PopScope(`canPop: !_hasLiveSession`) | PRESENT | |
| L37 | SCRIBE_START_DIAGNOSTIC socket emit at 5s/15s with gate booleans + app version | MicrophoneListeningScreen.tsx | — | MISSING | Deliberately scoped out (RN marks it temporary), but it is the only start-failure telemetry. |
| L38 | Android foreground service + notification permission | — (RN has none) | foreground_recording_service.dart, scribe_recording_screen.dart | N/A | Flutter-only addition. |
| L39 | Full-screen dark UI, translucent light status bar, no header | MicrophoneListeningScreen.tsx, styles.ts | scribe_recording_screen.dart (light Scaffold + TabScreenHeader `scribe.title`) | PARTIAL | Visual divergence (light theme, extra header). |
| L40 | Conference: socket CLOUD_TELEPHONY_PATH; USER_JOINED → checkCounselorChat; "Connecting…" until chatId (no timeout) | ConferenceListeningScreen.tsx | conference_listening_screen.dart `_connect`, `_onUserJoined` | PRESENT | |
| L41 | Conference AUDIO_STREAM → exotel amplitudes; AUDIO_INACTIVE_TIMEOUT clears amplitudes (fade out) | ConferenceListeningScreen.tsx, utils/audioUtils.ts `exotelAudioDataToAmplitudes` | conference_listening_screen.dart `_onAudioStream` | PARTIAL | No inactivity timeout — last frame stays frozen when the stream stops. |
| L42 | Conference DismissableBanner (`scribeStopTakingNotesBanner`) in focus mode | ConferenceListeningScreen.tsx, DismissableBanner.tsx | conference_listening_screen.dart, dismissable_banner.dart | PRESENT | RN additionally requires provider ∈ ConferenceCallProviders. |
| L43 | Conference CHAT_ENDED → replace with Breathing | ConferenceListeningScreen.tsx, useListeningCommon.ts | conference_listening_screen.dart `_onCallEnded` | PARTIAL | Shows `conferenceListening.callEnded` red text and disconnects; no navigation to Breathing/summary. |
| L44 | Conference focus/non-focus layouts (timer, waveform, nudge, Search) | ConferenceListeningScreen.tsx | conference_listening_screen.dart | PRESENT | Search missing (see L29). |
| L45 | Conference controls: pause/resume and end hidden; focus button gated | ConferenceListeningScreen.tsx | conference_listening_screen.dart (ListeningControls flags) | PRESENT | |
| L46 | Conference end-call confirmation modal | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN (end button hidden). |
| L47 | Conference privacy lock + tooltip next to "Taking notes" | ConferenceListeningScreen.tsx `renderTakingNotes` | conference_listening_screen.dart | PARTIAL | Plain text only; no lock icon/tooltip. |
| L48 | Conference AUDIO_CHAT_PAUSED/RESUMED emits | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN (pause button hidden). |
| L49 | Conference socket disconnect on background / reconnect on active | useSocketConnection.ts (default `disconnectOnBackground:true`) | socket_service.dart (keeps socket) | N/A | Benign divergence; Flutter keeps the passive socket alive. |
| L50 | ControlButtonsSection, ListeningAnimation components | components/ControlButtonsSection, ListeningAnimation | — | N/A | Exported but not rendered in RN. |
| L51 | Analytics/tracking | — | — | N/A | None in RN (see L37 for socket diagnostic). |

Backend/socket calls (Listening): socket connect `/microphone-chat` and cloud-telephony path PRESENT; emits START_AUDIO_CHAT PRESENT, AUDIO_MESSAGE PRESENT, SCRIBE_START_DIAGNOSTIC MISSING, AUDIO_CHAT_PAUSED/RESUMED N/A; listens SESSION_CREATED, USER_JOINED (PARTIAL L7), MESSAGE_RECEIVED, UTTERANCE_ENDED, NUDGE, CHAT_ENDED, AUDIO_STREAM PRESENT; GET `/chats/counsellor-chat` PRESENT (USER_JOINED) / MISSING (foreground check L35); POST `/chats/:id/end` PRESENT; GET `/settings/nudge-status` PRESENT; POST `/chats/messages/:id/feedback`, PATCH `/chats/messages/feedback/:id` PRESENT; reference-document search MISSING (L29).
Toasts/alerts: mic settings alert (PARTIAL L3); everything else is in-screen state views.
Navigation targets: Breathing (replace) PRESENT for mic (L19/L21 partial on error), PARTIAL for conference (L43); goBack PRESENT.

---

#### 4. BoxBreathingScreen — route "Breathing" (`screens/BoxBreathingScreen/**`)

Flutter: `lib/features/boxbreathing/presentation/box_breathing_screen.dart`, `call_end_overlay.dart`, `flower_petal_painter.dart`, `breath_sound_player.dart`; route `/box-breathing?chatId=` in app_router.dart.

Tally: PRESENT 7 · PARTIAL 2 · N/A 1

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| B1 | CallEndOverlay for 3s: black→darkBlue3 gradient, `stressBuster.messages.gaveBest` fades to `momentForYourself` | BreathingScreen.tsx, CallEndOverlay/CallEndOverlay.tsx | call_end_overlay.dart, box_breathing_screen.dart `_overlayTimer` | PRESENT | |
| B2 | Background image + gradient + heading `stressBuster.returnToSelf` | BreathingScreen.tsx | box_breathing_screen.dart `_buildBreathing` | PRESENT | |
| B3 | Box animation: dot around square, flower petals bloom, 4 phases × 4s, phase labels `boxBreathing.phase*` | BoxBreathingAnimation.tsx, FlowerPetal.tsx | box_breathing_screen.dart `_buildAnimation`, flower_petal_painter.dart | PRESENT | |
| B4 | Breath sound: play on inhale, mix with other audio, volume 0 when muted, replay on unmute mid-inhale | BoxBreathingAnimation.tsx (react-native-sound-player) | breath_sound_player.dart, box_breathing_screen.dart | PRESENT | |
| B5 | Per-phase seconds counter 1→4 | BreathingScreen.tsx `onPhaseChange` | box_breathing_screen.dart `_restartCountdown` | PRESENT | |
| B6 | Controls: mute/unmute, play/pause (pause resets to phase 0, seconds 1) | BreathingControls.tsx, BreathingScreen.tsx | box_breathing_screen.dart `_BreathingControls`, `_setPlaying`, `_toggleMute` | PRESENT | |
| B7 | Pause when app goes inactive; stop on unmount | BreathingScreen.tsx AppState | box_breathing_screen.dart `didChangeAppLifecycleState`, `dispose` | PRESENT | |
| B8 | "View call summary" → CallSummary with no params (chatId from currentChat, live flow semantics) | BreathingScreen.tsx `onPressViewSessionSummary` | box_breathing_screen.dart `_viewCallSummary` (fetch item, push `/call-log/:id`) | PARTIAL | Silent no-op when neither `?chatId` nor currentChat is set; summary opens with from-logs semantics (see S1/S48/S49) and pops back to breathing. |
| B9 | Hardware back → clear currentChat, stop, reset stack to CallLog | BreathingScreen.tsx | box_breathing_screen.dart `_resetToCallLog` | PARTIAL | Clears chat and stops, but navigates to `/home` instead of the Call Log screen. |
| B10 | Analytics/tracking | — | — | N/A | None in RN. |

---

#### Top gaps by user impact

1. S29/S42 — Editing (or voice-dictating) Tags saves `summary.tags` as a comma string; ally-be only normalizes arrays, so the string overwrites stored tags (call_summary_screen.dart `_saveBuiltinFields`, voice_note_section.dart).
2. L11 — Scribe starts paused but the "resume to let it listen" mute tooltip never shows (`_isMuteTooltipOpen` never true); counsellors can record a whole session that sends no audio.
3. L7 — USER_JOINED ignores `payload.chatId` and waits on GET counsellor-chat, reintroducing the race RN fixed → false "Microphone failure" at 5s.
4. L34/L35 — No keep-awake during live sessions, and no foreground re-check → screen sleeps mid-call; a session ended while backgrounded leaves the user on the live screen.
5. C6 — Call-log duration filter sends minutes where backend expects seconds (RN ×60); clearing a date/duration box doesn't clear the filter.
6. S44/S43 — Voice dictation overwrites a note's earlier transcript (not seeded from `details.transcript`) and never fills custom fields.
7. S4 — `/settings/summary-fields` visible-fields config not applied: all sections/fields shown to every tenant, and the voice field catalog is unfiltered.
8. S47/S46/S16 — Summary transcript tab: one unpaginated, unsorted GET (long calls truncated), no timestamps/speaker labels/dictation view, and shown without VIEW_MESSAGES.
9. C17 — Call log lists never refresh on focus: archived/renamed calls, new notes and just-finished sessions stay stale until manual refresh.
10. S11 — Export summary (export-summary + file save) missing from the summary menu.

Also notable: S21 AddNotes-while-generating missing; S38 manual-note flag not latched (voice section vanishes after first save); S49/B9 live-flow exits go to the wrong place; L29 reference Search missing on the listening screen; S1 `/call-log/:id` crashes without `extra`; C12 FeatureNotAvailable state missing.


### Parity ledger — Learn screens (RN → Flutter)

RN root: `ally-platform/ally-mobile/src` (source of truth). Flutter root: `ally-mobile-flutter/lib` on `master`.
Audit date: 2026-10-28.

**Branch note:** the brief said `parity/feedback` held in-flight work. While this audit ran, `parity/feedback` was merged into `master` (merge commit `e248a07`, which includes `517c5e4` "Match the live role-play screen to RN SimulationAssistantScreen"), and the branch was deleted. Everything that was on that branch is now on master, so it is marked PRESENT or PARTIAL with the master file named. No IN PROGRESS rows are left. `feature/simkit` was already merged (`de796ac`).

**Analytics:** RN has no client analytics SDK at all. A grep for track/capture/posthog/logEvent/analytics/mixpanel/amplitude/Sentry/crashlytics across `src/` finds no event calls. So there are no event names to port, and every analytics row is N/A.

#### Overall tally

| Screen | PRESENT | PARTIAL | MISSING | N/A | Total |
|---|---|---|---|---|---|
| SimulationsScreen — the "Learn" bottom tab | 17 | 1 | 1 | 2 | 21 |
| SimulationDetailsScreen | 19 | 2 | 0 | 1 | 22 |
| SimulationPathDetailsScreen + CaseDetailsScreen | 18 | 4 | 1 | 1 | 24 |
| CourseOverviewScreen | 15 | 1 | 1 | 2 | 19 |
| CourseItemPlayerScreen | 31 | 13 | 8 | 2 | 54 |
| CourseProgressScreen | 8 | 2 | 0 | 1 | 11 |
| BreathingExerciseScreen (course GAME / BREATHING_EXERCISE) | 5 | 1 | 0 | 1 | 7 |
| SimulationAssistantScreen — live roleplay voice session | 20 | 6 | 7 | 2 | 35 |
| SimulationFeedbackScreen | 29 | 5 | 3 | 7 | 44 |
| **Overall** | **162** | **35** | **21** | **19** | **237** |

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
| Android hardware back: exit the app on the first tab, otherwise jump to the first tab | `useHardwareBackPressHandler` + `getFirstVisibleTab` | core/navigation/app_shell_screen.dart | PARTIAL | The shell has no `PopScope`. Back on a non-first tab pops `/home` and exits the app instead of switching to the first tab. |
| BadgePopup (app-wide unlock celebration: confetti, image, mark viewed, polls `/badges/me`) | components/BadgePopup, hooks/useBadgePopup.ts | — (achievements_repository.dart / achievements_screen.dart say it is "not ported") | MISSING | Learners never see the new-badge popup. Achievements tapping marks badges viewed as a stand-in. |
| Offline / no-network handling | — | — | N/A | RN has nothing specific on this screen. |
| Analytics | — | — | N/A | RN has no analytics calls (see header). |

Tally: PRESENT 17 · PARTIAL 1 · MISSING 1 · N/A 2

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
| Title + share icon → copy `ALLY_WEB_URL/scenario/:id` + "Link copied" toast | `linkCopyToClipboard` | simulation_details_screen.dart `_copyLink` | PARTIAL | The URL is hard-coded to `https://app.helloally.ai/` rather than read from env config. |
| "Completed N×" chip | `completedChip` | `_CompletedChip` | PRESENT | |
| Scenario label + rich-text description | `RichText html` | `HtmlRichText` | PRESENT | |
| Trigger-warning chips | `getTriggerWarningNames` | simulation_details_screen.dart | PRESENT | |
| CTA "Start Role play" / "Practice again" | `renderCtaSection` | `AppButton` | PRESENT | |
| CTA disabled when credits are low | `isStartSimulationDisabled` | `isStartDisabled = credits?.isLow` | PRESENT | |
| Low-credits modal, auto-hides after 5 s | `IllustratedModal` + `LOW_CREDITS_MODAL_DISPLAY_MS` | start_simulation_controller.dart `onCredits` / `LowCreditsModal` | PRESENT | |
| Pre-start "Before you get started" modal | `NotificationModal` | start_simulation_modals.dart `PreStartNotificationModal` | PRESENT | |
| Start call `POST /learn/scenario-session-start` {scenarioId, languageId?} | useStartSimulation `callSessionStart` | simulations_repository.dart `startScenarioSession` | PRESENT | |
| "Creating room…" full-screen overlay | `renderLoadingOverlay` | `_CreatingRoomOverlay` | PRESENT | |
| Microphone permission request before start; Settings alert when blocked; toast when denied | useStartSimulation + usePermissionAlert | — (deferred to the roleplay screen's `_connect`) | PARTIAL | Flutter asks for the mic only after navigating, and shows inline `errors.permission` text with no "Open Settings" alert (`openAppSettings` is never called). |
| 429 → RetrySessionModal (retry with stored params) | `isRateLimitError`, `retryStartSimulation` | start_simulation_controller.dart `_showRetry` / `RetrySessionModal` | PRESENT | |
| `entityId` error → ActiveSimulationModal (end session `POST /learn/scenario-session/:id/end`, success/error toast) | ActiveSimulationModal.tsx | start_simulation_modals.dart `ActiveSimulationModal`, controller `_showActiveSimulation` | PRESENT | |
| Other errors → error toast `errors.startSimulation` | showErrorToast | controller `_toast` (SnackBar) | PRESENT | |
| Navigate to the live screen with sessionData + scenario (reminders only when `remindersEnabled`) | navigate SIMULATION_ASSISTANT | `_pushRoleplay` → `/roleplay` extra; simulation_models.dart filters reminders | PRESENT | |
| Hardware back → goBack | useHardwareBackPressHandler | default pop | PRESENT | |
| Error state when the scenario fetch fails | — (RN never fetches) | `learn.details.loadingDetailsError` text | PRESENT | Extra state, harmless. |
| Analytics | — | — | N/A | None in RN. |

Tally: PRESENT 19 · PARTIAL 2 · MISSING 0 · N/A 1

---

#### 3. SimulationPathDetailsScreen + CaseDetailsScreen

The two RN screens are line-for-line identical apart from type names (they share `useLearningPathDetails`, `PathSimulationCard` and `SimulationDetailsModal`). Flutter shares one body, `LearningPathDetailView`.
RN: `screens/SimulationPathDetailsScreen/*`, `screens/CaseDetailsScreen/CaseDetailsScreen.tsx`, `hooks/useLearningPathDetails.ts`, `components/LearningPathDetails` (LearningPathHeader / LearningPathListHeader).
Flutter: `features/simulations/presentation/simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart`, `simulation_details_modal.dart`, `widgets/learning_path_widgets.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back + "Track" / "Case" title + credits read-out | LearningPathHeader | learning_path_widgets.dart `LearningPathHeader(showCredits)` | PRESENT | |
| Back falls back to the Learn tab when there's no back stack (`navigateToLearnTab`) | `handleBack` | BackTitleHeader default pop | PARTIAL | No fallback for a deep-linked entry with an empty stack. |
| Fetch `GET /learn/scenario-paths/:id` or `GET /learn/cases/:id` | useLearningPathDetails | simulations_repository.dart `simulationPathDetailsProvider` / `caseDetailsProvider` | PRESENT | |
| Loading spinner | ActivityIndicator | `LearningPathLoading` | PRESENT | |
| Error / empty → DataUnavailable EmptyState ("failedToLoadPathDetails" / "…CaseDetails") | EmptyState | `LearningPathLoadError` | PRESENT | |
| Pull-to-refresh | RefreshControl | RefreshIndicator | PRESENT | |
| List header: cover, title, description, progress bar x/y, completed state | LearningPathListHeader | learning_path_widgets.dart `LearningPathListHeader` | PRESENT | |
| Start / Continue button (label by `completedScenarios > 0`) | `handleStartPath` | learning_path_detail_view.dart | PRESENT | |
| Start disabled when there is no next scenario or credits are low | `isStartPathDisabled` | `isStartDisabled` | PRESENT | |
| Lazily create the path/case session (`POST …/create-session`) before opening the modal | `createSession` | `onEnsureSession` | PRESENT | |
| createSession failure → error toast with the server message | showToast(getErrorDetails) | inline red `_error` text | PARTIAL | Inline text instead of a toast, and it shows the raw exception. |
| Scenario row: 120×60 thumb, lock overlay, "Role play N", tick, "Next" chip, 2-line title | PathSimulationCard.tsx | learning_path_detail_view.dart `_ScenarioRow` | PRESENT | |
| Locked row not tappable | `handleSimulationPress` guard | `onTap: locked ? null` | PRESENT | |
| Completed row file icon → session lookup `GET /learn/scenario-session/(scenario-path-session-item or case-session-item)/:id` → Feedback(fromLogs) | `handleFileIconPress` | `onViewFeedback` → `/simulations/feedback/:id?fromLogs=true` | PARTIAL | RN also passes `pathId`; Flutter doesn't (the feedback screen has no pathId/caseId param). When the lookup returns no id, RN toasts "failedToLoadPathDetails"; Flutter does nothing. |
| SimulationDetailsModal: header, close, language dropdown, video/image, order label, title, description, trigger warnings, Start | SimulationDetailsModal.tsx | simulation_details_modal.dart | PRESENT | |
| Modal hidden while the pre-start NotificationModal shows | `visible={!!selected && !showNotification}` | simulation_details_modal.dart → `PreStartNotificationModal` | PRESENT | |
| Start with `scenarioPathSessionItemId` / `caseSessionItemId` from the *fresh* scenario, plus languageId | `handleProceedWithSimulation` | `startParamsFor(fresh ?? scenario)` | PRESENT | |
| Close the modal after the start settles | `.finally(handleCloseModal)` | `onSettled: close` | PRESENT | |
| Pass pathId / caseId to the live screen, then on to Feedback (back resets to path/case details; "Try another" hidden) | useStartSimulation params `pathId` / `caseId` | — | MISSING | `StartSimulationParams` has no pathId/caseId. After a path/case scenario, Feedback back goes to `/home` instead of the path/case. |
| ActiveSimulationModal / RetrySessionModal / error toast | shared hook | start_simulation_controller.dart | PRESENT | |
| Low-credits modal (5 s) | useEffect isLow | controller `onCredits` | PRESENT | |
| Path/case details + credits refreshed after a session ends (RN `endScenarioSession` invalidates SimulationCredits, SimulationPaths, SimulationPathDetails, Cases, CaseDetails) | services/simulationsApi.ts `invalidatesTags` | roleplay_voice_screen.dart `_endSession` (no invalidation); providers are non-autoDispose | PARTIAL | Back on path/case details, completion, locks and the credits counter stay stale until a manual pull-to-refresh. |
| Hardware back | useHardwareBackPressHandler | default | PRESENT | |
| Analytics | — | — | N/A | |

Tally: PRESENT 18 · PARTIAL 4 · MISSING 1 · N/A 1

---

#### 4. CourseOverviewScreen

RN: `screens/CourseOverviewScreen/CourseOverviewScreen.tsx`, `components/CourseSectionBlock.tsx`, `CourseItemRow.tsx`, `CourseLanguageSheet.tsx`, `CourseProgressSheet.tsx`, `utils/trackNavigation.ts`, `utils/trackItemMeta.ts`.
Flutter: `features/courses/presentation/course_detail_screen.dart`, `course_language_sheet.dart`, `course_progress_screen.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back + "Course" | LearningPathHeader | course_detail_screen.dart | PRESENT | |
| Back fallback to the Learn tab when the stack is empty | `handleBack` / navigateToLearnTab | default pop | PRESENT | Only reachable from Learn or a notification push, so there's always a stack. |
| Fetch `GET /learn/tracks/:id` | useGetLearnTrackDetailQuery | courses_repository.dart `trackDetailProvider` | PRESENT | |
| Loading spinner | ActivityIndicator | course_detail_screen.dart | PRESENT | |
| 403 → "Course not available" EmptyState; other errors → "Course not found" | CourseOverviewScreen.tsx | course_detail_screen.dart (DioException 403 check) | PRESENT | |
| Pull-to-refresh | RefreshControl | RefreshIndicator | PRESENT | |
| Language row "Reading in X · Change" (only with ≥2 languages) | `renderLanguageRow` | course_detail_screen.dart | PRESENT | |
| Language sheet: list, select → `PUT /learn/tracks/:id/language` {languageCode}, errors swallowed, close | CourseLanguageSheet.tsx | course_language_sheet.dart | PRESENT | |
| List header: cover, title, description, progress, completed | LearningPathListHeader | course_detail_screen.dart | PRESENT | |
| Start / Continue: enrol if needed (`POST /learn/tracks/:id/enroll`) → `GET /learn/tracks/:id/next-item` → open player; errors swallowed | `handleStartOrContinue` | `_startOrContinue` | PRESENT | |
| Tap progress bar → CourseProgressSheet (bottom sheet, 70% snap; session → Feedback; Continue → start/continue) | CourseProgressSheet.tsx | `onProgressTap` → push `/courses/:id/progress` (full screen) | PARTIAL | Opens a full screen instead of the in-context bottom sheet. The content is the same (see §6). |
| Section blocks sorted by order: ring with number, title, subtitle | CourseSectionBlock.tsx | `_CourseSectionBlock` | PRESENT | |
| Item row: type badge letter, lock, tick, status chip (Completed / In progress / Next), meta line, language-fallback caption, locked caption, current-item border | CourseItemRow.tsx | `_CourseItemRow`, `trackItemMeta`, `_typeBadge` | PRESENT | |
| "Next" item computed client-side (`findNextItemId`) | utils/trackNavigation.ts | `findNextTrackItemId` | PRESENT | |
| Item tap: locked ignored, otherwise open the player | `handleItemPress` | `_openItem` | PRESENT | Unknown item types get an "unsupported" snackbar instead of opening the player's UnsupportedItemCard. |
| Refresh after returning from the player (RN mutations invalidate `ALL_TRACK_TAGS`: list, detail, next-item) | services/coursesApi.ts | — | MISSING | Item completion never invalidates `trackDetailProvider` / `learnTracksProvider` (non-autoDispose). After finishing an item, the overview and the Learn list show stale status: newly unlocked items still look locked until pull-to-refresh. |
| Track languages endpoint `GET /learn/tracks/:id/languages` | coursesApi `getTrackLanguages` | — | N/A | No RN screen calls it; options come from the track detail. |
| Hardware back | useHardwareBackPressHandler | default | PRESENT | |
| Analytics | — | — | N/A | RN has none. |

Tally: PRESENT 15 · PARTIAL 1 · MISSING 1 · N/A 2

---

#### 5. CourseItemPlayerScreen

RN: `screens/CourseItemPlayerScreen/**` (37 non-test files), `hooks/useTrackPlayerNavigation.ts`, `hooks/useVideoWatchProgress.ts`, `components/DiscussionThread`, `DiscussionPost`, `PostInput`, `utils/activeTrackContext`.
Flutter: `features/courses/presentation/course_item_player_screen.dart` (player shell, PlayerTopBar, rail, bottom nav, `_ArticleView`, `_BreathingExerciseIntro`), `quiz/quiz_player.dart`, `quiz/quiz_question_widget.dart`, `video/*`, `journal/journal_player.dart`, `game/game_player.dart`, `branching/branching_scenario_player.dart`, `bucket_sort/bucket_sort_player.dart`, `roleplay/roleplay_case_player.dart`, `celebration_modal.dart`, `discussion/*`, `data/courses_repository.dart`, `data/discussion_repository.dart`, `data/video_watch_progress.dart`, `data/start_item_payload.dart`, `assets/games/*.html`.

##### Shell / navigation / states

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params trackId, itemId, highlightPostId | navigation/types.ts | `/courses/item/:itemId` with extra `(trackId, item)` | PARTIAL | The route needs a full `TrackDetailItem` in `extra`, so it can't be opened from an id alone, and there's no `highlightPostId` param. |
| Track fetch for nav (`GET /learn/tracks/:id`) + flatten sections/items | useTrackPlayerNavigation | `_flattenTrackItems`, `trackDetailProvider` | PRESENT | |
| Start item `POST /learn/tracks/items/:id/start` on every item change | `loadItem` | `_start()` | PRESENT | |
| Loading spinner | ActivityIndicator | CircularProgressIndicator | PRESENT | |
| Track-load failure → "trackLoadFailed" + Retry button | `isTrackError` branch | — (falls back to the bare `TabScreenHeader` shell) | MISSING | No retry. The nav chrome just disappears. |
| Item-load failure → "loadFailed" + Retry button | `loadError` branch | `_error` text only | PARTIAL | No Retry button; shows raw exception text. |
| PlayerTopBar: exit X, section eyebrow, item title, description, overall % | PlayerTopBar.tsx | `_PlayerTopBar` | PRESENT | |
| SegmentedProgressRail (current section) | SegmentedProgressRail.tsx | `_SegmentedProgressRail` | PRESENT | |
| PlayerBottomNav: Prev / Next / Finish, gated on `canAdvance` | PlayerBottomNav.tsx | `_PlayerBottomNav` | PRESENT | |
| `justCompleted` optimistic set | CourseItemPlayerScreen.tsx | `_justCompleted` | PRESENT | |
| `alreadyCompleted` passed to article/video/journal = server COMPLETED status OR justCompleted | CourseItemPlayerScreen.tsx | `alreadyCompleted: _completed` (in-session flag, reset to false on every item load) | PARTIAL | Bug: an already-completed journal reopens editable and submittable, a watched video loses its "Watched" state, and an article shows "Mark as read" again. Should use `_isItemCompleted(item)`. |
| Exit / back to overview (pop, else go to the overview) | `handleBackToOverview` | `_exitToOverview` | PRESENT | |
| Celebration modal (section / track complete), confetti, reduce-motion respected | CelebrationModal.tsx | celebration_modal.dart | PRESENT | |
| Celebration stats pill (completedCount) | CelebrationModal `completedCount` | celebration_modal.dart supports it; the screen never passes it | PARTIAL | The track-complete stats pill never renders. |
| Celebration "Continue" → go to the next item, or the overview | `onContinue` → goNextOrOverview | `onContinue: setState(_celebration = null)` | PARTIAL | Only dismisses; doesn't advance. |
| Celebration "Back to Learn" → Learn tab | navigateToLearnTab | `context.go('/home')` | PRESENT | Learn is the first tab. |
| Refetch the track on return from a launched roleplay/case/breathing (`getActiveTrackContext`) | useFocusEffect | `didChangeDependencies` + `_refetchTrackOnReturn` (roleplay/case only) | PRESENT | Breathing doesn't set the flag, which doesn't matter because it completes on mount. |
| Unsupported item type → UnsupportedItemCard (title, body, "Back to course") | UnsupportedItemCard.tsx | `Center(Text(unsupportedTitle))` | PARTIAL | No body text and no Back-to-course button. |
| Discussion thread under the item when `hasDiscussion` | `DiscussionThread itemId` | discussion/discussion_thread.dart | PRESENT | |
| Discussion `highlightPostId` deep link (from a COURSE_DISCUSSION_REPLY notification → player + scroll/highlight) | NotificationsScreen.tsx → COURSE_ITEM_PLAYER {highlightPostId} | discussion_thread.dart supports `highlightPostId`; the player never passes it; notifications_screen pushes `/courses/:trackId` only | MISSING | A reply notification lands on the course overview, not on the post. |
| Discussion CRUD (GET thread, POST post, POST reply, PUT edit, DELETE, PUT lock post, PUT lock discussion) | services/discussionApi.ts | data/discussion_repository.dart | PRESENT | `GET /learn/track-items/:id/discussion/tenants` (moderator tenants) isn't ported. RN exposes it but the player never calls it, so it doesn't count as a gap. |

##### Article

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Article HTML body | ArticlePlayer.tsx (`RichText`) | `_ArticleView` (`HtmlRichText`) | PRESENT | |
| Scroll-progress bar at the top | ArticlePlayer `progressTrack` | — | MISSING | |
| Inline questions placed at their anchors in the body (`splitArticleHtml`) | ArticlePlayer `segments` | `_ArticleView` lists all questions after the body | PARTIAL | Not interleaved. |
| ArticleQuestionCard: rich prompt, select then Submit (`POST …/article-questions/:qid/answer`), correct/incorrect + explanation, "answered" hint, resumes from `answered` | ArticleQuestionCard.tsx | `_ArticleView` RadioListTile | PARTIAL | Submits on tap (no Submit button); no explanation text; plain-text prompt; no resume of earlier answers; failures swallowed silently. |
| QuestionMedia (image with tap-to-expand, embedded video WebView, failure caption) | QuestionMedia.tsx | — (no `media` field in start_item_payload.dart) | MISSING | Also missing in the quiz and interjection players. |
| Resources list + ExternalResourceSheet (in-app WebView, timeout falls back to the OS browser, documents open externally) | ArticlePlayer resources, ExternalResourceSheet.tsx | — (no `resources` in the payload model) | MISSING | |
| "Mark as read" gated on reaching the end (sentinel / threshold) AND all shown questions answered; "Keep reading" label; last answer auto-completes | ArticlePlayer `canMark` | `AppButton` always enabled | PARTIAL | No read gating. `POST …/article-read` is present. |

##### Video

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Native S3 playback | VideoPlayer.tsx | video/video_player_widget.dart | PRESENT | |
| Watch progress: unique seconds, 10 s / +10% throttle, flush on pause/end/unmount → `POST …/video-progress` | hooks/useVideoWatchProgress.ts | data/video_watch_progress.dart, video_item_player.dart | PRESENT | |
| YouTube/Vimeo/Loom fallback card (open externally + mark watched) | VideoFallbackCard.tsx | video/video_fallback_card.dart | PRESENT | |
| Interjections: pause at the timestamp, blocking question, submit `POST …/interjections/:id/answer`, result, Continue resumes | VideoInterjectionModal.tsx | video/video_interjection_dialog.dart | PRESENT | Question media missing (see QuestionMedia). |
| "Watched" state | VideoItemPlayer | video_item_player.dart | PRESENT | Seeded wrongly by the `alreadyCompleted` bug above. |

##### Quiz

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Intro card: question count, pass score (hidden for surveys), attempts, Start disabled when exhausted | QuizIntro.tsx | quiz_player.dart `_QuizIntro` | PRESENT | |
| One question per page with "Question x of y", Back / Next / Submit | QuizItemPlayer.tsx | quiz_player.dart (all questions on one scrolling list) | PARTIAL | Different flow. |
| 8 question types (MCQ single/multi, true/false, ordering, matching, fill-blank, open-ended, Likert) | quiz/widgets/*.tsx | quiz/quiz_question_widget.dart | PRESENT | Ordering uses up/down buttons instead of drag; matching uses dropdowns. Same data. |
| Submit `POST …/quiz-attempts` | `handleSubmit` | `_submit` | PRESENT | Flutter adds an "answer all" check. |
| Results: passed/failed, score, attempts used, "Your responses" with correct answer, explanation and AI feedback per question | QuizResults.tsx | quiz_player.dart summary card + quiz_question_widget `_ResultBanner` | PARTIAL | No correct-answer line and no open-ended AI `feedback`; no "responses submitted / not scored" survey state. |
| PENDING_GRADING → "Finish grading" (regrade `POST …/quiz-attempts/:aid/regrade`) | QuizItemPlayer `handleRegrade` | — | MISSING | No regrade call in courses_repository.dart. |
| Retry: re-fetch `startTrackItem` for a fresh quiz and attempt count | `handleRetry` | clears answers locally only | PARTIAL | `attemptsUsed` is a stale widget prop, so Retry can be offered after the attempts are used up. |
| Confetti on pass (reduce-motion respected) | `fireConfetti` | — | MISSING | |
| Results "Next" button → next item / overview | QuizResults `onNext` | — (bottom nav Next only) | PRESENT | The bottom nav covers it. |
| Completion reported only when `passed && itemCompleted` (with section/track flags) | `applyAttemptResult` | `if (result.passed)` | PRESENT | Close enough: same flags forwarded. |

##### Journal, Game, Breathing, Branching, Bucket sort, Roleplay/Case

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Journal: prompts, required markers, debounced draft autosave `POST …/journal`, submit `POST …/journal/submit`, read-only after submit | JournalPlayer.tsx | journal/journal_player.dart | PRESENT | Same translation keys. Seeded wrongly by the `alreadyCompleted` bug. |
| HTML5 game bundles (6) in a WebView + bridge, `POST …/game-result`, last/best score | GamePlayer.tsx, games/*Html.ts | game/game_player.dart, assets/games/*.html | PRESENT | |
| Game in-frame localized strings (`window.__allyGameStrings` via FRAME_STRING_KEYS) | GamePlayer.tsx `injectedStrings` | — | MISSING | Games always run in English. |
| Unknown game key → unsupported title + body | GamePlayer `unsupported` | `_loadError = unsupportedTitle` | PARTIAL | Title only. |
| Breathing game key → NativeGamePlayer intro card (completes on mount) → BreathingExercise screen | NativeGamePlayer.tsx | `_BreathingExerciseIntro` → `/breathing-exercise` | PRESENT | |
| Breathing key with no config → UnsupportedItemCard | CourseItemPlayerScreen switch | falls through to `GamePlayer` (unsupported title) | PRESENT | Same end result: unsupported message. |
| Branching scenario: intro, nodes, choices, images, outcome / score / takeaway, trail, `POST …/branching-result`, attempts left, exhausted pause with recap and next round, Continue → next | BranchingScenarioPlayer.tsx | branching/branching_scenario_player.dart | PRESENT | Missing only the a11y labels `recapLabel` / `trailLabel`. |
| Bucket sort: tap-to-place `POST …/bucket-sort/place`, per-item feedback, rounds, restart `POST …/bucket-sort/restart`, first-try %, Continue | BucketSortPlayer.tsx | bucket_sort/bucket_sort_player.dart | PRESENT | Missing the `bucketA11y` label. |
| ROLEPLAY/CASE item: launch roleplay (trackItemProgressId) or open the case; assessment mode | RoleplayCasePlayer.tsx | roleplay/roleplay_case_player.dart (+ start_simulation_controller) | PRESENT | Translation keys match. |
| Accessibility labels on branching / bucket sort | various | — | N/A | Non-functional; listed under the rows above. |
| Analytics | — | — | N/A | |

Tally: PRESENT 31 · PARTIAL 13 · MISSING 8 · N/A 2

---

#### 6. CourseProgressScreen

RN: `screens/CourseProgressScreen/CourseProgressScreen.tsx`, `components/CourseProgressBody.tsx`, `PracticeNudge.tsx`, `LatestFeedbackPreview.tsx`, `RoleplaySessionRow.tsx`, `ScoreTrendSparkline.tsx`, `SectionProgressRow.tsx`, `SkillCategoryRow.tsx`.
Flutter: `features/courses/presentation/course_progress_screen.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header "Progress" + back | CourseProgressScreen.tsx | course_progress_screen.dart | PRESENT | |
| Fetch `GET /learn/tracks/:id/progress` | useGetLearnTrackProgressQuery | `trackProgressProvider` | PRESENT | |
| Loading / error EmptyState (DataUnavailable icon) | CourseProgressScreen.tsx | spinner / `notFound: $error` text | PARTIAL | Plain text with the raw error, no EmptyState icon. |
| Overall progress bar + % | CourseProgressBody | course_progress_screen.dart | PRESENT | |
| Section progress rows | SectionProgressRow.tsx | `_SectionProgressRow` | PRESENT | |
| Practice nudge → Continue (`GET …/next-item` → player) | PracticeNudge.tsx | `_PracticeNudge` | PRESENT | |
| Score-trend sparkline | ScoreTrendSparkline.tsx | `_ScoreTrendSparkline` / `_SparklinePainter` | PRESENT | |
| Skill-category rows | SkillCategoryRow.tsx | `_SkillCategoryRow` | PRESENT | |
| Feedback subheading ("based on N evaluated sessions", shown when `evaluatedRoleplaySessionCount > 0`) | CourseProgressBody `feedbackSubheading` | course_progress_screen.dart (key not used) | PARTIAL | Subheading is missing. Cosmetic. |
| Latest feedback preview + roleplay session rows → Feedback(scenarioSessionId) | LatestFeedbackPreview.tsx, RoleplaySessionRow.tsx | `_LatestFeedbackPreview`, `_RoleplaySessionRow` → `/simulations/feedback/:id` | PRESENT | |
| Analytics | — | — | N/A | |

Tally: PRESENT 8 · PARTIAL 2 · MISSING 0 · N/A 1

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
| Sets the active-track context so the player refetches on return | NativeGamePlayer `setActiveTrackContext` | — | PARTIAL | Low impact: the item is completed on mount. |
| Analytics | — | — | N/A | |

Tally: PRESENT 5 · PARTIAL 1 · MISSING 0 · N/A 1

---

#### 8. SimulationAssistantScreen — live roleplay voice session

RN: `screens/SimulationAssistantScreen/SimulationAssistantScreen.tsx` + 37 component files (SessionChecklist, SessionInfoTabs, LiveFeedback, SessionGoalTimer, SessionProgress, ScenarioInfoOverlay, SimulationTimer, SimulationControls, SpeakingIndicator, TurnIndicator, EndingSoonModal, SimulationCountdown, SessionScoreMeter, ParticipantTile, AudioWave/useAudioLevel).
Flutter (master, after merge `e248a07`): `features/roleplay/presentation/roleplay_voice_screen.dart`, `checklist_panel.dart`, `session_info_tabs.dart`, `participant_tile.dart`, `turn_state.dart`, `live_feedback_toast.dart`, `session_score_meter.dart`, `pause_resume_state.dart`, `core/realtime/livekit_room_service.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params: sessionData {id, accessToken, liveKitServerUrl}, scenario, pathId, caseId, languageId | navigation/types.ts | `/roleplay` extra {liveKitServerUrl, accessToken, scenarioSessionId, scenario} | PARTIAL | No pathId / caseId / languageId. |
| Auto-connect on mount (100 ms guard) | `handleConnect` useEffect | `_connect` behind a manual "Connect" button (`roleplayVoice.connect`) | PARTIAL | The learner has to tap Connect. The `517c5e4` commit keeps this on purpose. |
| AudioSession configuration (Android communication preset / iOS) before connect | `configureAudioSession` | — | MISSING | No audio-session / route configuration in livekit_room_service.dart. |
| Keep screen awake during the call | activateKeepAwake / deactivateKeepAwake | — (no wakelock dependency) | MISSING | The screen can sleep mid-session. |
| Start-simulation ringtone on mount, stopped when the agent speaks; end sound on disconnect | `playNotificationSound(sounds.start/endSimulation)`, SoundPlayer | — (assets/sounds has only breath.mp3) | MISSING | |
| 3-2-1 countdown overlay | SimulationCountdown | roleplay_voice_screen.dart `_startCountdown` | PARTIAL | Starts after connecting, not on mount. |
| Room status: connecting → connected → ringing → AGENT_JOINED (agent speaks, or 1.5 s silent grace after the participant joins) | attachRoomListeners `transitionToAgentJoined`, AGENT_SILENT_GRACE_MS | `inProgress = _isConnected` | MISSING | No participant-connected / agent-joined state. The timer starts after the countdown, not when the agent joins. |
| Loader text (connecting / waiting for agent / ending) + mic prompt | `renderLoader` | `_buildLoader` | PRESENT | |
| Room disconnected by the agent/server → end sound + `navigation.replace(Feedback)` | `onDisconnected` | — (no RoomDisconnectedEvent listener) | MISSING | If the agent ends the session (cap-ended, auto-end, crash), the Flutter learner stays stuck on the call screen. |
| Session timer (elapsed, freezes while paused) | SimulationTimer.tsx | `_elapsed` / `_onTick` | PRESENT | |
| 30 s-remaining warning → EndingSoonModal (Continue / End) | SimulationTimer `onWarning`, EndingSoonModal.tsx | `_showEndingSoon` dialog | PRESENT | |
| Auto-end at time limit + 15 s grace | `onTimeLimit` | `_onTick` → `_endCall` | PRESENT | |
| SessionGoalTimer (when `timerMode`: "x min y sec remaining", session-timer label) | SessionGoalTimer.tsx | — (no `timerMode` in simulation_models.dart) | MISSING | |
| SessionProgress (scenario `stateNames` progress) | SessionProgress.tsx | — (no `stateNames` in the model) | MISSING | |
| AI ParticipantTile + learner picture-in-picture, speaking border/pulse | ParticipantTile.tsx | participant_tile.dart | PRESENT | |
| Audio-level waveform (`useAudioLevel`, polled 100 ms) | AudioWave/useAudioLevel.ts | participant_tile.dart (uses `isSpeaking` only) | PARTIAL | No level-driven animation. |
| TurnIndicator / SpeakingIndicator (thinking / AI speaking / your turn), AGENT_STATE data messages, debounced remote speaking | TurnIndicator.tsx, SpeakingIndicator.tsx | turn_state.dart `deriveTurnStates`, participant_tile.dart | PRESENT | |
| ScenarioInfoOverlay (i): title + trigger warnings | ScenarioInfoOverlay.tsx | roleplay_voice_screen.dart (scenario info overlay) | PRESENT | |
| Info tab bar: Checklist / Reminders / Description (each tab only when it has content) | SimulationAssistantScreen `infoTabs`, SessionInfoTabs.tsx | session_info_tabs.dart | PRESENT | |
| SessionChecklist (CHECKLIST mode, ticked via `detected_event_ids`); falls back when there are 0 events | SessionChecklist.tsx | checklist_panel.dart | PRESENT | |
| LiveFeedback toast (emoji + message), hidden in checklist/focus mode | LiveFeedback.tsx | live_feedback_toast.dart | PRESENT | |
| SessionScoreMeter (accumulated score; hidden when `showScoreMeter === false`) | SessionScoreMeter.tsx | session_score_meter.dart | PRESENT | |
| SimulationControls: collapsible button group (mic, focus, pause, end) | SimulationControls.tsx | roleplay_voice_screen.dart (`_controlsMaximized`) | PRESENT | Merged via `517c5e4`. |
| Mic toggle (error toast `errors.toggleMic`) | `handleToggleMic` | `_toggleMic` | PRESENT | Errors aren't surfaced. |
| Focus mode (hidden for NONE experience mode) | `showFocusButton={!isNoneMode}` | `_isFocusMode` | PRESENT | |
| Pause/resume (only when `pauseEnabled === true`): mic off, clock frozen, publish {type:pause/resume}, 2.5 s ack timeout revert + `errors.pauseControl` | `handleTogglePause`, `armControlAck` | pause_resume_state.dart, `_togglePause` | PRESENT | |
| Agent control messages paused/resumed ack, cap-warning → EndingSoon, cap-ended | onDataReceived | `_handleDataMessage` | PARTIAL | cap-ended is a no-op on the assumption that a disconnect follows, but no disconnect handler exists (see the MISSING row above). |
| End session: disconnect, `POST /learn/scenario-session/:id/end` {enableRecommendations:true}, always replace with Feedback (in `finally`) with pathId/caseId/languageId | `handleDisconnect` | `_endSession` → `pushReplacement('/simulations/feedback/:id')` | PARTIAL | Flutter only navigates on success (stays with an inline error on failure), sends no `enableRecommendations` body, no pathId/caseId, and doesn't invalidate credits/paths/cases. |
| Hardware/system back during the session → "End Simulation?" IllustratedModal | useHardwareBackPressHandler + IllustratedModal | `PopScope` + `_showEndConfirmation` | PRESENT | |
| Dark full-bleed call layout, RN info-tab styling | styles.ts | roleplay_voice_screen.dart | PRESENT | Merged via `517c5e4`. |
| Error toasts (`errors.connect` / `attachListeners` / `audioSession` / `toggleMic`) | useErrorToast | inline `_error` text | PRESENT | Different surface, same information. |
| Mic permission | requested upstream in useStartSimulation | `_connect` Permission.microphone.request | PRESENT | Settings deep link gap counted in §2. |
| Background audio (call continues when the app is backgrounded) | LiveKit SDK | livekit_client (per livekit_room_service doc) | PRESENT | Not verified at runtime. |
| Credits refresh after the session | endScenarioSession invalidates SimulationCredits | — | N/A | Counted in §3. |
| Analytics | — | — | N/A | |

Tally: PRESENT 20 · PARTIAL 6 · MISSING 7 · N/A 2

---

#### 9. SimulationFeedbackScreen

RN: `screens/SimulationFeedbackScreen/SimulationFeedbackScreen.tsx` + 47 component files, `components/FeedbackPopup`, `components/SessionRatingTrigger`, `hooks/useHideReviewDetails.ts`, `hooks/useToggleReviewPrivacy.ts`, `hooks/useSimulationSessionRecordingUrl.ts`, `hooks/useSimulationTranscriptDetails.ts`.
Flutter (master, after merge `e248a07`): `features/simulations/presentation/simulation_feedback_screen.dart`, `simulation_transcript_tab.dart`, `widgets/feedback/{debrief_tab,debrief_sections,supervisor_note,feedback_popup,feedback_widgets}.dart`, `core/widgets/ask_ai_chat/*`, `data/simulation_transcript_repository.dart`, `data/simulations_repository.dart`, `data/simulation_models.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params scenarioSessionId, fromLogs, pathId, caseId | navigation/types.ts | `/simulations/feedback/:id?fromLogs=` | PARTIAL | No pathId / caseId. |
| Fetch `GET /learn/scenario-session/:id?enableRecommendations=true`, polling every 3.5 s ×7 until feedback lands (or both tabs off); retry-limit state | `fetchSimulationDetailsWithRetry` | `_fetchWithRetry` / `_restartPolling` | PRESENT | |
| Restart polling when the UI language changes | effect on `activeLanguageCode` | — | MISSING | A learner who switches language never gets the translated debrief until they reopen the screen. |
| Restart polling on screen re-focus | useFocusEffect | only after returning from share-for-review | PARTIAL | |
| Header: back arrow, "Simulation *Summary/End*" (by fromLogs) | `renderTitle` | `_buildTitle` | PRESENT | |
| Title / tabs gated by `view:session-scenario-messages` | `hasScenarioMessagesPermission` | `canSeeMessages` | PRESENT | |
| Share switch (feedback on, not a short session): on with no review or a review <10 min old → share flow; otherwise toggle privacy (toasts) | `CustomSwitch onToggle`, useToggleReviewPrivacy | `_buildTitle` switch, `_shareSimulation`, privacy toggle + `privacyUpdated` / `errorUpdatePrivacy` snackbars | PRESENT | |
| Share for review → ShareForReview(reviewId, scenarioSessionId, scenarioData, note) | `handleShareSimulation` | `/share-for-review/:id` extra | PRESENT | |
| Review fetch `GET` review by id (status, note, createdAt) | useGetReviewByIdQuery | `_loadReview` (reviews_repository) | PRESENT | |
| SessionRatingTrigger (5 stars, sm) → opens the popup with that rating | SessionRatingTrigger | feedback_widgets.dart `SessionRatingTrigger` | PRESENT | |
| FeedbackPopup (title, stars, caption, per-rating tag chips, comment, Submit) | components/FeedbackPopup | feedback_popup.dart | PRESENT | |
| Auto-open the rating popup on a fresh session without feedback; adopt existing `sessionFeedback` | init effect | `_handledFeedbackInit` | PRESENT | |
| Leave-without-rating interception (popup source auto/leave/manual) | `handleFeedbackAndNavigate`, `hideFeedbackPopup` | `_onBackPressed`, `_hidePopup`, PopScope | PRESENT | |
| Submit `POST /learn/scenario-session/:id/feedback` {rating, feedback, tags} + success/fail toast; leave after submit when source=leave or feedback is disabled | `submitFeedback` | `_submitFeedback` | PRESENT | |
| Back: path/case → reset to path/case details; fromLogs → goBack; otherwise → Learn tab | `handleBack` | `_handleBack` (fromLogs pop, else `go('/home')`) | PARTIAL | No path/case reset (no params). |
| `feedbackTabs` (debrief / transcript toggles), DEFAULT fallback, both off = rating only | `feedbackTabs`, `feedbackEnabled` | `showDebriefTab` / `showTranscriptTab` / `feedbackEnabled` | PRESENT | |
| Short session (≤30 s) → only the "Session Review" tab (ShortSessionUI card) | getSimulationSummaryTabs, SummaryTab → SimulationSummary → ShortSessionUI | feedback_widgets.dart `ShortSessionSummary` | PRESENT | |
| SimulationSummarySkeleton while loading | SummaryTab | `_NoteSkeleton` / summary loading | PRESENT | |
| Tab bar (scrollable, primary indicator), active tab falls back to the first | `renderTabBar`, effect | `_buildTabBar`, TabController rebuild | PRESENT | |
| EventChecklist (CHECKLIST mode, not short): `GET /learn/scenario-session/:id/event-checklist`, green/red rows | EventChecklist.tsx | feedback_widgets.dart `EventChecklist`, repository `getEventChecklist` | PRESENT | |
| DebriefTab: header, generating skeleton + hint, failed state, SupervisorNote | Debrief/DebriefTab.tsx | widgets/feedback/debrief_tab.dart | PRESENT | |
| SupervisorNote: Ally avatar, "from Ally", AI-generated badge + tooltip, sections, `**bold**`, `[[msg:id]]` → "See this moment" chips | Debrief/SupervisorNote.tsx, debriefSections.ts | supervisor_note.dart, debrief_sections.dart | PRESENT | |
| Moment chip → switch to Transcript, page until the row loads, scroll + highlight; "moment not found" toast | `handleOpenMoment`, SimulationTranscript | `_openMoment`, simulation_transcript_tab.dart | PRESENT | |
| Ask-AI reply thread: history `GET /learn/scenario-sessions/:id/chat/history`, SSE stream `POST …/chat/stream`, streaming bubble, citations table, interrupted state, error + Retry, 2,000-char limit, keyboard handling | AskAI/chatSessionManager.ts, useAskAIChat.ts, ChatElements.tsx, DebriefReplyInput.tsx | core/widgets/ask_ai_chat/{ask_ai_chat_api,controller,widgets,markdown,sse_event_parser}.dart | PRESENT | RN keeps a module-level session store, so a stream survives leaving the screen. Flutter's controller is screen-scoped and cancels on dispose. |
| Read-only debrief from Logs (no reply thread) | `readOnly={fromLogs}` | `readOnly` | PRESENT | |
| Transcript tab: card, accuracy disclaimer, paginated `GET /learn/scenario-session/:id/messages` (10/page), learner/AI tinted rows, `mm:ss Speaker`, agent name, empty state | TranscriptTab, SimulationTranscript, SimulationTranscriptItem, EmptyTranscript | simulation_transcript_tab.dart | PRESENT | |
| Session recording player: `GET /learn/scenario-session/:id/recording` presigned URL, play/pause/seek, "no recording" text | SimulationAudioPlayer.tsx (571 lines), useSimulationSessionRecordingUrl.ts | — (the transcript tab doc says "Not ported") | MISSING | Learners can't replay their session audio. |
| Playback-synced transcript highlighting + tap-to-seek | SimulationTranscript | — | PARTIAL | Depends on the player; transcript without sync only. |
| Transcript translation language dropdown | SimulationTranscript `useLanguageDropdown`, languageCodeEndpoints | — | MISSING | |
| Floating review button (feedback on, not the Debrief tab, review exists, `!hideReviewDetails`, `view:simulation-review`) → ReviewDetails | `handleViewReview`, useHideReviewDetails (threads / reactions count) | `_ReviewButton`, `_checkHideReviewDetails` (getThreads, getReactionsCount) | PRESENT | |
| "Try another simulation" button (not Debrief, not fromLogs, no path/case, details loaded) | `renderTryAnotherSimulation` → `handleSubmit` (opens the rating popup) | `context.push('/simulations')` | PARTIAL | Different action: Flutter opens a standalone SimulationsScreen route (outside the tab shell); RN reopens the rating popup. The path/case hide condition isn't possible without params. |
| Hardware back → same interception | useHardwareBackPressHandler | PopScope | PRESENT | |
| Lazy tab placeholder spinner | TabView `renderLazyPlaceholder` | TabBarView | PRESENT | |
| Session date/duration for share (`formatDurationAsMMSS`) | handleShareSimulation | `_shareSimulation` (seconds string) | PRESENT | |
| Reactions (count drives review-button visibility) | useLazyGetReactionsCountQuery | reactions_repository `getReactionsCount` | PRESENT | |
| Language-translated payload headers (languageCodeEndpoints) | services/languageCodeEndpoints.ts | — | PRESENT | The app-wide interceptor sends the language. Not re-verified here; see the network ledger. |
| SessionGlimpse | components/SessionGlimpse | — | N/A | Not rendered anywhere in RN (dead code). |
| ExpandableFeedbackSection + RecommendationBox | components/ExpandableFeedbackSection, RecommendationBox | — | N/A | Not rendered in RN (dead code). |
| PrivacyToggle | components/PrivacyToggle | — | N/A | Not rendered in RN; the header switch replaces it. |
| FeedbackDropdown | components/FeedbackDropdown | — | N/A | Not rendered in RN. |
| UpNextSimulationCard / SimulationTransitionSection / useSimulationTransition (up-next transition, `GET …/upcoming-scenario`) | components/SimulationTransitionSection, UpNextSimulationCard, hooks/useSimulationTransition.ts | — | N/A | Exported but never rendered by any RN screen. `upcoming-scenario` endpoints are unused in live RN UI. |
| Standalone AskAI panel + AskAiInitialState | components/AskAI/AskAI.tsx, AskAiInitialState.tsx | — | N/A | Not rendered in RN; DebriefTab uses the hook directly. |
| SummaryCard reuse (CallTranscript) | components/SummaryCard | feedback_widgets.dart `FeedbackSummaryCard` | PRESENT | |
| Analytics | — | — | N/A | |

Tally: PRESENT 29 · PARTIAL 5 · MISSING 3 · N/A 7

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
| POST /learn/scenario-session/:id/end (body enableRecommendations) | Assistant / ActiveSimulationModal | PARTIAL (no body; no cache invalidation) |
| GET /learn/scenario-session/:id?enableRecommendations=true | Feedback | PRESENT |
| POST /learn/scenario-session/:id/feedback | Feedback | PRESENT |
| GET /learn/scenario-session/:id/messages | Transcript | PRESENT |
| GET /learn/scenario-session/:id/recording | Audio player | MISSING |
| GET /learn/scenario-session/:id/event-checklist | EventChecklist | PRESENT |
| GET/POST /learn/scenario-sessions/:id/chat/{history,stream} | Debrief Ask-AI | PRESENT |
| GET /learn/scenario-paths/:id/upcoming-scenario, GET /learn/cases/:id/upcoming-scenario | dead RN code | N/A |
| GET /learn/tracks, /:id, /:id/progress, /:id/next-item; POST /:id/enroll; PUT /:id/language | Course screens | PRESENT |
| POST /learn/tracks/items/:id/{start,article-read,video-progress,quiz-attempts,game-result,branching-result,bucket-sort/place,bucket-sort/restart,journal,journal/submit} | Player | PRESENT |
| POST …/article-questions/:qid/answer, …/interjections/:iid/answer | Player | PRESENT |
| POST /learn/tracks/items/:id/quiz-attempts/:aid/regrade | Quiz | MISSING |
| GET /learn/tracks/:id/languages | unused by RN UI | N/A |
| Discussion GET/POST/PUT/DELETE + locks | Player discussion | PRESENT (tenants endpoint unused by RN UI) |
| GET /badges/me (BadgePopup polling) | Learn tab BadgePopup | MISSING |


### §2d Reviews (from reviews_and_components part A)

### Parity ledger — Reviews (Part A) and shared components (Part B)

RN source of truth: `ally-platform/ally-mobile/src`. Flutter baseline: `ally-mobile-flutter` **committed `master` at e248a07** (this already includes the `parity/feedback` merge, which landed while this audit ran: SimulationFeedback rebuild, Ask-AI, FeedbackPopup, SessionRatingTrigger, roleplay `CollapsibleButtonGroup` port). In-flight work: branch `parity/reviews` (commits a91ed21, dda6d85, f5fb4f0, e780dd4, not merged into master). An item is marked IN PROGRESS only after its code was read in that branch (`git show parity/reviews:<path>`).

Status key: **PRESENT** = master has the behaviour (or the same behaviour under another name). **PARTIAL** = master has part of it (the Notes column says what is missing). **MISSING** = master has nothing. **IN PROGRESS** = master is MISSING or PARTIAL, but `parity/reviews` implements it. **N/A** = RN never renders it, or it is gated to dev builds.

#### Tallies

| Part | Rows | PRESENT | PARTIAL | MISSING | MERGED (was IN PROGRESS on parity/reviews) | N/A |
|---|---|---|---|---|---|---|
| A — Review screens + hooks | 77 | 26 | 4 | 3 | 42 | 2 |
| B — Shared components (67 dirs; sub-components split into 72 rows) | 72 | 33 | 13 | 5 | 15 | 6 |

Every IN PROGRESS item is MISSING or PARTIAL on master. If `parity/reviews` is never merged, add those counts to MISSING/PARTIAL.

---

#### Part A — Review screens

Flutter master files: `lib/features/reviews/presentation/{review_screen,review_card,review_details_screen,thread_detail_screen,share_for_review_screen,review_note_callout,simulation_details_card,simulation_audio_player}.dart`, `lib/features/reviews/data/{reviews_repository,scribe_reviews_repository,review_models}.dart`.
`parity/reviews` adds or rewrites: `review_widgets.dart`, `review_details_parts.dart`, `review_conversation.dart`, `review_comment_sheets.dart`, `comment_list_controller.dart`, `data/review_api.dart`. It deletes `thread_detail_screen.dart`.

##### A1. ReviewScreen (Review tab) — RN `screens/ReviewScreen/ReviewScreen.tsx`, `components/ReviewList.tsx`, `hooks/useReviews.ts`, `constants/reviews.ts`

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A1.1 | Header | `TabScreenHeader title=review.title` | `review_screen.dart` `TabScreenHeader` | PRESENT | |
| A1.2 | Type tabs gate | Scribe/Simulation `TabView` (underline TabBar) only when user has both `VIEW_SIMULATION_REVIEWS` and `VIEW_SCRIBE_REVIEWS`; Scribe first; with only one permission that list renders directly | `review_screen.dart` `_UnderlineTabRow` + permission logic | PRESENT | Branch restyles it to `_ReviewTypeTabBar` (padding, hairline shadow). |
| A1.3 | Detail-open gate | `VIEW_SIMULATION_REVIEW` / `VIEW_SCRIBE_REVIEW` → `canViewReview`; when false, "Review Conversation" link is hidden and the comment preview can't open details | master: link rendered but **disabled** (`onPressed: null`); branch: `onOpenReview` null → link hidden | MERGED (was IN PROGRESS on parity/reviews) | master shows a dead grey link. |
| A1.4 | No-permission fallback | Neither permission → simulation list (`reviewTypeTabs[0] ?? SIMULATION`) | master: centered plain `review.empty.title` text; branch: `AppEmptyState` (emptyReviews icon + description) | MERGED (was IN PROGRESS on parity/reviews) | Edge case. |
| A1.5 | BadgePopup | `isReviewerOnly(permissions) && <BadgePopup/>` on the Review tab | none | MISSING | See B row BadgePopup. Reviewer-only users never see badge-unlock celebrations. |
| A1.6 | Read filter | All/Read/Unread pill `TabView tabWidthMode="content"` | master `AppTabView` (equal-width tabs); branch `_ContentWidthTabs` | PRESENT | Width mode differs on master (cosmetic); branch exact. |
| A1.7 | Sort dropdown | `CustomDropdown alignModalRight`: Latest / Most viewed / Most commented | master `AppDropdown`; branch `_SortDropdown` (right-aligned card) | PRESENT | |
| A1.8 | Filter/sort change | Resets offset, clears list, refetches | master: new family-provider key → refetch | PRESENT | |
| A1.9 | Pagination | `useReviews` LIMIT 10, `onEndReached` 0.5, `hasMore = page==10 && offset+len<count` | master: one request, `limit: 25, offset: 0` (`reviews_repository.dart:28`), no load-more; branch: 10/page + scroll threshold 0.5 | MERGED (was IN PROGRESS on parity/reviews) | **On master, reviews after the 25th can't be reached.** |
| A1.10 | Pull-to-refresh | `FlatList refreshing/onRefresh` | master none; branch `RefreshIndicator` | MERGED (was IN PROGRESS on parity/reviews) | |
| A1.11 | Refresh on re-focus | `useFocusEffect` → `refresh()` on every return after the first | none in master or branch (branch `_openReview` is a plain `push`, no `.then` refresh) | MISSING | After the user returns from details, read/unread state and comment/reaction counts stay stale until a manual pull. |
| A1.12 | Loading state | Footer `ActivityIndicator` while loading/fetching/hasMore | master: full-screen spinner; branch: footer spinner | MERGED (was IN PROGRESS on parity/reviews) | |
| A1.13 | Empty state | `EmptyState` icon `EmptyReviewIcon` + `review.empty.title` + `review.empty.description` | master: plain title text only; branch: `AppEmptyState(emptyReviews.svg, title, description)` | MERGED (was IN PROGRESS on parity/reviews) | |
| A1.14 | Error state | `showToast(review.error.title,'error')`; list stays | master: inline `review.error.title: $error` replaces list; branch: SnackBar | MERGED (was IN PROGRESS on parity/reviews) | master leaks the raw exception text. |
| A1.15 | Navigation → details | `REVIEW_DETAILS` or `SCRIBE_REVIEW_DETAILS` `{reviewId}` | `/reviews/:id` (+ `extra: ReviewType.scribe`) | PRESENT | Master's simulation path pushes without `extra` (defaults to simulation, fine). |
| A1.16 | Mark-as-read timing | Not on tap; details screen marks read after 10 s | master: awaits `markAsRead` **on tap**, before navigating (a slow call delays the open; reviews opened from CallSummary/SimFeedback are never marked read); branch: 10 s timer on details | MERGED (was IN PROGRESS on parity/reviews) | |
| A1.17 | Unread dot on Review tab | `TabNavigator` sums sim + scribe unread counts | `app_shell_screen.dart` `unreadReviewCountProvider` → `app_bottom_tab_bar.dart` dot | PRESENT | |
| A1.18 | Analytics | None in RN review screens/hooks (grep: no analytics/logEvent) | — | N/A | |

##### A2. ReviewCard (list item) — RN `ReviewScreen/components/ReviewCard.tsx`, `ExpandedComments.tsx`, `ReactionsCount.tsx`

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A2.1 | Author row | `UserProfileImage` (36, image or initial with border) + name + `formatRelativeTime` | master `CircleAvatar`; branch `ReviewUserAvatar` | PRESENT | Avatar style approximate on master. |
| A2.2 | Note | Full note text | `review_card.dart` | PRESENT | |
| A2.3 | Simulation body | Date&time / Duration rows, then `SimulationDetailsCard` (cover, chip, title, plain-text description with View more) | `review_card.dart` + `simulation_details_card.dart` | PRESENT | |
| A2.4 | Scribe body | `SimulationDetailsCard` titled `summaryName`, Date/Duration rows inside | `review_card.dart` | PRESENT | |
| A2.5 | Cover video | `SimulationDetailsCard` plays `coverVideoUrl` via `VideoPreview` | master and branch: TODO(video-preview), image only | MISSING | `CoverVideoPreview` exists in core but isn't wired into this card. |
| A2.6 | Audio player | `SimulationAudioPlayer` when sim review has `audioUrl` | `simulation_audio_player.dart` | PRESENT | |
| A2.7 | Reactions summary | `ReactionsCount`: top-3 emoji bubbles overlapped + `pluralize(n,'reaction')` → `REACTIONS {reviewId, reviewType}` | master: a smile.svg icon + count (no top-3 emoji bubbles) → `/reactions/:id`; branch: `ReactionsCount` with `getTopReactions(3)` bubbles | MERGED (was IN PROGRESS on parity/reviews) | |
| A2.8 | Comment-count toggle | Tap → fetch general-comments overview (offset 0, limit 2) once, expand inline; tap again collapses; 0 comments = no-op | master: tap opens details; branch: `_toggleComments` + `ExpandedComments` | MERGED (was IN PROGRESS on parity/reviews) | |
| A2.9 | ExpandedComments | Spinner while loading; ≤2 `ReviewComment`s (no reply/reaction buttons; tap → details); "No comments yet"; "Show more" when count>2; "Collapse" with chevron | branch `review_card.dart` `ExpandedComments` | MERGED (was IN PROGRESS on parity/reviews) | master: none. |
| A2.10 | Review Conversation link | `ChatAddOnIcon` + `review.feedCard.reviewTranscript`, only when `onReviewPress` | master: always shown, disabled without permission; branch: hidden | MERGED (was IN PROGRESS on parity/reviews) | Same as A1.3. |

##### A3. ReviewDetailsScreen — RN `SimulationReviewDetailsScreen.tsx`, `ScribeReviewDetailsScreen.tsx`, `components/ReviewDetailsLayout.tsx`, `GeneralCommentsSection.tsx`, `ReviewNote.tsx`, `hooks/useReviewDetailsLogic.ts`, `useReviewComments.ts`, `contexts/ReviewApiContext.tsx`

Master `review_details_screen.dart` is a different design: an AppBar with a reactions icon, an author row, then **Discussion / Threads TabBar tabs**. It has **no transcript**, and threads open a separate full-screen `ThreadDetailScreen`. The `parity/reviews` rewrite (dda6d85) ports the RN layout.

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A3.1 | Data source per type | `ReviewApiProvider` (simulationApiHooks / scribeApiHooks) | master: `reviewType` switches repositories; branch: `review_api.dart` abstraction | PRESENT | Same idea. Branch consolidates it into one API class. |
| A3.2 | Review fetch | `useGetReviewByIdQuery` refetchOnMount/Focus/Reconnect | master `reviewDetailProvider` (FutureProvider, fetched once, invalidated after actions) | PARTIAL | No refetch on focus/reconnect (master and branch). |
| A3.3 | Mark read after 10 s | `setTimeout(markXReviewAsRead, 10000)`, cleared on unmount | master: none on this screen (done on list tap); branch: `_markReadTimer` 10 s, cancelled in dispose | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.4 | Header | Back arrow + `ReviewTranscriptHeader` (type chip, title, help icon → scenario details modal (sim), "By avatar name • date • Duration") over a lightGray7 rule | master: AppBar "Review" + avatar/name only; branch: `review_details_parts.dart` `ReviewTranscriptHeader` + `_ScenarioDetailsDialog` | MERGED (was IN PROGRESS on parity/reviews) | Branch dialog shows cover image; cover video still a TODO. |
| A3.5 | Scribe title fallback | `summaryName` or `review.details.callTitle {id}` | branch `title:` uses `summaryName` / callTitle | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.6 | Transcription disclaimer | Simulation only: `transcription.accuracyDisclaimer` | master + branch | PRESENT | |
| A3.7 | Audio player header | `SimulationAudioPlayer` as list header (sim with audioUrl), no transcript sync | master + branch | PRESENT | |
| A3.8 | ReviewNote | Orange callout "NOTE"; edit icon when the user can edit; "+" add-note button when note is empty and editable; hidden when no note and not editable | master: callout only when the note is non-empty (no "+" add-note); branch `review_note_callout.dart` handles both | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.9 | Edit-note gate | Owner && not HIDDEN && created < 10 min (`isMinutesPassed`) | master `_isMinutesPassed` + owner + !private | PRESENT | |
| A3.10 | Edit-note navigation | → `SHARE_SIMULATION`/`SHARE_CALL_LOG` with `isEditNote`, `note`, scenario/session context (cover, title, description, createdAt, duration) | master: `/share-for-review/:id`, all context fields null → card degrades to nothing; branch passes `contextTitle`, dateTime, duration | MERGED (was IN PROGRESS on parity/reviews) | Branch still drops cover/description. |
| A3.11 | Transcript (Conversation) | Paged 10 messages, de-duped, "mm:ss Speaker: text"; owner name for learner side; pull-to-refresh; footer spinner while loading more | master: **none**; branch `review_conversation.dart` `TranscriptMessageRow` + paging in `review_details_screen.dart` | MERGED (was IN PROGRESS on parity/reviews) | **Main master gap: reviewers can't read the transcript they are reviewing.** |
| A3.12 | Comment from text selection | `isSelectable = !isPrivate && canEditThread`; native selection menu "Add comment" → `CommentInput` sheet → POST `{messageId, selection{start,end,text}, content}`; new thread inserted locally | master: none (doc: "isn't wired"); branch: `SelectableText` + `_AddCommentMenu` + `_CommentInputSheet` + `selectionToMessageRange` | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.13 | Commented-range highlight + tap | `splitByCommentRanges` amber highlight; tap → `MessageThreadsBottomSheet` (only if `canViewThreads`, not while composing) | master none; branch `onThreadsTap` → `MessageThreadsSheetPage` | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.14 | General comments footer | `GeneralCommentsSection` once all transcript pages load: "Comments", own avatar + "Add a comment" input + send; list (20/page, "Load More"); reply → ReplyBottomSheet; inline edit within 10 min; delete with confirmation; hide/unhide (review owner); emoji reactions | master: "Discussion" tab — flat `ListTile`s (author + text), `AppChatInput` add only; no pagination, reactions, reply, edit, delete or hide | MERGED (was IN PROGRESS on parity/reviews) | Branch `GeneralCommentsSection` + `CommentListController`. |
| A3.15 | InteractionsBar (floating) | Bottom pill: Share switch (sim owners with EDIT perm), comment button + count → ThreadsBottomSheet (if `canViewThreads`), own emoji reaction on the review (`myReaction`), divider, ReactionsCount | master: AppBar smile icon → Reactions screen; **no way to react to the review itself**; privacy switch in the author row | MERGED (was IN PROGRESS on parity/reviews) | Branch `InteractionsBar`. |
| A3.16 | Privacy toggle | `useToggleReviewPrivacy`: on→IN_REVIEW, off→HIDDEN; toast success/error; sim: in InteractionsBar; scribe: in header (`toggleInHeader`); owner + `EDIT_*_REVIEW` only | master `_togglePrivate` (correct endpoint per type) in the author row, SnackBar | PRESENT | Placement differs; branch matches RN placement. |
| A3.17 | Threads sheet | `ThreadsBottomSheet`: Inline / General tabs, thread cards (selected text, first comment faded, "N more comments") → CommentThreadBottomSheet; General list + footer input | master: "Threads" tab list → `ThreadDetailScreen` (full page) | MERGED (was IN PROGRESS on parity/reviews) | Branch `review_comment_sheets.dart` `_ThreadsPage`. |
| A3.18 | Comment thread view | `CommentThreadBottomSheet`: back header, comments with Reply/reactions/actions, "Add comment" footer hidden when private | master `thread_detail_screen.dart` (anchor + root + paged replies + reply box + reaction chips + Edit/Delete/Hide popup menu) | MERGED (was IN PROGRESS on parity/reviews) | master is a usable full-screen substitute (PARTIAL on master). |
| A3.19 | Reply view | `ReplyBottomSheet`: original comment + indented replies + "Add reply" footer; deleting original goes back | master: replies inline in ThreadDetailScreen; branch `_ReplyPage` | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.20 | Sheet back-stack | `useReviewComments`/`replySourceRef`: back returns to the originating sheet (threads list, message threads, or closes for inline-general) | branch: page stack inside one sheet | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.21 | Android hardware back | `useHardwareBackPressHandler` closes the top sheet first, then `goBack` | branch: sheets are modal routes (system back pops them) | MERGED (was IN PROGRESS on parity/reviews) | Implicit in Flutter. |
| A3.22 | Local thread-sync | `handleThreadCommentChange` add/edit/delete/hide mirrored into transcript; a thread with no comments left disappears (un-highlights) | branch `_onThreadCommentChange` | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.23 | Gates | sim: `VIEW_SIMULATION_REVIEW_THREADS` (threads), `EDIT_SIMULATION_REVIEW_THREAD` (selection), `EDIT_SIMULATION_REVIEW` (privacy); scribe: threads/selection always on, `EDIT_SCRIBE_REVIEW` | master: only the edit-review gate (threads tab is always visible, no thread perms checked); branch: `canViewThreads`/`canEditThread` exactly as RN | MERGED (was IN PROGRESS on parity/reviews) | master shows threads to users without `VIEW_SIMULATION_REVIEW_THREADS`. |
| A3.24 | Private-review restrictions | isPrivate: no selection, no actions menu, no reply button, reaction disabled on anchor, footers hidden | master `ThreadDetailScreen.isPrivate` (menus + composer hidden); branch everywhere | MERGED (was IN PROGRESS on parity/reviews) | |
| A3.25 | Loading / error | `isLoading` spinner; `isError` → spinner (RN shows a spinner on error too) | master: spinner / "loadReviewFailed: $error" text; branch: same + RefreshIndicator | PRESENT | Flutter's error text is more informative than RN's. |
| A3.26 | Delete confirmation | `ConfirmationModal` destructive (threadsBottomSheet.deleteConfirmation.*) | master `ConfirmationModal.show` in ThreadDetail; branch in all comment lists | PRESENT | |

##### A4. ShareForReviewScreen — RN `ShareSimulationScreen.tsx`, `ShareCallLogScreen.tsx`, `components/ShareReviewLayout.tsx`, `hooks/useShareScreenLogic.ts`

Flutter: one `share_for_review_screen.dart` (`isScribe` switch) at `/share-for-review/:scenarioSessionId`. Reached from `simulation_feedback_screen.dart` and `call_summary_screen.dart` (`_handleShareToggle`).

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A4.1 | Header | Close (X) + title: edit → `review.details.editNote`; scribe share → `review.details.shareModalHeader`; sim share → `simulationPage.shareScreenTitle` | master: `TabScreenHeader` with editNote/shareScreenTitle (scribe uses the sim title, no X); branch: X + title | MERGED (was IN PROGRESS on parity/reviews) | Check the scribe-specific title in the branch at merge. |
| A4.2 | Note input | `LineTextInput` placeholder `review.addNotePlaceholder`, maxLength 250, counter `n/250` (grapheme count) | master: TextField maxLength 250, `.length` counter; branch: `characters.length` | PRESENT | Master counts UTF-16 units, so emoji count double. |
| A4.3 | Context card | Sim: Date&time/Duration rows + `SimulationDetailsCard` (cover image/video, title, description); scribe: card titled session name with rows inside | `SimulationDetailsCard`; sim caller passes only dateTime/duration (no title/cover/description) | PARTIAL | Sim share card lacks scenario title/cover/description; no cover video. |
| A4.4 | Emoji picker | `rn-emoji-keyboard` (search, recents, multi-select), appended to note while under limit | `core/widgets/emoji_insert_picker.dart` (fixed grid, no search/recents) | PARTIAL | Scoped by design. |
| A4.5 | Submit button | `Button` Share / Save | `AppButton` | PRESENT | |
| A4.6 | Create (sim) | `createReview {scenarioSessionId, note}` → toast `callFeedback.sharedForReview` → goBack | master: `context.go('/home')`, **no toast**; branch: toast + `pop` | MERGED (was IN PROGRESS on parity/reviews) | Master throws the user out of the feedback screen to Home. |
| A4.7 | Create (scribe) | `createScribeReview` → toast → `replace(SCRIBE_REVIEW_DETAILS, newId)` | master: `pushReplacement('/reviews/$id')`, no toast; branch: toast + replace | MERGED (was IN PROGRESS on parity/reviews) | |
| A4.8 | Update (reviewId present) | `updateStatus {IN_REVIEW, note}` → toast (share: sharedForReview; edit: editNoteSuccess) → goBack | master: no toast; sim → `go('/home')`, scribe → `pop`; branch: toast + pop | MERGED (was IN PROGRESS on parity/reviews) | |
| A4.9 | Error handling | Toast server `data.message` (and goBack) or `callFeedback.issues.editNoteExpired` | master: inline red `review.shareFailed: $e`; branch: DioException message → SnackBar + pop | MERGED (was IN PROGRESS on parity/reviews) | |
| A4.10 | Analytics | None | — | N/A | |

##### A5. Review hooks / context

| # | Hook | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A5.1 | `contexts/ReviewApiContext` | Swaps 15 RTK hooks between simulation and scribe | master: `reviewType` branches in each widget; branch `data/review_api.dart` | PRESENT | |
| A5.2 | `useReviews` | Paged list (10), filter/sort reset, loadMore, refresh | master `reviewsListProvider` (one page of 25) | MERGED (was IN PROGRESS on parity/reviews) | See A1.9–A1.10. |
| A5.3 | `useCommentActions` — add | Prepend new comment locally after success | master: add + invalidate (general); add reply in ThreadDetail; branch `CommentListController.submit` | PRESENT | |
| A5.4 | `useCommentActions` — edit | Single input switches to update when `editingCommentId`; 10-min window | master ThreadDetail inline edit; general comments: none; branch everywhere | MERGED (was IN PROGRESS on parity/reviews) | |
| A5.5 | `useCommentActions` — delete | Confirm → delete → local remove, count−1, `goback` callback | master ThreadDetail; branch everywhere | MERGED (was IN PROGRESS on parity/reviews) | |
| A5.6 | `useCommentActions` — hide/unhide | `updateCommentVisibility`, local `hidden` flag | master ThreadDetail; branch everywhere | MERGED (was IN PROGRESS on parity/reviews) | |
| A5.7 | `useCommentActions` — emoji | `getReactionAction` ADD/UPDATE/REMOVE with local count bookkeeping and `myReaction` | master ThreadDetail always sends `ReactionAction.add` (no switch/remove) then refetches; branch full ADD/UPDATE/REMOVE bookkeeping | MERGED (was IN PROGRESS on parity/reviews) | On master a user can't remove or change a reaction. |
| A5.8 | `usePaginatedComments` | 20/page, `hasMore = loaded<count` | master: ThreadDetail replies paged; general comments unpaged; branch `CommentListController` | MERGED (was IN PROGRESS on parity/reviews) | |
| A5.9 | `useReactions` | Count summary + paged (20) list per emoji filter | `features/reactions/presentation/reactions_screen.dart` | PRESENT | Branch f5fb4f0 restyles it. |
| A5.10 | `useToggleReviewPrivacy` | IN_REVIEW/HIDDEN + toasts | master `review_details_screen.dart` `_togglePrivate`; `call_summary_screen.dart` `_handleShareToggle`; `simulation_feedback_screen.dart` `_onShareToggled` | PRESENT | |
| A5.11 | `useHideReviewDetails` | Private review shows the "view review" button only if it has threads or reactions | `call_summary_screen.dart` and `simulation_feedback_screen.dart` (doc-commented as this gate) | PRESENT | |
| A5.12 | `useShareScreenLogic` | Title/label/submit branching, 250 limit, emoji append | `share_for_review_screen.dart` | PARTIAL | Toast/navigation divergences A4.6–A4.9 (fixed in branch). |
| A5.13 | `useReviewComments` (sheet state machine) | 4 sheets with back-stack | branch `review_comment_sheets.dart` | MERGED (was IN PROGRESS on parity/reviews) | |

---


---

## §3 Shared components (`src/components/`)

### Part B — Shared components (`src/components/*`)

RN call sites were found by grepping `<Component` outside `__tests__`. Each Flutter verdict comes from reading the Flutter file, not from a single grep miss.

| RN component | RN file(s) | RN call sites | Flutter equivalent | Status | Notes |
|---|---|---|---|---|---|
| ActionsMenu | `ActionsMenu/ActionsMenu.tsx` | ReviewComment (Edit/Delete/Hide), CallLog header (Archive) | `call_log_screen.dart` `_ActionsMenu` (PopupMenuButton, threeDots.svg); `thread_detail_screen.dart` `_CommentTile` PopupMenu; branch `review_widgets.dart` `ReviewActionsMenu` | PRESENT | No shared widget on master; both call sites are covered. |
| BadgePopup | `BadgePopup/BadgePopup.tsx` + `hooks/useBadgePopup` | ReviewScreen (reviewer-only), SimulationsScreen | none. `achievements_repository.dart:56-62` and `achievements_screen.dart:25-34` document it as "not ported" | MISSING | No polling of `/badges/me` (`viewedStatus`, gated on `VIEW_USER_BADGES`), no unlock modal, no first-badge confetti (`confetti` package already used by `celebration_modal.dart`). Badges are only marked viewed by tapping them on Achievements. |
| BottomSheet | `BottomSheet/BottomSheet.tsx` (gorhom: snapPoints, handle 80x4, 16 radius, backdrop) | CommentInput, Comment/Reply/Threads/MessageThreads sheets, LanguageSelectorSheet, CallLog, CourseItemPlayer, CourseOverview, ProfileSettings | `showModalBottomSheet` in `language_selector_sheet.dart`, `call_log_filter_sheet.dart`, `course_language_sheet.dart`, `profile_image_options_sheet.dart`, `emoji_insert_picker.dart`; branch `ReviewCommentSheet` (80% snap, 80x4 handle) | PRESENT | No shared styled wrapper on master; handle/radius vary per call site. |
| BottomSheetBackHeader | `BottomSheetBackHeader/BottomSheetBackHeader.tsx` | CommentThreadBottomSheet, ReplyBottomSheet | branch `review_widgets.dart` `ReviewSheetBackHeader` | MERGED (was IN PROGRESS on parity/reviews) | master: none (ThreadDetail uses an AppBar). |
| Button | `Button/Button.tsx` | ~22 screens/components | `core/widgets/app_button.dart` `AppButton` | PRESENT | |
| GoogleLoginButton | `Button/GoogleLoginButton.tsx` | SplashScreen | `features/auth/presentation/login_screen.dart` (`_signInWithGoogle`) | PRESENT | Disabled when client id unconfigured. |
| AppleLoginButton | `Button/AppleLoginButton.tsx` | SplashScreen (iOS) | `login_screen.dart` (`sign_in_with_apple`) | PRESENT | |
| ButtonGroup / ButtonItem | `ButtonGroup/ButtonGroup.tsx`, `ButtonItem.tsx` | only via CollapsibleButtonGroup | see next row | PRESENT | Internal to CollapsibleButtonGroup. |
| CollapsibleButtonGroup | `ButtonGroup/CollapsibleButtonGroup.tsx` | ListeningScreen controls, SimulationAssistantScreen controls | `roleplay_voice_screen.dart` `_SimulationControls` (collapsible, chevron, starts collapsed — merged from parity/feedback); `scribe/presentation/listening_controls.dart` is a plain button column (doc: "this is a plain button column instead") | PARTIAL | Scribe Listening screen lacks the floating collapsible bar. |
| Carousel / Pagination / SecurityCarousel | `Carousel/*.tsx` | none rendered (SplashScreen only mocks it in tests; configs live in `constants/general.ts`) | — | N/A | Dead in RN. |
| ChartComponent | `ChartComponent/ChartComponent.tsx` | none (exported only) | — | N/A | Dead in RN. |
| Checkbox | `Checkbox/Checkbox.tsx` | SplashScreen TermsAndAgreementModal | `features/auth/presentation/terms_and_agreement_modal.dart` `_TermsCheckbox` | PRESENT | |
| SessionChecklist | `Checklist/SessionChecklist.tsx` | SimulationAssistantScreen | `features/roleplay/presentation/checklist_panel.dart` | PRESENT | Restyled in the parity/feedback merge. |
| ChipGroup / Chip | `ChipGroup/*.tsx` | FeedbackPopup (rating tags + FEEDBACK_ISSUE_OPTIONS chips) | `simulations/presentation/widgets/feedback/feedback_popup.dart` (rating tag chips); `call_summary_screen.dart` `_SummaryFeedbackPopup` (tag chips) | PARTIAL | Call-summary popup omits the `FEEDBACK_ISSUE_OPTIONS` issue-chip row RN shows for ratings 2–4 (`showChips` default true); the comment box there is always shown instead. |
| CircularProgress | `CircularProgress/CircularProgress.tsx` | LevelIndicator, CourseItemPlayer, CourseOverview, CourseProgress, SimulationsScreen | `simulations/presentation/widgets/circular_progress.dart` (used by `course_detail_screen.dart`, `simulations_screen.dart`) | PRESENT | LevelIndicator and course-progress rings use Material `CircularProgressIndicator` (no 1200 ms ease-out animation). |
| CommentBottomSheetFooter | `CommentBottomSheetFooter/*.tsx` (via `hooks/useStableFooterRenderer`) | Comment/Reply/Threads sheets | master: `core/widgets/app_chat_input.dart` reply box in ThreadDetail; branch `review_widgets.dart` `CommentFooterInput` | MERGED (was IN PROGRESS on parity/reviews) | |
| CommentInput | `CommentInput/CommentInput.tsx` | ReviewDetails (after text selection) | branch `review_comment_sheets.dart` `_CommentInputSheet` | MERGED (was IN PROGRESS on parity/reviews) | master: none (no selection-comment flow). |
| CommentThreadBottomSheet | `CommentThreadBottomSheet/*.tsx` | ReviewDetails | master `thread_detail_screen.dart` (full screen); branch `_CommentThreadPage` | MERGED (was IN PROGRESS on parity/reviews) | master works as a full-page substitute. |
| CommentableText (iOS / Android) | `CommentableText/IosCommentableText.tsx`, `AndroidCommentableText.tsx` (native selection + "Add comment" menu, highlight ranges) | Conversation | branch `review_conversation.dart` `TranscriptMessageRow` (SelectableText + custom context menu, one implementation for both platforms) | MERGED (was IN PROGRESS on parity/reviews) | master: none. |
| ConfirmationModal | `ConfirmationModal/ConfirmationModal.tsx` | Comment/Reply/Threads sheets, CallSummary (archive), ReviewDetails | `core/widgets/confirmation_modal.dart` (used by call_summary, discussion_post_tile, thread_detail, profile_settings) | PRESENT | |
| Conversation | `Conversation/Conversation.tsx` | ReviewDetails | branch `review_details_screen.dart` + `review_conversation.dart` | MERGED (was IN PROGRESS on parity/reviews) | master: none (A3.11). |
| CustomLineChart | `CustomLineChart/CustomLineChart.tsx` | none (exported only) | — | N/A | Dead in RN. |
| CustomModal | `CustomModal/CustomModal.tsx` (title, optional input, primary/secondary buttons) | CallSummary DeleteRenameModal (rename + delete), ProfileSettings (unsaved changes) | ProfileSettings → `ConfirmationModal.show` (`profile_settings_screen.dart:202`); rename → Material `AlertDialog` + TextField (`call_summary_screen.dart:335`) | PARTIAL | No shared widget; rename uses the stock Material dialog (not RN styling); **delete-session flow not ported** (`call_summary_screen.dart:215` doc). |
| CustomSwitch | `CustomSwitch/CustomSwitch.tsx` (32x18 pill) | InteractionsBar/ReviewTranscriptHeader, CallSummary, ProfileSettings, SimulationFeedback | `profile_settings_screen.dart` `RnCustomSwitch` (also used by simulation_feedback_screen); Material `Switch` themed to RN colours (`app_theme.dart switchTheme`) in call_summary and review_details; branch `ReviewSwitch` | PRESENT | Material Switch is larger than the 32x18 RN pill (cosmetic). |
| CustomTabs | `CustomTabs/CustomTabs.tsx` (scrollable underline tabs, light/dark scheme) | SearchScreen, ListeningScreen resource search | `search/presentation/search_screen.dart` category `ChoiceChip` row | PARTIAL | Pill chips instead of underline tabs; the dark-scheme ListeningScreen search isn't ported (see ResourceArticleCard). |
| DiscussionPost | `DiscussionPost/DiscussionPost.tsx` | DiscussionThread | `courses/presentation/discussion/discussion_post_tile.dart` | PRESENT | |
| DiscussionThread | `DiscussionThread/DiscussionThread.tsx` | CourseItemPlayer | `courses/presentation/discussion/discussion_thread.dart` | PRESENT | |
| Dropdown (CustomDropdown) | `Dropdown/Dropdown.tsx` | ReviewScreen sort, Leaderboard period, SimulationDetails language, SimPath modal language, RoleplayCasePlayer language, SimulationTranscript translation language, CallSummary custom fields, fieldRenderer | `core/widgets/app_dropdown.dart` (review sort); `leaderboard_screen.dart` `_PeriodDropdown`; `simulations/presentation/widgets/scenario_language_dropdown.dart` (details/modal/roleplay case); `DropdownButtonFormField` in call_summary custom fields | PARTIAL | **SimulationTranscript translation-language dropdown is missing** (`simulation_transcript_tab.dart:28-30` "Not ported"); custom fields use Material dropdown styling. |
| DropdownMenu | `DropdownMenu/DropdownMenu.tsx` | only `SummaryDropdown` / `FeedbackDropdown`, which are exported but never rendered | — | N/A | Dead in RN. |
| EmojiPicker | `EmojiPicker/EmojiPicker.tsx` (pill of platform emoji above icon; ADD/UPDATE/REMOVE) | ReviewComment, InteractionsBar | master `thread_detail_screen.dart` reaction chips + picker row (`kPlatformEmojiIds`, always ADD); branch `review_widgets.dart` `ReviewEmojiPicker` | MERGED (was IN PROGRESS on parity/reviews) | Master can't toggle a reaction off or switch to another emoji. |
| EmptyState | `EmptyState/EmptyState.tsx` | CallLog, CaseDetails, CourseOverview, CourseProgress, ReviewScreen, SimPathDetails, SuspendedAccount, UserAnalytics | `core/widgets/app_empty_state.dart` | PRESENT | ReviewScreen on master doesn't use it (A1.13). |
| EmptyTranscript | `EmptyTranscript/EmptyTranscript.tsx` (icon + `transcription.empty`) | CallSummary transcript, SimulationFeedback transcript | `simulation_transcript_tab.dart` `_EmptyTranscript` (icon + text); `call_summary_screen.dart:1559` plain centered text | PARTIAL | CallSummary transcript lacks the illustration. |
| ErrorBoundary | `ErrorBoundary/ErrorBoundary.tsx` (crashlytics.recordError + "Something went wrong" + Try again reset) | App.tsx root | none — `main.dart` sets no `FlutterError.onError` / `ErrorWidget.builder`; `firebase_crashlytics` is in pubspec but unused in lib | MISSING | Uncaught build errors show Flutter's default grey/red error widget; no crash reporting. |
| FeedbackPopup | `FeedbackPopup/FeedbackPopup.tsx` | CallSummary, SimulationFeedback | `simulations/presentation/widgets/feedback/feedback_popup.dart` (SimFeedback, merged); `call_summary_screen.dart` `_SummaryFeedbackPopup` | PARTIAL | Call-summary variant missing the issue-chip row (see ChipGroup). |
| ForceUpdateModal | `ForceUpdateModal/ForceUpdateModal.tsx` + `hooks/useForceUpdate` (`appConfigApi.getForceUpdateConfig.minimumSupportedVersion` vs app version) | SplashScreen | none (no minimum-version check anywhere in lib) | MISSING | No way to force users off a broken build. |
| IllustratedActionModal | `IllustratedActionModal/*.tsx` | SimulationDetails (ActiveSimulationModal), SimulationAssistant (EndingSoonModal) | `start_simulation/start_simulation_modals.dart` `ActiveSimulationModal`; `roleplay_voice_screen.dart` ending-soon state (`_showEndingSoon`) | PRESENT | |
| IllustratedModal | `IllustratedModal/IllustratedModal.tsx` | CaseDetails/SimPath (no credits), Listening end-call, Logout, SimAssistant end, SimDetails | `core/widgets/illustrated_modal.dart` (drawer logout, call_log start, scribe end confirmation); `LowCreditsModal` in start_simulation_modals; roleplay `_ConfirmOverlay` | PRESENT | |
| InfoTooltip | `InfoTooltip/InfoTooltip.tsx` | TabScreenHeader, Achievements, SimulationFeedback | `core/widgets/info_tooltip_icon.dart` (Material Tooltip, tap trigger) | PRESENT | Bubble styling differs from RN's walkthrough tooltip. |
| LanguageSelectorSheet | `LanguageSelectorSheet/*.tsx` | ProfileSettings | `account/presentation/language_selector_sheet.dart` | PRESENT | |
| LearningPathHeader / LearningPathListHeader / ProgressBar | `LearningPathDetails/*.tsx` | CaseDetails, CourseOverview, CourseProgress, SimPathDetails | `simulations/presentation/widgets/learning_path_widgets.dart` (`LearningPathHeader`, `LearningPathProgressBar`, list header); `learning_path_detail_view.dart` | PRESENT | |
| LevelIndicator | `LevelIndicator/LevelIndicator.tsx` | ProgressHeaderWidget, ProgressScreen | `core/widgets/level_indicator.dart` | PRESENT | Uses `CircularProgressIndicator` (no animation). |
| LineTextInput | `LineTextInput/LineTextInput.tsx` | CallLog, ShareForReview | `core/widgets/app_chat_input.dart` (send-button mode), `app_text_field.dart`, share screen TextField | PRESENT | |
| CallLogSkeleton | `LoadingSkeleton/CallLogSkeleton.tsx` | CallLog | `calllog/presentation/call_log_screen.dart` `_CallLogSkeleton` | PRESENT | |
| SimulationsSkeleton | `LoadingSkeleton/SimulationsSkeleton.tsx` | SimulationsScreen | `simulations/presentation/widgets/simulations_skeleton.dart` | PRESENT | |
| Message | `Message/Message.tsx` (timestamp + body row) | Conversation | branch `review_conversation.dart` `TranscriptMessageRow`; `simulation_transcript_tab.dart` `TranscriptItem` is the self-debrief equivalent | MERGED (was IN PROGRESS on parity/reviews) | Review transcript use is branch-only. |
| MessageThreadsBottomSheet | `MessageThreadsBottomSheet/*.tsx` | ReviewDetails | branch `review_comment_sheets.dart` `_MessageThreadsPage` | MERGED (was IN PROGRESS on parity/reviews) | master: none. |
| NetworkImage | `NetworkImage/NetworkImage.tsx` (SvgUri → fetch+SvgXml fallback, spinner, error state) | BadgePopup, AchievementsScreen | `achievements_screen.dart:276` `Image.network(..., errorBuilder: SizedBox.shrink)` | PARTIAL | No SVG support: badge art served as SVG (the reason RN's component exists) renders blank; no loading spinner. |
| NetworkLogs | `NetworkLogs/NetworkLogs.tsx` (draggable "Logs" bubble + react-native-network-logger) | App.tsx, gated `env.ENVIRONMENT === 'development'` | — | N/A | Dev-only tool. |
| NotificationModal | `NotificationModal/NotificationModal.tsx` | CaseDetails, SimDetails, SimPathDetails (pre-start) | `start_simulation_modals.dart` `PreStartNotificationModal` | PRESENT | |
| PostInput | `PostInput/PostInput.tsx` | DiscussionPost, DiscussionThread | `courses/presentation/discussion/discussion_post_input.dart` | PRESENT | Hard-caps at maxLength instead of showing RN's red over-limit state (documented). |
| PrivacyTooltip | `PrivacyTooltip/PrivacyTooltip.tsx` | Microphone + Conference ListeningScreen (data-safe bullets), CallSummary AddNotesSection (`summaryLoading.notesTooltip`) | `scribe_recording_screen.dart:365` `_showPrivacyInfo` (AlertDialog with the 4 bullets) | PARTIAL | Conference listening has none; CallSummary add-notes tooltip is missing (no `notesTooltip`/`addNotes` in lib); shows as a dialog, not an anchored tooltip. |
| ProgressHeaderWidget | `ProgressHeaderWidget/*.tsx` | TabScreenHeader | `progress/presentation/progress_header_widget.dart` | PRESENT | |
| ReplyBottomSheet | `ReplyBottomSheet/ReplyBottomSheet.tsx` | ReviewDetails | master: replies inside `thread_detail_screen.dart`; branch `_ReplyPage` | MERGED (was IN PROGRESS on parity/reviews) | |
| ResourceArticleCard | `ResourceArticleCard/*.tsx` (category, tag chips, heading, 3-line content with View more/less, light/dark) | SearchScreen, ListeningScreen resource search (dark) | `search_screen.dart` results as `ListTile(heading, 2-line content, category Chip)` | PARTIAL | No tag chips, no expand/collapse ("View more"), no dark theme; the in-call resource search on Listening isn't ported (`scribe_recording_screen.dart:48` doc). |
| ReviewComment | `ReviewComment/ReviewComment.tsx` | All comment sheets, ReviewDetails general comments, ReviewScreen ExpandedComments | master: `thread_detail_screen.dart` `_CommentTile` (avatar-less tile, reaction chips, popup menu, hidden state); general comments are plain ListTiles; branch `review_widgets.dart` `ReviewCommentTile` / `ControlledCommentTile` | MERGED (was IN PROGRESS on parity/reviews) | master missing: top-3 reaction bubbles + count, reply-count link, "Hidden" badge styling, use outside ThreadDetail. |
| ReviewTranscriptHeader | `ReviewTranscriptDetails/ReviewTranscriptHeader.tsx` | ReviewDetails | branch `review_details_parts.dart` `ReviewTranscriptHeader` | MERGED (was IN PROGRESS on parity/reviews) | master: none. |
| InteractionsBar | `ReviewTranscriptDetails/InteractionsBar.tsx` | ReviewDetails | branch `review_details_parts.dart` `InteractionsBar` | MERGED (was IN PROGRESS on parity/reviews) | master: none; can't react to a review (A3.15). |
| ReviewTypeChip | `ReviewTypeChip/ReviewTypeChip.tsx` | ReviewTranscriptHeader, SimulationDetailsCard | `core/widgets/review_type_chip.dart` | PRESENT | |
| RichText | `RichText/RichText.tsx` | LearningPathDetails, CourseItemPlayer, SimulationAssistant, SimulationDetails | `core/widgets/html_rich_text.dart` `HtmlRichText` | PRESENT | |
| SearchableLocationDropdown | `SearchableLocationDropdown/*.tsx` (placesApi paged + search) | `utils/fieldRenderer.tsx` FieldType.SearchableDropdown (CallSummary location/custom fields), VoiceNoteSection | `calllog/data/call_summary_fields.dart:184` "plain text entry here instead — no places catalog ported" | MISSING | Free-text location means unvalidated values for a backend that expects place ids/names from the catalog. |
| SessionRatingTrigger | `SessionRatingTrigger/*.tsx` | SimulationFeedback header | `simulations/presentation/widgets/feedback/feedback_widgets.dart` `SessionRatingTrigger` | PRESENT | Merged from parity/feedback. |
| ShinyText | `ShinyText/ShinyText.tsx` (shimmer sweep) | CallSummary SummaryGenerationProgress step label | `call_summary_screen.dart` `_GenerationProgressView` — static text, no cycling steps (documented at :1636) | MISSING | Cosmetic. |
| SimulationCard | `SimulationCard/SimulationCard.tsx` | CourseItemPlayer, SimulationsScreen | `simulations/presentation/widgets/simulation_card.dart` | PRESENT | |
| SimulationDetailsCard / SimulationDetailRow | `SimulationDetailsCard/*.tsx` | ReviewScreen card, ShareForReview | `reviews/presentation/simulation_details_card.dart` + `review_card.dart` `ReviewDetailRow` | PARTIAL | Cover video not played (TODO in master and branch); master always shows View more even when the text fits (branch measures overflow). |
| SimulationTransitionSection / UpNextSimulationCard | `SimulationTransitionSection/*.tsx` | none (exported only; SimFeedback has its own UpNextSimulationCard) | — | N/A | Dead in RN. |
| StarRating | `StarRating/StarRating.tsx` | FeedbackPopup | `feedback_widgets.dart` `StarRatingRow`; `_SummaryFeedbackPopup` stars | PRESENT | |
| TabScreenHeader | `TabScreenHeader/TabScreenHeader.tsx` | CallLog, Leaderboard, Progress, Review, Search, Simulations, UserAnalytics | `core/widgets/tab_screen_header.dart` | PRESENT | |
| TabView | `TabView/TabView.tsx` (pill tabs; `tabWidthMode` equal/content) | ThreadsBottomSheet, Achievements, CallLog, CallSummary, Review, SimFeedback, Simulations, UserAnalytics | `core/widgets/app_tab_view.dart` `AppTabView` (+ `learn_tab_view.dart`); branch `_ContentWidthTabs` | PRESENT | Master has no content-width mode. CallSummary uses a Material `TabBar` instead (`call_summary_screen.dart:609`). |
| ThreadsBottomSheet / GeneralCommentsList | `ThreadsBottomSheet/*.tsx` | ReviewDetails | master: "Threads" + "Discussion" tabs in `review_details_screen.dart`; branch `_ThreadsPage` + `_GeneralList` | MERGED (was IN PROGRESS on parity/reviews) | |
| Toast / ToastProvider / useToast | `Toast/*.tsx` (success/error styled, top/bottom, auto-hide) | App root; ~15 screens | Material `SnackBar` via `ScaffoldMessenger` / `core/widgets/root_scaffold_messenger.dart` | PARTIAL | No success/error visual variants or top position; several master flows skip the toast altogether (e.g. share success, A4.6). |
| UserProfileImage | `UserProfileImage/UserProfileImage.tsx` (image or initial, border, fallback icon) | ReviewComment, ReviewTranscriptHeader, LogoutScreen, ReviewDetails, ReviewScreen | master `CircleAvatar` per call site (`review_card.dart`, `review_details_screen.dart`); branch `review_widgets.dart` `ReviewUserAvatar` | MERGED (was IN PROGRESS on parity/reviews) | master: no 1pt border, no fallback icon, inconsistent sizes. |
| VideoPreview | `VideoPreview/VideoPreview.tsx` | SimulationDetailsCard, SimulationDetailsScreen, SimulationPathDetailsScreen | `core/widgets/cover_video_preview.dart` (`simulation_details_screen.dart:182`, `simulation_details_modal.dart:243`) | PARTIAL | Not wired into `SimulationDetailsCard` (review cards, share screen, review header scenario dialog). |

Not a component: `components/shared/commentBottomSheetStyles.ts` (a style sheet), so it has no row.

---

### Top gaps by user impact

1. **Review details has no transcript on master** (A3.11). Reviewers can't read the conversation they are reviewing, can't comment on a selection (A3.12), and can't see highlighted thread ranges (A3.13). Fixed in `parity/reviews` (not merged).
2. **Review list is capped at 25 on master** (A1.9). There is no pagination or pull-to-refresh, so older reviews are unreachable. Fixed in branch.
3. **The list never refreshes on return from details** (A1.11), in master or branch. Read/unread state and comment/reaction counts go stale.
4. **ForceUpdateModal is missing** (B). There is no minimum-version gate, so users can't be forced off a broken release.
5. **ErrorBoundary and crash reporting are missing** (B). There is no global error fallback, and crashlytics is in pubspec but never wired.
6. **BadgePopup is missing** (A1.5, B). No unlock celebration on the Review or Simulations tabs; reviewer-only users get no badge feedback at all.
7. **Reactions on master can't be removed or changed, and the review itself can't be reacted to** (A5.7, A3.15). Fixed in branch.
8. **General comments on master are a flat add-only list** (A3.14). No reply, edit, delete, hide, reactions or pagination. Fixed in branch.
9. **The master share flow sends simulation shares to Home with no success toast** (A4.6, A4.8, A4.9). It also shows the raw exception inline instead of the server message. Fixed in branch.
10. **SearchableLocationDropdown is missing** (B). Call-summary location is free text instead of a place picker.

Also worth noting:
- The master Threads tab ignores `VIEW_SIMULATION_REVIEW_THREADS` (A3.23).
- Master marks a review read on tap, not after 10 s on details; reviews opened from CallSummary or SimulationFeedback are never marked read (A1.16).
- `NetworkImage` has no SVG support, so SVG badge art may render blank (B).
- The SimulationTranscript translation-language dropdown is missing (B, Dropdown).
- `VideoPreview` isn't wired into `SimulationDetailsCard` (A2.5).

---

## §4 Hooks, app shell, services, utils (and §6 Store)

This part covers §4 (Section A: hooks), §4b (Section B: app shell) and §6 (Section C: store).

### Parity ledger part: hooks, app shell, store

RN source: `ally-platform/ally-mobile/src` · Flutter: `ally-mobile-flutter/lib` on `master` at `e248a07`. `parity/feedback` was merged into master partway through this audit, so the feedback and transcript rows reflect the merged code. The only in-flight branch left is `parity/reviews` (`a91ed21`).

Flutter paths below are relative to `lib/`.

#### Tallies

| Section | Rows | PRESENT | PARTIAL | MISSING | MERGED (was IN PROGRESS) | N/A |
|---|---|---|---|---|---|---|
| A. Hooks | 53 | 22 | 14 | 6 | 3 | 8 |
| B. App shell / services / utils | 62 | 35 | 8 | 14 | 0 | 5 |
| C. Store | 28 | 18 | 4 | 4 | 0 | 2 |
| **Total** | **143** | **75** | **26** | **24** | **3** | **15** |

Status key:
- **PRESENT**: the same behaviour exists, possibly built a different way.
- **PARTIAL**: some of the behaviour exists.
- **MISSING**: nothing equivalent exists. Every MISSING row was checked by reading the Flutter files and searching `lib/` under several names, not by one failed grep.
- **IN PROGRESS**: the work exists on a branch (confirmed with `git show`).
- **N/A**: dead code in RN, an RN-only wrapper, or dev-only.

---

#### Section A — Hooks (`src/hooks/`)

| Hook | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| useAppNavigation | Typed `useNavigation` for the native stack. | go_router `context.push/go` | N/A | Navigation wrapper only. |
| useAppleLogin | Apple sign-in requests email and full name, then POSTs `/auth/apple` with identityToken, authorizationCode and fullName. A suspended account (403 `USER_SUSPENDED`) is sent to SuspendedAccount. A cancel does nothing; any other error shows a toast. | `features/auth/presentation/login_screen.dart` (`_signInWithApple`), `features/auth/data/auth_repository.dart` (`loginWithApple`) | PRESENT | Cancel, suspended and toast handling are all mirrored. It won't complete for real until an Apple Developer setup exists for the Flutter bundle id. |
| useBadgePopup | Polls `GET /badges/me?viewedStatus=UNVIEWED` every 60s, only while the screen is focused and the user has `VIEW_USER_BADGES`; also refetches on focus and reconnect. Badges are queued: the first shows after 1s, auto-closes after 5s, then the next follows 350ms later. Closing calls `PATCH /badges/me/:id/viewed`. Mounted on SimulationsScreen, and on ReviewScreen for reviewer-only users. | none | MISSING | `achievements_screen.dart` says the popup was deliberately not ported. As a stand-in it marks a badge viewed when tapped in Achievements. No polling, no queue, no celebration modal. |
| useBugReport | Validates description length, then `POST /bug-reports` with context (screen, appVersion, device, os, clientTimestamp). A 429 shows a rate-limit toast; success shows a toast and clears the field. | `features/bugreport/presentation/bug_report_screen.dart`, `features/bugreport/data/bug_report_repository.dart` | PRESENT | Handles 429 (`_httpTooManyRequests`). |
| useCallSummaryActions | Rename (`updateCallInfo`, then toast). Export: storage permission, `GET` export, save `.txt` to Documents/CallSummary (iOS) or Downloads (Android). Archive/unarchive with modal and toast. Delete (`summary: {}`, then `goBack` after 2s). Summary feedback POST. `handleGoBack` resets to CallLog and clears currentChat outside the log flow. | `features/calllog/presentation/call_summary_screen.dart`, `call_log_repository.dart` (`updateSummaryName`, `archiveCallLog`, `addSummaryFeedback`) | PARTIAL | Rename, archive and feedback work. The screen's own doc says **export and delete were not ported**. |
| useCallSummaryForm | Keeps a form baseline shared in the store. Reseeds on every summary refetch while keeping unsaved edits. Seeds manual notes with empty values. Saves only changed keys. Marks clean only the keys actually written, so an edit made during the save stays dirty. Section reset restores the server values. | `features/calllog/presentation/call_summary_screen.dart` (`_seedIfNeeded`, `_dirtyKeys`, `_saveBuiltinFields`) | PARTIAL | (1) It seeds **once per chat**: a later AI fill, regeneration or `invalidate` never refreshes the untouched fields. (2) `_saveBuiltinFields` runs `_dirtyKeys.clear()` after the await, which **drops edits typed while the save was in flight**. That is the exact bug the RN comment describes fixing. |
| useCallTranscriptDetails | Pages `/chats/:id/messages` with limit 20 and an offset. Sorts by `createdAt` for WEBRTC, otherwise `startSeconds` ASC. Timestamps are relative to the start. Infinite scroll. | `call_log_repository.dart` `getChatMessages(chatId)` | PARTIAL | Sends **no limit, offset, sortBy or sortOrder**, and does not paginate. If the backend pages by default, long transcripts get cut off (see the memory note "Incomplete transcripts = pagination"). |
| useCommentActions | Comment CRUD with local optimistic patching: add (prepend), edit, delete with confirm, hide/unhide, emoji reaction add/update/remove count maths. Dismisses the keyboard; `onCommentsChanged` fires for parents. | master: `features/reviews/presentation/thread_detail_screen.dart` (partial). Branch: `parity/reviews` `lib/features/reviews/presentation/comment_list_controller.dart` | MERGED (was IN PROGRESS on parity/reviews) | The branch's `CommentListController` ports add/edit/delete/hide/reactions and the 10-minute edit window. |
| useCounselorChat | When authenticated with `VIEW_COUNSELOR_CHAT`: `GET /chats/counsellor-chat`. On an active chat it sets currentChat and fires a callback; otherwise it clears currentChat unless the user is on Breathing, CallSummary or Listening. Re-checks on AppState background→active. Guards against concurrent checks. | `core/chat/active_chat_discovery.dart` (`checkForActiveChat`), `main.dart` (`didChangeAppLifecycleState`, auth listener) | PRESENT | No in-flight guard, so concurrent calls are possible (low risk). |
| useDebounce | Debounced callback, leading or trailing. | `Timer` used inline where needed | N/A | |
| useDrawerNavigation | Typed drawer navigation. | `core/navigation/drawer_menu_button.dart` (`DrawerMenuScope`) | N/A | |
| useForceUpdate | `GET /app-version/{ios,android}` returns `minimumSupportedVersion`, compared by semver against the app version. Splash shows a blocking ForceUpdateModal whose button opens the store, and navigation is held back. | none | MISSING | Searched `lib/` for minimumSupportedVersion, app-version, forceUpdate, ForceUpdate and openAppStore. `package_info_plus` is only used for the drawer version label and bug-report context. |
| useGoogleLogin | `GoogleSignin.configure`, `hasPlayServices`, `signOut` before `signIn`, then POST `/auth/google` with the idToken. Suspended goes to SuspendedAccount; cancel and in-progress are silent; Play Services and other errors show a toast. | `login_screen.dart` (`_signInWithGoogle`, `GoogleSignIn.instance.initialize`) | PRESENT | Same signOut-first pattern. Needs a client id configured. |
| useHardwareBackPressHandler | Android back calls a custom callback, else `goBack`, else the system default. | `PopScope` in call_summary, box_breathing, login (OTP→email), celebration_modal, simulation_feedback, profile_settings, scribe_recording, roleplay_voice, start_simulation_modals, simulation_details_modal | PRESENT | Implemented per screen. |
| useHideReviewDetails | For a private review, fetch threads (limit 1), then reaction counts; hide the review section if both are empty. | `simulation_feedback_screen.dart` (`_hideReviewDetails`), `call_summary_screen.dart` | PRESENT | |
| useIsEvaluator | `EVALUATOR_ACCESS` permission check. | — | N/A | **Unused in RN**: no caller outside `hooks/index.ts`. |
| useKeyboardState | Keyboard show/hide listener (used by SearchableLocationDropdown). | `MediaQuery.viewInsets` | N/A | |
| useLanguageDropdown | Language options and map from `/languages?active&hasVoices` plus preferences. | — | N/A | **Unused in RN** (exported only). Preferences have their own Flutter port. |
| useLeaderboard | `GET /community/leaderboard?window&limit=50&offset`, deduped by userId, infinite scroll. `GET /community/leaderboard/my-rank`, refetched on focus. Flags the current user; window change resets the offset. | `features/leaderboard/data/leaderboard_repository.dart` (`LeaderboardController`, `myRankProvider`), `leaderboard_screen.dart` | PRESENT | |
| useLeaderboardNotification | Toggle stored under AsyncStorage `LEADERBOARD_NOTIFICATION_ENABLED` (default ON); schedules or cancels the weekly Notifee trigger. | `core/push/leaderboard_notification.dart` (`leaderboardNotificationEnabledProvider`), `profile_settings_screen.dart:496` | PRESENT | Same key name, in SharedPreferences. |
| useLearningPathDetails | Track or case details query, create a path or case session, look up the scenario session for an item, pull to refresh. | `simulations_repository.dart` (`createPathSession`, `createCaseSession`, `/learn/scenario-session/scenario-path-session-item/:id`, `/case-session-item/:id`), `simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart` | PRESENT | |
| useListeningScreen | Derives isWebMicrophoneMode and isConferenceCall, the privacy tooltip list (noRecording / encrypted / noTrainingData / personalInfoRemoved), the tooltip insets and the start time. | `features/scribe/data/chat_models.dart` (`isWebMicrophoneMode`, `isConferenceCall`), `audio_waveform.dart` (focus mode) | PARTIAL | The **privacy tooltip** (`audioCall.privacy.*`) appears nowhere in `features/scribe`. |
| useLiveAudioStream | Mic permission check/request. A start request is held until init finishes (avoids a native crash). Streams 16kHz mono PCM base64. Permission denied: settings alert, and cancel goes back. Re-checks permission when the app returns to the foreground. Stops on unmount. | `features/scribe/presentation/scribe_recording_screen.dart` (`AudioRecorder.startStream` pcm16 16kHz, emits `AUDIO_MESSAGE`) | PARTIAL | Streaming works. On denial it only sets `_permissionDenied` and shows error text: **no settings alert, no `openAppSettings`, and no foreground re-check**. |
| useNavigationAwareCounselorChat | Tracks the current route. An active chat from Splash resets to [CallLog, Listening]; from Listening it does nothing; otherwise it navigates to Listening. Always subscribed to AppState. | `active_chat_discovery.dart` (`targetRouteForActiveChat`, `isListeningRoute`) | PRESENT | Uses `router.go` (replaces the stack) instead of reset/navigate; documented. |
| useNetworkConnectivity | NetInfo subscription: `isConnected` / `isInternetReachable` / `isOffline`. Drives NetworkDisconnected (network vs socket copy, Try-again hidden while offline) on the Listening screens. | `features/scribe/presentation/network_disconnected.dart` (UI only) | MISSING | No connectivity dependency in pubspec. `scribe_recording_screen.dart` passes `isOffline: false` hard-coded and maps everything to `DisconnectedType.socket` (documented as scoped out). |
| usePaginatedComments | Comment pagination, 20 per page, append/reset, `hasMore`. | Branch: `parity/reviews` `comment_list_controller.dart` (`pageSize`, `loadMore`) | MERGED (was IN PROGRESS on parity/reviews) | |
| usePermissionAlert | Alert with Cancel and "Open settings" (`openSettings()`); preset microphone variant. | `call_log_screen.dart:232` (`openAppSettings`) only | PARTIAL | Only the call-log start flow offers settings. Roleplay, scribe and start-simulation show error text only. |
| useProfileImage | Image library (jpeg/png, 0.8 quality, 800px); rejects over 2MB or non-square. Save: presigned URL → PUT to S3 → PATCH `/users/profile-image` → delete the old image best-effort. Remove: delete + PATCH empty. | `features/account/presentation/profile_settings_screen.dart` (`_maxProfileImageBytes`, square check), `account_repository.dart` (`/users/profile-image-url`, PATCH `/users/profile-image`, delete) | PRESENT | |
| useProgressSummary | Two gates: the `VIEW_USER_RANK` permission and `GET progress-enabled`. Then the summary query, shared through one cache entry. | `features/progress/data/progress_repository.dart` (`progressEnabledProvider`, `viewUserRank` gate), `progress_header_widget.dart` | PRESENT | |
| useReactions | Reaction counts summary (emoji map, sorted), paged list (20) filtered by reaction, refresh. Swaps between simulation and scribe APIs via ReviewApiContext. | `features/reactions/presentation/reactions_screen.dart`, `reactions_repository.dart` | PRESENT | |
| useReviews | Reviews list: readFilter and sort, LIMIT 10 with offset paging, reset on filter change. | master: `reviews_repository.dart` `getReviews` is a **single page, limit 25**. Branch: `parity/reviews` (`ReviewsPage`, `limit 10`, offset, `_hasMore`, `loadMore`) | MERGED (was IN PROGRESS on parity/reviews) | Master can't load past 25 reviews. |
| useScribeNoteCreationEnabled | `GET /settings/scribe-note-creation-enabled`, skipped unless `COUNSELOR_ACCESS` (otherwise 403). | `core/settings/settings_repository.dart` `scribeNoteCreationEnabledProvider`; `call_log_screen.dart:273` watches it only when `isCounselor` | PRESENT | |
| useScribeVoiceNoteEnabled | `GET /settings/scribe-voice-note-enabled`, gated by counsellor permission. | `settings_repository.dart` `scribeVoiceNoteEnabledProvider`; `voice_note_section.dart:216` | PARTIAL | The provider is watched **before** the counsellor check, so non-counsellors fire a request that gets a 403. Display is still gated correctly. |
| useSearch | `searchDocuments` (PAGE_SIZE, category filter); `excludedIds` pagination; category counts; 250ms debounced suggestion filter; suggestion tap. | `features/search/data/search_repository.dart` (`excludedIds`, `categories`), `search_screen.dart` | PRESENT | |
| useShareScreenLogic | Share or edit-note: max 250 chars, emoji appended, create review or update status. Toast; on a server message, toast then go back. | `features/reviews/presentation/share_for_review_screen.dart` (`_maxNoteLength = 250`, `EmojiInsertPicker`, `isEditNote`) | PRESENT | Reworked again on `parity/reviews` (UI fidelity). |
| useSimulationCredits | Fetches `/simulation-credits` on every mounting screen when the user has `EDIT_SCENARIO_SESSION`, otherwise clears. Stores in the credits slice. `refreshCredits`, usage %, low-credit flag. | `simulations_repository.dart` `simulationCreditsProvider`; `app_drawer.dart` (gated `editScenarioSession`), `credits_display.dart`, `simulation_details_screen.dart`, `learning_path_detail_view.dart` | PARTIAL | A non-autoDispose `FutureProvider` is **never invalidated** (no `ref.invalidate(simulationCreditsProvider)` anywhere), so credits stay stale for the whole session after simulations. |
| useSimulationSessionRecordingUrl | `GET` session recording presigned URL (2 attempts; a 404 means missing). `refreshFromPlaybackError` with a 4s cooldown for expired URLs. Feeds the TranscriptTab audio player. | none | MISSING | The doc in `simulation_transcript_tab.dart` says "Not ported: the session-recording audio player". No route string anywhere. |
| useSimulationTranscriptDetails | Pages `/learn/scenario-session/:id/messages` (limit 10, startSeconds ASC, **languageCode**) with a paging lock, id dedupe and MM:SS formatting. | `features/simulations/data/simulation_transcript_repository.dart` (limit 10, offset, `sortBy: startSeconds`), `simulation_transcript_tab.dart` | PARTIAL | No `languageCode` param, so the RN **transcript-language switch** (TRANSCRIPT_LANGUAGE_OPTIONS) is missing. Offset paging is present. |
| useSimulationTransition | Polls upcoming path/case scenario (5s, 4 tries); retry or start the next simulation. | — | N/A | **Unused in RN** (only a comment in `languageCodeEndpoints.ts`). |
| useSocket | One socket per owner, idempotent `connect`, a generation stamp against stale connects, auth as a function (fresh token on each reconnect), 5 reconnects, 1–5s delay, 10s timeout, forceNew, retry after failure 2s, emit/on/off. | `core/realtime/socket_service.dart` | PRESENT | No generation stamp and no 2s retry after failure. Minor. |
| useSocketConnection | Connects on screen focus, disconnects on blur. AppState: background disconnects (unless `disconnectOnBackground=false`), foreground reconnects. | Screens call `SocketService.connect` and `disconnect` themselves in initState and dispose (`scribe_recording_screen.dart`, `conference_listening_screen.dart`) | PARTIAL | **No AppState-driven reconnect on foreground or disconnect on background** (documented as not ported in `scribe_recording_screen.dart`). The app-wide cloud-telephony socket is also missing (Section B). |
| useStableFooterRenderer | Bottom-sheet footer render-stability shim. | — | N/A | Specific to `@gorhom/bottom-sheet`. |
| useStartSimulation | Checks or requests mic permission **before** creating the session (blocked: settings alert; denied: toast). Creates the scenario session; navigates to the assistant with token, LiveKit URL, scenario and reminders. 429 shows a retry modal; an `entityId` body shows the active-simulation modal. | `features/simulations/presentation/start_simulation/start_simulation_controller.dart`, `start_simulation_modals.dart` | PARTIAL | 429, entityId and languageId/trackItemProgressId are present. The doc says "Not ported: RN's microphone-permission request before the start call", so a denied mic is only found **after** the session (and its credit) is created, inside `roleplay_voice_screen.dart`, which shows error text with no settings link. |
| useStoragePermissions | Android below 33 needs `WRITE_EXTERNAL_STORAGE`; denied shows a toast and opens settings. | none | MISSING | Only needed for summary export, which is itself missing. |
| useSummaryState | Lazy summary fetch; holds the loader for 3s after the summary arrives; latches manual-note status; **debounced (1s) notes autosave `POST /chats/:id/notes` while the summary generates** (AddNotesSection); refresh; clears summary state on unmount. | `call_summary_screen.dart` (`callSummaryProvider`, manual-note handling, the generation-progress view) | PARTIAL | The **notes-during-generation autosave is missing**: no `/chats/:id/notes` call anywhere in `lib/`. |
| useTabBackToHomeHandler | On Search, Community, Progress and UserAnalytics tab roots, Android back jumps to the first visible tab instead of leaving the app. | none | MISSING | `core/navigation/app_shell_screen.dart` has no `PopScope`; the tab is local `IndexedStack` state, so back on any tab **exits the app**. |
| useTabScreenHeader | The hamburger shows only on the first visible tab and opens the drawer. | `core/navigation/app_shell_screen.dart` (`onOpenDrawer: i == 0`), `drawer_menu_button.dart`, `core/widgets/tab_screen_header.dart` | PRESENT | |
| useToggleReviewPrivacy | PATCH review status: `IN_REVIEW` when on, `HIDDEN` when off, then a toast. | `simulation_feedback_screen.dart:361`, `call_summary_screen.dart:317`, `review_details_screen.dart:108` | PRESENT | |
| useTrackPlayerNavigation | Flattens the track by sorted sections and items; current/prev/next; `canAdvance` (completed or just completed); overall %. | `features/courses/presentation/course_item_player_screen.dart` (`_flattenTrackItems`, `goNextOrOverview`) | PRESENT | |
| useTranslate | `t` (typed) and `tVariable`. | `core/localization/translate_ref.dart` (`ref.t`, `ref.tr`) | PRESENT | |
| useUser | `checkAuth`: with a token, fetch `/users/me` and permissions, then set user, permissions and authenticated; on any failure, logout. `handleUserLogout`: **unregister push token**, then `handleLogout`, then `resetApiState`. | `core/auth/auth_state.dart`, `features/account/data/account_repository.dart` `currentUserProvider`, `core/permissions/permissions_repository.dart` | PARTIAL | Flutter restores auth from the stored token alone; a non-401 `/users/me` failure does not log out (lenient divergence). **Logout never deregisters the push token** (see Section B/C). |
| useVideoWatchProgress | Counts unique watched seconds (a jump over 2s counts as a seek). Reports every 10s or on a +10% change; flushes on unmount. | `features/courses/data/video_watch_progress.dart` | PRESENT | Ported almost line for line. |
| useVoiceNoteRecorder | WAV dictation 16k mono, start/pause/resume/stop/reset, streamed to file. **Auto-stops at 24MB** (upload cap). Deletes the file on reset; releases the mic on unmount. | `features/calllog/presentation/voice_note_recorder.dart` (`record` `AudioEncoder.wav`) | PARTIAL | No size cap or auto-stop. A long dictation can go over the backend's 25MB multipart limit and fail to upload. `durationMs` comes from a 1s ticker rather than bytes. |

---

#### Section B — App shell, entry, services, contexts, utils

| Area | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| index.js | `registerGlobals()` for LiveKit WebRTC. | livekit_client needs none | N/A | |
| index.js | `messaging().setBackgroundMessageHandler` → `displayRemoteMessage`, registered at module scope. | `main.dart` `FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler)`; `core/push/push_notification_service.dart` | PRESENT | Inert today: there is **no `google-services.json` or `GoogleService-Info.plist`** in the repo (`Firebase.initializeApp` fails silently). |
| index.js | `notifee.onBackgroundEvent` PRESS on leaderboard id → `navigateToLeaderboard`; reminder → no-op. | `initializeLocalNotifications` `onDidReceiveNotificationResponse` covers foreground and background taps | PRESENT | |
| App.tsx | Redux `Provider`. | `ProviderScope(retry: appRetryPolicy)` | PRESENT | Flutter adds a retry policy (network/5xx only). |
| App.tsx | GestureHandlerRootView / SafeAreaProvider. | Flutter built-ins | N/A | |
| App.tsx | Translucent StatusBar; dark content after splash. | `main.dart` `AnnotatedRegion(SystemUiOverlayStyle.dark)` | PRESENT | |
| App.tsx | ToastProvider above the navigator, so toasts survive the auth stack swap. | `core/widgets/root_scaffold_messenger.dart` (`rootScaffoldMessengerKey`) | PRESENT | |
| App.tsx / ErrorBoundary | Catches render errors, shows a fallback with a reset that remounts the navigator, `crashlytics().recordError`. | none | MISSING | No `FlutterError.onError`, `PlatformDispatcher.onError`, `ErrorWidget.builder` or Crashlytics calls in `lib/`, even though `firebase_crashlytics` is in pubspec. |
| App.tsx | NetworkLogs overlay in development. | — | N/A | Dev only. |
| localization/i18n.ts | Synchronous English init; restores the saved UI language (`ally:ui:language`); 5 languages. | `core/localization/localization_controller.dart` (`build`, SharedPreferences `ui_language`) | PRESENT | Different key names (`ui_language`, `i18n_version`). Only matters for migrating an existing install. |
| localization/dynamic.ts | Behind `LANGUAGE_SELECTOR_FLAG`: fetch the CDN manifest; apply the cached bundle first; re-fetch namespaces when the version moves; cache per (version, lang); refresh every 30s and on foreground; network failure falls back to cache. | `localization_controller.dart` (`refresh`, `_pollTimer`, `didChangeAppLifecycleState`) | PRESENT | |
| dynamic.ts | On `languageChanged`: refresh and apply **that language's** cached or fetched resource. | `changeLanguage` → `refresh()` | PARTIAL | **Bug**: `_refresh` returns early when `cachedVersion == manifest.currentVersion`, so after switching language the new language's CDN overrides are never fetched or applied until the manifest version moves. Only the bundled strings show. |
| LanguageSelectorSheet | `changeLanguage`, persist, `forceRTL`, `api.util.resetApiState()` so content re-fetches in the new language. | `features/account/presentation/language_selector_sheet.dart` → `changeLanguage` | PARTIAL | No API cache reset. Moot while languageCode injection (next row) is missing. |
| services/api.ts | Injects `languageCode` (the active UI language) into the allowlisted content endpoints: scenarios, paths, cases, simulation details, checklist, skills, reviews, badges, leaderboard, endScenarioSession, learn tracks, enrollTrack. | none | MISSING | No interceptor and no per-repository param; searched `lib/` for `languageCode` and `lang`. **Hindi/Marathi/Tamil/Kannada users get English scenario, course, review and leaderboard content.** |
| services/api.ts | `/api/v1` prefix, with `/api/v2` for generate-otp, verify-otp and learn/scenarios (exact match). | `core/network/auth_interceptor.dart`, `api_routes.dart` | PRESENT | |
| services/api.ts | Bearer token from storage on every request. | `auth_interceptor.dart` `onRequest` | PRESENT | |
| services/api.ts | 401 → refresh with the refresh token → store new tokens → retry. No tokens, or refresh fails, logs out. | `auth_interceptor.dart` (single-flight `_refreshFuture`) | PRESENT | Better than RN: concurrent 401s share one refresh. |
| services/api.ts | Unrecoverable 401 → `handleLogout` + `resetApiState` + `auth.sessionExpired` toast. | `auth_state.dart` `sessionExpired()` | PRESENT | |
| RootNavigator | Swaps stacks on `isAuthenticated` (authed: CallLog, Listening, …; unauthed: Splash, SuspendedAccount). | `core/routing/app_router.dart` `computeRedirect` + `_RouterRefreshListenable` | PRESENT | |
| Splash | `checkAuth()` on launch; holds the UI while loading. | `AuthController._restore` + `/splash` `_LaunchScreen` (`isRestored`) | PARTIAL | Token-only restore, no user/permissions validation at launch (see the useUser row). |
| Splash | Authenticated with `profileCompleted === false` → CompleteProfile. | `computeRedirect` (`profileCompleted` gate) | PRESENT | |
| Splash | Authenticated with `VIEW_COUNSELOR_CHAT` → `checkCounselorChat`: active goes to [CallLog, Listening], otherwise CallLog. | `main.dart` auth listener → `checkForActiveChat` | PRESENT | |
| Splash | Force-update modal blocks all post-login routing. | none | MISSING | See useForceUpdate. |
| Splash | Login: a suspended error routes to SuspendedAccount (unauth stack). | `login_screen.dart` `_isSuspendedUserError` → `/suspended`; `computeRedirect` `isSuspended` | PRESENT | |
| Splash | Hardware back on the OTP step returns to email. | `login_screen.dart` `PopScope` | PRESENT | |
| RootNavigator | On auth, `getSummaryFields()` loads the tenant's visible summary fields into the store (`setSummaryVisibleFields`), used by CallSummaryDetails, SectionWrapper and VoiceNoteSection. | none | MISSING | No `/settings/summary-fields` in `lib/`. Flutter shows every summary field whatever the tenant has configured. |
| RootNavigator + utils/deeplink.ts | Universal links `https://{ALLY_WEB_URL host}/summary/:id` → reset to [CallLog, CallSummary(callId, fromLogs)], kept pending until authenticated and summary fields are loaded; suppresses the active-chat auto-route while a link is in progress. | none | MISSING | No `/summary` route, and no app_links/uni_links dependency. |
| RootNavigator + deeplink.ts | `/course/:uuid` → CourseOverview once past Splash and CompleteProfile; kept pending through login; dropped if on Listening; launch URL handled once. | none (`/courses/:trackId` exists but nothing routes a link to it) | MISSING | |
| Native link claims | AASA `paths` and an Android `autoVerify` intent-filter `pathPrefix` for /summary and /course. | none | MISSING | AndroidManifest has no https intent filter and iOS has no entitlements file. |
| RootNavigator | App-wide socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` → `checkCounselorChat` → auto-route to Listening (an incoming conference call is answered from the phone with no screen open). | none (`conference_listening_screen.dart` only connects once already on that screen) | MISSING | Conference calls only surface on the next app resume or relaunch, not while the app is open. |
| useCounselorChat via RootNavigator | Foreground re-check for an active chat. | `main.dart` `didChangeAppLifecycleState(resumed)` | PRESENT | |
| RootNavigator | Leaderboard reminder when authenticated and `VIEW_COMMUNITY_LEADERBOARD` and enabled (null means ON): create channel, request permission, schedule weekly (Mon 11:00 from env). | `core/push/leaderboard_notification.dart` (`leaderboardNotificationSyncProvider`, `zonedSchedule` `dayOfWeekAndTime`) | PRESENT | Flutter also cancels it on logout; RN doesn't. |
| RootNavigator + pushNotificationService | When authenticated: create the `reminders` channel, request notification permission, register the FCM token (`POST /notifications/device-tokens` with platform), re-register on `onTokenRefresh`, show foreground messages via Notifee. | `core/navigation/app_shell_screen.dart` initState → `PushNotificationService.initializeAndRegister` | PARTIAL | The code is a full port, but it **can't work until the Firebase config files exist** for `com.helloally.ally_mobile_flutter`. Registration only fires once `/home` mounts. |
| pushNotificationService | `unregisterDeviceForPush` on logout: `DELETE` device token, then `messaging().deleteToken()`. | `notifications_repository.dart` `deleteDeviceToken` is defined but **never called** | MISSING | A logged-out device keeps getting the previous user's reminders. |
| pushNotificationService | `displayRemoteMessage`: data-only `{title, body}`, skipped when body is empty; `reminders` channel; tap goes to the default action. | `displayReminderNotification` | PRESENT | Unique id per notification, as in RN. |
| RootNavigator | Foreground notification tap: leaderboard id → jump to the Leaderboard **tab**; reminder → Simulations or Notifications. | `navigateForNotificationPayload` → `routeForNotificationTap` → `router.go` | PRESENT | `router.go` replaces the stack (no back to Home), and the leaderboard opens the standalone `/leaderboard` route, not the tab. |
| RootNavigator | Killed-app initial notification (authenticated only): reminder routing; leaderboard routing deduped through `LEADERBOARD_NOTIF_HANDLED_TS` (scheduledAt); waits until off Splash. | `initializeLocalNotifications` → `getNotificationAppLaunchDetails` | PRESENT | No `HANDLED_TS` dedupe (low impact, since launch details only fire on a real launch). |
| utils/notificationNavigation | `isReminderNotification` (type `ENGAGEMENT_REMINDER`); `handleReminderNavigation` (`screen` hint is Simulations, otherwise Notifications). | `core/push/notification_navigation.dart` | PRESENT | |
| notificationService | `getNextScheduledNotificationTime` from env day, hour and minute; weekly trigger; cancel. | `leaderboard_notification.dart` `nextWeeklyOccurrence`, `cancel` | PRESENT | |
| TabNavigator | Tabs filtered by permission; ACHIEVEMENTS only for reviewer-only users; initial tab is `getFirstVisibleTab`; unread-review dot (sim plus scribe unread count); lazy tabs; nothing renders while user is loading. | `core/navigation/app_shell_screen.dart`, `tab_config.dart`, `app_bottom_tab_bar.dart`, `unreadReviewCountProvider` | PRESENT | If permissions fail to load (e.g. offline launch), the shell shows raw `'$error'` text with no retry. |
| DrawerNavigator | Drawer with logout confirmation, then `handleUserLogout`. | `core/navigation/app_drawer.dart` `_confirmLogout` | PRESENT | Logout misses push deregistration (row above). |
| utils/navigation.ts | `navigateToTab` / `navigateToLearnTab` / `navigateToCallLogTab` reset into a specific tab (used by path/case/course/feedback/CallSummary exits). | `context.go('/home')` in feedback, course player, box breathing, share | PARTIAL | No way to target a tab. The user lands on whichever tab the shell last had selected. |
| RootNavigator | `gestureEnabled: false` on CallSummary, CourseItemPlayer, CompleteProfile, SimulationAssistant and SimulationFeedback. | `PopScope` on call_summary, roleplay_voice, simulation_feedback; router redirect pins complete-profile | PRESENT | |
| contexts/ReviewApiContext | Swaps every comment, thread and reaction hook between the simulation and scribe review APIs. | `ReviewType` parameter + `ScribeReviewsRepository` / `ScribeReactionsRepository` (`review_details_screen.dart`, `reactions_screen.dart`) | PRESENT | |
| Keep-awake (useListeningCommon, SimulationAssistantScreen) | `activateKeepAwake` while listening or recording and during a live roleplay; deactivated on exit. | none | MISSING | No wakelock package. `ForegroundRecordingService` (`allowWakeLock: true`) keeps the **CPU** awake on Android Scribe only, not the screen. Nothing on roleplay or iOS. |
| utils/asyncStorage | JSON get/set/remove over AsyncStorage. | SharedPreferences, plus `core/network/token_storage.dart` (secure storage) | PRESENT | |
| AsyncStorageKeys.ACCESS_TOKEN / REFRESH_TOKEN | Token pair. | `token_storage.dart` (same key names, Keychain/Keystore) | PRESENT | |
| AsyncStorageKeys.LEARN_ACCESS_TOKEN | — | — | N/A | Never read or written in RN. |
| AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED | Toggle. | `leaderboardNotificationPrefsKey` (same name) | PRESENT | |
| AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS | Cold-start tap dedupe. | none | MISSING | Low impact. |
| AsyncStorageKeys.ACTIVE_TRACK_CONTEXT | Set when a course roleplay or game launches; CourseItemPlayer refetches the track on focus to pick up completion. | `course_item_player_screen.dart` `_refetchTrackOnReturn` (in memory, route-aware) | PRESENT | Doesn't survive an app kill (RN's does). |
| AsyncStorageKeys.UI_LANGUAGE / I18N_VERSION | UI language plus dynamic version cache. | `localization_controller.dart` (`ui_language`, `i18n_version`) | PRESENT | |
| AsyncStorageKeys.AUDIO_PLAYBACK_RATE | Remembers the feedback-screen audio speed. | `features/reviews/presentation/simulation_audio_player.dart` cycles the rate but **doesn't save it** | MISSING | The RN feedback recording player that uses it is missing anyway. |
| utils/logger | Console output only in development. | `debugPrint` | N/A | |
| utils/error.ts | `getErrorDetails` (message, else error, else "somethingWentWrong"), `isBackendApiError`. | ad hoc in `login_screen.dart`, `complete_profile_screen.dart` | PARTIAL | No shared helper. Many screens show `'$e'` or a generic key instead of the backend `message` (e.g. `call_summary_screen.dart` `_saveBuiltinFields` puts `: $e` in the error). |
| utils/error.ts | `isSuspendedUserError` (403 + `USER_SUSPENDED` or "User suspended"). | `login_screen.dart` `_isSuspendedUserError` | PRESENT | |
| utils/fileOperations | `saveFile`: summary export `.txt` to iOS Documents/CallSummary or Android Downloads, plus `scanFile`. | none | MISSING | Export isn't ported. |
| utils/imageUpload | `uploadImageToS3` (PUT blob to the presigned URL). | `account_repository.dart` (presign, then PUT) | PRESENT | |
| utils/bugReportContext | screen, appVersion, device label, os, timestamp. | `bug_report_repository.dart` `_buildContext` (PackageInfo) | PRESENT | |
| utils/version.ts | `getAppVersion`, semver `isVersionLower`. | `package_info_plus` for display only | PARTIAL | No version comparison (needed for force update). |
| utils/common `openAppStore` | Opens the platform store URL (ForceUpdateModal). | none | MISSING | |
| ListeningScreen NetworkDisconnected | Offline vs socket copy; Try-again hidden while offline. | `features/scribe/presentation/network_disconnected.dart` | PARTIAL | The UI is ported but `isOffline` is always false (no connectivity source). |

---

#### Section C — Store (`src/store/`)

| Slice / item | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| store.ts | `configureStore` combining user, chat, summary, credits and the RTK Query api. | Riverpod `ProviderScope` with per-feature providers | PRESENT | |
| store.ts | `setupListeners` enables `refetchOnFocus` / `refetchOnReconnect` (used by badges). | none | MISSING | No reconnect-driven refetch. Low impact without the badge popup. |
| api tagTypes | Tag invalidation keeps 21 cache families fresh after mutations (credits, unread counts, notifications, track detail, discussion, …). | Manual `ref.invalidate(...)` at some call sites; `apiClientProvider` rebuilds everything when auth flips | PARTIAL | Patchy. Notably `SimulationCredits` is never invalidated (see below). |
| userSlice.initialState | `loading: true` until the token check finishes. | `AuthState.unknown` (`isRestored: false`) | PRESENT | |
| userSlice.setAuthenticated | Flag drives the stack swap. | `AuthController.state.isAuthenticated` | PRESENT | |
| userSlice.setLoading | Ends the launch wait. | `AuthState.isRestored` | PRESENT | |
| userSlice.setUser / clearUser | Current user from `/users/me`. | `currentUserProvider` (returns a never-completing future when signed out; refetches on auth change) | PRESENT | |
| userSlice.setPermissions | Permissions array drives tabs, drawer and gates. | `userPermissionsProvider` (`/authorization/permissions`), rebuilt through `apiClientProvider` on auth change | PRESENT | |
| userSlice.storeTokens (thunk) | Writes ACCESS and REFRESH tokens to AsyncStorage. | `TokenStorage.storeTokens` (secure storage) via `AuthController.signIn` and the interceptor refresh | PRESENT | Encrypted storage (deliberate). Tokens from an RN install wouldn't migrate, but the bundle id differs today. |
| userSlice.handleLogout (thunk) | Removes tokens, `setAuthenticated(false)`, `clearUser`, `setPermissions([])`. | `AuthController.logout()` (`TokenStorage.clear`, state false), with user and permissions providers rebuilt | PRESENT | |
| useUser.handleUserLogout | Best-effort **push token deregistration** (DELETE device token + FCM `deleteToken`) while auth is still valid, then logout. | none | MISSING | `deleteDeviceToken` exists in `notifications_repository.dart` but is unused. |
| useUser.handleUserLogout | `api.util.resetApiState()` drops every cached query. | `apiClientProvider` watches `isAuthenticated`; every repository watches it, so the cascade rebuilds | PRESENT | |
| api.ts handleUserLogout | Session expiry: logout + reset + toast `auth.sessionExpired`. | `AuthController.sessionExpired()` (snackbar, no toast if never signed in) | PRESENT | |
| useUser.checkAuth failure | Any `/users/me` failure logs out. | none | PARTIAL | Lenient divergence: Flutter stays signed in after a non-401 failure and shows provider errors instead. |
| Logout side effects: socket | Sockets close through screen unmount and focus cleanup (userId goes undefined). | Screens dispose `SocketService` when the redirect unmounts them; `socketServiceProvider` disposes on scope teardown | PRESENT | |
| Logout side effects: analytics | RN has **no** PostHog, and no Crashlytics `setUserId` or reset. | — | N/A | Nothing to port. Flutter has Crashlytics in pubspec but uses none of it. |
| Logout side effects: chat / credits / summary | RN does **not** clear `chat.currentChat`, credits or summary on logout. | `currentChatProvider` also isn't cleared; credits rebuild through apiClient | N/A | Parity, including RN's latent leak. |
| chatSlice.setCurrentChat | Set from the counsellor-chat discovery. | `core/chat/current_chat_provider.dart` `set(chat)` from `active_chat_discovery.dart` | PRESENT | |
| chatSlice.setCurrentChatId | On `USER_JOINED`, MicrophoneListeningScreen records the chat id (merge, not replace), so a slow refetch can't strand the session. | `scribe_recording_screen.dart` keeps the chatId in local state only | PARTIAL | `currentChatProvider` isn't updated from the scribe screen, so CallLog's "hide FAB / filter the current chat" only learns about it after discovery runs. |
| chatSlice.clearCurrentChat | Cleared when no active chat is found (except on Breathing, CallSummary or Listening) and in CallSummary `handleGoBack` (not from logs). | `active_chat_discovery.dart` `isExemptFromClearingCurrentChat`; `box_breathing_screen.dart:187` | PRESENT | |
| chat.currentChat consumers | CallLog hides the start FAB and filters the live chat out of the list; CallSummary falls back to its chatId; Listening reads provider and startedAt. | `call_log_screen.dart:288`, `call_log_repository.dart:750`, `box_breathing_screen.dart:194` | PRESENT | |
| creditsSlice.setCredits / clearCredits | Set after fetch when the user has `EDIT_SCENARIO_SESSION`; cleared otherwise. | `simulationCreditsProvider`; drawer gated by `editScenarioSession` | PRESENT | |
| Credits refresh | Re-fetched on every mount of Simulations, SimulationDetails, Path, Case and drawer; `refreshCredits` exposed. | none | MISSING | Never invalidated, so credits show stale values after running simulations until the app restarts or auth changes. |
| summarySlice.setSummaryData | Summary response shared across the CallSummary component tree (set in `getCallSummary` `onQueryStarted`). | `callSummaryProvider(chatId)` family | PRESENT | |
| summarySlice.setFormData / markFormDataSaved | Shared form and a merged saved-baseline: only keys actually written are marked clean, so edits made during a save stay dirty. | `call_summary_screen.dart` `_formValues`, `_savedFormValues`, `_dirtyKeys` | PARTIAL | `_dirtyKeys.clear()` after the save **drops edits typed while it was in flight**. Seeded once per chat, so it never reseeds on refetch (see the useCallSummaryForm row). |
| summarySlice.setSummaryVisibleFields / selectSummaryVisibleFields | Tenant-configured visible summary fields filter the sections and voice-note targets. | none | MISSING | See Section B, `getSummaryFields`. |
| summarySlice.clearSummaryStates | Clears summary, form and saved data when CallSummary unmounts. | Local `State` is discarded on dispose | PRESENT | |
| summarySlice selectors | selectSummary, selectCallDetails, selectCallInfo (chatId, counselorId, duration, provider, mode, summaryName), selectMetrics. | `CallSummaryDetails` model fields in `call_log_repository.dart`; metrics fields `listeningShare`, `reflectiveQuestionsAsked`, `emotionalLift` in `call_summary_fields.dart` | PRESENT | `selectMetrics` itself has no `.tsx` consumer in RN. |

---

#### Top gaps by user impact

1. **No `languageCode` injection for content endpoints** (`services/api.ts` + `languageCodeEndpoints.ts`). Every non-English user sees English scenarios, courses, reviews, badges and leaderboard.
2. **No app-wide cloud-telephony socket** (`USER_JOINED` → auto-route to Listening). Counsellors on conference calls aren't taken to the live session while the app is open.
3. **No force update** (`/app-version`, semver check, blocking ForceUpdateModal, store link). There is no way to retire old builds.
4. **No deep links** (`/summary/:id` and `/course/:uuid` universal links, plus native AASA and intent filters). Shared summary and course links open in the browser.
5. **Push is non-functional** (no Firebase config files), and **logout never deregisters the device token**. Once push works, logged-out devices will keep getting reminders.
6. **Summary form save bug**: edits typed during an in-flight save are dropped from the dirty set. The form is seeded once per chat (no reseed on AI fill or regeneration). The tenant `summary-fields` visibility config is ignored. The notes-during-generation autosave is missing.
7. **No keep-awake** on live roleplay or Scribe listening (iOS and Android). The screen can lock mid-session. The foreground service only keeps the CPU awake on Android Scribe.
8. **Android back on any tab exits the app** (`useTabBackToHomeHandler` missing; no PopScope in AppShell). Tab-targeted exits (`navigateToLearnTab` / `navigateToCallLogTab`) are also missing.
9. **Mic permission gaps**: no pre-start mic check before a simulation is created (a credit is spent, then the call fails), and no open-settings alert in roleplay or Scribe. There is also no network-connectivity detection (offline is always reported as a socket error) and no AppState socket reconnect.
10. **Smaller gaps**:
    - Credits never refresh after simulations (stale balance).
    - The call transcript isn't paginated or sorted (long calls get cut off).
    - The session-recording player and transcript language switch on simulation feedback are missing.
    - The badge-unlock popup is missing.
    - Summary export and delete are missing.
    - There is no ErrorBoundary or Crashlytics, so JS-equivalent render crashes go unreported.
    - Switching UI language doesn't apply the new language's CDN translations (cached-version early return in `localization_controller.dart`).

---

## §5 Backend endpoints (actually called by RN) and transport

### Endpoints and transport parity ledger (RN to Flutter)

- RN source of truth: `ally-platform/ally-mobile/src` (services/*.ts, constants/general.ts `API_ROUTES`, plus raw fetch/XHR/socket.io/LiveKit callers).
- Flutter: `ally-mobile-flutter` **master @ e248a07**, the tip at 18:52 on 2026-10-28. `parity/feedback` was merged into master at 18:52 and the branch deleted, so Ask-AI and event-checklist now count as PRESENT on master. The only open in-flight branch is **`parity/reviews` @ a91ed21**. I also checked `feature/simkit`, which is already merged.
- "Called" means an RTK endpoint whose generated hook or `.endpoints.X.initiate` is referenced from non-test code under `src/`, or a raw call. Hooks that are only exported from `hooks/index.ts` and never invoked (`useLanguageDropdown`, `useSimulationTransition`) count as unused, so the endpoints that only they reach are listed as DEAD (transitive).
- Paths are shown without the `/api/v1` prefix. Both apps prepend `/api/{v1|v2}`, and v2 applies only to exact `/auth/generate-otp`, `/auth/verify-otp` and `/learn/scenarios`. Flutter matches this (`auth_interceptor.dart` `_isV2` uses exact equality).
- **(lang)** means the endpoint is in RN `LANGUAGE_CODE_ENDPOINTS`. RN `baseQuery` injects `languageCode=<i18n.resolvedLanguage>` into query params on GETs and into the body on mutations. **Flutter has no equivalent anywhere** (I grepped `languageCode`/`Accept-Language` across `lib/`; the only hits are the course-language PUT and course models). Every (lang) endpoint Flutter implements is therefore PARTIAL: non-English UI users get backend content in the default language.

#### Tallies

| Status | Count |
|---|---|
| PRESENT | 104 (99 RTK + 5 raw) |
| PARTIAL | 21 (20 RTK + 1 raw) |
| MISSING | 11 |
| MERGED (was IN PROGRESS on parity/reviews) | 14 |
| DEAD (defined in RN, never called) | 25 (21 direct + 4 transitive) |
| **Called endpoints total** | 150 (144 RTK + 6 raw HTTP) |

Transport, realtime and cache findings are in separate sections below and are not counted in the table.

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
| getForceUpdateConfig | GET /app-version/ios or /app-version/android | none | hooks/useForceUpdate (SplashScreen) | none. No `app-version` string, version check or force-update UI anywhere in `lib/`. | **MISSING** |

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
| getAvailableBadges (lang) | GET /badges/me/available | none (+languageCode) | AchievementsScreen | `AchievementsRepository.getBadges`, `badgesProvider` | PARTIAL: no `languageCode`, so badge names and descriptions are not localized |
| getBadges | GET /badges/me?viewedStatus=UNVIEWED | `{viewedStatus}`; polled every 60s, refetchOnFocus/Reconnect | hooks/useBadgePopup, BadgePopup (app-wide unlock celebration) | none. `achievements_repository.dart:56-62` documents the popup as "not-yet-ported". | **MISSING** |
| markBadgeAsViewed | PATCH /badges/me/:badgeId/viewed | none; invalidates Badges lists | hooks/useBadgePopup (on popup dismiss) | `AchievementsRepository.markBadgeAsViewed`, called on badge tap in `achievements_screen.dart:250` (different trigger because there is no popup) | PRESENT (endpoint; trigger differs) |
| getProgressSummary | GET /progress/me/summary | none | hooks/useProgressSummary (header widget) | `ProgressRepository.getProgressSummary` | PRESENT |
| getProgress | GET /progress/me | none | ProgressScreen | `ProgressRepository.getProgress` | PRESENT |
| getProgressEnabled | GET /progress/me/enabled | none | hooks/useProgressSummary | `ProgressRepository.getProgressEnabled` | PRESENT |
| getLeaderboard (lang) | GET /community/leaderboard | `{window, limit=50, offset=0, sortBy='score', order='DESC'}` | hooks/useLeaderboard | `LeaderboardRepository.getLeaderboard` sends only `{window, limit=30, offset}` | PARTIAL: no `sortBy=score`/`order=DESC` (relies on backend default), page size 30 vs 50, no `languageCode` |
| getMyRank | GET /community/leaderboard/my-rank | `{window}` | hooks/useLeaderboard | `LeaderboardRepository.getMyRank` | PRESENT |
| getNotifications | GET /notifications | `{limit=25, offset}` | NotificationsScreen | `NotificationsRepository.list` + loadMore | PRESENT |
| markNotificationRead | PATCH /notifications/:id/read | none | NotificationsScreen | `markRead`; invalidates `notificationsControllerProvider` | PRESENT |
| markAllNotificationsRead | PATCH /notifications/read-all | none | NotificationsScreen | `markAllRead` | PRESENT |
| registerDeviceToken | PUT /notifications/device-tokens | `{token, platform:'IOS'/'ANDROID'}` | services/pushNotificationService (initiate on login + token refresh) | `NotificationsRepository.registerDeviceToken` via `core/push/push_notification_service.dart:210,216` | PRESENT |
| deleteDeviceToken | DELETE /notifications/device-tokens/:encodedToken | none | `unregisterDeviceForPush`, called from hooks/useUser logout | Method exists (`notifications_repository.dart:58`) but **is never called**. `AuthController.logout()` and `sessionExpired()` only clear tokens. | **MISSING**: after logout, the device keeps receiving the previous user's pushes |

##### Scribe: live chat, call log, call summary, notes
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getCounsellorChat | GET /chats/counsellor-chat | none | useCounselorChat (RootNavigator, SplashScreen, CallLogScreen, useListeningCommon) | `ChatRepository.getCounsellorChat`, `core/chat/active_chat_discovery.dart` (cold launch + resume only) | PRESENT. The app-wide socket trigger is missing; see §3. |
| endCall | POST /chats/:chatId/end | none | useListeningCommon | `ChatRepository.endCall` | PRESENT |
| addFeedback | POST /chats/messages/:messageId/feedback | `{rating}` | NudgeSection | `ChatRepository.addFeedback` | PRESENT |
| updateFeedback | PATCH /chats/messages/feedback/:feedbackId | `{rating}` | NudgeSection | `ChatRepository.updateFeedback` | PRESENT |
| updateNotes | POST /chats/:chatId/notes | `{content}` (1s debounce) | hooks/useSummaryState, CallSummaryScreen `onNoteChange` / AddNotesSection (notes typed while the summary is generating) | none. No `/notes` path; `call_log_repository.dart:230` only *reads* `callInfo.notes`. | **MISSING** |
| getCallLogs | GET /chats/call-logs | `{limit, offset, archive, fieldFilters?, startDate?, endDate?, minDuration?, maxDuration?, tags?, mode?, status?, source?}` | CallLogScreen | `CallLogRepository.getCallLogs` + `CallLogFilterState.toQueryParameters` (all filter keys) | PRESENT |
| getCallTags | GET /chats/tags | `{offset:0}` | CallLogScreen (filter sheet) | `CallLogRepository.getAllTags` sends `{search?}` | PRESENT (param difference is harmless) |
| archiveCallLog | PATCH /chats/call-logs/:id/archive | `{archive}` | useCallSummaryActions | `CallLogRepository.archiveCallLog` | PRESENT |
| getSimulationLogs | GET /learn/scenario-sessions | `{limit, offset, sortBy:'createdAt', order:'DESC'}` | CallLogScreen (Role play tab) | `CallLogRepository.getSimulationLogs` sends `{limit, offset}` only | PARTIAL: no `sortBy`/`order`, so ordering depends on the backend default |
| getCallSummary | GET /chats/:chatId | none; `onQueryStarted` stores in redux | hooks/useSummaryState | `CallLogRepository.getCallSummary` / `getCallLogItem`; 403 handled (`call_summary_screen.dart:964`) | PRESENT |
| updateCallSummary | PUT /chats/:chatId/call-details | `{summary: <changed fields, cleared=null>}`; "Delete summary" sends `{summary:{}}` | useCallSummaryForm, VoiceNoteSection, useCallSummaryActions (delete) | `CallLogRepository.updateCallSummary(chatId, {summary: changed})` | PARTIAL: edit path matches; the **delete-summary** call (`{summary:{}}`) is not ported (`call_summary_screen.dart:213-218`) |
| exportCallSummary | GET /chats/:chatId/export-summary (`responseHandler: text`) | none; result saved to a file | useCallSummaryActions (3-dot menu, Export) | none. "Not ported: ... export" (`call_summary_screen.dart:213`). | **MISSING** |
| updateCallInfo | PATCH /chats/:chatId/call-info | `{summaryName}` | useCallSummaryActions (rename) | `CallLogRepository.updateSummaryName` | PRESENT |
| enhanceCallSummary | POST /chats/enhance | `{content}` returns `{enhanced_content}` | SectionWrapper | `CallLogRepository.enhanceCallSummary`, used at `call_summary_screen.dart:785` (the screen doc comment saying "not ported" is stale) | PRESENT |
| addSummaryFeedback | POST /chats/:chatId/summary-feedback | `{rating, feedback:{issues[], comment}}` | useCallSummaryActions | `CallLogRepository.addSummaryFeedback` | PRESENT |
| retrySummary | POST /chats/:chatId/retry-summary | none | CallSummaryScreen | `CallLogRepository.retrySummary` | PRESENT |
| getChatMessages | GET /chats/:chatId/messages | `{limit:20, offset, sortOrder:'ASC', sortBy: WEBRTC ? 'createdAt' : 'startSeconds', type?}`, infinite scroll | hooks/useCallTranscriptDetails (CallTranscript tab) | `CallLogRepository.getChatMessages(chatId)` sends **no query params** and a single request | PARTIAL: no pagination or sort, so only the backend's default first page renders; long calls show a truncated transcript, possibly in the wrong order |
| getCustomFieldDefinitions | GET /custom-fields/definitions | none | CallLogScreen, CallSummaryDetails, VoiceNoteSection | `CustomFieldsRepository.getDefinitions` | PRESENT |
| getCustomFieldValues | GET /custom-fields/values/:chatId | none | CallSummaryDetails | `CustomFieldsRepository.getValues` | PRESENT |
| upsertCustomFieldValues | PUT /custom-fields/values/:chatId | `{values:[{fieldDefinitionId, value|null}]}` | CallSummaryDetails, VoiceNoteSection | `CustomFieldsRepository.upsertValues` (sends explicit null) | PRESENT |
| getCustomFieldsEnabled | GET /settings/custom-fields-enabled | none | CallSummaryDetails, VoiceNoteSection | `SettingsRepository.getCustomFieldsEnabled` (`core/settings/settings_repository.dart`) | PRESENT |
| createNote | POST /chats/note | none | CallLogScreen | `CallLogRepository.createNote` | PRESENT |
| generateNoteFromAudio | POST /chats/note/generate-from-audio (multipart) | parts `audio` (dictation.wav, audio/wav), `fields` (JSON: built-in **plus tenant custom fields**), `languageHint?` | VoiceNoteSection | `CallLogRepository.generateNoteFromAudio` (`FormData` with `audio` + `fields`); `voice_note_section.dart:45 _voiceFieldCatalog()` uses `summaryFieldDefs` only | PARTIAL: custom-field definitions are not sent in `fields`, and extracted custom values are never upserted, so dictation cannot fill custom fields |
| saveNoteTranscript | PUT /chats/:chatId/transcript | `{transcript}` | VoiceNoteSection | `CallLogRepository.saveNoteTranscript` | PRESENT |
| getSummaryFields | GET /settings/summary-fields | none; `onQueryStarted` dispatches `setSummaryVisibleFields` | RootNavigator (on auth), CallSummaryScreen | none. Flutter renders the static `summaryFieldDefs` catalog for every tenant. | **MISSING**: tenant-configured visible summary sections are ignored |
| getNudgeStatus | GET /settings/nudge-status | none | Microphone/Conference listening screens | `SettingsRepository.getNudgeStatus` | PRESENT |
| getVisibleChatTypes | GET /settings/chat-types | none | CallLogScreen | `SettingsRepository.getVisibleChatTypes` | PRESENT |
| getScribeNoteCreationEnabled | GET /settings/scribe-note-creation-enabled | none | hooks/useScribeNoteCreationEnabled | `SettingsRepository` | PRESENT |
| getScribeVoiceNoteEnabled | GET /settings/scribe-voice-note-enabled | none | hooks/useScribeVoiceNoteEnabled | `SettingsRepository` | PRESENT |
| getPlaces | GET /places | `{page=1, limit=50}` | components/SearchableLocationDropdown via utils/fieldRenderer (summary "location" field) | none. `call_summary_fields.dart:181-186`: "plain text entry here instead, no places catalog ported". | **MISSING** |
| searchPlaces | GET /places/search | `{query}` | SearchableLocationDropdown | none | **MISSING** |

##### Courses (learn tracks) and discussion
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter (`features/courses/data/courses_repository.dart` unless noted) | Status |
|---|---|---|---|---|---|
| getLearnTracks (lang) | GET /learn/tracks | none; unwraps `data` | SimulationsScreen | `getLearnTracks`, `learnTracksProvider` | PARTIAL: no `languageCode` |
| getLearnTrackDetail (lang) | GET /learn/tracks/:trackId | none | CourseOverviewScreen, CourseItemPlayerScreen | `getLearnTrackDetail`, `trackDetailProvider` | PARTIAL: no `languageCode` |
| getLearnTrackProgress | GET /learn/tracks/:trackId/progress | none | CourseProgressScreen, CourseProgressSheet | `getLearnTrackProgress`, `trackProgressProvider` | PRESENT (goes stale; see §4) |
| getNextTrackItem | GET /learn/tracks/:trackId/next-item | none | CourseProgressScreen, CourseOverviewScreen | `getNextTrackItem` (imperative) | PRESENT |
| enrollTrack (lang) | POST /learn/tracks/:trackId/enroll | body `{languageCode}` (injected) | CourseOverviewScreen | `enrollTrack(trackId)` with no body | PARTIAL: enrollment language not sent |
| startTrackItem | POST /learn/tracks/items/:itemId/start | none | CourseItemPlayerScreen, Quiz/Branching/BucketSort players | `startTrackItem` | PRESENT |
| markArticleRead | POST .../items/:itemId/article-read | none | ArticlePlayer | `markArticleRead` | PRESENT |
| submitArticleQuestionAnswer | POST .../items/:itemId/article-questions/:qid/answer | `{selectedOptionId}` | ArticleQuestionCard | `submitArticleQuestionAnswer` | PRESENT |
| reportVideoProgress | POST .../items/:itemId/video-progress | `{watchedPct}` (+ optimistic `maxWatchedPct` patch) | VideoItemPlayer | `reportVideoProgress` | PRESENT |
| submitInterjectionAnswer | POST .../items/:itemId/interjections/:iid/answer | `QuizAnswerInput` | VideoInterjectionModal | `submitInterjectionAnswer(answer.toJson())` | PRESENT |
| submitQuizAttempt | POST .../items/:itemId/quiz-attempts | `{answers: QuizAnswerInput[]}` | QuizItemPlayer | `submitQuizAttempt` | PRESENT |
| regradeQuizAttempt | POST .../items/:itemId/quiz-attempts/:attemptId/regrade | none | QuizItemPlayer (PENDING_GRADING results) | none. No `regrade` in `lib/` or `parity/reviews`. | **MISSING**: a quiz stuck in PENDING_GRADING cannot be re-graded from mobile |
| recordGameResult | POST .../items/:itemId/game-result | `{score}` | GamePlayer | `recordGameResult` | PRESENT |
| recordBranchingResult | POST .../items/:itemId/branching-result | `{path: string[]}` | BranchingScenarioPlayer | `recordBranchingResult` | PRESENT |
| placeBucketSortItem | POST .../items/:itemId/bucket-sort/place | `{sortItemId, bucketId}` | BucketSortPlayer | `placeBucketSortItem` | PRESENT |
| restartBucketSort | POST .../items/:itemId/bucket-sort/restart | none | BucketSortPlayer | `restartBucketSort` | PRESENT |
| saveJournalDraft | POST .../items/:itemId/journal | `{responses:[{promptId, response}]}` | JournalPlayer | `saveJournalDraft` | PRESENT |
| submitJournal | POST .../items/:itemId/journal/submit | none | JournalPlayer | `submitJournal` | PRESENT |
| setTrackLanguage | PUT /learn/tracks/:trackId/language | `{languageCode}` | CourseLanguageSheet | `setTrackLanguage`; invalidates `trackDetailProvider` | PRESENT |
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
| getScenarios (lang) | GET /v2 /learn/scenarios | none; unwraps `data` | SimulationsScreen | `getScenarios` (v2 via exact match) | PARTIAL: no `languageCode` |
| getScenarioById (lang) | GET /learn/scenarios/:id | none | RoleplayCasePlayer (course) | `getScenarioById`, `scenarioByIdProvider` | PARTIAL: no `languageCode` |
| getSimulationPaths (lang) | GET /learn/scenario-paths | none; unwraps `data` | SimulationsScreen | `getScenarioPaths` | PARTIAL: no `languageCode` |
| getSimulationPathDetails (lang) | GET /learn/scenario-paths/:pathId | none; scenarios sorted by `order` | hooks/useLearningPathDetails | `getSimulationPathDetails` | PARTIAL: no `languageCode` |
| createPathSession | POST /learn/scenario-paths/:pathId/create-session | none | useLearningPathDetails | `createPathSession`; screen invalidates path details | PRESENT |
| getScenarioSessionByPathItem | GET /learn/scenario-session/scenario-path-session-item/:id | none | useLearningPathDetails | `getScenarioSessionByPathItem` | PRESENT |
| getCases (lang) | GET /learn/cases | none | SimulationsScreen | `getCases` | PARTIAL: no `languageCode` |
| getCaseDetails (lang) | GET /learn/cases/:caseId | none | RoleplayCasePlayer, useLearningPathDetails | `getCaseDetails` | PARTIAL: no `languageCode` |
| createCaseSession | POST /learn/cases/:caseId/create-session | none | useLearningPathDetails | `createCaseSession` | PRESENT |
| getScenarioSessionByCaseItem | GET /learn/scenario-session/case-session-item/:id | none | useLearningPathDetails | `getScenarioSessionByCaseItem` | PRESENT |
| getSimulationCredits | GET /simulation-credits | none; tag `SimulationCredits` | hooks/useSimulationCredits (drawer, details screens) | `getSimulationCredits`, `simulationCreditsProvider` | PRESENT (never refreshed; see §4) |
| startScenarioSession | POST /learn/scenario-session-start | `{scenarioId, scenarioPathSessionItemId?, caseSessionItemId?, trackItemProgressId?, languageId?}` returns `{scenarioSession.id, accessToken{token, serverUrl}, scenario}` | hooks/useStartSimulation | `startScenarioSession` (same body); `SessionData.fromJson` reads `accessToken.token/serverUrl` | PRESENT |
| endScenarioSession (lang) | POST /learn/scenario-session/:id/end | body `{enableRecommendations:true, languageCode}` | ActiveSimulationModal, SimulationAssistantScreen | `endScenarioSession(id)` with **no body** (`roleplay_voice_screen.dart:498`, `start_simulation_controller.dart:244`) | PARTIAL: `enableRecommendations` and `languageCode` are not sent, so recommendations and localized debrief generation may differ; no credit/path/case invalidation |
| getSimulationDetails (lang) | GET /learn/scenario-session/:id | `{enableRecommendations:true}` | SimulationFeedbackScreen | `getSimulationDetails` (sends `enableRecommendations`) | PARTIAL: no `languageCode` |
| addSimulationFeedback | POST /learn/scenario-session/:id/feedback | `{rating, feedback, tags?}` | SimulationFeedbackScreen | `addSimulationFeedback` | PRESENT |
| getEventChecklist (lang) | GET /learn/scenario-session/:id/event-checklist | none | EventChecklist (feedback screen) | `getEventChecklist`, `eventChecklistProvider` (merged from parity/feedback) | PARTIAL: no `languageCode` |
| getSimulationMessages | GET /learn/scenario-session/:id/messages | `{limit:10, offset, sortBy:'startSeconds', sortOrder, languageCode?}` (`languageCode` = transcript-translation dropdown) | useSimulationTranscriptDetails (SimulationTranscript) | `SimulationTranscriptRepository.getMessages` (`{limit:10, offset, sortBy:'startSeconds', sortOrder:'ASC'}`) | PARTIAL: no `languageCode`; the transcript-translation dropdown is "Not ported" (`simulation_transcript_tab.dart:28-30`) |
| getSimulationSessionRecording | GET /learn/scenario-session/:id/recording | none returns recording URL | hooks/useSimulationSessionRecordingUrl (TranscriptTab audio player) | none. "Not ported: the session-recording audio player" (`simulation_transcript_tab.dart:28`). | **MISSING** |
| (raw) Ask-AI history | GET /learn/scenario-sessions/:id/chat/history | Bearer; own 401-refresh-retry | AskAI/chatSessionManager.loadHistory | `AskAiChatApi.getHistory` (`core/widgets/ask_ai_chat/ask_ai_chat_api.dart`) through shared Dio and interceptor | PRESENT |
| (raw) Ask-AI stream (SSE) | POST /learn/scenario-sessions/:id/chat/stream | `{message}`, `Accept: text/event-stream`; XHR `onprogress` parse of `data: {type: START\|TOKEN\|CITATIONS\|DONE\|ERROR}` | chatSessionManager.startStream | `AskAiChatApi.streamChat` (`ResponseType.stream` + `SseEventParser`); 401 refreshed by `AuthInterceptor`; error copy matches RN | PRESENT |
| (raw) Review/feedback audio | GET `<audioUrl>` (S3) | none | SimulationAudioPlayer (review card/details) | `simulation_audio_player.dart` `setSourceUrl(audioUrl)` | PRESENT |

##### Reviews (simulation + scribe), threads, reactions
Master files: `features/reviews/data/reviews_repository.dart`, `scribe_reviews_repository.dart`, `features/reactions/data/reactions_repository.dart`. The branch `parity/reviews` adds a unified `features/reviews/data/review_api.dart` (`ReviewApi`, base switches on `ReviewType`). I verified that it covers the rows marked IN PROGRESS.

| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getReviews (lang) | GET /scenario-session-reviews | `{sortBy, readFilter, limit:10, offset, order:'DESC'}`, infinite scroll | ReviewScreen / ReviewList / useReviews | master: `getReviews` fixed `{sortBy, limit:25, offset:0, readFilter?}` (first 25 only, no pagination). `parity/reviews`: paginated `limit/offset`. | **MERGED** (was IN PROGRESS on parity/reviews). The branch still omits `order:'DESC'` (its doc comment wrongly says RN sends no `order`) and `languageCode`. |
| getScribeReviews | GET /scribe-session-reviews | same shape | ReviewScreen | master: same 25-item, no-pagination limit; branch paginates | **MERGED** (was IN PROGRESS on parity/reviews); same `order` caveat |
| getReviewById (lang) | GET /scenario-session-reviews/:id | none; `keepUnusedDataFor:0`, refetchOnFocus/Reconnect | SimulationFeedbackScreen, SimulationReviewDetailsScreen | `ReviewsRepository.getReview`, `reviewDetailProvider` | PARTIAL: no `languageCode`; no refetch-on-focus |
| getScribeReviewById | GET /scribe-session-reviews/:id | none | ScribeReviewDetailsScreen | `getScribeReview` | PRESENT |
| createReview | POST /scenario-session-reviews | `{scenarioSessionId, note}` | ShareSimulationScreen | `ReviewsRepository.createReview` | PRESENT |
| createScribeReview | POST /scribe-session-reviews | `{scribeSessionId:number, note}` | ShareCallLogScreen | `ScribeReviewsRepository.createReview` | PRESENT |
| updateReviewStatus | PATCH /scenario-session-reviews/:id | `{status, note?}` | ReviewApiContext, ShareSimulationScreen, useToggleReviewPrivacy | `updateReviewStatus` | PRESENT |
| updateScribeReviewStatus | PATCH /scribe-session-reviews/:id | `{status, note?}` | ReviewApiContext, CallSummaryScreen, ShareCallLogScreen, ScribeReviewDetailsScreen | `updateReviewStatus` (scribe) | PRESENT |
| markSimulationReviewAsRead | PATCH /scenario-session-reviews/:id/mark-read | none | SimulationReviewDetailsScreen | `markAsRead` (called from `review_screen.dart` on open) | PRESENT |
| markScribeReviewAsRead | PATCH /scribe-session-reviews/:id/mark-read | none | ScribeReviewDetailsScreen | `markAsRead` (scribe) | PRESENT |
| getUnreadSimulationReviewCount | GET /scenario-session-reviews/unread-count | none | navigation/TabNavigator (Reviews tab dot) | `getUnreadCount`, `unreadReviewCountProvider` (`app_shell_screen.dart:60`) | PRESENT |
| getUnreadScribeReviewCount | GET /scribe-session-reviews/unread-count | none | navigation/TabNavigator (dot = sim + scribe) | none on master or `parity/reviews` | **MISSING**: scribe reviewers never see the unread dot |
| getMessages | GET /scenario-session-reviews/:id/messages | `{offset, limit, sortOrder?, sortBy?}` | SimulationReviewDetailsScreen (transcript under review) | master: none. Branch: `ReviewApi.getMessages` | **MERGED** (was IN PROGRESS on parity/reviews) |
| getScribeMessages | GET /scribe-session-reviews/:id/messages | same | ScribeReviewDetailsScreen | branch `ReviewApi.getMessages` (scribe base) | **MERGED** (was IN PROGRESS on parity/reviews) |
| addReviewComment | POST /scenario-session-reviews/:id/comments | `{threadId?, parentCommentId?, messageId?, selection?, content}` | ReviewApiContext, SimulationReviewDetailsScreen | master: `addGeneralComment {content}` / `addThreadReply {threadId, content}`, so no message-anchored threads (`messageId`/`selection`) and no `parentCommentId`. Branch: `ReviewApi.addComment` with all five keys. | **MERGED** (was IN PROGRESS on parity/reviews) |
| addScribeReviewComment | POST /scribe-session-reviews/:id/comments | same | ReviewApiContext, ScribeReviewDetailsScreen | same as above | **MERGED** (was IN PROGRESS on parity/reviews) |
| getThreadComments | GET /scenario-session-reviews/threads/:threadId/comments | `{offset, limit}` | ReviewApiContext | master: none. Branch: `ReviewApi.getThreadComments` | **MERGED** (was IN PROGRESS on parity/reviews) |
| getScribeThreadComments | GET /scribe-session-reviews/threads/:threadId/comments | same | ReviewApiContext | branch | **MERGED** (was IN PROGRESS on parity/reviews) |
| getGeneralReviewComments | GET /scenario-session-reviews/:id/comments | `{offset, limit}` (paginated) | ReviewApiContext | master: `getGeneralComments` with no params (single page). Branch: paginated. | **MERGED** (was IN PROGRESS on parity/reviews) |
| getScribeGeneralReviewComments | GET /scribe-session-reviews/:id/comments | same | ReviewApiContext | same as above | **MERGED** (was IN PROGRESS on parity/reviews) |
| getGeneralCommentsOverview | GET /scenario-session-reviews/:id/comments-overview | `{offset:0, limit:2, sortOrder:'DESC', sortBy:'createdAt'}` | ReviewList, ReviewCard (comment preview on list cards) | master: none. Branch: `ReviewApi.getCommentsOverview` (identical params), used in `review_card.dart:99`. | **MERGED** (was IN PROGRESS on parity/reviews) |
| getScribeGeneralCommentsOverview | GET /scribe-session-reviews/:id/comments-overview | same | ReviewList | branch | **MERGED** (was IN PROGRESS on parity/reviews) |
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
| addReactionToReview | POST /scenario-session-reviews/:id/reactions | `{reaction, action}`; invalidates `Badges` | ReviewApiContext (react to the whole review) | master: method exists but **no caller**. Branch: `ReviewApi.addReactionToReview` used in `review_details_screen.dart:184`. | **MERGED** (was IN PROGRESS on parity/reviews) |
| addScribeReactionToReview | POST /scribe-session-reviews/:id/reactions | same | ReviewApiContext | same as above | **MERGED** (was IN PROGRESS on parity/reviews) |

##### Dynamic translations CDN (raw)
| RN | Method + path | Shape | RN call site | Flutter | Status |
|---|---|---|---|---|---|
| (raw) i18n sync | GET `${I18N_BASE_URL}/manifest.json`, then GET `${base}/${currentVersion}/${lang}/${ns}.json` per namespace | no auth; cached in AsyncStorage per version+lang; refresh on start, on AppState active, every MANIFEST_RECHECK_MS, and on `languageChanged` | localization/dynamic.ts | `LocalizationController._refresh` (`core/localization/localization_controller.dart:134-165`) using a bare `Dio()` (correct, no API interceptor); 30s poll + resume; gated on `LANGUAGE_SELECTOR_FLAG` like RN | PARTIAL: (1) `if (cachedVersion == manifest.currentVersion) return;` never checks that a cached resource exists *for the current language*. RN checks `cachedResource`. After `changeLanguage()` the state is reset to bundled strings, `refresh()` exits early, and CDN overrides for the new language are dropped until the next manifest version bump. (2) The default `I18N_BASE_URL` is `https://api.helloally.dev/i18n` (the dev env was retired 10-15), where RN defaults to empty, i.e. disabled. |

---

#### 2. Transport layer

| Concern | RN (`services/api.ts` etc.) | Flutter (`core/network/*`) | Status |
|---|---|---|---|
| Base URL | `env.API_BASE_URL + '/api/'` + `v1`/`v2` per exact-match list | `AppConfig.requireApiBaseUrl + '/api'`; interceptor prefixes `/v1` or `/v2` with exact match (`auth_interceptor.dart:47`) | PRESENT |
| Auth header | `authorization: Bearer <ACCESS_TOKEN>` from AsyncStorage in `prepareHeaders` | Same header from `flutter_secure_storage` (`token_storage.dart`, same key names) | PRESENT. Storage differs: Keychain/Keystore vs AsyncStorage, so tokens do not migrate across the app swap and users must log in again. |
| 401 refresh | On 401: no tokens means logout; else POST `/auth/refresh {refreshToken}` (through the same baseQuery, with the old bearer); store tokens; retry the original once; on failure, logout. No de-duplication. | Same contract; a bare `refreshDio` posts `/v1/auth/refresh`; concurrent 401s share one `_refreshFuture` (single-use refresh token race fixed); the retry goes via `refreshDio` (keeps `ResponseType.stream`) | PRESENT (Flutter is stricter: if the retried request 401s again it also logs out, where RN would just return the error) |
| Logout on refresh failure | `handleLogout()` + `api/resetApiState` + toast `auth.sessionExpired` | `AuthController.sessionExpired()`: clear tokens, auth state false, snackbar `auth.sessionExpired` (suppressed if already signed out); `apiClientProvider` watches auth, so every repository/provider is rebuilt (cache reset) | PRESENT. **Neither path calls DELETE device-token** (RN calls it only on explicit logout via useUser). Flutter misses it on explicit logout too. |
| Retry | None (RTK default) | Riverpod `appRetryPolicy`: provider reads only, max 3, 400ms doubling, skips 4xx/cancel; mutations not retried | Divergent by design (OK) |
| Timeouts | None on RTK fetch; Ask-AI XHR has no explicit timeout; socket `timeout:10000` | Dio `connectTimeout 20s`, `receiveTimeout 90s` (inter-chunk); socket `setTimeout(10000)` | Divergent: an LLM endpoint (enhance, retry-summary, generate-from-audio) that is silent for more than 90s fails in Flutter but would succeed in RN |
| Language headers / params | No `Accept-Language`; injects `languageCode` param/body for 18 allowlisted endpoints (`languageCodeEndpoints.ts`) | None at all | **PARTIAL**: 16 implemented endpoints lack `languageCode` (flagged (lang) above) |
| App-version header | None. App version is sent only in bug-report `context` and the `SCRIBE_START_DIAGNOSTIC` socket payload. | None; bug-report `context.appVersion` sent; diagnostic not emitted | PARTIAL (diagnostic only; see §3) |
| Tenant header | None (tenant comes from the JWT) | None | PRESENT (parity) |
| 403 suspended | `isSuspendedUserError`: 403 && (`error==='USER_SUSPENDED'` or `message==='User suspended'`) checked only at OTP/Google/Apple sign-in, then `SuspendedAccount` screen. Not global. | `login_screen.dart:55-65` same predicate after all three sign-in methods, then `/suspended`; router allows `/suspended` while unauthenticated | PRESENT |
| Other 403 | CallSummaryScreen hides transcript tab on 403 | `call_summary_screen.dart:964` 403 branch; `course_detail_screen.dart:88` 403 | PRESENT |
| Error normalisation and toast | `getErrorDetails`: `data.message \|\| data.error \|\| t('common.somethingWentWrong')` used by screens with `showToast` | No shared helper; a few screens parse `data['message']` (complete_profile, branching, start_simulation, voice note), many render raw `'$error'` / `'...: $e'` (DioException `toString`), e.g. `call_log_screen.dart:247`, `call_summary_screen.dart:862,968,1556`, `roleplay_voice_screen.dart:503` | PARTIAL: users see raw Dio exception text in several places |
| Network logger | `NetworkLogs` overlay in development | none | n/a (dev only) |

#### 3. Realtime: socket.io and LiveKit

| Item | RN | Flutter | Status |
|---|---|---|---|
| Client config | `io(API_BASE_URL + path, {path:'/socket.io', transports:['websocket','polling'], auth: cb with fresh token, reconnection 5 attempts 1-5s, timeout 10s, forceNew, autoConnect:false})` + manual retry timer after an open failure (`RETRY_AFTER_FAILURE_MS`) | `core/realtime/socket_service.dart`: identical options; **no retry-after-failure timer** (`connect()` has try/finally only); a single shared `SocketService` instance across namespaces | PARTIAL (no manual retry after an initial open failure) |
| Microphone namespace (`MICROPHONE_SOCKET_PATH` = /microphone-chat) listeners | `SESSION_CREATED`, `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `MESSAGE_RECEIVED`, `UTTERANCE_ENDED` | `scribe_recording_screen.dart:176-185`: all six | PRESENT |
| Microphone emits | `AUDIO_MESSAGE {audioData: base64 chunk, chatId}`, `START_AUDIO_CHAT {isLinear16Encoded:true, platform:'MOBILE', sampleRate:16000, mode:'SCRIBE'}` | `scribe_recording_screen.dart:227,237`: same payloads | PRESENT |
| `SCRIBE_START_DIAGNOSTIC` emit | `{afterMs, appVersion, ...gates}` at 5s/15s when the recording has not started | Constant defined, never emitted (deliberately skipped per `scribe_recording_screen.dart:63`) | **MISSING** (telemetry only) |
| Cloud-telephony namespace (`CLOUD_TELEPHONY_PATH`) on ConferenceListeningScreen | on: `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `AUDIO_STREAM`; emits `AUDIO_CHAT_PAUSED/RESUMED {chatId}` behind a button that is hidden (`showPauseResumeButton={false}`), so effectively dead | `conference_listening_screen.dart:130-138`: same four listeners; no pause emit (parity, since RN hides it) | PRESENT |
| **App-wide** cloud-telephony socket | `RootNavigator.tsx:170` keeps a socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` calls `checkCounselorChat()` and auto-navigates into an incoming conference call while the app is in the foreground | None. `active_chat_discovery.dart` runs only on cold launch / resume / complete-profile. | **MISSING**: a counsellor sitting in the app does not get routed into an incoming telephony call |
| LiveKit token/room | Comes from the `startScenarioSession` response `accessToken.{token, serverUrl}` (no separate token endpoint; `/rooms` `listRooms` is DEAD) | `SessionData.fromJson` reads the same fields; `LiveKitRoomService.connect(url, token)` | PRESENT |
| LiveKit room events | `Connected`, `Disconnected` (navigate to feedback), `ParticipantConnected` (ringing until agent audio, grace timer), `ActiveSpeakersChanged`, `DataReceived`; `ParticipantEvent.IsSpeakingChanged` | `livekit_room_service.dart:83-89` listens **only** to `DataReceivedEvent` and `ActiveSpeakersChangedEvent`; no `RoomDisconnectedEvent` / `ParticipantConnectedEvent` anywhere in `lib/` | PARTIAL: when the agent or server ends the room (time cap, `cap-ended`, agent crash), Flutter does not auto-navigate to feedback; there is no agent-joined/ringing transition |
| LiveKit data publish | `localParticipant.publishData` (pause/resume control) | `LiveKitRoomService.publishData` | PRESENT |

#### 4. Cache invalidation (RN tags vs Flutter refresh after mutations)

| RN mutation, then what it invalidates | Flutter after the same action | Gap |
|---|---|---|
| endScenarioSession: `SimulationCredits`, `SimulationPaths`, `SimulationPathDetails`, `Cases`, `CaseDetails` | nothing is invalidated (`roleplay_voice_screen.dart:493-505`, `start_simulation_controller.dart:244`); `simulationCreditsProvider` is never invalidated anywhere | **Stale credits** in the drawer/details and stale path/case progress after a role play, until pull-to-refresh or app restart |
| Course mutations (enroll, startTrackItem, articleRead, quiz submit/regrade, branching, bucket place, journal submit, setTrackLanguage; conditional on articleQuestion/videoProgress completion): `LearnTracks`, `LearnTrackDetail` (also feeds progress), `LearnTrackNext` | only `trackDetailProvider(trackId)` is invalidated (item player, detail enroll, language sheet). `learnTracksProvider` and `trackProgressProvider` are never invalidated after a mutation. | Course list percentages/enrolled state and the Course Progress screen stay stale |
| createPathSession: `SimulationPathDetails` + `SimulationPaths`; createCaseSession: `CaseDetails` + `Cases` | details provider invalidated; list providers (`scenarioPathsProvider`/`casesProvider`) not | List cards stale (minor) |
| addReviewComment / deleteComment / addReactionToReview: `Badges` (+ `ReviewDetails`, `ReviewMessages`, `GeneralComments`, `ReviewThreads`) | general-comment add invalidates `generalCommentsProvider` + `reviewDetailProvider`; thread replies refresh in `thread_detail_screen`; `badgesProvider` never invalidated | Newly unlocked reviewer badges are not shown until reload (minor) |
| markBadgeAsViewed: badge lists | no invalidation (only used on tap) | minor |
| updateProfileImage / deleteProfileImage / completeProfile: refetch `User` | `ref.invalidate(currentUserProvider)` | PRESENT |
| discussion mutations: `CourseDiscussion` | `ref.invalidate(discussionProvider(itemId))` | PRESENT |
| markNotificationRead / markAll: `Notifications` + `UnreadNotificationCount` | `ref.invalidate(notificationsControllerProvider)` (the unread-count endpoint is unused in both apps) | PRESENT |
| markSimulation/ScribeReviewAsRead: (no tags in RN either) | no invalidation of `unreadReviewCountProvider` | parity (both stale) |
| Polling / refetchOnFocus: `getBadges` every 60s + focus/reconnect; review details refetchOnFocus/Reconnect | none (no popup; providers are not focus-aware) | PARTIAL |

#### 5. DEAD RTK endpoints (defined in RN, never called)

Direct, with zero hook or initiate references outside tests:
`badgesApi.getBadgeCount` (GET /badges/me/count) · `callSummaryApi.getTags` (POST /chats/summary/tag-positivity-ratings) · `coursesApi.getTrackLanguages` (GET /learn/tracks/:id/languages) · `discussionApi.getDiscussionModeratorTenants` (GET /learn/track-items/:id/discussion/tenants) · `generalCommentsApi.getGeneralComments`, `addGeneralComment`, `deleteGeneralComment`, `updateGeneralComment`, `updateGeneralCommentVisibility` (/scenario-session-reviews/:id/general-comments, /general-comments/:id[/visibility]) · `scribeGeneralCommentsApi.getScribeGeneralComments`, `addScribeGeneralComment`, `deleteScribeGeneralComment`, `updateScribeGeneralComment`, `updateScribeGeneralCommentVisibility` · `notificationsApi.getUnreadNotificationCount` (GET /notifications/unread-count; Flutter also defines `unreadCount()` and never calls it) · `reviewsApi.getReview` · `searchApi.getCategories` (GET /reference-document/categories) · `simulationSummaryApi.getSimulationSkills` (GET /learn/scenario-session/:id/skills) · `simulationSummaryApi.getChatHistory` (the live path is the raw fetch in chatSessionManager) · `simulationsApi.listRooms` (GET /rooms) · `userApi.updateUserPreferences` (POST /users/preferences).

Transitive, reachable only from the unused hooks `useLanguageDropdown` / `useSimulationTransition`:
`simulationsApi.getAvailableLanguages` (GET /learn/scenario-languages?active&hasVoices) · `userApi.getUserPreferences` (GET /users/me/preferences) · `simulationsApi.getUpcomingScenario` (GET /learn/scenario-paths/:id/upcoming-scenario) · `simulationsApi.getUpcomingCaseScenario` (GET /learn/cases/:id/upcoming-scenario).

**Flutter-only calls to RN-dead endpoints:** `features/preferences/data/preferences_repository.dart` (Preferences screen) calls GET /users/me/preferences, POST /users/preferences `{default_language_id}`, and GET /learn/scenario-languages (without RN's `active=true&hasVoices=true` filter). RN's live simulation language picker uses `scenario.availableLanguages` from the scenario payload instead. This is extra Flutter surface with no RN counterpart; decide whether to keep it.

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
| Flutter keys | 1566 | 1458 | 1458 | 1458 | 1458 |

- RN static keys referenced from code: **848**. All 848 exist in Flutter `en.json`, so **0 are missing**.
- Dynamic key templates in RN: **13 families**. All expansions exist in Flutter `en.json` because it is a superset of RN `en.json`.
- RN `en.json` keys absent from Flutter `en.json`: **1** (`auth.login.otp.expires`, replaced by `_one`/`_other` plural keys).
- English value drift: 0. hi/kn/mr/ta value drift on shared keys: 0.
- Flutter-only keys: **106**. In hi/kn/mr/ta, Flutter is missing **108** of its own en keys (106 Flutter-only plus the 2 plural keys).
- Flutter `t()` references not present in `en.json`: **0** (509 distinct literal refs checked).

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | Static keys referenced from RN code exist in Flutter en | 848 keys | `assets/locales/en.json` | PRESENT | 0 missing. |
| 2 | Dynamic key families | `months.${variant}` (utils/date.ts); `postSim.debrief.section.${key}` (SupervisorNote); `callSummary.archiveActionModal.${key}.{header.title,header.subtitle,description,confirm,cancel}` (ArchiveActionModal); `courses.progressDashboard.classification.${c}` (SkillCategoryRow); `courses.language.fallback.${reason}` (CourseItemRow); `courses.branching.outcome.${outcome}` (BranchingScenarioPlayer); `simulations.${tabLabel}` (SimulationsScreen); `postSim.feedback.dialog.rating.tags.${rating}` (FeedbackPopup) | all subtrees present in en.json | PRESENT | Whether each Flutter widget actually builds these keys is covered per screen in §2. |
| 3 | OTP expiry string | `auth.login.otp.expires` (one key, translated in all 5 languages) | `auth.login.otp.expires_one/_other` in en only (`login_screen.dart:850`) | PARTIAL | hi/kn/mr/ta have neither the RN key nor the plural keys, so the expiry line falls back to English. Port the RN translations into `_one`/`_other`. |
| 4 | RN-translated keys dropped from Flutter hi/kn/mr/ta | RN hi/kn/mr/ta have `courses.breathing.{title,defaultIntro,start,cycleProgress}` | present in Flutter en, absent in the other 4 | PARTIAL | A regression against RN: copy these 4 keys from the RN locale files. |
| 5 | Flutter-only keys **referenced in code** with no hi/kn/mr/ta translation (33) | — | listed in the next table | MISSING | These show English to Indic users. |
| 6 | Flutter-only keys not referenced in code (75) | — | `home.*` (17, the Phase-0 dev shell), `scribe.*` and `conferenceListening.*` debug labels, older `review.*`/`callSummary.*`/`simulations.*`/`postSim.feedback.*` drafts | N/A | Cleanup candidates, no user impact. |
| 7 | All five languages present for RN keys | 5 × 1461 | 5 files, RN keys complete except rows 3 and 4 | PRESENT | |
| 8 | Dynamic CDN translation sync (`localization/dynamic.ts`, gated by `LANGUAGE_SELECTOR_FLAG`) | `I18N_BASE_URL` manifest + namespaces | `core/localization/localization_controller.dart` | PARTIAL | After a language change it returns early when the cached version matches, so the new language's overrides are never applied. The default URL is `https://api.helloally.dev/i18n` (dev host retired 10-15); RN's default is empty (§9). |
| 9 | Hardcoded English UI literals in Flutter outside `t()` | RN also hardcodes some (`SUMMARY_STATUS_CONFIG` labels, summary field labels) | 81 grep hits. Most mirror RN; Flutter-only examples: `app_shell_screen.dart` "No accessible tabs for this account", `call_log_screen.dart` semantic labels 'Filter'/'Refresh' | PARTIAL | Spot-check only, not exhaustive. |

The 33 referenced but untranslated Flutter keys, grouped by feature (missing in all of hi/kn/mr/ta):

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

Method (`scratchpad/scripts/assets2.py`; raw output in `inventory/assets_final.txt`):
- RN assets are resolved through `src/assets/{icons,images,animations,sounds}/index.ts` export names, and an asset counts as used when that name appears in non-test RN `src`.
- A Flutter asset counts as referenced when its filename appears in `lib/**/*.dart`. Flutter uses literal `assets/...` paths and has no interpolated asset paths, which was checked.

Overview:
- RN has 161 asset files: 143 svg icons, 11 png images, 4 Lottie animations, 3 mp3 sounds, plus 7 fonts. `icons/infoBlack.svg` is not exported from RN `icons/index.ts`, so it is RN-dead.
- Flutter ships **every RN file except `sounds/startSimulation.mp3` and `sounds/endSimulation.mp3`**, plus `assets/locales/*` and `assets/games/*.html` (6 game bundles, all referenced).
- Fonts: all 7 are bundled in pubspec (ReplayPro ×3, Roboto, IBM Plex Serif ×2, Yeseva One). PRESENT.

| Bucket | Count | Status |
|---|---|---|
| RN-used and Flutter-referenced | 96 files + 7 fonts | PRESENT |
| RN-used, shipped in Flutter but **never referenced**: Flutter draws a Material icon instead, or the feature is missing | 47 | PARTIAL (listed below; 4 carousel images and 3 icons used only by never-rendered RN components are effectively N/A) |
| RN-used and **not shipped** in Flutter | 2 | MISSING: `sounds/startSimulation.mp3`, `sounds/endSimulation.mp3` (role-play start ringtone and end sound, `SimulationAssistantScreen.tsx`) |
| RN-unused (dead in RN) | 16 files | N/A: `icons/{infoBlack,bars,callEnd,callHighlights,demogs,forward10,headphone,keyEvents,lightBulb,profileIcon,replay10,rightArrow,thumbUp}.svg`, `images/{listenLive,joinCall}.png`, `animations/listen.json`. All are also unreferenced in Flutter, so they are deletion candidates. |

RN-used assets that Flutter ships but never references (PARTIAL). Each line gives the asset, then where RN uses it, then what it implies for Flutter.

**Call summary section icons** (`constants/summary.ts` `SECTION_LIST`, rendered in CallSummaryDetails)
- Assets: `assessment.svg`, `brightnessAlert.svg`, `callDetails.svg`, `database.svg`, `flow.svg`, `handShare.svg`, `headsetMic.svg`, `intake.svg`, `keyConcern.svg`, `magnifyEye.svg`, `newsStand.svg`, `ongoingRisks.svg`, `prescriptions.svg`, `sessionSummary.svg`, `smile.svg`, `tableEye.svg`, `tag.svg`
- Flutter (`call_summary_screen.dart:76-90`) uses Material `Icons.*` instead. Visual parity only.

**Call summary summary screen**
- `images/summaryGenerated.png`, `images/summaryFailed.png`, `animations/summaryLoading.json`, `icons/shieldWithTick.svg`: used by SummaryGenerationProgress and SummaryUnauthorized. Flutter has no generation-progress illustration or Lottie (§2 Scribe).
- `icons/page.svg`, `icons/info.svg`: used by AddNotesSection, which handles notes typed while the summary generates. The feature is missing in Flutter.
- `icons/contract.svg`, `icons/export.svg`, `icons/edit.svg`, `icons/unarchive.svg`: used by the SummaryModals actions menu. Export is missing in Flutter; the other actions use Material icons.
- `icons/goldenShield.svg`: used in CallSummaryDetails (privacy banner).
- `icons/call.svg`, `icons/transcript.svg`: used by SummaryDropdown and FeedbackDropdown, which are N/A in RN (exported but never rendered).
- `icons/delete.svg`: used by VoiceNotePanel and DiscussionPost. Flutter uses Material icons.
- `icons/arrowRight.svg`: used by SectionHeader, PlayerBottomNav and SessionGlimpse. Flutter uses Material chevrons.

**Listening**
- `icons/pause.svg`, `icons/resume.svg`: used by ListeningControls. Flutter `listening_controls.dart` uses other icons.
- `icons/thumb.svg`: used by NudgeSection.
- `icons/networkDisconnected.svg`: used by the NetworkDisconnected screen. Flutter `network_disconnected.dart` uses a Material icon.
- `icons/endSession.svg`: used by CallEndConfirmationModal and the role-play end button.

**Simulation feedback**
- `images/conversation.png`: used in SimulationFeedback, Debrief and summary constants.
- `animations/botThinking.json`: used by the Ask-AI thinking indicator in ChatElements.
- `icons/arrowUpRight.svg`: used by AskAiInitialState.
- `icons/simulation.svg`: used by FeedbackDropdown, which is N/A in RN.

**Other**
- `icons/forceUpdateAlert.svg`: used by ForceUpdateModal, which is missing in Flutter.
- `icons/downArrow.svg`: used by the ResourceArticleCard expand control, which is missing in Flutter.
- `images/carousel{1..4}.png`: used only by `SECURITY_CAROUSEL_SLIDES`, which only SecurityCarousel uses, and SecurityCarousel is never rendered. N/A in practice.

Flutter assets with no reference in `lib/`: the 47 above plus the 16 RN-dead ones (63 in total). Flutter ships no asset that RN lacks, apart from locales and games.

---

## §9 Config / env / flags

RN: `react-native-config` reads `env/.env*` via `src/config/env.ts` (`assertEnvVar` makes most values required). Flutter: `--dart-define(-from-file)` read through `lib/core/config/app_config.dart` and `lib/core/push/leaderboard_notification.dart`.

| # | RN var (required?) | RN consumers | Flutter equivalent & default | Status | Notes |
|---|---|---|---|---|---|
| 1 | `ENVIRONMENT` (req.) | `App.tsx` NetworkLogs gate, `utils/logger.ts` (logging on in development only), drawer "(Dev)" suffix | `AppConfig.environment`; default `development` in debug, `production` in release | PRESENT | |
| 2 | `API_BASE_URL` (req.) | `services/api.ts` | `AppConfig.apiBaseUrl` (default `''`, `requireApiBaseUrl` throws) | PRESENT | |
| 3 | `API_VERSION` (req.) | read by `env.ts` only; nothing uses it. Versions are per-endpoint: `/api/v1`, plus `/api/v2` for 3 routes | hardcoded v1, with v2 list in `api_routes.dart` | N/A | Dead in RN. |
| 4 | `ALLY_WEB_URL` (req.) | `utils/deeplink.ts` link allowlist, CallLog "Learn more" link, SimulationDetails copy-link | hardcoded `https://app.helloally.ai/` in `simulation_details_screen.dart` | PARTIAL | Not configurable per environment (staging builds copy prod links). The deep-link allowlist and CallLog "Learn more" are missing (§2 Scribe C12, §4b). |
| 5 | `MICROPHONE_SOCKET_PATH` (req.) | `hooks/useSocket.ts` (Scribe) | `AppConfig.microphoneSocketPath`, default `/microphone-chat` | PRESENT | |
| 6 | `CLOUD_TELEPHONY_PATH` (req.) | app-wide telephony socket, Conference listening | `AppConfig.cloudTelephonyPath`, default `/cloud-telephony-chat` | PRESENT | The value is ported, but the app-wide socket that uses it is MISSING (§4b). |
| 7 | `GOOGLE_WEB_CLIENT_ID` (req.) | `useGoogleLogin` `webClientId` | `AppConfig.googleWebClientId`, default `''` | PARTIAL | Empty disables the Google button. The Flutter package id has no OAuth client. |
| 8 | `GOOGLE_IOS_CLIENT_ID` (req.) | `useGoogleLogin` `iosClientId` | `AppConfig.googleIosClientId`, default `''` | PARTIAL | iOS also needs `GIDClientID` and the reversed-client URL scheme in Info.plist, which are missing (§10). |
| 9 | `NOTIFICATION_SCHEDULE_DAY` (default 1) | `notificationService.ts` weekly leaderboard reminder | `leaderboard_notification.dart` `int.fromEnvironment`, default 1 | PRESENT | |
| 10 | `NOTIFICATION_SCHEDULE_HOUR` (default 11) | same | default 11 | PRESENT | |
| 11 | `NOTIFICATION_SCHEDULE_MINUTE` (default 0) | same | default 0 | PRESENT | |
| 12 | `LANGUAGE_SELECTOR_FLAG` (default false) | `i18n.ts` dynamic sync, `ProfileSettingsScreen` language row (2 places) | `AppConfig.languageSelectorEnabled` gates the sync in `localization_controller.dart` | PARTIAL | The Profile language row ignores the flag (§2 account, section 6). |
| 13 | `I18N_BASE_URL` (default `''`) | `localization/dynamic.ts` | `AppConfig.i18nBaseUrl`, default `https://api.helloally.dev/i18n` | PARTIAL | The default points at the dev host retired 10-15. It should default to empty or prod. |
| 14 | Android manifest placeholder `${appLinkHost}` (Gradle, per flavor) | App Links intent filter | none | MISSING | Build flavors aren't wired either: AppConfig's own comment says flavors are a later step. |
| 15 | Per-environment Firebase config (`GoogleService-Info.plist`, `google-services.json`) | Firebase app, FCM, Crashlytics | none in repo | MISSING | See §10. |

Flutter-only flags: none beyond the above. Also listed as N/A: `NetworkLogs` and the logger are dev-only.

---

## §10 Native / platform

### 10a iOS `Info.plist` (RN `ios/ally/Info.plist` vs Flutter `ios/Runner/Info.plist`)

| # | Key | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | `CFBundleDisplayName` | `Ally` | `Ally Mobile Flutter` | PARTIAL | Release identity. Bundle id is RN prod id vs `com.helloally.allyMobileFlutter`, which needs a decision before shipping. |
| 2 | `CFBundleURLTypes` (Google reversed client ids ×2) + `GIDClientID` | present | absent | MISSING | `google_sign_in` on iOS needs both, or sign-in fails at runtime. |
| 3 | `NSMicrophoneUsageDescription` | present | present (different, better copy) | PRESENT | |
| 4 | `NSPhotoLibraryUsageDescription` | present | present | PRESENT | |
| 5 | `NSCameraUsageDescription` | present | absent | N/A | Neither app captures camera (RN `launchCamera` unused; Flutter `ImageSource.gallery` only; role play is audio-only). |
| 6 | `NSLocationWhenInUseUsageDescription` | empty string | absent | N/A | RN has no geolocation calls. |
| 7 | `UIBackgroundModes` | `remote-notification` | `audio` | PARTIAL | `remote-notification` is missing (background/silent push handling). `audio` is a Flutter addition that keeps Scribe and role play recording when backgrounded; RN has no equivalent on iOS. |
| 8 | `NSAppTransportSecurity` `NSAllowsLocalNetworking` | true | absent | N/A | Dev-only (local http backend). Add it if local-network testing on device is needed. |
| 9 | `UIAppFonts` (7 fonts) | listed | fonts bundled via pubspec | PRESENT | |
| 10 | `UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`, `UISupportsDocumentBrowser` | true | absent | MISSING | RN exposes exported summaries (`utils/fileOperations.saveFile`, used by `useCallSummaryActions` export) in the Files app. Needed only once export is ported. |
| 11 | `ITSAppUsesNonExemptEncryption` = false | present | absent | MISSING | Without it, App Store Connect asks for export compliance on every build. |
| 12 | `UIRequiredDeviceCapabilities` arm64 | present | absent | N/A | Flutter iOS builds are arm64-only anyway. |
| 13 | `UISupportedInterfaceOrientations` | Portrait only | Portrait + LandscapeLeft/Right (iPad: all four) | MISSING | No `SystemChrome.setPreferredOrientations` in lib either, so Flutter rotates and RN doesn't. |
| 14 | `UIViewControllerBasedStatusBarAppearance` false | present | absent | N/A | Flutter controls the status bar via `SystemUiOverlayStyle`. |
| 15 | `UIApplicationSceneManifest` (scene lifecycle, iOS 27) | SceneDelegate | `FlutterSceneDelegate` scene config | PRESENT | |
| 16 | `PrivacyInfo.xcprivacy` (app-level privacy manifest) | present (`ios/ally/PrivacyInfo.xcprivacy`) | absent | MISSING | App Store requires a privacy manifest for required-reason APIs. |

### 10b iOS entitlements (RN `ios/ally/ally.entitlements`; **Flutter has no `.entitlements` file and no `CODE_SIGN_ENTITLEMENTS` in `project.pbxproj`**)

| # | Entitlement | RN | Flutter | Status |
|---|---|---|---|---|
| 17 | `aps-environment` (push) | development (prod via signing) | none | MISSING |
| 18 | `com.apple.developer.applesignin` | Default | none | MISSING: Apple sign-in fails on device although `sign_in_with_apple` is integrated. |
| 19 | `com.apple.developer.associated-domains` `applinks:app.dev.helloally.ai`, `applinks:app.helloally.ai` | present | none | MISSING: no universal links. |

### 10c iOS AppDelegate / SceneDelegate

| # | Behaviour | RN (`AppDelegate.swift`) | Flutter (`AppDelegate.swift`, `SceneDelegate.swift`) | Status | Notes |
|---|---|---|---|---|---|
| 20 | Firebase configure at launch | `FirebaseApp.configure()` | `Firebase.initializeApp()` in Dart (`main.dart:32`) | PARTIAL | Fails without `GoogleService-Info.plist` (row 22). |
| 21 | Scene lifecycle (iOS 27 requirement) | custom SceneDelegate | implicit-engine FlutterSceneDelegate | PRESENT | |
| 22 | `GoogleService-Info.plist` / Android `google-services.json` | present | absent | MISSING | FCM, Crashlytics and the Google Android client config all depend on these. |
| 23 | Cold-start URL / universal-link forwarding (`urlContexts`, `NSUserActivityTypeBrowsingWeb` → `RCTLinkingManager`) | present | none (no `app_links`/`uni_links` plugin, no Dart handler) | MISSING | |
| 24 | Warm deep links (`openURLContexts`, `continue userActivity`) | present | none | MISSING | |
| 25 | `UNUserNotificationCenter` delegate | via RN Firebase / notifee | set in `AppDelegate` for flutter_local_notifications | PRESENT | |
| 26 | Native module `CommentableTextView` (Swift + ObjC manager: text selection → "Comment" menu on the review transcript) | `ios/ally/CommentableText*.swift/.m` + `components/CommentableText/{Ios,Android}CommentableText.tsx` | `features/reviews/presentation/review_conversation.dart` (selection context menu) | PRESENT | MERGED from parity/reviews, verified on the branch (§3). |

### 10d Android manifest (RN `android/app/src/main/AndroidManifest.xml` vs Flutter)

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 27 | Package / applicationId, label | `com.helloally.app`, `@string/app_name` (Ally) | `com.helloally.ally_mobile_flutter`, label `ally_mobile_flutter` | PARTIAL | Release identity, needs a decision. |
| 28 | `INTERNET` | ✓ | ✓ | PRESENT | |
| 29 | `RECORD_AUDIO` | ✓ | ✓ | PRESENT | |
| 30 | `MODIFY_AUDIO_SETTINGS` | ✓ | ✓ | PRESENT | |
| 31 | `POST_NOTIFICATIONS` | ✓ | ✓ | PRESENT | |
| 32 | `RECEIVE_BOOT_COMPLETED` | ✓ | ✓ (plus the flutter_local_notifications boot receiver) | PRESENT | Reschedules the weekly reminder after reboot. |
| 33 | `SCHEDULE_EXACT_ALARM` | ✓ (notifee exact trigger) | absent | PRESENT (by design) | Flutter schedules with `AndroidScheduleMode.inexactAllowWhileIdle` (`leaderboard_notification.dart:126`), which needs no permission. The reminder may fire a few minutes late. |
| 34 | `WRITE_EXTERNAL_STORAGE` (maxSdk 28) + `requestLegacyExternalStorage` | ✓ | absent | MISSING | Only needed for summary export on Android 9 and below (`saveFile`). Ties to the export gap. |
| 35 | `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` + `WAKE_LOCK` + `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + flutter_foreground_task service (`foregroundServiceType=microphone`) | **absent** | present | N/A | A Flutter addition: RN has no foreground service, so Android 14+ kills its mic in the background. Keep it. |
| 36 | App Links intent filter `autoVerify`, https `${appLinkHost}` `/summary`, `/course` | ✓ | absent | MISSING | |
| 37 | `launchMode` | `singleTask` | `singleTop` | PARTIAL | `singleTask` is what makes a link or notification tap reuse the running task. Revisit together with deep links. |
| 38 | `screenOrientation="portrait"` | ✓ | absent | MISSING | |
| 39 | `allowBackup="false"` | ✓ | absent (defaults to true) | MISSING | Security: shared_preferences and other app data get backed up. |
| 40 | `windowSoftInputMode` | `adjustPan` | `adjustResize` (Flutter default) | N/A | Flutter handles insets itself. |
| 41 | `supportsRtl` | true | default | N/A | No RTL locales. |

### 10e Native modules (`package.json` dependencies) → Flutter plugins

| # | RN package (used in) | Flutter plugin / approach | Status | Notes |
|---|---|---|---|---|
| 42 | `@gorhom/bottom-sheet` (12 files) | `showModalBottomSheet` / `DraggableScrollableSheet` | PRESENT | Per-sheet parity in §2/§3. |
| 43 | `@invertase/react-native-apple-authentication` | `sign_in_with_apple` | PARTIAL | The entitlement is missing (row 18). |
| 44 | `@livekit/react-native` + `@livekit/react-native-webrtc` + `livekit-client` | `livekit_client` | PRESENT | The room-disconnect listener is missing (§2 Learn). |
| 45 | `@notifee/react-native` (local display, channels, weekly trigger) | `flutter_local_notifications` | PRESENT | Foreground FCM display parity is in §4b. |
| 46 | `@react-native-async-storage/async-storage` | `shared_preferences` + `flutter_secure_storage` | PRESENT | Tokens move to secure storage, so existing users must log in again after migrating from the RN build (§5 transport). |
| 47 | `@react-native-clipboard/clipboard` | `flutter/services` `Clipboard` | PRESENT | |
| 48 | `@react-native-community/netinfo` (`useNetworkConnectivity`) | none | MISSING | Needs `connectivity_plus` or equivalent (§4). |
| 49 | `@react-native-firebase/app` + `messaging` | `firebase_core` + `firebase_messaging` | PARTIAL | Wired in Dart, but the config files are absent (row 22). |
| 50 | `@react-native-firebase/crashlytics` (ErrorBoundary) | `firebase_crashlytics` in pubspec, **never imported** | MISSING | No `FlutterError.onError` or `recordError` (§11). |
| 51 | `@react-native-google-signin/google-signin` | `google_sign_in` | PARTIAL | iOS plist config and client ids are missing (rows 2, §9.7–8). |
| 52 | `@react-native-masked-view/masked-view` (ShinyText) | `ShaderMask` | see §3 ShinyText | PRESENT | |
| 53 | `@react-navigation/*` (bottom-tabs, drawer, native, native-stack) | `go_router` + custom shell/drawer | PRESENT | §1. |
| 54 | `@react-navigation/stack` | — | N/A | Unused in RN. |
| 55 | `@reduxjs/toolkit` + `react-redux` | `flutter_riverpod` | PRESENT | §6. |
| 56 | `@sayem314/react-native-keep-awake` (useListeningCommon, SimulationAssistantScreen) | none | MISSING | Needs `wakelock_plus` (Top gap 9). |
| 57 | `@shopify/react-native-skia` | — | N/A | Unused in RN. |
| 58 | `@wuba/react-native-echarts` + `echarts` (CustomLineChart) | — | N/A | CustomLineChart is never rendered (§3). |
| 59 | `i18next` + `react-i18next` | custom `localization_controller.dart` / `translations.dart` | PRESENT | §7. |
| 60 | `lodash` | — | N/A | No direct imports. |
| 61 | `lottie-react-native` (4 files) | `lottie` | PARTIAL | Only the splash animation is used. The summaryLoading and botThinking Lottie files are unreferenced (§8). |
| 62 | `react-native-audio-api` (SimulationAudioPlayer) | `audioplayers` (`simulation_audio_player*.dart`) | PARTIAL | The review audio player exists. The SimulationFeedback recording player is missing (§2 Learn). |
| 63 | `react-native-calendars` | — | N/A | Unused in RN. |
| 64 | `react-native-chart-kit` (ChartComponent) | — | N/A | ChartComponent is never rendered (§3). |
| 65 | `react-native-confetti-cannon` (CelebrationModal, QuizItemPlayer, BadgePopup) | `confetti` | PARTIAL | Celebration modal: PRESENT. Quiz-pass confetti and BadgePopup: MISSING. |
| 66 | `react-native-config` | `--dart-define` / `AppConfig` | PRESENT | §9. |
| 67 | `react-native-fs` (fileOperations.saveFile, useVoiceNoteRecorder) | `path_provider` + `dart:io` | PARTIAL | Voice notes: PRESENT. File export (saveFile): MISSING. |
| 68 | `react-native-gesture-handler` / `reanimated` / `screens` / `safe-area-context` / `keyboard-aware-scroll-view` / `size-matters` / `linear-gradient` / `svg` / `tab-view` | Flutter framework (`rn_scale.dart` for size-matters), `flutter_svg`, `TabBar` | PRESENT | Framework-level equivalents. |
| 69 | `react-native-image-picker` (useProfileImage) | `image_picker` | PRESENT | The jpeg/png restriction is missing (§2 account). |
| 70 | `react-native-live-audio-stream` (useLiveAudioStream, useVoiceNoteRecorder) | `record` (PCM stream) | PRESENT | |
| 71 | `react-native-network-logger` (NetworkLogs) | — | N/A | Dev-only "Logs" bubble (`ENVIRONMENT==='development'`). |
| 72 | `react-native-pager-view` | — | N/A | Unused in RN. |
| 73 | `react-native-permissions` (7 files: mic, notifications, photo; `openSettings`) | `permission_handler` | PARTIAL | The "Open Settings" alert on a blocked mic is missing (usePermissionAlert, §4). |
| 74 | `react-native-reanimated-carousel` (Carousel) | — | N/A | The Carousel is never rendered. |
| 75 | `react-native-sound-player` (breath.mp3, start/end simulation sounds) | `audioplayers` (`breath_sound_player.dart`) | PARTIAL | Breath sound: PRESENT. Start/end simulation sounds: MISSING (§8). |
| 76 | `react-native-version-check` (`utils/version.ts`: store URL + version compare) | `package_info_plus` (version only) | MISSING | No store lookup or force update (Top gap 6). |
| 77 | `react-native-video` (VideoItemPlayer, QuestionMedia, VideoPreview) | `video_player` | PARTIAL | Video items and CoverVideoPreview: PRESENT. QuestionMedia video: MISSING (§2 Learn). |
| 78 | `react-native-walkthrough-tooltip` (InfoTooltip, PrivacyTooltip) | `info_tooltip_icon.dart` | PARTIAL | PrivacyTooltip is missing on some screens (§3). |
| 79 | `react-native-webview` (UserAnalytics, QuestionMedia, games) | `webview_flutter` | PRESENT | |
| 80 | `rn-emoji-keyboard` (ShareForReview note, reactions) | `emoji_insert_picker.dart` | PRESENT | |
| 81 | `socket.io-client` (useSocket) | `socket_io_client` | PRESENT | Retry and foreground reconnect gaps are in §4/§5. |
| 82 | (Flutter-only) `flutter_foreground_task`, `timezone`/`flutter_timezone`, `webview_flutter` game bridge | — | N/A | Additions with no RN counterpart. |
| 83 | `react` / `react-native` core | Flutter SDK | PRESENT | |

---

## §11 Analytics / telemetry

The whole of RN `src/` was searched (non-test) for posthog, mixpanel, amplitude, segment, `logEvent`, `.track(`, `.capture(`, `analytics()` and Sentry. **RN emits no product-analytics events, so there are no event names to port.** The only telemetry is listed below.

| # | RN telemetry | RN file | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | Crashlytics `log()` + `recordError(error, 'UnhandledRenderError')` from the global ErrorBoundary, with fallback UI | `components/ErrorBoundary/ErrorBoundary.tsx`, `App.tsx` | none: `firebase_crashlytics` isn't imported anywhere in `lib/`, and there's no `FlutterError.onError` / `PlatformDispatcher.onError` | MISSING | Uncaught Flutter errors go unreported, and there's no global fallback screen. |
| 2 | Crashlytics native crash reporting (auto, via RN Firebase) | native | the plugin is in pubspec, but there's no Firebase config file (§10 row 22) and no init | MISSING | |
| 3 | `SCRIBE_START_DIAGNOSTIC` socket event at Scribe start (mic/device diagnostics to the backend) | `MicrophoneListeningScreen.tsx:450` | not emitted | PARTIAL | §2 Scribe calls it "deliberately left out". Confirm with the backend that nobody consumes it before dropping it. |
| 4 | Dev logger (`utils/logger.ts`, console only when `ENVIRONMENT==='development'`) | `utils/logger.ts` | `debugPrint` / `log` | N/A | Dev only. |


---

## Not determined / limits of this audit

- **MERGED rows were not re-read on master.** They were verified on `parity/reviews` at `a91ed21`–`e780dd4`. Master's `lib/features/reviews` is byte-identical to `e780dd4`, but the merge may have touched callers elsewhere, such as `call_summary_screen.dart` and `app_drawer.dart`.
- **Notifications screen rows** (§2 account, section 8) predate commit `e780dd4` (the restyle).
- **Runtime behaviour was not exercised.** Nothing was built or run, so the following are code-reading verdicts only: native config failures (Google sign-in without a URL scheme, Firebase without plist/json), timing issues (5 s mic-failure race, reminder drift) and visual parity.
- **Hardcoded English literals in Flutter** (§7 row 9) were spot-checked by grep, not audited exhaustively.
- **Backend consumers were not checked.** Whether anything reads `SCRIBE_START_DIAGNOSTIC`, or whether the backend still honours `enableRecommendations`, needs a backend check.
- **Release identity is a product decision, not a parity verdict.** This covers bundle id / applicationId (`com.helloally.app` vs `com.helloally.allyMobileFlutter` / `com.helloally.ally_mobile_flutter`) and whether Flutter ships as an update to the RN app, which affects token migration from AsyncStorage and store listing.
- **Scripts and raw outputs:** `scratchpad/scripts/{i18n.py,assets2.py}`, `inventory/{i18n.json,assets_final.txt}`, and the per-part source files in `inventory/parts/`.
