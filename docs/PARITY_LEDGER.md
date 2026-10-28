# RN → Flutter PARITY LEDGER v2 (ally-mobile → ally-mobile-flutter)

Re-audit date: 2026-10-28. Read-only; nothing was built, run or edited in either repo. Every verdict comes from reading code.

- **RN (source of truth):** `ally-platform/ally-mobile` at `7a8ce0c19`. `git log 7a8ce0c19..origin/master -- ally-mobile` (after fetch) shows one commit, `fc1253ea7`, an automated version bump to 1.23.47 that touches only `build.gradle` and `project.pbxproj`. No RN screen, component or hook changed, so nothing new needed auditing.
- **Flutter:** `master` @ `227db3a` (Merge `parity/courses`). Since v1 (`cfb1672`) these were merged: `parity/shell`, `parity/live`, `parity/data`, `parity/i18n`, `parity/callsummary`, `parity/courses`, plus teammate commits (`97c9f94`, `eda4b6d`, `925ee2c`). That is 58 commits.
- **Method:** every v1 PARTIAL, MISSING and MERGED row was re-read on master and given a new status plus a Flutter file reference. About 10% of PRESENT rows were also spot-checked, weighted toward the areas that changed. Rows that changed have **"v2:"** in their Notes; rows that were re-checked and are still open say "Unchanged".

## Status key

- **PRESENT**: the same behaviour exists on master, possibly built differently. The row names the Flutter file.
- **PARTIAL**: some of the behaviour exists. The Notes say exactly what is missing.
- **MISSING**: nothing equivalent exists on master.
- **MERGED**: retired in v2. All 75 v1 MERGED rows (`parity/reviews`) were re-read on master, and every one is now PRESENT.
- **N/A**: RN dead code, dev-only tooling, or a framework concern with no runtime behaviour.
- **DEAD**: an RN endpoint that is defined but never called.

## Totals per section (v2; v1 in brackets)

| § | Section | Rows | PRESENT | PARTIAL | MISSING | MERGED | N/A / DEAD |
|---|---|---|---|---|---|---|---|
| 1 | Navigation | 47 | 40 (32) | 3 (9) | 1 (3) | 0 | 3 |
| 2 | Screens: account/shell | 211 | 166 (151) | 20 (26) | 0 (9) | 0 | 25 |
| 2 | Screens: Scribe | 156 | 134 (80) | 4 (43) | 2 (15) | 0 (1) | 16 (17)¹ |
| 2 | Screens: Learn | 237 | 208 (162) | 9 (35) | 1 (21) | 0 | 19 |
| 2 | Screens: Reviews + review hooks | 77 | 69 (26) | 5 (4) | 1 (3) | 0 (42) | 2 |
| 3 | Shared components | 72 | 59 (33) | 7 (13) | 0 (5) | 0 (15) | 6 |
| 4 | Hooks | 53 | 43 (22) | 2 (14) | 0 (6) | 0 (3) | 8 |
| 4b | App shell / services / utils | 62 | 48 (35) | 4 (8) | 5 (14) | 0 | 5 |
| 5 | Backend endpoints called by RN | 150 | 148 (104) | 2 (21) | 0 (11) | 0 (14) | 25 dead |
| 6 | Store | 28 | 24 (18) | 2 (4) | 0 (4) | 0 | 2 |
| 7 | Translations | 9 | 6 (3) | 2 (4) | 0 (1) | 0 | 1 |
| 8 | Assets (161 files + 7 fonts) | 168 | 123 (103) | 19 (47) | 0 (2) | 0 | 26 (16)² |
| 9 | Config / env / flags | 15 | 7 (7) | 5 (5) | 2 (2) | 0 | 1 |
| 10 | Native / platform | 83 | 49 (30) | 8 (16) | 8 (19) | 0 | 18 |
| 11 | Analytics / telemetry | 4 | 2 (0) | 1 (1) | 0 (2) | 0 | 1 |
| | **Total** | **1,372** | **1,126 (806)** | **93 (250)** | **20 (117)** | **0 (75)** | |

¹ Listening L49 changed from N/A to PRESENT: the conference screen now drops its socket in the background and reconnects on resume.
² Ten v1 PARTIAL assets became N/A: their only RN importers are never rendered (carousel1–4, conversation.png, call/transcript, simulation, arrowUpRight, botThinking.json).

The transport, realtime and cache sub-tables in §5 are not counted above. Each has one PARTIAL left.

As in v1, one gap can show up in several sections; deep links, for example, appear in §1, §4b, §9 and §10. Use the list below to count distinct work items.

---

## Remaining gaps: the work list to reach zero (deduplicated)

### A. Needs credentials or release identity (blocked outside engineering)
1. **Firebase config files** (`GoogleService-Info.plist`, `google-services.json`) for the Flutter app ids. The push, FCM and Crashlytics code is finished but no-ops without them (§10 r20/22, §10e r49, §9 r15, §11 r2).
2. **Google sign-in:** `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` default to `''`. Needs an OAuth client for the Flutter package id, plus `GIDClientID` and the reversed-client-id `CFBundleURLTypes` in Info.plist (§9 r7/8, §10 r2, §10e r51).
3. **Entitlements file + `CODE_SIGN_ENTITLEMENTS`:** `aps-environment`, `com.apple.developer.applesignin` and associated domains. Without it, Apple sign-in fails on device and push can't register (§10b r17–19, §10e r43).
4. **Release identity decision:** bundle id / applicationId (`com.helloally.allyMobileFlutter` / `com.helloally.ally_mobile_flutter` vs RN `com.helloally.app`). This decision drives:
   - the force-update store URLs (`force_update.dart:17-18` point at the RN listings)
   - OAuth and Firebase registration
   - whether tokens can migrate from AsyncStorage. They can't today, so users log in again.
   (§10a r1, §10d r27)
5. **iPad:** Flutter targets `"1,2"` and iPad can rotate; RN is iPhone-only (§10).

### B. Deep links (one feature; 9 rows)
6. Universal and App Links for `/summary/:id` and `/course/:uuid`. Needs:
   - an `app_links` plugin and a Dart handler that holds a link until auth/profile completes
   - AASA and `assetlinks.json` hosted on the web domain
   - an Android `autoVerify` intent filter with a `${appLinkHost}` placeholder
   - `launchMode` changed to `singleTask`
   - iOS cold and warm link forwarding
   (§1 r42, §4b, §9 r14, §10c r23/24, §10d r36/37). It depends on A3 (associated domains).

### C. Navigation / shell
7. **Exits that don't pick a tab:** three flows still call `go('/home')` and land on whichever tab was last open. They should use `goToHomeTab`.
   - `simulation_feedback_screen.dart:250,260`
   - `course_item_player_screen.dart:290`
   - `scribe_recording_screen.dart:521`
   (§1 r41, §4b)
8. **Community tab:** opens the browser only once, from `initState`. Later taps do nothing and leave a blank tab selected (`community_screen.dart`; §1 r38).
9. **Review-tab unread dot:** the scribe count is now included, but nothing invalidates `unreadReviewCountProvider`, so the dot never clears after reading (§1 r33).
10. **Permissions-fetch failure:** shows raw `Text('$error')`, with no retry or fallback tab. `app_shell_screen.dart:81,111` also has the untranslated literal "No accessible tabs for this account".
11. **Launch auth:** `_restore` validates the token only, so a `/users/me` failure other than 401 doesn't log out (RN logs out on any failure). A returning user sees a blank splash, skips the Lottie, and the status bar isn't hidden. Needs a product call (§2 account, §4b, §6).
12. **Suspended screen** is pushed rather than replaced, so back returns to the login sheet.
13. **`dev-user` fallback** `userId` on `/scribe` and `/conference-listening` while the user is still loading.

### D. Account screens
14. **Social login:** non-cancel Google and Apple SDK errors show a generic toast instead of the SDK or Play-Services message.
15. **Profile:** the image picker isn't limited to jpeg/png, and `LANGUAGE_SELECTOR_FLAG` doesn't hide the Language row (`profile_settings_screen.dart:279`; §9 r12).
16. **Bug report:** uses a Material AppBar with a Material back arrow (`bug_report_screen.dart:101`), and the submit button isn't pinned to the bottom.
17. **Progress:**
    - the rank link pushes standalone `/leaderboard` with no permission check
    - the screen is blank when the gate is false
    - no refetch on revisit
18. **Analytics WebView:** no page-load spinner, and a failed URL shows raw error text.
19. **Search tab:**
    - the result card is a `ListTile` (`search_screen.dart:372`) with no expand (downArrow), no tag chips and no View more/less
    - `ChoiceChip`s (`:300`) instead of underline tabs
    - Clear returns to the launch view instead of staying on results
    (§2, §3 ResourceArticleCard/CustomTabs)
20. **Achievements badge art:** `Image.network` (`achievements_screen.dart:271`) renders SVG badges blank and shows no spinner. Reuse `badge_popup.dart:312 _BadgeImage` (§3 NetworkImage).

### E. Scribe
21. **S44:** a second dictation on an existing note overwrites the earlier transcript. `_transcript` is never seeded from `details.transcript` (`voice_note_section.dart:92`).
22. **Voice-note recorder:** no 24 MB auto-stop, so a long dictation can exceed the 25 MB upload cap (`voice_note_recorder.dart`; §4).
23. **C12:** the FeatureNotAvailable state on CallLog is missing. There's no "Oops" copy, Learn-more link (`ALLY_WEB_URL`) or link-failure alert (`call_log_screen.dart:401`).
24. **C6:** the call-log date filters are free-text boxes, not date-time pickers, and an emptied box sends `startDate=''` (`call_log_filter_sheet.dart:376-388`).
25. **C5:** the filter badge counts four fields where RN counts two (`call_log_repository.dart:404`).
26. **C24:** several call-log rows can be expanded at once; RN keeps one (`call_log_row.dart:73`).
27. **C33:** no `GET /chats/counsellor-chat` before `/scribe`. Low impact since the chatId race fix.
28. **Privacy tooltip** is missing on the call-summary notes section shown while the summary generates (RN `AddNotesSection.tsx:65`; §10e r78).
29. **Custom-field dropdowns** use Material `DropdownButtonFormField` (`call_summary_screen.dart:1554,1700,1718`; §3 Dropdown).

### F. Learn
30. **Role-play call audio routing is never configured.** RN `configureAudioSession` prefers bluetooth, then headset, then speaker, then earpiece, and defaults iOS to the speaker. Flutter's call may route to the earpiece. Needs a device check.
31. **Role-play start sound isn't stopped when the agent first speaks** (`roleplay_voice_screen.dart:499 _transitionToAgentJoined`).
32. **Speaking waveform** uses LiveKit's speaking flag rather than audio-level amplitude. Flutter treats this as a deliberate difference.
33. **Path/Case details:**
    - back has no fallback to the Learn tab when the stack is empty
    - a `createSession` failure shows raw inline exception text (`learning_path_detail_view.dart:98`) instead of a toast
    - no `failedToLoadPathDetails` toast when there is no session id
34. **Course overview:** the progress bar opens a full screen, not RN's 70% bottom sheet. `showCourseBottomSheet` exists but isn't used here.
35. **Simulation feedback:**
    - polling doesn't restart when returning from Review details
    - "Try another" pushes `/simulations` instead of reopening the rating popup (product call)
    - the short-session summary has no help (?) icon and no SimulationDetailsModal (`feedback_widgets.dart:332`)

### G. Reviews
36. **Cover video never plays** in review cards, the share card, or the review-header scenario dialog. `simulation_details_card.dart:43` is a TODO and `review_details_parts.dart:142` is unwired; reuse `CoverVideoPreview` (A2.5, A3.4, §3 VideoPreview).
37. **The share screen never receives the scenario cover or description,** because `ShareForReviewArgs` (`app_router.dart:50`) lacks the fields (A4.3, A3.10).
38. **Review details don't refetch on app foreground or reconnect,** or after returning from edit-note (A3.2, §5 `getReviewById`).
39. **The emoji picker has no search, recents or multi-select.** It was scoped down; product to accept (A4.4).

### H. Cross-cutting
40. **No shared `getErrorDetails`:** about 12 places show raw Dio exception text, e.g.:
    - `call_log_screen.dart:248`
    - `call_summary_screen.dart:999,1150`
    - `search_screen.dart:129,153`
    (§4b utils/error.ts, §5 transport)
41. **Toast:** a plain SnackBar with no success/error variants and no top position (§3 Toast; product call).
42. **`I18N_BASE_URL`** defaults to the retired `https://api.helloally.dev/i18n` (`app_config.dart:51`). RN defaults to `''`; decide between empty and the prod CDN (§7 r8, §9 r13).
43. **`ALLY_WEB_URL`** is configurable but unused for the deep-link allowlist and the CallLog Learn-more link (§9 r4; closes with items 6 and 23).
44. **Socket:** no retry timer after a failed first connect (RN `RETRY_AFTER_FAILURE_MS`), and no refetch on network reconnect (§5 realtime, §6 store.ts).
45. **Low impact:**
    - the feedback audio playback speed isn't saved (`simulation_audio_player.dart`)
    - a notification tap that cold-starts the app isn't deduplicated (`HANDLED_TS`)
    - two untranslated a11y labels, 'Filter' and 'Refresh' (`call_log_screen.dart:461,539`)

### I. Icon/asset visual sweep
46. There are **33 sites** where RN draws an SVG/PNG and Flutter draws `Icons.*` or nothing. The full list is in §8b.
    - **Call summary and voice note: 27 sites.**
      - the 18 section-header icons (product call: the Material set was chosen deliberately)
      - the expand caret, goldenShield, the summaryFailed.png 403 state and the chatBubble review button
      - 5 voice-note icons
    - **Shell: 3 sites.** The InfoTooltipIcon in every TabScreenHeader and on Achievements ×2, and the bug-report back arrow.
    - **Search: 1 site.** The result-card downArrow.
    - **Learn: 2 sites.** The course-progress chevron and the feedback help icon.

    Everything except the 17 section icons, goldenShield and play.svg is wiring only: the assets already ship and are referenced elsewhere. In the other direction, 26 N/A asset files are candidates for deletion from Flutter.

### J. Needs a backend check (not a Flutter change)
47. Does anything consume `SCRIBE_START_DIAGNOSTIC`, which Flutter now emits?
48. Does the backend still honour `enableRecommendations`?
49. Keep or remove the Flutter-only `/preferences` route? It calls three endpoints RN never calls. Flutter also has unused client methods for `getTrackLanguages` and `getModeratorTenants`.
50. Keep or remove the delete-summary code? It is unreachable from the menu, which mirrors RN.

### Regressions found
None. About 130 PRESENT rows were spot-checked across all slices.

Two rows went PRESENT → PARTIAL, and both are v1 audit misses rather than regressions:
- **§8 `play.svg`:** v1 matched filenames as substrings, so `replay.svg` hid this. `git log -S` confirms the file was never referenced.
- **§2 Learn feedback help icon:** never ported.

Minor finding: `voice_note_section.dart:249` reads the voice-note setting before the counsellor permission check, so a non-counsellor triggers one harmless 403.

---

## Changed since v1

- **Rows that changed status:** about 360 in total.
  - §1/§2 account: 25
  - Scribe: 54
  - Learn: 49
  - Reviews and §3: 71
  - §4–§11: about 70
  - §5/§7: 57
  - §8: 32
- **Closed headline gaps (v1 Top 25):**
  - #1 `languageCode` (interceptor)
  - #4 role-play lifecycle
  - #5 telephony socket and chatId race
  - #6 force update
  - #7 call-summary tags, in-flight edits, reseed
  - #8 Scribe resume tooltip
  - #9 keep-awake
  - #11 logout push deregistration
  - #12 summary-fields
  - #13 transcript paging
  - #14 duration seconds
  - #15 stale data (RTK-tag refetch, focus refetch)
  - #16 path/case/language threading
  - #17 completed course items
  - #18 Android back
  - #19 connectivity and mic-before-credit
  - #20 feedback recording and transcript language
  - #21 badge popup
  - #22 error boundary and Crashlytics (code; config blocked)
  - #23 article and quiz players
  - #24 call-summary export/delete/places/notes
  - #25 portrait, allowBackup, privacy manifest, display name
  - the v1 "smaller items": Community excepted, Search card excepted, Review dot partly fixed, discussion-reply highlight, start/end sounds, i18n language change, 33 untranslated strings
- **Still open from v1 Top 25:**
  - #2 Firebase/entitlements and #3 Google iOS config (credentials)
  - #10 deep links
  - part of #25 (bundle id)
- **Translations:** hi, kn, mr and ta now have all 1,566 en keys, guarded by a completeness test, with i18next plurals and English fallback.
- **New in v2:** §8b Icon/asset visual sweep, and the MERGED status retired.

---
## §1 Navigation — routes, params, tabs, drawer

RN: `src/navigation/{RootNavigator,DrawerNavigator,TabNavigator,types}.tsx`, `src/constants/{navigation,tabs}.ts*`. Flutter: `lib/core/routing/app_router.dart` (go_router), `lib/core/navigation/{app_shell_screen,app_bottom_tab_bar,app_drawer,tab_config}.dart`.

**v2 tally (master 227db3a): 47 rows: 40 PRESENT / 3 PARTIAL / 1 MISSING / 3 N/A** (v1: 32 / 9 / 3 / 3).

RN layout: a native stack with two branches. Signed out: Splash, SuspendedAccount. Signed in: Drawer → BottomTabs plus 26 stack screens. Flutter layout: a flat go_router list with a `computeRedirect` gate (`/splash` → `/login` | `/complete-profile` | `/home`; `/suspended` allowed while signed out).

| # | RN route (params; options) | Flutter route / file | Status | Notes |
|---|---|---|---|---|
| 1 | Drawer `BottomTabs {hideTabBar?}` (DrawerNavigator) | `/home` → `AppShellScreen` + `app_drawer.dart` | PRESENT | Drawer items, gating and version label are detailed in §2 account, sections 4–5. |
| 2 | `Splash` (signed-out branch; login lives inside it) | `/splash` (`_LaunchScreen`, blank until the session is restored) + `/login` (`login_screen.dart`) | PRESENT | |
| 3 | `SuspendedAccount` (signed-out branch) | `/suspended` → `suspended_account_screen.dart` | PRESENT | |
| 4 | `CompleteProfile` (`gestureEnabled:false`) | `/complete-profile`, forced by `computeRedirect` | PRESENT | |
| 5 | `Listening {isMicrophoneMode:true}` | `/scribe` → `ScribeRecordingScreen` | PRESENT | Still falls back to `userId 'dev-user'` when the user hasn't loaded yet (app_router.dart:157). |
| 6 | `Listening {isMicrophoneMode:false}` (conference) | `/conference-listening/:chatId` → `ConferenceListeningScreen` | PRESENT | v2: the app-wide telephony socket now routes here (core/chat/cloud_telephony_listener.dart, wired in main.dart). |
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
| 19 | `SimulationFeedback {scenarioSessionId?, fromLogs?, pathId?, caseId?, languageId?}` (`gestureEnabled:false`) | `/simulations/feedback/:sessionId?fromLogs=&pathId=&caseId=&languageId=` (app_router.dart:260-267) | PRESENT | v2: back returns to the path/case details (simulation_feedback_screen.dart:240-254). The non-path, non-logs back still goes to plain `/home`, see row 41. |
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
| 33 | Tab `Review` (`VIEW_SIMULATION_REVIEWS` or `VIEW_SCRIBE_REVIEWS`) + unread dot | `kTabReview`, `app_bottom_tab_bar.dart`, `unreadReviewCountProvider` (reviews_repository.dart:131-148) | PARTIAL | v2: now sums simulation + scribe counts, each gated on its own permission. Remaining: nothing ever invalidates `unreadReviewCountProvider`, so the dot never clears after reading a review or appears for new ones until the API client rebuilds (login/language change). |
| 34 | Tab `UserAnalytics` (`VIEW_ANALYTICS_DASHBOARD`) | `kTabUserAnalytics` | PRESENT | |
| 35 | Tab `Leaderboard` (`VIEW_COMMUNITY_LEADERBOARD`) | `kTabLeaderboard` | PRESENT | v2: the weekly-reminder tap now selects the tab (`goToLocation(homeTabLocation(kTabLeaderboard))`). Progress's rank link still pushes standalone `/leaderboard` (§2 account, section 10). |
| 36 | Tab `Achievements` (`VIEW_USER_BADGES`; reviewer-only layout via `isReviewerOnly`) | `kTabAchievements`, `isReviewerOnly()` | PRESENT | |
| 37 | Tab `Search` (`VIEW_REFERENCE_DOCUMENT`) | `kTabSearch` | PRESENT | |
| 38 | Tab `Community` (`VIEW_COMMUNITY`; opens external link) | `kTabCommunity` → `community_screen.dart` | PARTIAL | Unchanged: opens the browser once from `initState` (community_screen.dart:17-26). Later taps do nothing and a blank tab stays selected. |
| 39 | Tab permission OR-semantics + `getFirstVisibleTab` initial tab | `tab_config.dart` `_hasAnyPermission`, `app_shell_screen.dart` | PRESENT | |
| 40 | Android hardware back on a tab root → first visible tab (`useTabBackToHomeHandler`, `useHardwareBackPressHandler`) | `app_shell_screen.dart:150-160` (`PopScope`: back on a non-first tab → first visible tab; on the first tab → exit; closes the badge popup first) | PRESENT | v2: landed in 557dc55. |
| 41 | "Reset to tab" exits (end of flow → Learn tab / CallLog tab via `navigation.reset`) | `core/navigation/home_tab_navigation.dart` (`goToHomeTab`), used by call_summary_screen.dart:487 and box_breathing_screen.dart:191 | PARTIAL | v2: CallLog flows reset to the CallLog tab. Remaining: simulation_feedback_screen.dart:260, course_item_player_screen.dart:290 (celebration "back to Learn") and scribe_recording_screen.dart:521 still `go('/home')`, which lands on the last-selected tab instead of Learn/CallLog. |
| 42 | Universal-link routes `https://{ALLY_WEB_URL}/summary/:id` → [CallLog, CallSummary], `/course/:uuid` → CourseOverview (pending until auth/profile) | none | MISSING | Unchanged: no app_links/uni_links, no `/summary/` or `/course/` handler in lib/. §4b and §10 cover the native side. |
| 43 | Notification-tap routing by push type (`RootNavigator` + `pushNotificationService`) | `core/push/notification_navigation.dart` | PRESENT | v2: leaderboard reminder selects the tab (notification_navigation.dart:50, push_notification_service.dart:126). RN's push-tap handler never routes COURSE_DISCUSSION_REPLY either; the in-app Notifications list does (section 8). |
| 44 | Auth-gated stack split (signed-out branch shows only Splash/Suspended) | `computeRedirect` in `app_router.dart` | PRESENT | Launch logs out only on a 401, while RN logs out on any `/users/me` failure (§2 account). |
| 45 | Drawer content (`CustomDrawerContent`, menu items, LogoutModal) | `app_drawer.dart`, logout modal | PRESENT | v2: logout now deregisters the device token (auth_state.dart:70-78). |
| 46 | In-screen modals/sheets (CallLogFilterSheet, CourseProgressSheet, LanguageSelectorSheet, comment/thread sheets, start-simulation modals) | per-feature `showModalBottomSheet` | N/A | Not routes in RN either. Each is mapped in §2/§3. |
| 47 | Flutter-only routes with no RN stack equivalent: `/preferences`, `/reviews`, `/leaderboard`, `/community`, `/search` as standalone pushes | `app_router.dart` | N/A | `/preferences` calls three RN-DEAD endpoints (§5). Decide whether to keep or remove it. |


---

## §2 Screens

The four sub-parts below were each written by a separate auditor, and each keeps its own tallies and top-gaps list.

### Parity ledger — account / shell screens

Scope: SplashScreen (login), CompleteProfile, SuspendedAccount, Drawer (DrawerNavigator + CustomDrawerContent), LogoutModal, ProfileSettings, BugReport, Notifications, Achievements, Progress, UserAnalytics, Leaderboard, Community, Search, Reactions, TabNavigator.

- RN root: `ally-platform/ally-mobile/src/` (paths below are relative to it)
- Flutter root: `ally-mobile-flutter/lib/` on `master` (paths below are relative to it). Branches `parity/reviews` and `parity/feedback` were diffed against their merge base. Neither touches anything in this scope except `core/navigation/app_drawer.dart` (refactor only on parity/feedback, no behaviour change) and the Reactions entry point (moved into `review_widgets.dart` on parity/reviews). No row is IN PROGRESS.
- **v2 re-audit (2026-10-28, master 227db3a):** every PARTIAL/MISSING row re-read on master; ~20 PRESENT rows spot-checked (shell, drawer, logout, notifications restyle, leaderboard, tab gating). Notes prefixed "v2:" changed; "Unchanged:" rows were re-read and still hold. No regressions found.

#### Overall tally

**v2 (master 227db3a): 211 rows: 166 PRESENT / 20 PARTIAL / 0 MISSING / 0 IN PROGRESS / 25 N/A** (v1: 151 / 26 / 9 / 0 / 25)

(v2: the "Android back on a tab root" gap, listed once each under UserAnalytics, Community, Search and TabNavigator, is fixed by the shell `PopScope` in 557dc55.)

**Analytics and tracking:** RN has no product analytics in this scope. Grepping all of `src/` for posthog, logEvent, trackEvent, `.capture(`, mixpanel, amplitude and `analytics()` finds nothing. The only telemetry is Crashlytics in the global `components/ErrorBoundary`. So each screen's analytics row is N/A, with no event names to list.

---

#### 1. SplashScreen (login) — `screens/SplashScreen/**`
Tally: 32 present / 6 partial / 0 missing / 0 in-progress / 1 n-a

Note: RN has no carousel in this folder. The 17 files are SplashScreen, EmailLogin, OtpVerification, OtpInput, TermsAndAgreementModal, plus their styles, types and tests. Google and Apple login live in `hooks/useGoogleLogin.ts`, `hooks/useAppleLogin.ts` and `components/Button/*LoginButton`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Lottie splash plays frames 0→200, then freezes at 0.99 | SplashScreen.tsx | features/auth/presentation/login_screen.dart | PRESENT | Same frame math. |
| Status bar hidden during the animation; dark-content 1s after it ends | SplashScreen.tsx | login_screen.dart (`SystemUiOverlayStyle.light`) | PARTIAL | Unchanged: `AnnotatedRegion(SystemUiOverlayStyle.light)` at login_screen.dart:431-432; never hidden. |
| Signed-in user still sees the Lottie, then is routed | SplashScreen.tsx | core/routing/app_router.dart (`_LaunchScreen`, `computeRedirect`) | PARTIAL | Unchanged, deliberate perf change: a returning user gets a blank `/splash` and goes straight to `/home`. Needs a product decision (keep or restore). |
| `checkAuth()` on launch: GET /users/me + /authorization/permissions; any failure → logout | hooks/useUser.ts | core/auth/auth_state.dart (`_restore`), features/account/data/account_repository.dart (`currentUserProvider`), core/permissions/permissions_repository.dart | PARTIAL | Unchanged: `_restore` (auth_state.dart:44-55) only checks a token exists; only a 401 logs out. Offline/5xx `/users/me` keeps the session. |
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
| Google Sign-In button (signOut first, idToken → POST google login, allowedRoles) | EmailLogin.tsx, hooks/useGoogleLogin.ts | login_screen.dart (`_signInWithGoogle`, `_GoogleLoginButton`), features/auth/data/auth_repository.dart | PARTIAL | Unchanged, needs credentials: disabled unless `GOOGLE_WEB_CLIENT_ID` is set at build time, and the Flutter package id has no OAuth client registered. |
| Google SDK errors: cancel/in-progress silent; toast "Google Play Services not available or outdated"; other → toast with `err.message` | hooks/useGoogleLogin.ts | login_screen.dart | PARTIAL | Unchanged: every non-cancel `GoogleSignInException` toasts generic "auth.login.google.error" (login_screen.dart:274-278). No Play-Services message, no SDK message. |
| Apple Sign-In (iOS only; email + fullName scopes; identityToken/authorizationCode/fullName) | EmailLogin.tsx, hooks/useAppleLogin.ts | login_screen.dart (`_signInWithApple`, `_AppleLoginButton`), auth_repository.dart | PRESENT | |
| Apple SDK errors: cancel silent; others → toast with `err.message` | hooks/useAppleLogin.ts | login_screen.dart | PARTIAL | Unchanged: generic "auth.login.apple.error" (login_screen.dart:305-309). |
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
| Navigation uses `replace`, so back cannot return to the login form | same | login_screen.dart (`context.push('/suspended')`) | PARTIAL | Unchanged: `context.push('/suspended')` at login_screen.dart:244 and :395. |
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
Tally: 5 present / 0 partial / 0 missing / 0 in-progress / 2 n-a

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
Tally: 14 present / 2 partial / 0 missing / 0 in-progress / 4 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back arrow + "profile.settings.title" | ProfileSettingsScreen.tsx | features/account/presentation/profile_settings_screen.dart (`BackTitleHeader`) | PRESENT | |
| Back with unsaved photo change → CustomModal "common.unsavedChanges" (Discard red / Cancel) → reset + goBack | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_handleBack`, core/widgets/confirmation_modal.dart) | PRESENT | |
| System back with unsaved changes | ProfileSettingsScreen.tsx (no handler; Android back discards silently) | profile_settings_screen.dart (`PopScope`) | PRESENT | Flutter also guards system back, a small improvement. |
| Avatar 116pt (image or initial on lightGray2); spinner overlay while saving | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_ProfileImageSection`) | PRESENT | |
| Upload hint text | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| "Upload Image" link opens the image sheet (disabled while saving) | ProfileSettingsScreen.tsx | profile_settings_screen.dart | PRESENT | |
| Image sheet: title, "Change"/"Upload" option, "Remove" when an image exists | components/ProfileImageBottomSheet.tsx | features/account/presentation/profile_image_options_sheet.dart | PRESENT | |
| Gallery pick: quality 0.8, max 800×800, **jpeg/png only** | hooks/useProfileImage.ts | profile_settings_screen.dart (`_pickImage`, image_picker) | PARTIAL | Unchanged: `pickImage` (profile_settings_screen.dart:99-105) has no MIME restriction; HEIC/GIF can be picked. |
| Validation toasts: >2MB "Image size must be less than 2MB…", non-square "Image must be square…" | useProfileImage.ts | profile_settings_screen.dart | PRESENT | Prefixed with "errors.uploadProfileImage". |
| Save button only while unsaved; upload = presign → S3 PUT → PATCH URL → best-effort delete of the old image | useProfileImage.ts | profile_settings_screen.dart (`_save`), features/account/data/account_repository.dart (`uploadProfileImage`) | PRESENT | |
| Remove + Save → DELETE old image, PATCH '' | useProfileImage.ts | profile_settings_screen.dart, account_repository.dart | PRESENT | |
| Save error → toast "errors.uploadProfileImage" | useProfileImage.ts | profile_settings_screen.dart (`_showErrorToast`) | PRESENT | |
| Read-only Name and Email fields ("—" when empty) | ProfileSettingsScreen.tsx | profile_settings_screen.dart (`_Field`) | PRESENT | |
| Language row, gated by `env.LANGUAGE_SELECTOR_FLAG` | ProfileSettingsScreen.tsx, config/env.ts | profile_settings_screen.dart (`_LanguageField`) | PARTIAL | Unchanged: always shown (profile_settings_screen.dart:279). `AppConfig.languageSelectorEnabled` only gates the CDN sync. |
| Language sheet: en/hi/mr/ta/kn, selected dot, persist, forceRTL, **reset the API cache so localized content refetches** | components/LanguageSelectorSheet/LanguageSelectorSheet.tsx, services/api.ts + languageCodeEndpoints.ts | features/account/presentation/language_selector_sheet.dart, core/network/api_client.dart:46-52 (rebuilds the client on a language switch), core/network/language_code_interceptor.dart (RN allowlist) | PRESENT | v2: `languageCode` injected on the RN endpoint list and loaded content refetches after a switch (249653c). |
| Leaderboard notification toggle (LEARNER only): persisted, schedules/cancels the weekly reminder | ProfileSettingsScreen.tsx, hooks/useLeaderboardNotification.ts | profile_settings_screen.dart (`LeaderboardNotificationToggleRow`), core/push/leaderboard_notification.dart | PRESENT | |
| Loading and error states for the user record | — (RN reads Redux user) | profile_settings_screen.dart | N/A | Flutter-only states. |
| Delete account | — | — | N/A | Not in RN. |
| Logout from this screen | — | — | N/A | RN only offers logout in the drawer. |
| Analytics events | — | — | N/A | None. |

#### 7. BugReportScreen — `screens/BugReportScreen/BugReportScreen.tsx`, `hooks/useBugReport.ts`, `utils/bugReportContext.ts`
Tally: 9 present / 2 partial / 0 missing / 0 in-progress / 1 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: LeftArrowIcon + ReplayPro "bugReport.title", bottom border | BugReportScreen.tsx | features/bugreport/presentation/bug_report_screen.dart | PARTIAL | Unchanged: Material `AppBar` + `Icons.arrow_back` (bug_report_screen.dart:97-101). |
| Prompt text | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Multiline input: placeholder, maxLength 1000, disabled while submitting | BugReportScreen.tsx | bug_report_screen.dart (`AppTextField`) | PRESENT | |
| Character counter "n/1000" | BugReportScreen.tsx | bug_report_screen.dart | PRESENT | |
| Submit pinned in a bottom footer; disabled until the trimmed text is non-empty and ≤1000; spinner | BugReportScreen.tsx, useBugReport.ts | bug_report_screen.dart | PARTIAL | Unchanged: button inline under the field, not pinned. |
| Silent context: screen, appVersion, device, os, clientTimestamp | utils/bugReportContext.ts | features/bugreport/data/bug_report_repository.dart | PRESENT | |
| Previous screen name (deepest active route) | BugReportScreen.tsx | core/navigation/app_drawer.dart passes `activeTabName` | PRESENT | |
| Success → toast "bugReport.successMessage", clear, goBack | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| HTTP 429 → toast "bugReport.rateLimitMessage" | useBugReport.ts | bug_report_screen.dart | PRESENT | |
| Other errors → error toast "errors.submitBugReport" | useBugReport.ts | bug_report_screen.dart | PRESENT | Appends the raw exception text. |
| Keyboard avoidance | BugReportScreen.tsx | bug_report_screen.dart (Scaffold resize) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 8. NotificationsScreen — `screens/NotificationsScreen/NotificationsScreen.tsx`
Tally: 11 present / 0 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Entry: reminder push tap without a "Simulations" hint → Notifications (no in-app entry in RN) | utils/notificationNavigation.ts | core/push/notification_navigation.dart (`reminderRouteFor`), app_router `/notifications` | PRESENT | |
| Header: back + "Notifications" + "Mark all read" only when something is unread | NotificationsScreen.tsx | features/notifications/presentation/notifications_screen.dart | PRESENT | Flutter's title and button are translated; RN hardcodes English. |
| Hardware back → goBack | NotificationsScreen.tsx | default route pop | PRESENT | |
| Initial loading spinner | NotificationsScreen.tsx | notifications_screen.dart | PRESENT | |
| Empty: "You're all caught up — no notifications yet." | NotificationsScreen.tsx | notifications_screen.dart ("notifications.empty") | PRESENT | |
| Error state | — | notifications_screen.dart | N/A | RN has none and shows the empty state. Flutter shows "loadError: $error". |
| Row: title, body (max 3 lines), timeAgo ("just now", "Xm/h/d ago", date) | NotificationsScreen.tsx | notifications_screen.dart:205-240 | PRESENT | v2: body `maxLines: 3` (notifications_screen.dart:237), RN text styles. |
| Unread styling: blue dot + tinted row background | NotificationsScreen.tsx, styles.ts | notifications_screen.dart:205-230 | PRESENT | v2: grey50 row background + 8pt primary dot (`unread-dot`). |
| Tap → mark read | NotificationsScreen.tsx | notifications_screen.dart (`_onItemTap`) | PRESENT | Invalidates the whole list, so pagination resets to page 1. |
| Tap course-discussion reply → CourseItemPlayer(trackId, itemId, highlightPostId) | NotificationsScreen.tsx | notifications_screen.dart:75-84 → `/courses/item/:itemId` with `CourseItemPlayerArgs(trackId, highlightPostId)` | PRESENT | v2: opens the item and highlights the post. |
| Infinite scroll, page size 25 | NotificationsScreen.tsx | features/notifications/data/notifications_repository.dart (`NotificationsController.loadMore`) | PRESENT | |
| Pull-to-refresh | NotificationsScreen.tsx | notifications_screen.dart (RefreshIndicator) | PRESENT | |
| Analytics events | — | — | N/A | None. |

#### 9. AchievementsScreen — `screens/AchievementsScreen/**`
Tally: 10 present / 0 partial / 0 missing / 0 in-progress / 2 n-a

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
| Tap card → mark badge viewed | — | achievements_screen.dart | N/A | Flutter-only extra; the real popup now exists (next row). |
| Badge-unlock celebration popup (global `BadgePopup`/`useBadgePopup`, marks viewed on dismiss) | components/BadgePopup, hooks/useBadgePopup.ts | features/achievements/presentation/badge_popup.dart (`BadgePopupHost`, confetti, poll + `PATCH …/viewed`), hosted in core/navigation/app_shell_screen.dart | PRESENT | v2: landed in a5d3ce7/557dc55. Active on Learn tab, and Review tab for reviewer-only users, as RN. |
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
| Link "progress.rank.link" → Leaderboard (tab jump; does nothing without leaderboard permission) | ProgressScreen.tsx | progress_screen.dart → `push('/leaderboard')` | PARTIAL | Unchanged: `context.push('/leaderboard')` (progress_screen.dart:55) — should `goToHomeTab(kTabLeaderboard)` and no-op without the permission. |
| Link "progress.badges.link" → Achievements | ProgressScreen.tsx | progress_screen.dart → `/achievements` | PRESENT | |
| When the gate is false RN still renders both link cards | ProgressScreen.tsx | progress_screen.dart (`dashboard == null` → blank) | PARTIAL | Unchanged: `dashboard == null` → blank (progress_screen.dart:42). |
| Loading; error shown before empty | ProgressScreen.tsx | progress_screen.dart | PRESENT | |
| Refetch on every mount (`refetchOnMountOrArgChange`) | ProgressScreen.tsx | progress_repository.dart (`progressDashboardProvider`, not autoDispose) | PARTIAL | Unchanged: `progressDashboardProvider` (progress_repository.dart:155) is not autoDispose and nothing invalidates it; pull-to-refresh only. |
| `useTabBackToHomeHandler` on this stack screen | ProgressScreen.tsx | default pop | N/A | Equivalent effect: back leaves Progress. |
| Analytics events | — | — | N/A | None. |

#### 11. UserAnalyticsScreen (tab) — `screens/UserAnalyticsScreen/UserAnalyticsScreen.tsx`
Tally: 11 present / 1 partial / 0 missing / 0 in-progress / 1 n-a

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
| WebView `startInLoadingState` spinner; a failed URL is silently omitted | UserAnalyticsScreen.tsx | user_analytics_screen.dart | PARTIAL | Unchanged: no page-load indicator in `_DashboardWebView`; a failed URL shows raw `Text('$error')` (user_analytics_screen.dart:175-177). |
| Reset URLs when the user changes | UserAnalyticsScreen.tsx | analytics_repository.dart (provider rebuilds on auth or user change) | PRESENT | |
| Android back on the tab → first visible tab (`useTabBackToHomeHandler`) | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 (`PopScope`) | PRESENT | v2: one shell-level fix. |
| Analytics events | — | — | N/A | None. |

#### 12. LeaderboardScreen (tab) — `screens/LeaderboardScreen/LeaderboardScreen.tsx`, `hooks/useLeaderboard.ts`
Tally: 14 present / 0 partial / 0 missing / 0 in-progress / 1 n-a

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
Tally: 2 present / 1 partial / 0 missing / 0 in-progress / 1 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_COMMUNITY | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| **On every focus**: goBack (to the previous tab) + open https://community.helloally.ai/ externally | CommunityScreen.tsx (`useFocusEffect`) | features/community/presentation/community_screen.dart (`initState` post-frame) | PARTIAL | Unchanged: runs once from `initState` (community_screen.dart:17-26); later taps do nothing; `context.pop()` cannot pop inside the shell so a blank tab stays selected. |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: shell `PopScope`. |
| Analytics events | — | — | N/A | None. |

#### 14. SearchScreen (tab) — `screens/SearchScreen/**`, `hooks/useSearch.ts`, `components/ResourceArticleCard`
Tally: 13 present / 2 partial / 0 missing / 0 in-progress / 2 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Tab gate VIEW_REFERENCE_DOCUMENT (also the fallback first tab) | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Launch view: header with Ally logo (+ hamburger if first tab), search input, "search.suggestionsTitle" + 4 suggestion chips | SearchScreen.tsx, components/SearchHeader.tsx, SearchSuggestions.tsx, searchConfig.ts | features/search/presentation/search_screen.dart (`_buildSearchLaunch`, `_SearchHeader`, `_SuggestionChip`) | PRESENT | |
| Focus animation: header up 60, input up 50, over 300ms; suggestions hidden while focused | SearchScreen.tsx | search_screen.dart (TweenAnimationBuilder) | PRESENT | The class doc saying "not ported" is stale; the code does it. |
| Tap outside → dismiss keyboard and unfocus | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Autocomplete dropdown under the input while typing | components/SearchInput.tsx, useSearch.ts | search_screen.dart (`_SearchBar`, `_onTextChanged`) | PRESENT | Divergence: Flutter filters with a 250ms debounce. RN never calls `debounceSearch`, so it always lists all 4. |
| Suggestion tap → search | useSearch.ts | search_screen.dart (`_search`) | PRESENT | |
| Submit → POST search (limit 6), category counts | useSearch.ts | features/search/data/search_repository.dart (pageSize 6) | PRESENT | |
| Clear (X) → reset search state | SearchInput.tsx, useSearch.ts (`resetSearch`) | search_screen.dart (`_resetSearch`) | PARTIAL | Unchanged: `_resetSearch` (search_screen.dart:179-192) returns to the launch view. |
| Category tabs "All (n)" + "Category (n)", shown when there are results | SearchScreen.tsx (CustomTabs) | search_screen.dart (ChoiceChip row) | PRESENT | Different widget style. |
| Category change → refetch with `filters.category`, scroll to top | useSearch.ts | search_screen.dart (`_selectCategory`) | PRESENT | |
| Infinite scroll via `excludedIds` | useSearch.ts | search_screen.dart (`_loadMore`) | PRESENT | |
| Initial loader and footer loader | SearchScreen.tsx | search_screen.dart | PRESENT | |
| Empty: 'search.noResults "query"' + suggestions | components/SearchEmpty.tsx | search_screen.dart | PRESENT | |
| **Result card** (ResourceArticleCard): category chip, horizontal tag chips, heading, 3-line content, "common.viewMore" expand/collapse | components/ResourceArticleCard | search_screen.dart (plain `ListTile`) | PARTIAL | Unchanged: plain `ListTile`, 2-line content, no expand, no tags (search_screen.dart:372-376). |
| Error handling | useSearch.ts (logs, shows the empty state) | search_screen.dart (red "search.error: $e") | N/A | Flutter-only state. |
| Android back → first tab | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: shell `PopScope`. |
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
Tally: 8 present / 2 partial / 0 missing / 0 in-progress / 0 n-a

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| 8 tabs (Learn, CallLog, Review, UserAnalytics, Leaderboard, Achievements, Search, Community) with active/inactive icons; shown if the user has ANY listed permission | constants/tabs.tsx | core/navigation/tab_config.dart | PRESENT | |
| Achievements tab only for reviewer-only users (VIEW_USER_BADGES without VIEW_COMMUNITY_LEADERBOARD) | TabNavigator.tsx, constants/tabs.tsx | tab_config.dart (`visibleTabsFor`, `isReviewerOnly`) | PRESENT | |
| Initial tab = first visible, falls back to Search | constants/tabs.tsx | tab_config.dart (`getFirstVisibleTab`), app_shell_screen.dart | PRESENT | |
| Render nothing while the user is loading | TabNavigator.tsx | core/navigation/app_shell_screen.dart (spinner while permissions load) | PRESENT | |
| Floating pill bar (60pt, radius 40, 30pt bottom margin, shadow); wider side margins when fewer than 3 tabs | TabNavigator.tsx | core/navigation/app_bottom_tab_bar.dart | PRESENT | |
| Lazy tab mount, tabs stay mounted | TabNavigator.tsx (`lazy`) | app_shell_screen.dart (`_visitedTabNames` + IndexedStack) | PRESENT | |
| Review tab unread dot = simulation unread + scribe unread > 0 (RTK tag-invalidated when reviews are read) | TabNavigator.tsx, services/reviewsApi.ts, services/scribeReviewsApi.ts | app_shell_screen.dart, features/reviews/data/reviews_repository.dart (`unreadReviewCountProvider`) | PARTIAL | v2: scribe count now included and each count gated on its own permission (reviews_repository.dart:131-148). Remaining: nothing invalidates the provider, so the dot never clears after reading. |
| Android hardware back on a tab root → first visible tab instead of exiting (Search, Community, UserAnalytics) | hooks/useTabBackToHomeHandler.ts | core/navigation/app_shell_screen.dart:150-160 | PRESENT | v2: back on a non-first tab → first visible tab; on the first tab → exit. |
| Hamburger only on the first visible tab's header | hooks/useTabScreenHeader.ts | core/navigation/drawer_menu_button.dart (`DrawerMenuScope`) | PRESENT | |
| Permissions fetch failure | (RN treats it as an empty permission list) | app_shell_screen.dart (raw `Text('$error')`) | PARTIAL | Unchanged: raw `Text('$error')` (app_shell_screen.dart:80), no retry/fallback tabs. |



### Parity ledger — Scribe screens (CallLog, CallSummary, Listening, Breathing)

RN source of truth: `ally-platform/ally-mobile/src` (screens/CallLog, screens/CallSummaryScreen, screens/ListeningScreen, screens/BoxBreathingScreen + hooks useSummaryState, useCallSummaryActions, useCallSummaryForm, useCallTranscriptDetails, useListeningCommon, useListeningScreen, useLiveAudioStream, useSocketConnection, useSocket, useToggleReviewPrivacy, useHideReviewDetails, utils/fieldRenderer.tsx, constants/summary.ts).
Flutter: `ally-mobile-flutter` `master` at `227db3a` (lib/features/calllog, lib/features/scribe, lib/features/boxbreathing, lib/core/realtime, lib/core/chat, lib/core/settings, lib/core/navigation, lib/core/routing/app_router.dart).
**v2 re-audit (2026-10-28):** every row that was PARTIAL/MISSING/MERGED in v1 was re-read on master (parity/data, parity/live, parity/callsummary, parity/shell merges); rows changed in v2 say `v2:` in Notes. ~10% of PRESENT rows spot-checked (S7, S13, S17, S19, S22, S23, S51, L8, L19, L22, L27, L42, C23) — no regressions. Rows marked `Icon sweep:` render a Material icon where RN renders an SVG/PNG. Read-only audit; nothing built or run.

#### Tallies

| Screen | PRESENT | PARTIAL | MISSING | MERGED (was IN PROGRESS) | N/A | Rows |
|---|---|---|---|---|---|---|
| CallLog | 30 | 3 | 2 | 0 | 4 | 39 |
| CallSummaryScreen | 49 | 1 | 0 | 0 | 6 | 56 |
| ListeningScreen (Microphone + Conference) | 46 | 0 | 0 | 0 | 5 | 51 |
| BoxBreathingScreen ("Breathing") | 9 | 0 | 0 | 0 | 1 | 10 |
| **Overall** | **134** | **4** | **2** | **0** | **16** | **156** |

v1 → v2: 54 status changes (CallLog 3, CallSummary 25, Listening 24, Breathing 2). L49 moved N/A → PRESENT because Flutter now matches RN's background disconnect.

(Backend-call, toast and navigation appendices under each screen are cross-references and are not counted again in the tallies.)

Analytics: RN has **no** product-analytics calls in any of these screens/hooks (grep for track/capture/posthog/logEvent/analytics/mixpanel/amplitude/firebase across the four screens and their hooks returns nothing; the only "analytics" strings are i18n keys `analytics.types.*`). Each screen gets one N/A row for this. The only telemetry-like emit is the socket `SCRIBE_START_DIAGNOSTIC` event (Listening row L37).

---

#### 1. CallLog (`screens/CallLog/**`, 26 files)

Flutter: `lib/features/calllog/presentation/call_log_screen.dart`, `call_log_row.dart`, `call_log_filter_sheet.dart`, `call_tag_chip.dart`; `lib/features/calllog/data/call_log_repository.dart`, `custom_fields_filter.dart`, `custom_fields_repository.dart`; `lib/core/settings/settings_repository.dart`; `lib/core/widgets/illustrated_modal.dart`, `status_badge.dart`, `app_empty_state.dart`, `app_tab_view.dart`, `tab_screen_header.dart`.

Tally: PRESENT 30 · PARTIAL 3 · MISSING 2 · N/A 4

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| C1 | Header title "calls.header.title" + italic subtitle | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart (TabScreenHeader) | PRESENT | |
| C2 | Archive view mode: title `calls.menu.archives`, back arrow, no subtitle, `archive:true` list | CallLogScreen.tsx, CallLogHeader.tsx | call_log_screen.dart (`_isViewingArchive`, `archivedCallLogsControllerProvider`) | PRESENT | |
| C3 | Actions menu (three dots → "Archives"), gated ARCHIVE_CALL_LOG + real tab + not in archive view | CallLogHeader.tsx (ActionsMenu) | call_log_screen.dart `_ActionsMenu` | PRESENT | |
| C4 | Refresh button with 600ms spin while fetching | CallLogHeader.tsx | call_log_screen.dart `_RefreshButton` | PRESENT | |
| C5 | Filter button + active-filter count badge (shown only for real/archived view + VIEW_CALL_LOGS) | CallLogHeader.tsx, utils/fieldFilters.ts `countActiveFilters` | call_log_screen.dart `_FilterButton`, call_log_repository.dart `CallLogFilterState.activeCount` | PARTIAL | Still open (v2): `CallLogFilterState.activeCount` (call_log_repository.dart:404) counts startDate, endDate, minDuration, maxDuration separately; RN counts the date range as 1 and the duration range as 1 (a full date+duration filter shows 4 instead of 2). |
| C6 | Built-in filters: Date & Time (from/to), Duration (mins, min/max), Mode (Scribe/Dictation), Status (Generated/Processing/Error/No Audio), Channel (Live/Uploaded) → query params | CallLogFilterSheet.tsx, utils/fieldFilters.ts `getBuiltinFilterFields`/`buildBuiltinParams` | call_log_filter_sheet.dart, call_log_repository.dart `toQueryParameters`/`_minutesToSeconds` (:455) | PARTIAL | v2: duration bug fixed (minutes ×60 → seconds; `withDuration` clears an emptied box, f67db72). Remaining: Date & Time from/to are free-text boxes (call_log_filter_sheet.dart:376-388) rather than RN date-time pickers, and emptying one sets `''` via `copyWith` (sent as `startDate=`), not null. |
| C7 | Tags multiselect filter (options from GET /chats/tags, only if non-empty) | CallLogScreen.tsx (`useGetCallTagsQuery`), fieldFilters.ts | call_log_filter_sheet.dart `_tagsField`, call_log_repository.dart `getAllTags`/`callLogTagOptionsProvider` | PRESENT | Flutter additionally gates on VIEW_TAGS permission (RN gates the query on VIEW_CALL_LOGS; endpoint itself needs view:tags, so visible outcome is the same). |
| C8 | Tenant custom-field filters (filterable defs → multiselect/number/date/text), `fieldFilters` JSON param | fieldFilters.ts `getFilterFields`/`buildFieldFiltersParam`, CallLogFilterSheet.tsx | custom_fields_filter.dart, call_log_filter_sheet.dart `_customFieldsSection` | PRESENT | Flutter only shows them when `/settings/custom-fields-enabled` is true (RN fetches defs regardless). Class doc in call_log_screen.dart/call_log_repository.dart saying custom filters are "not ported" is stale. |
| C9 | Filter sheet draft lifecycle: reseed from applied state on open, Clear, Apply → refetch page 0 | CallLogFilterSheet.tsx, CallLogScreen.tsx `handleApplyFilters` | call_log_filter_sheet.dart, call_log_repository.dart `CallLogFilterController` (list controllers watch it) | PRESENT | |
| C10 | Real/Role-play pill tabs only when both VIEW_CALL_LOGS and VIEW_SCENARIO_SESSION | CallLogScreen.tsx (TabView) | call_log_screen.dart (AppTabView) | PRESENT | |
| C11 | `availableLogTypes` + initial-tab correction from permissions | CallLogScreen.tsx | call_log_screen.dart `_buildScreen` | PRESENT | |
| C12 | FeatureNotAvailable state (no TAB_PERMISSIONS): "Oops" title, `calls.appCurrentlyForCounsellors`, "Learn more" → `Linking.openURL(ALLY_WEB_URL)`, Alert `common.unableToOpenLink` on failure | CallLogScreen.tsx, components/FeatureNotAvailable/* | call_log_screen.dart (`_activeTab == null` branch) | MISSING | Still open (v2): call_log_screen.dart:401 shows only a centred `calls.fallback.callEmptyTitle` text; no oops copy, no Learn-more CTA to ALLY_WEB_URL, no link-failure alert. |
| C13 | Real logs: GET /chats/call-logs, limit 10, offset paging, hasMore = page==10 | CallLogScreen.tsx, services/callsApi.ts | call_log_repository.dart `RealCallLogsController` (kCallLogPageSize=10) | PRESENT | |
| C14 | Simulation logs: GET /learn/scenario-sessions limit/offset | CallLogScreen.tsx, simulationsApi.ts | call_log_repository.dart `SimulationLogsController` | PRESENT | |
| C15 | Archived logs list (separate offset/hasMore) | CallLogScreen.tsx | call_log_repository.dart `ArchivedCallLogsController` | PRESENT | |
| C16 | Hide the ongoing call (`details.chatId === currentChat.chatId`) from the real list | CallLogScreen.tsx `fetchInitialRealLogs` | call_log_repository.dart `RealCallLogsController.build` | PRESENT | `currentChatProvider` is only set by active-chat discovery (core/chat/active_chat_discovery.dart), not by ScribeRecordingScreen itself. |
| C17 | Refetch all permitted lists on every screen focus (`useFocusEffect`) | CallLogScreen.tsx | call_log_screen.dart:324 (`ScreenFocusListener` invalidates real/archived/simulation lists) | PRESENT | v2: fixed (023b77c). |
| C18 | Pull-to-refresh resets active list to page 0 | CallLogScreen.tsx `handleRefresh` | call_log_screen.dart `_InfiniteScrollListView` (RefreshIndicator) | PRESENT | |
| C19 | Infinite scroll (`onEndReachedThreshold 0.5`) + footer spinner | CallLogScreen.tsx | call_log_screen.dart `_InfiniteScrollListView` (200px threshold) | PRESENT | |
| C20 | First-page skeleton (CallLogSkeleton ×10) | CallLogScreen.tsx, components/CallLogSkeleton | call_log_screen.dart `_CallLogSkeleton` | PRESENT | Static blocks (no shimmer). |
| C21 | Empty state (NoCallLogsIcon, call vs sim titles, `audioCall.fallback.noActiveCallDesc`) | CallLogScreen.tsx (EmptyState) | call_log_screen.dart `_CallLogEmptyState` | PRESENT | |
| C22 | Error state = empty state (RN resets list to [] on failed fetch) | CallLogScreen.tsx | call_log_screen.dart (`error:` → `_CallLogEmptyState`) | PRESENT | |
| C23 | Row: title chain (summaryName → metadata.sessionName → chatId → `ID-{id}`), StatusBadge (incl. NO_AUDIO hexagon), eye icon only when enabled, date•time / scenario•date line | CallLogItem.tsx, StatusBadge.tsx | call_log_row.dart, core/widgets/status_badge.dart, call_log_repository.dart `CallLogItem.fromJson/logTitle` | PRESENT | |
| C24 | Single expanded row at a time (`expandedIdx`) via chevron; header greys when expanded | CallLogScreen.tsx `handleToggle`, CallLogItem.tsx | call_log_row.dart (`_expanded` per row) | PARTIAL | Still open (v2): `_expanded` is per-row state (call_log_row.dart:73); several rows can be open at once (RN collapses the previous one). |
| C25 | Expanded details: source label + colour (Live/Uploaded) `|`, Duration, Session score (hidden when 0), Mode, tag chips coloured by positivity_rating (clamped 1–5) | CallLogItem.tsx, Tag.tsx, constants TAG_COLORS, utils/callLog `getLogSourceLabelConfig` | call_log_row.dart, call_tag_chip.dart, call_log_screen.dart `_RealLogsList` | PRESENT | |
| C26 | Row disabled unless VIEW_CHAT_DETAILS (real/archived) / VIEW_SCENARIO_SESSION_DETAILS (sim) | CallLogScreen.tsx `renderItem` | call_log_screen.dart (`enabled:`) | PRESENT | |
| C27 | Nav real/archived row → CallSummary `{callId: details.chatId, fromLogs:true}` | CallLogScreen.tsx `handleItemPress` | call_log_screen.dart → `/call-log/:id` (extra CallLogItem), core/routing/app_router.dart | PRESENT | Route hard-requires `state.extra as CallLogItem` (see S1). |
| C28 | Nav sim row → SimulationFeedback `{scenarioSessionId, fromLogs:true}` | CallLogScreen.tsx | call_log_screen.dart → `/simulations/feedback/:id?fromLogs=true` | PRESENT | |
| C29 | Start-session FAB: shown if (START_CALL_PERMISSIONS or canCreateNote) and no current chat; grey when nothing offerable; when chat-types unknown, re-fetch and toast `common.somethingWentWrong` if nothing offerable | CallLogScreen.tsx | call_log_screen.dart `_StartSessionFab` + onPressed | PRESENT | |
| C30 | Re-ask GET /settings/chat-types on every focus (401-burst recovery) | CallLogScreen.tsx (`useFocusEffect(getVisibleChatTypes)`) | call_log_screen.dart:329 (invalidates `visibleChatTypesProvider` on focus) | PRESENT | v2: fixed. |
| C31 | StartSessionModal: consent footer copy, "Start Scribe Mode" (if MICROPHONE_CHAT enabled), "Start Dictation Mode"/Create note (counsellor + scribe-note-creation-enabled), loading/disabled states, close X | StartSessionModal.tsx, CallLogScreen.tsx | call_log_screen.dart `_showStartSessionModal` (core/widgets/illustrated_modal.dart) | PRESENT | |
| C32 | Start Scribe: mic `check` → `request` each bounded to 30s, double-tap guard, BLOCKED/DENIED → microphone settings alert, error → toast `common.somethingWentWrong`, then navigate `Listening {isMicrophoneMode:true}` | CallLogScreen.tsx `handleVoiceRecording`, hooks/usePermissionAlert | call_log_screen.dart `_startScribeSession`, `_showMicrophoneSettingsAlert` → `/scribe` | PRESENT | |
| C33 | `checkCounselorChat()` (GET /chats/counsellor-chat) fired right before navigating to Listening | CallLogScreen.tsx, hooks/useCounselorChat | call_log_screen.dart | MISSING | Still open (v2): `_startScribeSession` (call_log_screen.dart:194-205) pushes `/scribe` without priming current chat. Low impact now: the scribe screen takes `chatId` from USER_JOINED (L7) and hydrates itself. |
| C34 | Create note: POST /chats/note → close sheet → CallSummary `{callId, fromLogs:true}`; failure toast `calls.createNote.error` and sheet stays | CallLogScreen.tsx `handleCreateNote`, scribeNoteApi.ts | call_log_screen.dart `_createNote`, call_log_repository.dart `createNote` | PRESENT | |
| C35 | Android hardware back: exit app on first visible tab, else navigate to first visible tab | CallLogScreen.tsx (`useHardwareBackPressHandler`, `getFirstVisibleTab`) | core/navigation/app_shell_screen.dart:150 (shell `PopScope`) | PRESENT | v2: fixed in the shell (557dc55): back on a non-first tab selects the first visible tab; on the first tab it pops (exits). |
| C36 | `checkAuth()` on focus when no userData | CallLogScreen.tsx | — | N/A | Flutter auth/user state is app-global (core/auth); no per-screen re-check needed. |
| C37 | RetrySessionModal (max-active-users auto-retry) | components/RetrySessionModal/* | — | N/A | Lives in CallLog/components but is only used by SimulationDetails/SimulationPathDetails/CaseDetails screens (out of scope here). |
| C38 | Badge component | components/Badge/* | — | N/A | Exported but not rendered anywhere in RN. |
| C39 | Analytics/tracking | — | — | N/A | None in RN. |

Backend calls (CallLog): GET `/chats/call-logs` {limit, offset, archive, fieldFilters, startDate, endDate, minDuration, maxDuration, tags, mode, status, source} — Flutter PRESENT (seconds since v2; date boxes free text, C6); GET `/chats/tags?offset=0` — PRESENT (no offset param sent); GET `/custom-fields/definitions` — PRESENT; GET `/learn/scenario-sessions` — PRESENT; GET `/settings/chat-types` — PRESENT; GET `/settings/scribe-note-creation-enabled` — PRESENT; POST `/chats/note` — PRESENT; GET `/chats/counsellor-chat` (pre-nav) — MISSING (C33).
Toasts/alerts (CallLog): `calls.createNote.error` (PRESENT), `common.somethingWentWrong` (PRESENT ×2), mic settings alert `simulationPage.allowMicrophone/microphonePrompt` (PRESENT), Alert `common.error`/`common.unableToOpenLink` (MISSING with C12).
Navigation targets: CallSummary, SimulationFeedback, Listening(isMicrophoneMode), first visible tab / exit app (C35 PRESENT via shell), external ALLY_WEB_URL (C12 MISSING).

---

#### 2. CallSummaryScreen (`screens/CallSummaryScreen/**`, 45 files + hooks)

Flutter: `lib/features/calllog/presentation/call_summary_screen.dart` (1880 lines), `voice_note_section.dart`, `voice_note_recorder.dart`; `lib/features/calllog/data/call_log_repository.dart`, `call_summary_fields.dart`, `custom_fields_repository.dart`; `lib/features/reviews/data/scribe_reviews_repository.dart`, `lib/features/reactions/data/reactions_repository.dart`, `lib/features/reviews/presentation/share_for_review_screen.dart`; `lib/core/widgets/confirmation_modal.dart`.

Tally: PRESENT 49 · PARTIAL 1 · MISSING 0 · N/A 6

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| S1 | Route params `callId`, `fromLogs`; `chatId = callId ?? currentChat.chatId` (live flow from Breathing passes none) | CallSummaryScreen.tsx | core/routing/app_router.dart:285-299 (`/call-log/:id` with optional extra, `?live=1`; `/call-summary`), call_summary_screen.dart | PRESENT | v2: fixed — opens by id without `extra`; `fromLogs` modelled (live flow = `?live=1` or `/call-summary`). |
| S2 | GET /chats/:id summary fetch + loading spinner | hooks/useSummaryState.ts, services/callSummaryApi.ts | call_log_repository.dart `callSummaryProvider`/`getCallSummary`; call_summary_screen.dart `_SummaryTab` | PRESENT | |
| S3 | Refresh on every re-focus after first (e.g. back from share/review screens) | CallSummaryScreen.tsx (`useFocusEffect` + `isFirstFocusRef`) | call_summary_screen.dart `_pushAndRefresh` (:341) | PRESENT | v2: every push from this screen (share, review FAB) refetches on return. |
| S4 | GET /settings/summary-fields (refetched on open) → `selectSummaryVisibleFields`: hide sections with no visible fields (except AdditionalNotes) and hide non-visible fields | CallSummaryScreen.tsx, CallSummaryDetails.tsx `renderSection`, SectionWrapper.tsx, services/settingsApi.ts | call_summary_screen.dart:1159 (`summaryVisibleFieldsProvider`), voice_note_section.dart:38 | PRESENT | v2: fixed (0de134b). |
| S5 | Header: back arrow, "Session *Summary*" title, `#summaryName` or `-` | components/Header/Header.tsx | call_summary_screen.dart `_buildHeaderTitle`, `_summaryName` (:274) | PRESENT | v2: rename updates the header at once. Material AppBar + TabBar rather than RN custom header (visual only). |
| S6 | Share switch visible only when summary available + status SUCCESS + transcript present + not archived | Header.tsx, CallSummaryScreen.tsx | call_summary_screen.dart `showShareSwitch` | PRESENT | |
| S7 | Share toggle: ON with no review or review <10 min old → ShareCallLog screen; otherwise PATCH scribe review status IN_REVIEW/HIDDEN, toasts `simulationPage.privacyUpdated` / `simulationPage.errorUpdatePrivacy`, then refresh | CallSummaryScreen.tsx `handleShareToggle`, hooks/useToggleReviewPrivacy.ts, services/scribeReviewsApi | call_summary_screen.dart `_handleShareToggle`, scribe_reviews_repository.dart `updateReviewStatus` | PRESENT | |
| S8 | ShareCallLog nav params `{scribeSessionId, reviewId, sessionData:{title (summaryName ‖ review.feedCard.sharedSimulationForReview), createdAt (details.startTime ‖ createdAt), duration (formatDurationFromSeconds)}, note}` | CallSummaryScreen.tsx `handleShareForReview` | call_summary_screen.dart `_handleShareToggle` (:356-367) | PRESENT | v2: passes `contextDateTime` (startTime ‖ createdAt), `contextDuration` and the translated title fallback. |
| S9 | ShareCallLog (scribe) screen itself | screens/ShareCallLog (out of folder, entry from here) | lib/features/reviews/presentation/share_for_review_screen.dart | PRESENT | v2: parity/reviews merged (bb6ca2b); on master. |
| S10 | Menu → Rename (CustomModal with input; PATCH /chats/:id/call-info `{summaryName}`; toasts `callSummary.info.summaryNameUpdateSuccess/Failed`) | SummaryModals.tsx, DeleteRenameModal.tsx, hooks/useCallSummaryActions.ts | call_summary_screen.dart `_showRenameDialog`, call_log_repository.dart `updateSummaryName` | PRESENT | AlertDialog instead of CustomModal; see S5 stale header. |
| S11 | Menu → Export (only when summary available): storage permission, GET /chats/:id/export-summary (string), save file, toasts `fileExportedSuccess` / `fileExportFailed` / invalid format | SummaryModals.tsx, useCallSummaryActions.ts `handleExport`, hooks/useStoragePermissions.ts, utils/fileOperations `saveFile` | call_summary_screen.dart menu (:452), call_summary_actions.dart `export`, data/summary_file_export.dart | PRESENT | v2: fixed (9d4807b/98ba567); iOS `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` present in Info.plist. |
| S12 | Menu → Data policy (opens PRIVACY_POLICY_URL) | SummaryModals.tsx | call_summary_screen.dart (`launchUrl(_privacyPolicyUrl)`) | PRESENT | |
| S13 | Menu → Archive/Unarchive with ConfirmationModal (destructive for archive), PATCH /chats/call-logs/:id/archive, success/failed toasts | SummaryModals.tsx, ArchiveActionModal.tsx, useCallSummaryActions.ts `handleArchive` | call_summary_screen.dart `_handleArchiveToggle`, core/widgets/confirmation_modal.dart | PRESENT | Archive state change is not pushed to the call-log list (C17). |
| S14 | Delete summary (CustomModal → PUT call-details `{summary:{}}` → goBack after 2s) | DeleteRenameModal.tsx, useCallSummaryActions.ts `handleDelete` | — | N/A | Unreachable in RN (menu never sets `activeModal='delete'`). Flutter mirrors it: `_showDeleteModal` + `CallSummaryActions.delete` exist but are unused. |
| S15 | SummaryDropdown (summary/transcript switcher) | Header/SummaryDropdown.tsx | — | N/A | Not rendered by Header.tsx. |
| S16 | Tabs Summary / Transcript; Transcript tab only if chatId && !403 && VIEW_MESSAGES | CallSummaryScreen.tsx (`showTranscriptTab`) | call_summary_screen.dart:601-603 | PRESENT | v2: gated on chatId, not-403 and VIEW_MESSAGES. |
| S17 | 403 → SummaryUnauthorized (image, `summary.notFoundTitle/Desc`, back button) | SummaryUnauthorized.tsx | call_summary_screen.dart `_SummaryUnauthorizedView` | PRESENT | Icon sweep: `Icons.lock_outline` (call_summary_screen.dart:1800) instead of RN `summaryFailed.png`. |
| S18 | Generation in progress: Lottie animation, ShinyText cycling SUMMARY_GENERATION_STEPS every 3s (full list live / tail from logs), transient "transcription deleted" shield row (5s), ETA `summaryLoading.estimatedTime`, live vs logs copy (`processingDescMain`/`…2`), success image + `summaryLoading.generated`, 3s "Setting up" hold after summary appears (`canShowSummary`) | SummaryGenerationProgress.tsx, useSummaryState.ts | summary_generation_progress.dart | PRESENT | v2: Lottie, ShinyText steps every 3s (full/tail), transcription-deleted pill, ETA, generated state, 3s setting-up hold (call_summary_screen.dart `_canShowSummaryTimer`). |
| S19 | FAILED and NO_AUDIO states (no-audio tag, failed title) | SummaryGenerationProgress.tsx | summary_generation_progress.dart:152 | PRESENT | v2: now uses `summaryFailed.png`. |
| S20 | Buttons under progress: "See if ready" (refresh) / "Retry" (POST /chats/:id/retry-summary + toasts `retryStarted`/`retryFailed`/server message) / "Setting up…" text, hidden for NO_AUDIO; "Check later" → clear currentChat + go to Call Log tab | CallSummaryScreen.tsx `renderSummaryButtons`, `handleRetrySummary`, `onViewCallLogs` | call_summary_screen.dart `_goToCallLog` (:484), summary_generation_progress.dart | PRESENT | v2: "Check later" clears current chat and goes to the Call Log tab. |
| S21 | AddNotesSection while generating: collapsible "Add notes", info tooltip, debounced (1s) POST /chats/:id/notes `{content}` | SummaryGenerationProgress/AddNotesSection.tsx, useSummaryState.ts `handleNoteChange`, chatApi `updateNotes` | summary_generation_progress.dart:303+ (AddNotes section, debounced POST /chats/:id/notes) | PRESENT | v2: fixed. |
| S22 | AI-generated warning banner (GoldenShield) above sections | CallSummaryDetails.tsx | call_summary_screen.dart (amber banner) | PRESENT | Icon sweep: `Icons.shield_outlined` (call_summary_screen.dart:1227) instead of RN `goldenShield.svg`. |
| S23 | Exclusive accordion; toggling blocked while another section is editing; collapsing the editing section exits edit | CallSummaryDetails.tsx `toggleSection`, SectionHeader.tsx | call_summary_screen.dart `_toggleSection`, `_SectionCard` | PRESENT | Icon sweep: section icons are Material (call_summary_screen.dart:88-105, rendered :1384); chevron `Icons.expand_less/expand_more` (:1428) instead of `arrowDown/arrowRight.svg`. |
| S24 | Edit gate `section.canEdit && (MANAGE_CUSTOM_FIELD_DEFINITIONS admin || counselorId === me)` | SectionWrapper.tsx | call_summary_screen.dart `_SectionCard` (`canEdit`) | PRESENT | |
| S25 | Edit → Wand (canEnhance) / Tick (save) / Close (reset section) controls with animation | SectionHeader.tsx, SectionWrapper.tsx | call_summary_screen.dart `_SectionCard`, `_onTickPress`, `_onClosePress` | PRESENT | No fade/slide animation. |
| S26 | AI enhance: POST /chats/enhance `{content}` for the section's editable field; pulsing field while enhancing; toast `summary.enhanceFailed` on error/empty | SectionWrapper.tsx, EditableField.tsx | call_summary_screen.dart `_onWandPress`, call_log_repository.dart `enhanceCallSummary` | PRESENT | Spinner replaces wand instead of pulsing text. |
| S27 | Built-in field renderers: Text (read-only), InlineTextInput, MultilineTextInput (EditableField), Dropdown (CustomDropdown) with localized labels/options | utils/fieldRenderer.tsx, FieldRow.tsx, EditableField.tsx, GenericSectionContent.tsx, constants/summary.ts | call_summary_screen.dart `_FieldEditor`, call_summary_fields.dart | PRESENT | |
| S28 | Location = SearchableLocationDropdown (places search) | utils/fieldRenderer.tsx (`FieldType.SearchableDropdown`), services/placesApi.ts | searchable_location_dropdown.dart, data/places_repository.dart; call_summary_screen.dart:1538 | PRESENT | v2: fixed (`/places`, `/places/search`). |
| S29 | Tags field edit → submit as array of names (`transformFormDataForSubmission` + `tagNames`) | hooks/useCallSummaryForm.ts, utils/formDataTransformer.ts | call_log_repository.dart:1026-1031 (tags sent as a list of names) | PRESENT | v2: fixed (0de134b); in-flight edits kept via `_form.pendingPatch`/`markSaved` (call_summary_screen.dart:986). |
| S30 | Read transform: dominantFeelings array → ", " string; tags → names; additionalNotes from callInfo.notes; computed read-only fields | utils/formDataTransformer.ts `transformSummaryToFormData`, constants/summary.ts computeValue | call_log_repository.dart:246-250, data/summary_display_format.dart | PRESENT | v2: dominantFeelings joined; duration/date/time formatted like RN (228162f). |
| S31 | Global Save button: shown when `(!callId || hasChanges)` and feedback popup closed; after save, opens summary-feedback popup (if no feedback, EDIT_SUMMARY_FEEDBACK, not manual note) | CallSummaryScreen.tsx `onSaveButtonPress`, CallSummaryDetails.tsx | call_summary_screen.dart:1277 (`alwaysShowSave || dirty`), `_onSaveButtonPress` | PRESENT | v2: always shown in the live flow; opens the feedback popup after save. |
| S32 | Unsaved edits survive refetch; seed per chat | useCallSummaryForm.ts | call_summary_screen.dart `_seedIfNeeded` | PRESENT | |
| S33 | Section close resets that section's built-in fields to saved values | useCallSummaryForm.ts `handleSectionFieldsReset` | call_summary_screen.dart `_resetSectionFields` | PRESENT | |
| S34 | Custom fields: `/settings/custom-fields-enabled` gate, GET definitions, GET values/:chatId (seed once), per-section PUT values/:chatId on tick, toast `summary.customFieldSaveFailed` | CallSummaryDetails.tsx, services/customFieldsApi.ts | call_summary_screen.dart `_seedCustomFieldsIfNeeded`/`_saveCustomFieldsForSection`, custom_fields_repository.dart, settings_repository.dart | PRESENT | |
| S35 | Custom field editPermission BOTH / ADMIN_ONLY / COUNSELLOR_ONLY | CustomFieldsSection.tsx `canEditField` | call_summary_screen.dart `_canEditCustomField` | PRESENT | |
| S36 | Custom field renderers TEXT, NUMBER (numeric kb), SINGLE_SELECT (dropdown by label), BOOLEAN (Yes/No → 'true'/'false'), MULTI_SELECT (modal with checkboxes, JSON array) | CustomFieldsSection.tsx | call_summary_screen.dart `_CustomFieldEditor` | PRESENT | |
| S37 | Custom field DATE: display via `formatCustomFieldDate`, edit value normalized by `normalizeCustomFieldDate` to YYYY-MM-DD | CustomFieldsSection.tsx (utils customFieldDate) | call_summary_screen.dart:1679 (`formatCustomFieldDate`), :1763 (`normalizeCustomFieldDate`) | PRESENT | v2: fixed (228162f). |
| S38 | Manual note detection latched for the screen's lifetime (`isManualNoteRef`) | useSummaryState.ts | call_summary_screen.dart `_isManualNote` latch (:270, :309) | PRESENT | v2: fixed. |
| S39 | VoiceNoteSection gate: `/settings/scribe-voice-note-enabled` + COUNSELOR_ACCESS + chatId + ≥1 voice field; "Record" CTA | VoiceNotePanel/VoiceNoteSection.tsx, hooks/useScribeVoiceNoteEnabled.ts | voice_note_section.dart | PRESENT | |
| S40 | VoiceNotePanel states: recording/paused (dot, m:ss, pause/resume, stop), stopped (discard, generate), generating (rotating transcribing/extracting/populating every 2.2s) | VoiceNotePanel/VoiceNotePanel.tsx | voice_note_section.dart `_VoiceNotePanel` | PRESENT | |
| S41 | Recorder + mic-permission error → toast `calls.createNote.voice.micDenied` / `generateError`, close panel | hooks/useVoiceNoteRecorder.ts, VoiceNoteSection.tsx | voice_note_recorder.dart, voice_note_section.dart `_onRecorderChanged` | PRESENT | |
| S42 | Generate: POST /chats/note/generate-from-audio (multipart audio + fields catalog of *visible* editable built-ins + editable custom fields), apply built-ins via PUT call-details (tags as names) | VoiceNoteSection.tsx `handleGenerate`/`applyGeneratedValues`, scribeNoteApi.ts | voice_note_section.dart `_voiceFieldCatalog` (:38) + custom fields (:235-253) | PRESENT | v2: catalog filtered by visible fields, includes editable custom fields; tags saved as names. |
| S43 | Voice custom-field values: `encodeVoiceCustomValue` (select label match, multiselect JSON, boolean yes/no, spoken date → YYYY-MM-DD) + PUT custom-fields values + remount form | VoiceNoteSection.tsx | data/voice_custom_fields.dart `encodeVoiceCustomValue`; voice_note_section.dart:167-176 | PRESENT | v2: fixed (71ebce0). |
| S44 | Transcript accumulation: seed from existing `details.transcript`, append new spoken text, PUT /chats/:id/transcript (best effort) | VoiceNoteSection.tsx (`transcriptRef`), scribeNoteApi `saveNoteTranscript` | voice_note_section.dart (`_transcript`), call_log_repository.dart `saveNoteTranscript` | PARTIAL | Still open (v2): `_transcript` starts `''` (voice_note_section.dart:92) and is never seeded from `details.transcript` (RN VoiceNoteSection.tsx:193 seeds `transcriptRef`). A second dictation on an existing note PUTs only the new text and overwrites the earlier transcript. |
| S45 | Voice toasts: generated / nothingExtracted / noSpeech (NO_SPEECH_DETECTED) / generateError; keep panel for retry on failure | VoiceNoteSection.tsx | voice_note_section.dart | PRESENT | |
| S46 | Transcript tab UI: SummaryCard titled `callSummary.header.transcript`, per-item mm:ss time (WEBRTC: createdAt−start; else startSeconds), speaker label You/Client, blue/purple bordered cards, DICTATION mode = one merged white block, EmptyTranscript component | CallTranscript.tsx, CallTranscriptItem.tsx, hooks/useCallTranscriptDetails.ts | call_transcript_tab.dart, scribe/presentation/call_transcript_item.dart | PRESENT | v2: mm:ss times, You/Client labels, DICTATION merged block, EmptyTranscript. |
| S47 | Transcript pagination: GET /chats/:id/messages {limit 20, offset, sortOrder ASC, sortBy createdAt (WEBRTC) / startSeconds}, load more on end reached, footer spinner | useCallTranscriptDetails.ts, services/callTranscriptApi.ts | call_log_repository.dart `getChatMessages` (:764), provider (:1013-1022) | PRESENT | v2: limit 20/offset/sortOrder ASC/sortBy createdAt (WEBRTC) or startSeconds (118522d). Pages are fetched up front rather than on end-reached (no footer spinner); result is the full ordered transcript. |
| S48 | Back-press summary-feedback prompt: summary shown, not manual note, no feedback yet, EDIT_SUMMARY_FEEDBACK, and (≥30s on screen **or** not from logs) | CallSummaryScreen.tsx `onBackNavigation` | call_summary_screen.dart `_handleBackPress` (:504) | PRESENT | v2: `≥30s || !fromLogs`. |
| S49 | `handleGoBack`: from logs → goBack; live flow → reset stack to CallLog + `clearCurrentChat` | useCallSummaryActions.ts | call_summary_screen.dart `_handleGoBack` (:477-488) | PRESENT | v2: live flow clears current chat and goes to the Call Log tab. |
| S50 | FeedbackPopup: stars, rating-dependent tag chips, issue chips (FEEDBACK_ISSUE_OPTIONS for 2–4), comment; POST /chats/:id/summary-feedback `{rating, feedback:{issues, comment, tags}}`; toasts `callFeedback.submitted` / `summaryLoading.summaryFeedbackSubmittedFailed`; close + go back | components/FeedbackPopup/FeedbackPopup.tsx, SummaryModals.tsx, CallSummaryScreen.tsx | simulations/presentation/widgets/feedback/feedback_popup.dart (issue chips), call_summary_screen.dart `_submitFeedback` (:524) | PRESENT | v2: issues and rating tags submitted. |
| S51 | View-review FAB (CommentIcon) when reviewId && !hideReviewDetails && VIEW_SCRIBE_REVIEW && !archived; hide private reviews with no threads (GET threads limit 1) and no reactions (GET reactions count) | CallSummaryScreen.tsx, hooks/useHideReviewDetails.ts | call_summary_screen.dart `_checkHideReviewDetails`, scribe_reviews_repository.dart, reactions_repository.dart | PRESENT | Icon sweep: FAB uses `Icons.comment_outlined` (call_summary_screen.dart:685) instead of RN `CommentIcon` (`chatBubble.svg`). |
| S52 | FAB navigates to ScribeReviewDetails `{reviewId, isPrivate}` | CallSummaryScreen.tsx `handleViewReview` | call_summary_screen.dart → `/reviews/:id` (extra ReviewType.scribe); reviews/presentation/review_details_screen.dart:317 | PRESENT | v2: `isPrivate` isn't passed, but the details screen derives it from the fetched review (`review.isPrivate`), so the outcome matches. |
| S53 | Clear summary Redux slice on unmount | useSummaryState.ts (`clearSummaryStates`) | — | N/A | Flutter keeps form state in the widget; nothing global to clear. |
| S54 | POST /chats/summary/tag-positivity-ratings (`useGetTagsMutation`) | services/callSummaryApi.ts | — | N/A | Exported but never called in RN (ratings moved server-side). |
| S55 | FlowSection, KeyConcernSection, NotesSection components | components/FlowSection, KeyConcern, CallSummaryDetails/NotesSection.tsx | — | N/A | Not rendered anywhere in RN. |
| S56 | Analytics/tracking | — | — | N/A | None in RN. |

Backend calls (CallSummary), v2: GET `/chats/:id`, GET `/settings/summary-fields`, PUT `/chats/:id/call-details` (tags as names), PATCH `/chats/:id/call-info`, GET `/chats/:id/export-summary`, PATCH `/chats/call-logs/:id/archive`, POST `/chats/enhance`, POST `/chats/:id/retry-summary`, POST `/chats/:id/summary-feedback` (issues + tags), POST `/chats/:id/notes`, GET `/chats/:id/messages` (limit/offset/sort), GET `/places` + `/places/search`, custom-fields enabled/definitions/values GET+PUT, GET `/settings/scribe-voice-note-enabled`, POST `/chats/note/generate-from-audio` (visible + custom fields), PATCH `/scribe-session-reviews/:id`, scribe review threads (limit 1), scribe reactions count — all PRESENT. PUT `/chats/:id/transcript` PARTIAL (S44: not seeded from the existing transcript).
Toasts: all RN toasts PRESENT incl. fileExportedSuccess / fileExportFailed / storagePermissionDenied / invalidResponseFormat.
Navigation targets: ShareCallLog PRESENT, ScribeReviewDetails PRESENT, CallLog tab reset PRESENT (S20/S49), goBack PRESENT.
---

#### 3. ListeningScreen (`screens/ListeningScreen/**`, 39 files) — Microphone (Scribe) + Conference

Flutter: `lib/features/scribe/presentation/scribe_recording_screen.dart`, `conference_listening_screen.dart`, `listening_controls.dart`, `nudge_section.dart`, `network_disconnected.dart`, `audio_waveform.dart`, `elapsed_timer.dart`, `dismissable_banner.dart`, `call_transcript_item.dart`; `lib/features/scribe/data/transcript_logic.dart`, `chat_models.dart`, `chat_repository.dart`; `lib/core/realtime/socket_service.dart`, `socket_events.dart`, `foreground_recording_service.dart`; `lib/core/chat/active_chat_discovery.dart`, `current_chat_provider.dart`; `lib/core/routing/app_router.dart` (`/scribe`, `/conference-listening/:chatId`).

Tally: PRESENT 46 · PARTIAL 0 · MISSING 0 · N/A 5

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| L1 | Mode routing: microphone if `isMicrophoneMode` param or chat provider MICROPHONE, else conference | ListeningScreen.tsx | app_router.dart (`/scribe`, `/conference-listening/:chatId`), active_chat_discovery.dart `targetRouteForActiveChat` | PRESENT | |
| L2 | Auto-start live mic stream on mount (16 kHz, mono, 16-bit, bufferSize 1024) | MicrophoneListeningScreen.tsx, hooks/useLiveAudioStream.ts | scribe_recording_screen.dart `_start` (record `startStream` pcm16) | PRESENT | |
| L3 | Mic permission on screen: request if needed; denied → settings alert (Cancel → goBack, OK → openSettings); re-check when app returns active | useLiveAudioStream.ts `checkPermission`, AppState listener | scribe_recording_screen.dart (settings alert :281-305; resume re-check :235) | PRESENT | v2: fixed (d4ae9eb). |
| L4 | Socket.IO to MICROPHONE_SOCKET_PATH, websocket+polling, auth callback with fresh token, reconnection 5 / 1–5s | hooks/useSocket.ts, useSocketConnection.ts | core/realtime/socket_service.dart | PRESENT | |
| L5 | Mic socket not torn down on background (`disconnectOnBackground:false`) | MicrophoneListeningScreen.tsx | socket_service.dart (no lifecycle disconnect) | PRESENT | |
| L6 | SESSION_CREATED → once permission + session ready, emit START_AUDIO_CHAT `{isLinear16Encoded, platform MOBILE, sampleRate, mode SCRIBE}` | MicrophoneListeningScreen.tsx, utils/audioUtils.ts `getStartAudioChatPayload` | scribe_recording_screen.dart `_maybeEmitStartAudioChat` | PRESENT | |
| L7 | USER_JOINED: take `payload.chatId` immediately (`setCurrentChatId`), then hydrate via GET /chats/counsellor-chat | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_onUserJoined` (:364) | PRESENT | v2: takes `payload.chatId` first, then hydrates. |
| L8 | 5s without chatId → MICROPHONE_FAILURE view | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_chatIdTimeoutTimer` | PRESENT | |
| L9 | AUDIO_MESSAGE `{audioData base64, chatId}` emitted when not paused and chatId known; never gated on socket.connected | MicrophoneListeningScreen.tsx `handleAudioData` | scribe_recording_screen.dart `_onAudioChunk` | PRESENT | |
| L10 | Web-microphone mode (chat provider MICROPHONE + platform WEB): no local streaming, pause disabled, no network/socket disconnect states | useListeningCommon.ts, useListeningScreen.ts, MicrophoneListeningScreen.tsx | scribe_recording_screen.dart `_isWebMicrophoneMode` (:134) | PRESENT | v2: no local streaming, pause disabled, no disconnect states. |
| L11 | Starts paused (`isCallPaused=true`) with mute tooltip visible ("Resume to let it listen") until resume or dismiss | MicrophoneListeningScreen.tsx, ListeningControls.tsx | scribe_recording_screen.dart:111 (`_isMuteTooltipOpen = true`), :577 | PRESENT | v2: fixed. |
| L12 | Pause/Resume debounced 500ms | MicrophoneListeningScreen.tsx (`useDebounce`) | scribe_recording_screen.dart:470 (500ms trailing debounce) | PRESENT | v2: fixed. |
| L13 | MESSAGE_RECEIVED (TEXT) / UTTERANCE_ENDED interim-final merge, split by sender | useListeningCommon.ts `processTranscription`/`updateLastTranscription` | transcript_logic.dart, scribe_recording_screen.dart | PRESENT | |
| L14 | Rehydrate existing chat messages (TEXT, reversed, split mine/theirs) | MicrophoneListeningScreen.tsx | transcript_logic.dart `rehydrateTranscriptions` (on USER_JOINED) | PRESENT | |
| L15 | NUDGE event → 500ms loading → current nudge | MicrophoneListeningScreen.tsx, ConferenceListeningScreen.tsx | scribe_recording_screen.dart / conference_listening_screen.dart `_onNudge` | PRESENT | |
| L16 | Nudge shown only in non-focus mode and when GET /settings/nudge-status true | both screens | scribe_recording_screen.dart, conference_listening_screen.dart (`nudgeStatusProvider`) | PRESENT | |
| L17 | Nudge content rendered with CustomMarkdown; SkeletonLoader while loading; scrollable | NudgeSection.tsx, CustomMarkdown.tsx, SkeletonLoader.tsx | nudge_section.dart (`NudgeMarkdown` :195, `_NudgeSkeleton` :319, maxHeight 80vs scroll :101) | PRESENT | v2: fixed. |
| L18 | Nudge feedback: "Is this helpful?" always shown; thumbs only with EDIT_MESSAGE_FEEDBACK; POST /chats/messages/:id/feedback or PATCH /chats/messages/feedback/:feedbackId; skip same rating; leading debounce | NudgeSection.tsx, chatApi.ts | nudge_section.dart:94-120, same-rating skip :69 | PRESENT | v2: "Is this helpful?" always shown; thumbs only with EDIT_MESSAGE_FEEDBACK. |
| L19 | CHAT_ENDED → replace with Breathing (only when focused) | useListeningCommon.ts `handleCallEndRedirection` | scribe_recording_screen.dart `_onCallEndedByServer` → `/box-breathing?chatId=` | PRESENT | |
| L20 | End-session confirmation (IllustratedModal, EndSessionIcon, mic copy `audioCall.endDialog.*`) | CallEndConfirmationModal.tsx | scribe_recording_screen.dart `_showEndConfirmation` (core/widgets/illustrated_modal.dart) | PRESENT | No EndSessionIcon illustration. |
| L21 | End call: stop stream, POST /chats/:id/end, navigate to Breathing on success **and** on error | useListeningCommon.ts `handleEndCall` + effect | scribe_recording_screen.dart `_endSession` (:484-500) | PRESENT | v2: goes to Breathing on success and error. |
| L22 | Back: no live session → clear currentChat + goBack; live → open end confirmation | MicrophoneListeningScreen.tsx `handleHardwareBackPress`, useListeningCommon `handleGoBack` | scribe_recording_screen.dart `_handleBackPress`, PopScope | PRESENT | v2: `_handleGoBack` now clears `currentChatProvider`. |
| L23 | "Connecting…" state with a Cancel button (dark theme) | MicrophoneListeningScreen.tsx | listening_chrome.dart `ListeningConnectingView(onCancel)`; scribe_recording_screen.dart:558 | PRESENT | v2: fixed. |
| L24 | NetworkDisconnected view: icon, title/desc per SOCKET/NETWORK/MICROPHONE_FAILURE, "Try again" hidden when offline, "Go back" | NetworkDisconnected.tsx | network_disconnected.dart (:43 offline from `isOfflineProvider`, :46 SOCKET → `common.somethingWentWrong`, :96 `networkDisconnected.svg`) | PRESENT | v2: fixed. |
| L25 | Offline detection (NetInfo) → NETWORK type; socket disconnect classified NETWORK vs SOCKET by offline flag | hooks/useNetworkConnectivity.ts, MicrophoneListeningScreen.tsx | core/realtime/connectivity.dart; scribe_recording_screen.dart:159, :256 | PRESENT | v2: fixed (connectivity_plus). |
| L26 | Try again → clear disconnected state + go back | MicrophoneListeningScreen.tsx `handleTryAgain` | scribe_recording_screen.dart `_handleTryAgain` | PRESENT | |
| L27 | Focus layout: lock icon + privacy tooltip (`audioCall.privacy.*` 4 bullets) + "Taking notes", timer, waveform, `listeningScreen.microphoneModeNote` | MicrophoneListeningScreen.tsx `renderFocusMode`, useListeningScreen.ts | scribe_recording_screen.dart `_buildBody`, `_showPrivacyInfo` | PRESENT | v2: tooltip bubble with `audioCall.privacy.*` keys (listening_chrome.dart:96-99). |
| L28 | Non-focus layout: compact label/timer + waveform row, nudge, Search, transcript ScrollView auto-scrolling to end | MicrophoneListeningScreen.tsx `renderNonFocusMode` | scribe_recording_screen.dart `_buildNonFocusMode` (auto-scroll :459, Search :674) | PRESENT | v2: fixed. |
| L29 | Search (reference-document search: input, "Try" suggestions, category tabs, ResourceArticleCard list, paging, empty state; dark theme) in non-focus mode | components/Search/Search.tsx, hooks/useSearch.ts, services/searchApi (`/reference-document/search`, `/categories`) | scribe_reference_search.dart; scribe_recording_screen.dart:674, conference_listening_screen.dart:301 | PRESENT | v2: fixed (cd51b4d). |
| L30 | Live transcript item: mm:ss since chat start, speaker label You/Client, coloured by sender | MicrophoneListeningScreen.tsx `getElapsedSeconds`, CallTranscriptItem | scribe_recording_screen.dart:688 (`speakerLabel`), `_elapsedLabel` mm:ss | PRESENT | v2: fixed. |
| L31 | Timer HH:MM:SS from chat.startedAt | Timer/Timer.tsx, useListeningScreen.ts `startTime` | elapsed_timer.dart | PRESENT | |
| L32 | Waveform: 120ms frames from latest amplitudes, silent when paused, focus vs compact sizes, `shapeAmplitudes` edge taper, iOS gain | AudioWaveformContainer.tsx, AudioWaveform.tsx, utils/audioUtils.ts | audio_waveform.dart `shapeAmplitudes` (:129) | PRESENT | v2: taper ported. |
| L33 | ListeningControls: CollapsibleButtonGroup (maximise/minimise toggle), pause/resume (icon+label, active variant), Focus (VIEW_REFERENCE_DOCUMENT), End session (red square), "data safe" shield footer | ListeningControls.tsx (components/CollapsibleButtonGroup) | listening_controls.dart (collapse chevron, SVG icons, shield footer :154) | PRESENT | v2: fixed. |
| L34 | Keep screen awake while listening (activate/deactivateKeepAwake) | useListeningCommon.ts | core/realtime/keep_awake.dart (wakelock_plus); scribe_recording_screen.dart:149, conference_listening_screen.dart:67 | PRESENT | v2: fixed. |
| L35 | App returns to foreground → (500ms) GET /chats/counsellor-chat; none → redirect to Breathing | useListeningCommon.ts AppState effect | scribe_recording_screen.dart `didChangeAppLifecycleState` (:237 `_checkChatStillActive`) | PRESENT | v2: fixed. |
| L36 | iOS swipe-back disabled for mic mode (`gestureEnabled:false`) | useListeningCommon.ts | scribe_recording_screen.dart PopScope(`canPop: !_hasLiveSession`) | PRESENT | |
| L37 | SCRIBE_START_DIAGNOSTIC socket emit at 5s/15s with gate booleans + app version | MicrophoneListeningScreen.tsx | scribe_recording_screen.dart:173-197 (5s/15s `SocketEvent.scribeStartDiagnostic`) | PRESENT | v2: fixed (cd51b4d). Backend consumer still unverified. |
| L38 | Android foreground service + notification permission | — (RN has none) | foreground_recording_service.dart, scribe_recording_screen.dart | N/A | Flutter-only addition. |
| L39 | Full-screen dark UI, translucent light status bar, no header | MicrophoneListeningScreen.tsx, styles.ts | listening_chrome.dart `ListeningPage` (:30 dark scaffold, no header) | PRESENT | v2: fixed. |
| L40 | Conference: socket CLOUD_TELEPHONY_PATH; USER_JOINED → checkCounselorChat; "Connecting…" until chatId (no timeout) | ConferenceListeningScreen.tsx | conference_listening_screen.dart `_connect`, `_onUserJoined` | PRESENT | |
| L41 | Conference AUDIO_STREAM → exotel amplitudes; AUDIO_INACTIVE_TIMEOUT clears amplitudes (fade out) | ConferenceListeningScreen.tsx, utils/audioUtils.ts `exotelAudioDataToAmplitudes` | conference_listening_screen.dart:64, :173 (2s inactivity clear) | PRESENT | v2: fixed. |
| L42 | Conference DismissableBanner (`scribeStopTakingNotesBanner`) in focus mode | ConferenceListeningScreen.tsx, DismissableBanner.tsx | conference_listening_screen.dart, dismissable_banner.dart | PRESENT | v2: also gated on conference providers (conference_listening_screen.dart:34). |
| L43 | Conference CHAT_ENDED → replace with Breathing | ConferenceListeningScreen.tsx, useListeningCommon.ts | conference_listening_screen.dart:133, :198 (→ `/box-breathing?chatId=`) | PRESENT | v2: fixed. |
| L44 | Conference focus/non-focus layouts (timer, waveform, nudge, Search) | ConferenceListeningScreen.tsx | conference_listening_screen.dart | PRESENT | Search missing (see L29). |
| L45 | Conference controls: pause/resume and end hidden; focus button gated | ConferenceListeningScreen.tsx | conference_listening_screen.dart (ListeningControls flags) | PRESENT | |
| L46 | Conference end-call confirmation modal | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN (end button hidden). |
| L47 | Conference privacy lock + tooltip next to "Taking notes" | ConferenceListeningScreen.tsx `renderTakingNotes` | listening_chrome.dart `TakingNotesRow`; conference_listening_screen.dart:248, :282 | PRESENT | v2: fixed. |
| L48 | Conference AUDIO_CHAT_PAUSED/RESUMED emits | ConferenceListeningScreen.tsx | — | N/A | Unreachable in RN (pause button hidden). |
| L49 | Conference socket disconnect on background / reconnect on active | useSocketConnection.ts (default `disconnectOnBackground:true`) | conference_listening_screen.dart `didChangeAppLifecycleState` (:113-121) | PRESENT | v2: now drops the socket on pause and reconnects + re-checks the chat on resume, as RN. |
| L50 | ControlButtonsSection, ListeningAnimation components | components/ControlButtonsSection, ListeningAnimation | — | N/A | Exported but not rendered in RN. |
| L51 | Analytics/tracking | — | — | N/A | None in RN (see L37 for socket diagnostic). |

Backend/socket calls (Listening), v2: socket `/microphone-chat` and cloud-telephony path, START_AUDIO_CHAT, AUDIO_MESSAGE, SCRIBE_START_DIAGNOSTIC, SESSION_CREATED, USER_JOINED (payload chatId), MESSAGE_RECEIVED, UTTERANCE_ENDED, NUDGE, CHAT_ENDED, AUDIO_STREAM, GET `/chats/counsellor-chat` (USER_JOINED + foreground check), POST `/chats/:id/end`, GET `/settings/nudge-status`, nudge feedback POST/PATCH, reference-document search + categories — all PRESENT. AUDIO_CHAT_PAUSED/RESUMED (conference) N/A.
Toasts/alerts: mic settings alert PRESENT.
Navigation targets: Breathing (replace) PRESENT for mic and conference; goBack PRESENT.
---

#### 4. BoxBreathingScreen — route "Breathing" (`screens/BoxBreathingScreen/**`)

Flutter: `lib/features/boxbreathing/presentation/box_breathing_screen.dart`, `call_end_overlay.dart`, `flower_petal_painter.dart`, `breath_sound_player.dart`; route `/box-breathing?chatId=` in app_router.dart.

Tally: PRESENT 9 · PARTIAL 0 · N/A 1

| # | RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|---|
| B1 | CallEndOverlay for 3s: black→darkBlue3 gradient, `stressBuster.messages.gaveBest` fades to `momentForYourself` | BreathingScreen.tsx, CallEndOverlay/CallEndOverlay.tsx | call_end_overlay.dart, box_breathing_screen.dart `_overlayTimer` | PRESENT | |
| B2 | Background image + gradient + heading `stressBuster.returnToSelf` | BreathingScreen.tsx | box_breathing_screen.dart `_buildBreathing` | PRESENT | |
| B3 | Box animation: dot around square, flower petals bloom, 4 phases × 4s, phase labels `boxBreathing.phase*` | BoxBreathingAnimation.tsx, FlowerPetal.tsx | box_breathing_screen.dart `_buildAnimation`, flower_petal_painter.dart | PRESENT | |
| B4 | Breath sound: play on inhale, mix with other audio, volume 0 when muted, replay on unmute mid-inhale | BoxBreathingAnimation.tsx (react-native-sound-player) | breath_sound_player.dart, box_breathing_screen.dart | PRESENT | |
| B5 | Per-phase seconds counter 1→4 | BreathingScreen.tsx `onPhaseChange` | box_breathing_screen.dart `_restartCountdown` | PRESENT | |
| B6 | Controls: mute/unmute, play/pause (pause resets to phase 0, seconds 1) | BreathingControls.tsx, BreathingScreen.tsx | box_breathing_screen.dart `_BreathingControls`, `_setPlaying`, `_toggleMute` | PRESENT | |
| B7 | Pause when app goes inactive; stop on unmount | BreathingScreen.tsx AppState | box_breathing_screen.dart `didChangeAppLifecycleState`, `dispose` | PRESENT | |
| B8 | "View call summary" → CallSummary with no params (chatId from currentChat, live flow semantics) | BreathingScreen.tsx `onPressViewSessionSummary` | box_breathing_screen.dart `_viewCallSummary` (:196-200) | PRESENT | v2: pushes `/call-log/:id?live=1`, or `/call-summary` with no chat (live-flow semantics). |
| B9 | Hardware back → clear currentChat, stop, reset stack to CallLog | BreathingScreen.tsx | box_breathing_screen.dart `_resetToCallLog` (:188-192) | PRESENT | v2: clears chat, stops, `goToHomeTab(kTabCallLog)`. |
| B10 | Analytics/tracking | — | — | N/A | None in RN. |

---

#### Top gaps by user impact (v2 — remaining only)

1. S44 — Voice dictation on an existing note overwrites the earlier transcript: `_transcript` isn't seeded from `details.transcript` (voice_note_section.dart:92).
2. C12 — FeatureNotAvailable state missing: users with no Call Log tab permission see a bare "no calls" text, no oops copy and no Learn-more link (call_log_screen.dart:401).
3. C6 — Call-log date filter is free text, not a date-time picker; emptying a date box sends `startDate=` (call_log_filter_sheet.dart:376-388).
4. C5 — Filter badge counts date and duration bounds separately (shows 4 where RN shows 2).
5. C24 — Several call-log rows can be expanded at once.
6. C33 — No `GET /chats/counsellor-chat` before navigating to `/scribe` (low impact; the screen hydrates from USER_JOINED).

Icon sweep (RN SVG/PNG → Flutter Material icon), all assets already shipped in Flutter `assets/` but unreferenced:
- CallSummary FAB: `chatBubble.svg` (CommentIcon) → `Icons.comment_outlined`, call_summary_screen.dart:685
- AI-generated banner: `goldenShield.svg` → `Icons.shield_outlined`, call_summary_screen.dart:1227
- 18 section icons (`callDetails, sessionSummary, flow, keyConcern, tableEye, magnifyEye, assessment, smile, brightnessAlert, prescriptions, handShare, newsStand, headsetMic, tag, database, intake, ongoingRisks, notes`.svg) → Material map call_summary_screen.dart:88-105, rendered :1384
- Section chevron: `arrowDown.svg` / `arrowRight.svg` → `Icons.expand_less/expand_more`, call_summary_screen.dart:1428
- SummaryUnauthorized: `summaryFailed.png` → `Icons.lock_outline`, call_summary_screen.dart:1800
- VoiceNotePanel/Section: `mic.svg` → `Icons.mic` (voice_note_section.dart:261, :448); `pause.svg` → `Icons.pause` (:416); `play.svg` → `Icons.play_arrow` (:423); `delete.svg` → `Icons.delete_outline` (:472)

### Parity ledger — Learn screens (RN → Flutter)

RN root: `ally-platform/ally-mobile/src` (source of truth). Flutter root: `ally-mobile-flutter/lib` on `master`.
Audit date: 2026-10-28. **v2 re-audit:** 2026-10-28 against Flutter `master` @ `227db3a` (RN unchanged at `7a8ce0c19`; only a release-bot version bump since). Every v1 PARTIAL/MISSING row re-read on master; ~25 PRESENT rows spot-checked in changed areas (course players, role-play lifecycle, mic-before-credit, feedback recording/transcript language, path/case threading, completed items). 49 status changes; 0 regressions; 1 audit miss (short-session help icon/modal, PRESENT → PARTIAL).

**Branch note:** the brief said `parity/feedback` held in-flight work. While this audit ran, `parity/feedback` was merged into `master` (merge commit `e248a07`, which includes `517c5e4` "Match the live role-play screen to RN SimulationAssistantScreen"), and the branch was deleted. Everything that was on that branch is now on master, so it is marked PRESENT or PARTIAL with the master file named. No IN PROGRESS rows are left. `feature/simkit` was already merged (`de796ac`).

**Analytics:** RN has no client analytics SDK at all. A grep for track/capture/posthog/logEvent/analytics/mixpanel/amplitude/Sentry/crashlytics across `src/` finds no event calls. So there are no event names to port, and every analytics row is N/A.

#### Overall tally

| Screen | PRESENT | PARTIAL | MISSING | N/A | Total |
|---|---|---|---|---|---|
| SimulationsScreen — the "Learn" bottom tab | 19 | 0 | 0 | 2 | 21 |
| SimulationDetailsScreen | 21 | 0 | 0 | 1 | 22 |
| SimulationPathDetailsScreen + CaseDetailsScreen | 20 | 3 | 0 | 1 | 24 |
| CourseOverviewScreen | 16 | 1 | 0 | 2 | 19 |
| CourseItemPlayerScreen | 52 | 0 | 0 | 2 | 54 |
| CourseProgressScreen | 10 | 0 | 0 | 1 | 11 |
| BreathingExerciseScreen (course GAME / BREATHING_EXERCISE) | 6 | 0 | 0 | 1 | 7 |
| SimulationAssistantScreen — live roleplay voice session | 30 | 2 | 1 | 2 | 35 |
| SimulationFeedbackScreen | 34 | 3 | 0 | 7 | 44 |
| **Overall** | **208** | **9** | **1** | **19** | **237** |

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

Tally: PRESENT 19 · PARTIAL 0 · MISSING 0 · N/A 2

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
| Low-credits modal, auto-hides after 5 s | `IllustratedModal` + `LOW_CREDITS_MODAL_DISPLAY_MS` | start_simulation_controller.dart `onCredits` / `LowCreditsModal` | PRESENT | |
| Pre-start "Before you get started" modal | `NotificationModal` | start_simulation_modals.dart `PreStartNotificationModal` | PRESENT | |
| Start call `POST /learn/scenario-session-start` {scenarioId, languageId?} | useStartSimulation `callSessionStart` | simulations_repository.dart `startScenarioSession` | PRESENT | |
| "Creating room…" full-screen overlay | `renderLoadingOverlay` | `_CreatingRoomOverlay` | PRESENT | |
| Microphone permission request before start; Settings alert when blocked; toast when denied | useStartSimulation + usePermissionAlert | start_simulation_controller.dart:178 `_ensureMicrophone` (before `_callSessionStart`), core/realtime/microphone_permission.dart (`showPermissionSettingsAlert` → `openAppSettings`) | PRESENT | v2: `497317a`. Checked before the session/credit is spent, as RN. |
| 429 → RetrySessionModal (retry with stored params) | `isRateLimitError`, `retryStartSimulation` | start_simulation_controller.dart `_showRetry` / `RetrySessionModal` | PRESENT | |
| `entityId` error → ActiveSimulationModal (end session `POST /learn/scenario-session/:id/end`, success/error toast) | ActiveSimulationModal.tsx | start_simulation_modals.dart `ActiveSimulationModal`, controller `_showActiveSimulation` | PRESENT | |
| Other errors → error toast `errors.startSimulation` | showErrorToast | controller `_toast` (SnackBar) | PRESENT | |
| Navigate to the live screen with sessionData + scenario (reminders only when `remindersEnabled`) | navigate SIMULATION_ASSISTANT | `_pushRoleplay` → `/roleplay` extra; simulation_models.dart filters reminders | PRESENT | |
| Hardware back → goBack | useHardwareBackPressHandler | default pop | PRESENT | |
| Error state when the scenario fetch fails | — (RN never fetches) | `learn.details.loadingDetailsError` text | PRESENT | Extra state, harmless. |
| Analytics | — | — | N/A | None in RN. |

Tally: PRESENT 21 · PARTIAL 0 · MISSING 0 · N/A 1

---

#### 3. SimulationPathDetailsScreen + CaseDetailsScreen

The two RN screens are line-for-line identical apart from type names (they share `useLearningPathDetails`, `PathSimulationCard` and `SimulationDetailsModal`). Flutter shares one body, `LearningPathDetailView`.
RN: `screens/SimulationPathDetailsScreen/*`, `screens/CaseDetailsScreen/CaseDetailsScreen.tsx`, `hooks/useLearningPathDetails.ts`, `components/LearningPathDetails` (LearningPathHeader / LearningPathListHeader).
Flutter: `features/simulations/presentation/simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart`, `simulation_details_modal.dart`, `widgets/learning_path_widgets.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header: back + "Track" / "Case" title + credits read-out | LearningPathHeader | learning_path_widgets.dart `LearningPathHeader(showCredits)` | PRESENT | |
| Back falls back to the Learn tab when there's no back stack (`navigateToLearnTab`) | `handleBack` | BackTitleHeader default pop | PARTIAL | Still no fallback: path/case screens pass no `onBack`, `BackTitleHeader` just pops (core/widgets/back_title_header.dart:34). Low impact: Feedback→path now builds `/home` + push, so a stack exists; only a cold deep link would hit it. |
| Fetch `GET /learn/scenario-paths/:id` or `GET /learn/cases/:id` | useLearningPathDetails | simulations_repository.dart `simulationPathDetailsProvider` / `caseDetailsProvider` | PRESENT | |
| Loading spinner | ActivityIndicator | `LearningPathLoading` | PRESENT | |
| Error / empty → DataUnavailable EmptyState ("failedToLoadPathDetails" / "…CaseDetails") | EmptyState | `LearningPathLoadError` | PRESENT | |
| Pull-to-refresh | RefreshControl | RefreshIndicator | PRESENT | |
| List header: cover, title, description, progress bar x/y, completed state | LearningPathListHeader | learning_path_widgets.dart `LearningPathListHeader` | PRESENT | |
| Start / Continue button (label by `completedScenarios > 0`) | `handleStartPath` | learning_path_detail_view.dart | PRESENT | |
| Start disabled when there is no next scenario or credits are low | `isStartPathDisabled` | `isStartDisabled` | PRESENT | |
| Lazily create the path/case session (`POST …/create-session`) before opening the modal | `createSession` | `onEnsureSession` | PRESENT | |
| createSession failure → error toast with the server message | showToast(getErrorDetails) | learning_path_detail_view.dart:98 (inline `_error` text) | PARTIAL | Unchanged: inline red text, not a toast, and it appends the raw exception (`$e`). |
| Scenario row: 120×60 thumb, lock overlay, "Role play N", tick, "Next" chip, 2-line title | PathSimulationCard.tsx | learning_path_detail_view.dart `_ScenarioRow` | PRESENT | |
| Locked row not tappable | `handleSimulationPress` guard | `onTap: locked ? null` | PRESENT | |
| Completed row file icon → session lookup `GET /learn/scenario-session/(scenario-path-session-item or case-session-item)/:id` → Feedback(fromLogs) | `handleFileIconPress` | simulation_path_details_screen.dart:59-69 / case_details_screen.dart:62-72 → `simulationFeedbackLocation(…, fromLogs: true, pathId/caseId)` | PARTIAL | pathId/caseId now passed. Remaining: when the lookup returns no id RN toasts `failedToLoadPathDetails`; Flutter does nothing (`if (sessionId != null …)`). |
| SimulationDetailsModal: header, close, language dropdown, video/image, order label, title, description, trigger warnings, Start | SimulationDetailsModal.tsx | simulation_details_modal.dart | PRESENT | |
| Modal hidden while the pre-start NotificationModal shows | `visible={!!selected && !showNotification}` | simulation_details_modal.dart → `PreStartNotificationModal` | PRESENT | |
| Start with `scenarioPathSessionItemId` / `caseSessionItemId` from the *fresh* scenario, plus languageId | `handleProceedWithSimulation` | `startParamsFor(fresh ?? scenario)` | PRESENT | |
| Close the modal after the start settles | `.finally(handleCloseModal)` | `onSettled: close` | PRESENT | |
| Pass pathId / caseId to the live screen, then on to Feedback (back resets to path/case details; "Try another" hidden) | useStartSimulation params `pathId` / `caseId` | start_simulation_controller.dart:41-44, 99-101 → app_router.dart:204-218 `/roleplay` → roleplay_voice_screen.dart:526 → simulation_feedback_screen.dart:240-254 | PRESENT | v2: `c29e765`. Feedback back resets to path/case details; "Try another" hidden. |
| ActiveSimulationModal / RetrySessionModal / error toast | shared hook | start_simulation_controller.dart | PRESENT | |
| Low-credits modal (5 s) | useEffect isLow | controller `onCredits` | PRESENT | |
| Path/case details + credits refreshed after a session ends (RN `endScenarioSession` invalidates SimulationCredits, SimulationPaths, SimulationPathDetails, Cases, CaseDetails) | services/simulationsApi.ts `invalidatesTags` | simulations_repository.dart:120-131 `endScenarioSession` → `_onInvalidate` (credits, paths, pathDetails, cases, caseDetails) wired at :200-218 | PRESENT | v2: `8e6ad33`. |
| Hardware back | useHardwareBackPressHandler | default | PRESENT | |
| Analytics | — | — | N/A | |

Tally: PRESENT 20 · PARTIAL 3 · MISSING 0 · N/A 1

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
| Tap progress bar → CourseProgressSheet (bottom sheet, 70% snap; session → Feedback; Continue → start/continue) | CourseProgressSheet.tsx | course_detail_screen.dart:182-183 → push `/courses/:id/progress` (full screen) | PARTIAL | Unchanged: full screen instead of RN's 70% bottom sheet (a `showCourseBottomSheet` helper now exists in course_bottom_sheet.dart but isn't used here). Content parity per §6. |
| Section blocks sorted by order: ring with number, title, subtitle | CourseSectionBlock.tsx | `_CourseSectionBlock` | PRESENT | |
| Item row: type badge letter, lock, tick, status chip (Completed / In progress / Next), meta line, language-fallback caption, locked caption, current-item border | CourseItemRow.tsx | `_CourseItemRow`, `trackItemMeta`, `_typeBadge` | PRESENT | |
| "Next" item computed client-side (`findNextItemId`) | utils/trackNavigation.ts | `findNextTrackItemId` | PRESENT | |
| Item tap: locked ignored, otherwise open the player | `handleItemPress` | course_detail_screen.dart:37 `_openItem` | PRESENT | v2: unknown item types now open the player, which shows `_UnsupportedItemCard` (`3ac5dbb`). |
| Refresh after returning from the player (RN mutations invalidate `ALL_TRACK_TAGS`: list, detail, next-item) | services/coursesApi.ts | courses_repository.dart `_invalidateTracks()` on every mutation, wired at :288-291 (learnTracks, trackDetail, trackProgress) | PRESENT | v2: `8e6ad33`/`05e06d0`. |
| Track languages endpoint `GET /learn/tracks/:id/languages` | coursesApi `getTrackLanguages` | courses_repository.dart:74-80 `getTrackLanguages` (ported, `05e06d0`) | N/A | No RN screen calls it; options come from the track detail. |
| Hardware back | useHardwareBackPressHandler | default | PRESENT | |
| Analytics | — | — | N/A | RN has none. |

Tally: PRESENT 16 · PARTIAL 1 · MISSING 0 · N/A 2

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
| Celebration "Back to Learn" → Learn tab | navigateToLearnTab | `context.go('/home')` | PRESENT | Learn is the first tab. |
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
| Interjections: pause at the timestamp, blocking question, submit `POST …/interjections/:id/answer`, result, Continue resumes | VideoInterjectionModal.tsx | video/video_interjection_dialog.dart | PRESENT | Question media missing (see QuestionMedia). |
| "Watched" state | VideoItemPlayer | video_item_player.dart | PRESENT | Seeded wrongly by the `alreadyCompleted` bug above. |

##### Quiz

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Intro card: question count, pass score (hidden for surveys), attempts, Start disabled when exhausted | QuizIntro.tsx | quiz_player.dart `_QuizIntro` | PRESENT | |
| One question per page with "Question x of y", Back / Next / Submit | QuizItemPlayer.tsx | quiz/quiz_player.dart (paged, Back / Next / Submit) | PRESENT | v2. |
| 8 question types (MCQ single/multi, true/false, ordering, matching, fill-blank, open-ended, Likert) | quiz/widgets/*.tsx | quiz/quiz_question_widget.dart | PRESENT | Ordering uses up/down buttons instead of drag; matching uses dropdowns. Same data. |
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
| HTML5 game bundles (6) in a WebView + bridge, `POST …/game-result`, last/best score | GamePlayer.tsx, games/*Html.ts | game/game_player.dart, assets/games/*.html | PRESENT | |
| Game in-frame localized strings (`window.__allyGameStrings` via FRAME_STRING_KEYS) | GamePlayer.tsx `injectedStrings` | game/game_player.dart:41-117 (`window.__allyGameStrings`) | PRESENT | v2: `9898caf`. |
| Unknown game key → unsupported title + body | GamePlayer `unsupported` | game/game_player.dart:266-282 (title + `unsupportedBody`) | PRESENT | v2. |
| Breathing game key → NativeGamePlayer intro card (completes on mount) → BreathingExercise screen | NativeGamePlayer.tsx | `_BreathingExerciseIntro` → `/breathing-exercise` | PRESENT | |
| Breathing key with no config → UnsupportedItemCard | CourseItemPlayerScreen switch | falls through to `GamePlayer` (unsupported title) | PRESENT | Same end result: unsupported message. |
| Branching scenario: intro, nodes, choices, images, outcome / score / takeaway, trail, `POST …/branching-result`, attempts left, exhausted pause with recap and next round, Continue → next | BranchingScenarioPlayer.tsx | branching/branching_scenario_player.dart | PRESENT | Missing only the a11y labels `recapLabel` / `trailLabel`. |
| Bucket sort: tap-to-place `POST …/bucket-sort/place`, per-item feedback, rounds, restart `POST …/bucket-sort/restart`, first-try %, Continue | BucketSortPlayer.tsx | bucket_sort/bucket_sort_player.dart | PRESENT | Missing the `bucketA11y` label. |
| ROLEPLAY/CASE item: launch roleplay (trackItemProgressId) or open the case; assessment mode | RoleplayCasePlayer.tsx | roleplay/roleplay_case_player.dart (+ start_simulation_controller) | PRESENT | Translation keys match. |
| Accessibility labels on branching / bucket sort | various | — | N/A | Non-functional; listed under the rows above. |
| Analytics | — | — | N/A | |

Tally: PRESENT 52 · PARTIAL 0 · MISSING 0 · N/A 2

---

#### 6. CourseProgressScreen

RN: `screens/CourseProgressScreen/CourseProgressScreen.tsx`, `components/CourseProgressBody.tsx`, `PracticeNudge.tsx`, `LatestFeedbackPreview.tsx`, `RoleplaySessionRow.tsx`, `ScoreTrendSparkline.tsx`, `SectionProgressRow.tsx`, `SkillCategoryRow.tsx`.
Flutter: `features/courses/presentation/course_progress_screen.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Header "Progress" + back | CourseProgressScreen.tsx | course_progress_screen.dart | PRESENT | |
| Fetch `GET /learn/tracks/:id/progress` | useGetLearnTrackProgressQuery | `trackProgressProvider` | PRESENT | |
| Loading / error EmptyState (DataUnavailable icon) | CourseProgressScreen.tsx | course_progress_screen.dart:96-101 (`AppEmptyState`, notFound) | PRESENT | v2: `3ac5dbb`. |
| Overall progress bar + % | CourseProgressBody | course_progress_screen.dart | PRESENT | |
| Section progress rows | SectionProgressRow.tsx | `_SectionProgressRow` | PRESENT | |
| Practice nudge → Continue (`GET …/next-item` → player) | PracticeNudge.tsx | `_PracticeNudge` | PRESENT | |
| Score-trend sparkline | ScoreTrendSparkline.tsx | `_ScoreTrendSparkline` / `_SparklinePainter` | PRESENT | |
| Skill-category rows | SkillCategoryRow.tsx | `_SkillCategoryRow` | PRESENT | |
| Feedback subheading ("based on N evaluated sessions", shown when `evaluatedRoleplaySessionCount > 0`) | CourseProgressBody `feedbackSubheading` | course_progress_screen.dart:160-168 (`feedbackSubheading_one/_other`) | PRESENT | v2. |
| Latest feedback preview + roleplay session rows → Feedback(scenarioSessionId) | LatestFeedbackPreview.tsx, RoleplaySessionRow.tsx | `_LatestFeedbackPreview`, `_RoleplaySessionRow` → `/simulations/feedback/:id` | PRESENT | Visual: row trailing chevron is Material `Icons.chevron_right` (course_progress_screen.dart:637) instead of RN `chevronRight.svg` (icon sweep). |
| Analytics | — | — | N/A | |

Tally: PRESENT 10 · PARTIAL 0 · MISSING 0 · N/A 1

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

Tally: PRESENT 6 · PARTIAL 0 · MISSING 0 · N/A 1

---

#### 8. SimulationAssistantScreen — live roleplay voice session

RN: `screens/SimulationAssistantScreen/SimulationAssistantScreen.tsx` + 37 component files (SessionChecklist, SessionInfoTabs, LiveFeedback, SessionGoalTimer, SessionProgress, ScenarioInfoOverlay, SimulationTimer, SimulationControls, SpeakingIndicator, TurnIndicator, EndingSoonModal, SimulationCountdown, SessionScoreMeter, ParticipantTile, AudioWave/useAudioLevel).
Flutter (master, after merge `e248a07`): `features/roleplay/presentation/roleplay_voice_screen.dart`, `checklist_panel.dart`, `session_info_tabs.dart`, `participant_tile.dart`, `turn_state.dart`, `live_feedback_toast.dart`, `session_score_meter.dart`, `pause_resume_state.dart`, `core/realtime/livekit_room_service.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params: sessionData {id, accessToken, liveKitServerUrl}, scenario, pathId, caseId, languageId | navigation/types.ts | app_router.dart:204-218 (`pathId`, `caseId`, `languageId` read from extra) → roleplay_voice_screen.dart:96-117 | PRESENT | v2: `c29e765`. |
| Auto-connect on mount (100 ms guard) | `handleConnect` useEffect | roleplay_voice_screen.dart:241-244 (`_connectTimer = Timer(_connectDelay, _connect)`) | PRESENT | v2: `b82d84f`. Manual Connect button gone. |
| AudioSession configuration (Android communication preset / iOS) before connect | `configureAudioSession` | — (only the start/end sound player sets an `AudioContext`, simulation_sound_player.dart:45; nothing configures the LiveKit call audio) | MISSING | RN `configureAudioSession` (Android `preferredOutputList` bluetooth/headset/speaker/earpiece + media preset, iOS `defaultOutput: speaker`) before `room.connect`. Flutter relies on livekit_client defaults; not verified at runtime (iOS may route to earpiece). |
| Keep screen awake during the call | activateKeepAwake / deactivateKeepAwake | roleplay_voice_screen.dart:235-236, 250 (`keepAwakeProvider` activate/deactivate) | PRESENT | v2: `b82d84f`. |
| Start-simulation ringtone on mount, stopped when the agent speaks; end sound on disconnect | `playNotificationSound(sounds.start/endSimulation)`, SoundPlayer | roleplay_voice_screen.dart:238 (start), :512 / :646 (end); simulation_sound_player.dart; assets/sounds/{start,end}Simulation.mp3 | PARTIAL | v2: sounds play (`d12a201`). Remaining: RN stops the start sound when the agent first speaks (`SoundPlayer.stop()`, SimulationAssistantScreen.tsx:365); Flutter never stops it (`_transitionToAgentJoined` :499 doesn't call stop). |
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
| Audio-level waveform (`useAudioLevel`, polled 100 ms) | AudioWave/useAudioLevel.ts | participant_tile.dart (`isSpeaking` only), roleplay_voice_screen.dart:348-356 | PARTIAL | Unchanged and documented as deliberate: one LiveKit `isSpeaking` signal instead of a 100 ms polled `audioLevel`, so no level-driven animation. |
| TurnIndicator / SpeakingIndicator (thinking / AI speaking / your turn), AGENT_STATE data messages, debounced remote speaking | TurnIndicator.tsx, SpeakingIndicator.tsx | turn_state.dart `deriveTurnStates`, participant_tile.dart | PRESENT | |
| ScenarioInfoOverlay (i): title + trigger warnings | ScenarioInfoOverlay.tsx | roleplay_voice_screen.dart (scenario info overlay) | PRESENT | |
| Info tab bar: Checklist / Reminders / Description (each tab only when it has content) | SimulationAssistantScreen `infoTabs`, SessionInfoTabs.tsx | session_info_tabs.dart | PRESENT | |
| SessionChecklist (CHECKLIST mode, ticked via `detected_event_ids`); falls back when there are 0 events | SessionChecklist.tsx | checklist_panel.dart | PRESENT | |
| LiveFeedback toast (emoji + message), hidden in checklist/focus mode | LiveFeedback.tsx | live_feedback_toast.dart | PRESENT | |
| SessionScoreMeter (accumulated score; hidden when `showScoreMeter === false`) | SessionScoreMeter.tsx | session_score_meter.dart | PRESENT | |
| SimulationControls: collapsible button group (mic, focus, pause, end) | SimulationControls.tsx | roleplay_voice_screen.dart (`_controlsMaximized`) | PRESENT | Merged via `517c5e4`. |
| Mic toggle (error toast `errors.toggleMic`) | `handleToggleMic` | roleplay_voice_screen.dart:609-615 `_toggleMic` | PRESENT | v2: errors now surface (`errors.toggleMic`, inline). |
| Focus mode (hidden for NONE experience mode) | `showFocusButton={!isNoneMode}` | `_isFocusMode` | PRESENT | |
| Pause/resume (only when `pauseEnabled === true`): mic off, clock frozen, publish {type:pause/resume}, 2.5 s ack timeout revert + `errors.pauseControl` | `handleTogglePause`, `armControlAck` | pause_resume_state.dart, `_togglePause` | PRESENT | |
| Agent control messages paused/resumed ack, cap-warning → EndingSoon, cap-ended | onDataReceived | roleplay_voice_screen.dart:323 (`cap-ended` no-op) + disconnect handler :510 | PRESENT | v2: the room-disconnect listener now exists, so cap-ended leaves for Feedback. |
| End session: disconnect, `POST /learn/scenario-session/:id/end` {enableRecommendations:true}, always replace with Feedback (in `finally`) with pathId/caseId/languageId | `handleDisconnect` | roleplay_voice_screen.dart:636-660 (`finally` → `_goToFeedback` with pathId/caseId/languageId); simulations_repository.dart:120-131 (body `{enableRecommendations:true}` + invalidation) | PRESENT | v2. |
| Hardware/system back during the session → "End Simulation?" IllustratedModal | useHardwareBackPressHandler + IllustratedModal | `PopScope` + `_showEndConfirmation` | PRESENT | |
| Dark full-bleed call layout, RN info-tab styling | styles.ts | roleplay_voice_screen.dart | PRESENT | Merged via `517c5e4`. |
| Error toasts (`errors.connect` / `attachListeners` / `audioSession` / `toggleMic`) | useErrorToast | inline `_error` text | PRESENT | Different surface, same information. |
| Mic permission | requested upstream in useStartSimulation | start_simulation_controller.dart:178 (before session start); roleplay screen no longer requests it (:449-453) | PRESENT | v2: Settings alert present (core/realtime/microphone_permission.dart). |
| Background audio (call continues when the app is backgrounded) | LiveKit SDK | livekit_client (per livekit_room_service doc) | PRESENT | Not verified at runtime. |
| Credits refresh after the session | endScenarioSession invalidates SimulationCredits | — | N/A | Counted in §3. |
| Analytics | — | — | N/A | |

Tally: PRESENT 30 · PARTIAL 2 · MISSING 1 · N/A 2

---

#### 9. SimulationFeedbackScreen

RN: `screens/SimulationFeedbackScreen/SimulationFeedbackScreen.tsx` + 47 component files, `components/FeedbackPopup`, `components/SessionRatingTrigger`, `hooks/useHideReviewDetails.ts`, `hooks/useToggleReviewPrivacy.ts`, `hooks/useSimulationSessionRecordingUrl.ts`, `hooks/useSimulationTranscriptDetails.ts`.
Flutter (master, after merge `e248a07`): `features/simulations/presentation/simulation_feedback_screen.dart`, `simulation_transcript_tab.dart`, `widgets/feedback/{debrief_tab,debrief_sections,supervisor_note,feedback_popup,feedback_widgets}.dart`, `core/widgets/ask_ai_chat/*`, `data/simulation_transcript_repository.dart`, `data/simulations_repository.dart`, `data/simulation_models.dart`.

| RN item | RN file(s) | Flutter equivalent file(s) | Status | Notes |
|---|---|---|---|---|
| Route params scenarioSessionId, fromLogs, pathId, caseId | navigation/types.ts | app_router.dart:264-266 (`pathId`, `caseId`, `languageId` query params); simulation_feedback_location.dart | PRESENT | v2. |
| Fetch `GET /learn/scenario-session/:id?enableRecommendations=true`, polling every 3.5 s ×7 until feedback lands (or both tabs off); retry-limit state | `fetchSimulationDetailsWithRetry` | `_fetchWithRetry` / `_restartPolling` | PRESENT | |
| Restart polling when the UI language changes | effect on `activeLanguageCode` | simulation_feedback_screen.dart:444-459 (`ref.listen(localizationControllerProvider)` → `_restartPolling`) | PRESENT | v2: `bc9381b`. |
| Restart polling on screen re-focus | useFocusEffect | simulation_feedback_screen.dart:356-371 (after share-for-review only) | PARTIAL | Unchanged: returning from Review details (`:564` push) or any other pushed route doesn't restart the poll / refetch the review. |
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
| Back: path/case → reset to path/case details; fromLogs → goBack; otherwise → Learn tab | `handleBack` | simulation_feedback_screen.dart:240-261 (`go('/home')` then push details; fromLogs pop; else `/home`) | PRESENT | v2. |
| `feedbackTabs` (debrief / transcript toggles), DEFAULT fallback, both off = rating only | `feedbackTabs`, `feedbackEnabled` | `showDebriefTab` / `showTranscriptTab` / `feedbackEnabled` | PRESENT | |
| Short session (≤30 s) → only the "Session Review" tab (ShortSessionUI card) | getSimulationSummaryTabs, SummaryTab → SimulationSummary → ShortSessionUI | feedback_widgets.dart:265-370 `ShortSessionSummary` | PARTIAL | v2 spot-check (audit miss, not a regression): RN `SimulationSummary` header has a help (?) icon (`help.svg`) beside the scenario title that opens `SimulationDetailsModal` (description, cover image/video). Flutter renders the title with no icon and no modal (feedback_widgets.dart:332-343). |
| SimulationSummarySkeleton while loading | SummaryTab | `_NoteSkeleton` / summary loading | PRESENT | |
| Tab bar (scrollable, primary indicator), active tab falls back to the first | `renderTabBar`, effect | `_buildTabBar`, TabController rebuild | PRESENT | |
| EventChecklist (CHECKLIST mode, not short): `GET /learn/scenario-session/:id/event-checklist`, green/red rows | EventChecklist.tsx | feedback_widgets.dart `EventChecklist`, repository `getEventChecklist` | PRESENT | |
| DebriefTab: header, generating skeleton + hint, failed state, SupervisorNote | Debrief/DebriefTab.tsx | widgets/feedback/debrief_tab.dart | PRESENT | |
| SupervisorNote: Ally avatar, "from Ally", AI-generated badge + tooltip, sections, `**bold**`, `[[msg:id]]` → "See this moment" chips | Debrief/SupervisorNote.tsx, debriefSections.ts | supervisor_note.dart, debrief_sections.dart | PRESENT | |
| Moment chip → switch to Transcript, page until the row loads, scroll + highlight; "moment not found" toast | `handleOpenMoment`, SimulationTranscript | `_openMoment`, simulation_transcript_tab.dart | PRESENT | |
| Ask-AI reply thread: history `GET /learn/scenario-sessions/:id/chat/history`, SSE stream `POST …/chat/stream`, streaming bubble, citations table, interrupted state, error + Retry, 2,000-char limit, keyboard handling | AskAI/chatSessionManager.ts, useAskAIChat.ts, ChatElements.tsx, DebriefReplyInput.tsx | core/widgets/ask_ai_chat/{ask_ai_chat_api,controller,widgets,markdown,sse_event_parser}.dart | PRESENT | RN keeps a module-level session store, so a stream survives leaving the screen. Flutter's controller is screen-scoped and cancels on dispose. |
| Read-only debrief from Logs (no reply thread) | `readOnly={fromLogs}` | `readOnly` | PRESENT | |
| Transcript tab: card, accuracy disclaimer, paginated `GET /learn/scenario-session/:id/messages` (10/page), learner/AI tinted rows, `mm:ss Speaker`, agent name, empty state | TranscriptTab, SimulationTranscript, SimulationTranscriptItem, EmptyTranscript | simulation_transcript_tab.dart | PRESENT | |
| Session recording player: `GET /learn/scenario-session/:id/recording` presigned URL, play/pause/seek, "no recording" text | SimulationAudioPlayer.tsx (571 lines), useSimulationSessionRecordingUrl.ts | simulation_transcript_tab.dart:84-111, 360-373; data/simulation_transcript_repository.dart:81-88 (`GET …/recording`); features/reviews/presentation/simulation_audio_player.dart | PRESENT | v2: `bc9381b`. |
| Playback-synced transcript highlighting + tap-to-seek | SimulationTranscript | simulation_transcript_tab.dart:140-146 `_seekTo`, :341 tap-to-seek, playback highlight | PRESENT | v2. |
| Transcript translation language dropdown | SimulationTranscript `useLanguageDropdown`, languageCodeEndpoints | simulation_transcript_tab.dart:31-33, 81-82, 165-203 (`languageCode` on `/messages`) | PRESENT | v2. |
| Floating review button (feedback on, not the Debrief tab, review exists, `!hideReviewDetails`, `view:simulation-review`) → ReviewDetails | `handleViewReview`, useHideReviewDetails (threads / reactions count) | `_ReviewButton`, `_checkHideReviewDetails` (getThreads, getReactionsCount) | PRESENT | |
| "Try another simulation" button (not Debrief, not fromLogs, no path/case, details loaded) | `renderTryAnotherSimulation` → `handleSubmit` (opens the rating popup) | simulation_feedback_screen.dart:476-481 (hide conditions incl. path/case), :555 `context.push('/simulations')` | PARTIAL | Hide conditions now match. Remaining: action differs — RN's `handleSubmit` reopens the rating popup; Flutter pushes a standalone `/simulations` route outside the tab shell (code comment says this is intentional). Product decision. |
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

Tally: PRESENT 34 · PARTIAL 3 · MISSING 0 · N/A 7

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



### §2d Reviews (from reviews_and_components part A)

### Parity ledger — Reviews (Part A) and shared components (Part B)

RN source of truth: `ally-platform/ally-mobile/src` at `7a8ce0c19` (only a release-bot version bump has landed in `ally-mobile` since). Flutter baseline (v2 re-audit, 2026-10-28): `ally-mobile-flutter` **`master` at 227db3a**, which includes `parity/reviews` (bb6ca2b) and the later parity/shell, live, data, i18n, callsummary and courses merges. Every row that was PARTIAL, MISSING or MERGED in v1 was re-read on master; about 10% of PRESENT rows were spot-checked (ActionsMenu, ConfirmationModal, Google/Apple login, start-simulation modals, DiscussionThread, SessionRatingTrigger/StarRating, ReviewTypeChip, RichText, A1.17, A3.6–A3.9) and no regressions were found.

Status key: **PRESENT** = master has the behaviour (or the same behaviour under another name). **PARTIAL** = master has part of it (the Notes column says what is missing). **MISSING** = master has nothing. **N/A** = RN never renders it, or it is gated to dev builds. The v1 MERGED status no longer applies: every MERGED row was re-read on master and re-labelled.

#### Tallies

| Part | Rows | PRESENT | PARTIAL | MISSING | MERGED | N/A |
|---|---|---|---|---|---|---|
| A — Review screens + hooks | 77 | 69 | 5 | 1 | 0 | 2 |
| B — Shared components (67 dirs; sub-components split into 72 rows) | 72 | 59 | 7 | 0 | 0 | 6 |

v1 → v2: Reviews went 26/4/3/42 → 69/5/1/0 (PRESENT/PARTIAL/MISSING/MERGED); components 33/13/5/15 → 59/7/0/0. 71 status changes across both parts.

---

#### Part A — Review screens

Flutter master files: `lib/features/reviews/presentation/{review_screen,review_card,review_widgets,review_details_screen,review_details_parts,review_conversation,review_comment_sheets,comment_list_controller,share_for_review_screen,review_note_callout,simulation_details_card,simulation_audio_player}.dart`, `lib/features/reviews/data/{review_api,reviews_repository,scribe_reviews_repository,review_models}.dart`.
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
| A1.7 | Sort dropdown | `CustomDropdown alignModalRight`: Latest / Most viewed / Most commented | `features/reviews/presentation/review_screen.dart:439` `_SortDropdown` (right-aligned card) | PRESENT | |
| A1.8 | Filter/sort change | Resets offset, clears list, refetches | master: new family-provider key → refetch | PRESENT | |
| A1.9 | Pagination | `useReviews` LIMIT 10, `onEndReached` 0.5, `hasMore = page==10 && offset+len<count` | `features/reviews/presentation/review_screen.dart:192,235` (10/page, `hasMore` as RN, scroll threshold 0.5 at :259); `data/reviews_repository.dart:26-37` + `scribe_reviews_repository.dart:22-33` send `order: DESC` | PRESENT | `languageCode` injected for `getReviews` by `core/network/language_code_interceptor.dart:40`. |
| A1.10 | Pull-to-refresh | `FlatList refreshing/onRefresh` | `features/reviews/presentation/review_screen.dart:305` `RefreshIndicator` | PRESENT | |
| A1.11 | Refresh on re-focus | `useFocusEffect` → `refresh()` on every return after the first | `features/reviews/presentation/review_screen.dart:271` `ScreenFocusListener(onFocus: _fetch(reset: true))` | PRESENT | v2: landed in 023b77c. |
| A1.12 | Loading state | Footer `ActivityIndicator` while loading/fetching/hasMore | `features/reviews/presentation/review_screen.dart` footer spinner | PRESENT | |
| A1.13 | Empty state | `EmptyState` icon `EmptyReviewIcon` + `review.empty.title` + `review.empty.description` | `features/reviews/presentation/review_screen.dart:325` `AppEmptyState(emptyReviews.svg, title, description)` | PRESENT | |
| A1.14 | Error state | `showToast(review.error.title,'error')`; list stays | `features/reviews/presentation/review_screen.dart:241` SnackBar `review.error.title` | PRESENT | Toast styling: see Toast row (B). |
| A1.15 | Navigation → details | `REVIEW_DETAILS` or `SCRIBE_REVIEW_DETAILS` `{reviewId}` | `/reviews/:id` (+ `extra: ReviewType.scribe`) | PRESENT | Master's simulation path pushes without `extra` (defaults to simulation, fine). |
| A1.16 | Mark-as-read timing | Not on tap; details screen marks read after 10 s | `features/reviews/presentation/review_details_screen.dart:81` 10 s `_markReadTimer`; list tap is a plain push (`review_screen.dart:252`) | PRESENT | |
| A1.17 | Unread dot on Review tab | `TabNavigator` sums sim + scribe unread counts | `app_shell_screen.dart:100` → `unreadReviewCountProvider` (`data/reviews_repository.dart:131`) sums sim + scribe counts, each asked only of users with the matching permission | PRESENT | v2: scribe count now included. Not refreshed after mark-read, which matches RN (no tag invalidates `UnreadReviewCount`). |
| A1.18 | Analytics | None in RN review screens/hooks (grep: no analytics/logEvent) | — | N/A | |

##### A2. ReviewCard (list item) — RN `ReviewScreen/components/ReviewCard.tsx`, `ExpandedComments.tsx`, `ReactionsCount.tsx`

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A2.1 | Author row | `UserProfileImage` (36, image or initial with border) + name + `formatRelativeTime` | `features/reviews/presentation/review_card.dart:136` `ReviewUserAvatar` (`review_widgets.dart:23`) | PRESENT | |
| A2.2 | Note | Full note text | `review_card.dart` | PRESENT | |
| A2.3 | Simulation body | Date&time / Duration rows, then `SimulationDetailsCard` (cover, chip, title, plain-text description with View more) | `review_card.dart` + `simulation_details_card.dart` | PRESENT | |
| A2.4 | Scribe body | `SimulationDetailsCard` titled `summaryName`, Date/Duration rows inside | `review_card.dart` | PRESENT | |
| A2.5 | Cover video | `SimulationDetailsCard` plays `coverVideoUrl` via `VideoPreview` | `features/reviews/presentation/simulation_details_card.dart:43` `TODO(video-preview)`; `review_card.dart:178` passes `coverVideoUrl` but it is ignored | MISSING | `core/widgets/cover_video_preview.dart` exists but isn't used here. Same gap as VideoPreview (B). |
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
| A3.2 | Review fetch | `useGetReviewByIdQuery` refetchOnMount/Focus/Reconnect | `data/reviews_repository.dart:152` `reviewDetailProvider` is `autoDispose` (fresh fetch on every open, 1c7e502) | PARTIAL | No refetch on app foreground/reconnect (RN `refetchOnFocus/Reconnect`), and returning from edit-note doesn't invalidate it (RN `updateReviewStatus` invalidates `ReviewDetails`; `review_details_screen.dart:273` `_editNote` neither awaits nor refreshes), so the edited note shows stale until the screen is reopened. |
| A3.3 | Mark read after 10 s | `setTimeout(markXReviewAsRead, 10000)`, cleared on unmount | `features/reviews/presentation/review_details_screen.dart:81` `_markReadTimer` 10 s, cancelled in dispose | PRESENT | |
| A3.4 | Header | Back arrow + `ReviewTranscriptHeader` (type chip, title, help icon → scenario details modal (sim), "By avatar name • date • Duration") over a lightGray7 rule | `features/reviews/presentation/review_details_parts.dart:23` `ReviewTranscriptHeader` + `:144` `_ScenarioDetailsDialog` | PARTIAL | Only the dialog's cover video is missing (image shown; `:142` "where the shared video preview plugs in"). Same gap as VideoPreview (B). |
| A3.5 | Scribe title fallback | `summaryName` or `review.details.callTitle {id}` | `features/reviews/presentation/review_details_screen.dart:424-426` | PRESENT | |
| A3.6 | Transcription disclaimer | Simulation only: `transcription.accuracyDisclaimer` | master + branch | PRESENT | |
| A3.7 | Audio player header | `SimulationAudioPlayer` as list header (sim with audioUrl), no transcript sync | master + branch | PRESENT | |
| A3.8 | ReviewNote | Orange callout "NOTE"; edit icon when the user can edit; "+" add-note button when note is empty and editable; hidden when no note and not editable | `features/reviews/presentation/review_note_callout.dart` (edit icon `editSquare.svg` :82; "+" add-note :57) | PRESENT | |
| A3.9 | Edit-note gate | Owner && not HIDDEN && created < 10 min (`isMinutesPassed`) | master `_isMinutesPassed` + owner + !private | PRESENT | |
| A3.10 | Edit-note navigation | → `SHARE_SIMULATION`/`SHARE_CALL_LOG` with `isEditNote`, `note`, scenario/session context (cover, title, description, createdAt, duration) | `features/reviews/presentation/review_details_screen.dart:273` `_editNote` passes title/date/duration | PARTIAL | Cover image and description never reach the share screen: `ShareForReviewArgs` (`core/routing/app_router.dart:50`) has no cover/description fields and the route (`:333`) doesn't forward them. Same fix as A4.3. |
| A3.11 | Transcript (Conversation) | Paged 10 messages, de-duped, "mm:ss Speaker: text"; owner name for learner side; pull-to-refresh; footer spinner while loading more | `features/reviews/presentation/review_conversation.dart:53` `TranscriptMessageRow` + paging `review_details_screen.dart:101` (10/page, de-duped) | PRESENT | |
| A3.12 | Comment from text selection | `isSelectable = !isPrivate && canEditThread`; native selection menu "Add comment" → `CommentInput` sheet → POST `{messageId, selection{start,end,text}, content}`; new thread inserted locally | `features/reviews/presentation/review_conversation.dart:204` `_AddCommentMenu` → `review_comment_sheets.dart:886` `_CommentInputSheet`; gate `review_details_screen.dart:362` | PRESENT | |
| A3.13 | Commented-range highlight + tap | `splitByCommentRanges` amber highlight; tap → `MessageThreadsBottomSheet` (only if `canViewThreads`, not while composing) | `features/reviews/presentation/review_details_screen.dart:479` `onThreadsTap` → `MessageThreadsSheetPage` | PRESENT | |
| A3.14 | General comments footer | `GeneralCommentsSection` once all transcript pages load: "Comments", own avatar + "Add a comment" input + send; list (20/page, "Load More"); reply → ReplyBottomSheet; inline edit within 10 min; delete with confirmation; hide/unhide (review owner); emoji reactions | `features/reviews/presentation/review_details_parts.dart:263` `GeneralCommentsSection` + `comment_list_controller.dart` | PRESENT | |
| A3.15 | InteractionsBar (floating) | Bottom pill: Share switch (sim owners with EDIT perm), comment button + count → ThreadsBottomSheet (if `canViewThreads`), own emoji reaction on the review (`myReaction`), divider, ReactionsCount | `features/reviews/presentation/review_details_parts.dart:519` `InteractionsBar` | PRESENT | |
| A3.16 | Privacy toggle | `useToggleReviewPrivacy`: on→IN_REVIEW, off→HIDDEN; toast success/error; sim: in InteractionsBar; scribe: in header (`toggleInHeader`); owner + `EDIT_*_REVIEW` only | `features/reviews/presentation/review_details_screen.dart` — sim in `InteractionsBar`, scribe in the header (`:344`); `call_summary_screen.dart`, `simulation_feedback_screen.dart` | PRESENT | Placement now matches RN. |
| A3.17 | Threads sheet | `ThreadsBottomSheet`: Inline / General tabs, thread cards (selected text, first comment faded, "N more comments") → CommentThreadBottomSheet; General list + footer input | `features/reviews/presentation/review_comment_sheets.dart:316` `_ThreadsPage` + `:479` `_GeneralList` | PRESENT | |
| A3.18 | Comment thread view | `CommentThreadBottomSheet`: back header, comments with Reply/reactions/actions, "Add comment" footer hidden when private | `features/reviews/presentation/review_comment_sheets.dart:684` `_CommentThreadPage` | PRESENT | `thread_detail_screen.dart` is gone from master. |
| A3.19 | Reply view | `ReplyBottomSheet`: original comment + indented replies + "Add reply" footer; deleting original goes back | `features/reviews/presentation/review_comment_sheets.dart:759` `_ReplyPage` | PRESENT | |
| A3.20 | Sheet back-stack | `useReviewComments`/`replySourceRef`: back returns to the originating sheet (threads list, message threads, or closes for inline-general) | `features/reviews/presentation/review_comment_sheets.dart:51` `ReviewSheetPage` stack inside one sheet | PRESENT | |
| A3.21 | Android hardware back | `useHardwareBackPressHandler` closes the top sheet first, then `goBack` | `features/reviews/presentation/review_comment_sheets.dart` (modal route; system back pops) | PRESENT | |
| A3.22 | Local thread-sync | `handleThreadCommentChange` add/edit/delete/hide mirrored into transcript; a thread with no comments left disappears (un-highlights) | `features/reviews/presentation/review_details_screen.dart:241` (RN `handleThreadCommentChange`), `comment_list_controller.dart:8` | PRESENT | |
| A3.23 | Gates | sim: `VIEW_SIMULATION_REVIEW_THREADS` (threads), `EDIT_SIMULATION_REVIEW_THREAD` (selection), `EDIT_SIMULATION_REVIEW` (privacy); scribe: threads/selection always on, `EDIT_SCRIBE_REVIEW` | `features/reviews/presentation/review_details_screen.dart:315-316` `canViewThreads`/`canEditThread` | PRESENT | |
| A3.24 | Private-review restrictions | isPrivate: no selection, no actions menu, no reply button, reaction disabled on anchor, footers hidden | `features/reviews/presentation/review_details_screen.dart:317-362` `isPrivate` threaded through | PRESENT | |
| A3.25 | Loading / error | `isLoading` spinner; `isError` → spinner (RN shows a spinner on error too) | master: spinner / "loadReviewFailed: $error" text; branch: same + RefreshIndicator | PRESENT | Flutter's error text is more informative than RN's. |
| A3.26 | Delete confirmation | `ConfirmationModal` destructive (threadsBottomSheet.deleteConfirmation.*) | `features/reviews/presentation/review_details_parts.dart`, `review_comment_sheets.dart` `ConfirmationModal.show` | PRESENT | |

##### A4. ShareForReviewScreen — RN `ShareSimulationScreen.tsx`, `ShareCallLogScreen.tsx`, `components/ShareReviewLayout.tsx`, `hooks/useShareScreenLogic.ts`

Flutter: one `share_for_review_screen.dart` (`isScribe` switch) at `/share-for-review/:scenarioSessionId`. Reached from `simulation_feedback_screen.dart` and `call_summary_screen.dart` (`_handleShareToggle`).

| # | Sub-feature | RN behaviour | Flutter | Status | Notes |
|---|---|---|---|---|---|
| A4.1 | Header | Close (X) + title: edit → `review.details.editNote`; scribe share → `review.details.shareModalHeader`; sim share → `simulationPage.shareScreenTitle` | `features/reviews/presentation/share_for_review_screen.dart:177-195` (close.svg X + editNote / shareModalHeader / shareScreenTitle) | PRESENT | |
| A4.2 | Note input | `LineTextInput` placeholder `review.addNotePlaceholder`, maxLength 250, counter `n/250` (grapheme count) | `features/reviews/presentation/share_for_review_screen.dart:107,227` (`characters.length`) | PRESENT | |
| A4.3 | Context card | Sim: Date&time/Duration rows + `SimulationDetailsCard` (cover image/video, title, description); scribe: card titled session name with rows inside | `features/reviews/presentation/share_for_review_screen.dart:232` `SimulationDetailsCard`; sim caller `simulation_feedback_screen.dart:357` passes title/date/duration | PARTIAL | Cover image and description are never supplied (the screen accepts `contextCoverImageUrl`/`contextDescription`, but `ShareForReviewArgs` at `app_router.dart:50` has no such fields and the route doesn't forward them); no cover video. |
| A4.4 | Emoji picker | `rn-emoji-keyboard` (search, recents, multi-select), appended to note while under limit | `core/widgets/emoji_insert_picker.dart` (fixed grid, no search/recents) | PARTIAL | Scoped down by design (no search, recents or multi-select). Product decision whether to accept. |
| A4.5 | Submit button | `Button` Share / Save | `AppButton` | PRESENT | |
| A4.6 | Create (sim) | `createReview {scenarioSessionId, note}` → toast `callFeedback.sharedForReview` → goBack | `features/reviews/presentation/share_for_review_screen.dart:150-151` toast + `pop` | PRESENT | |
| A4.7 | Create (scribe) | `createScribeReview` → toast → `replace(SCRIBE_REVIEW_DETAILS, newId)` | `features/reviews/presentation/share_for_review_screen.dart:137-138` toast + `pushReplacement(/reviews/:id)` | PRESENT | |
| A4.8 | Update (reviewId present) | `updateStatus {IN_REVIEW, note}` → toast (share: sharedForReview; edit: editNoteSuccess) → goBack | `features/reviews/presentation/share_for_review_screen.dart:150-151` | PRESENT | |
| A4.9 | Error handling | Toast server `data.message` (and goBack) or `callFeedback.issues.editNoteExpired` | `features/reviews/presentation/share_for_review_screen.dart:157-158` server message or `editNoteExpired`, pop on server message | PRESENT | |
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
| A5.12 | `useShareScreenLogic` | Title/label/submit branching, 250 limit, emoji append | `features/reviews/presentation/share_for_review_screen.dart` | PRESENT | Context-card data gap is A4.3. |
| A5.13 | `useReviewComments` (sheet state machine) | 4 sheets with back-stack | `features/reviews/presentation/review_comment_sheets.dart` | PRESENT | |

---


---

## §3 Shared components (`src/components/`)

### Part B — Shared components (`src/components/*`)

RN call sites were found by grepping `<Component` outside `__tests__`. Each Flutter verdict comes from reading the Flutter file, not from a single grep miss.

| RN component | RN file(s) | RN call sites | Flutter equivalent | Status | Notes |
|---|---|---|---|---|---|
| ActionsMenu | `ActionsMenu/ActionsMenu.tsx` | ReviewComment (Edit/Delete/Hide), CallLog header (Archive) | `call_log_screen.dart:556` `_ActionsMenu`; `features/reviews/presentation/review_widgets.dart:240` `ReviewActionsMenu` | PRESENT | |
| BadgePopup | `BadgePopup/BadgePopup.tsx` + `hooks/useBadgePopup` | ReviewScreen (reviewer-only), SimulationsScreen | `features/achievements/presentation/badge_popup.dart` `BadgePopupHost` (SVG/bitmap badge art, first-badge confetti), mounted in `core/navigation/app_shell_screen.dart:165` | PRESENT | v2: a5d3ce7 + 557dc55. |
| BottomSheet | `BottomSheet/BottomSheet.tsx` (gorhom: snapPoints, handle 80x4, 16 radius, backdrop) | CommentInput, Comment/Reply/Threads/MessageThreads sheets, LanguageSelectorSheet, CallLog, CourseItemPlayer, CourseOverview, ProfileSettings | `showModalBottomSheet` in `language_selector_sheet.dart`, `call_log_filter_sheet.dart`, `course_language_sheet.dart`, `profile_image_options_sheet.dart`, `emoji_insert_picker.dart`; branch `ReviewCommentSheet` (80% snap, 80x4 handle) | PRESENT | No shared styled wrapper; reviews use `ReviewCommentSheet` (80% snap, 80x4 handle); others vary per call site. |
| BottomSheetBackHeader | `BottomSheetBackHeader/BottomSheetBackHeader.tsx` | CommentThreadBottomSheet, ReplyBottomSheet | `features/reviews/presentation/review_widgets.dart:896` `ReviewSheetBackHeader` | PRESENT | |
| Button | `Button/Button.tsx` | ~22 screens/components | `core/widgets/app_button.dart` `AppButton` | PRESENT | |
| GoogleLoginButton | `Button/GoogleLoginButton.tsx` | SplashScreen | `features/auth/presentation/login_screen.dart` (`_signInWithGoogle`) | PRESENT | Disabled when client id unconfigured. |
| AppleLoginButton | `Button/AppleLoginButton.tsx` | SplashScreen (iOS) | `login_screen.dart` (`sign_in_with_apple`) | PRESENT | |
| ButtonGroup / ButtonItem | `ButtonGroup/ButtonGroup.tsx`, `ButtonItem.tsx` | only via CollapsibleButtonGroup | see next row | PRESENT | Internal to CollapsibleButtonGroup. |
| CollapsibleButtonGroup | `ButtonGroup/CollapsibleButtonGroup.tsx` | ListeningScreen controls, SimulationAssistantScreen controls | `roleplay_voice_screen.dart:785` `_SimulationControls`; `features/scribe/presentation/listening_controls.dart:20` `ListeningControls` (collapsible dark bar, chevronDown.svg, expanded by default) | PRESENT | v2: Scribe/Conference listening ported in d4ae9eb. |
| Carousel / Pagination / SecurityCarousel | `Carousel/*.tsx` | none rendered (SplashScreen only mocks it in tests; configs live in `constants/general.ts`) | — | N/A | Dead in RN. |
| ChartComponent | `ChartComponent/ChartComponent.tsx` | none (exported only) | — | N/A | Dead in RN. |
| Checkbox | `Checkbox/Checkbox.tsx` | SplashScreen TermsAndAgreementModal | `features/auth/presentation/terms_and_agreement_modal.dart` `_TermsCheckbox` | PRESENT | |
| SessionChecklist | `Checklist/SessionChecklist.tsx` | SimulationAssistantScreen | `features/roleplay/presentation/checklist_panel.dart` | PRESENT | Restyled in the parity/feedback merge. |
| ChipGroup / Chip | `ChipGroup/*.tsx` | FeedbackPopup (rating tags + FEEDBACK_ISSUE_OPTIONS chips) | `feedback_popup.dart:172` issue chips (`feedbackIssueOptions`); call summary passes `showChips: true` (`call_summary_screen.dart:706`) | PRESENT | v2: call summary now uses the shared `FeedbackPopup`. |
| CircularProgress | `CircularProgress/CircularProgress.tsx` | LevelIndicator, CourseItemPlayer, CourseOverview, CourseProgress, SimulationsScreen | `simulations/presentation/widgets/circular_progress.dart` (used by `course_detail_screen.dart`, `simulations_screen.dart`) | PRESENT | LevelIndicator and course-progress rings use Material `CircularProgressIndicator` (no 1200 ms ease-out animation). |
| CommentBottomSheetFooter | `CommentBottomSheetFooter/*.tsx` (via `hooks/useStableFooterRenderer`) | Comment/Reply/Threads sheets | `review_widgets.dart:755` `CommentFooterInput` | PRESENT | |
| CommentInput | `CommentInput/CommentInput.tsx` | ReviewDetails (after text selection) | `review_comment_sheets.dart:886` `_CommentInputSheet` | PRESENT | |
| CommentThreadBottomSheet | `CommentThreadBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:684` `_CommentThreadPage` | PRESENT | |
| CommentableText (iOS / Android) | `CommentableText/IosCommentableText.tsx`, `AndroidCommentableText.tsx` (native selection + "Add comment" menu, highlight ranges) | Conversation | `review_conversation.dart:53` `TranscriptMessageRow` (SelectableText + `_AddCommentMenu` :204, one implementation for both platforms) | PRESENT | |
| ConfirmationModal | `ConfirmationModal/ConfirmationModal.tsx` | Comment/Reply/Threads sheets, CallSummary (archive), ReviewDetails | `core/widgets/confirmation_modal.dart` (call_summary, profile_settings, review_details_parts, review_comment_sheets, discussion_post_tile) | PRESENT | |
| Conversation | `Conversation/Conversation.tsx` | ReviewDetails | `review_details_screen.dart` + `review_conversation.dart` | PRESENT | |
| CustomLineChart | `CustomLineChart/CustomLineChart.tsx` | none (exported only) | — | N/A | Dead in RN. |
| CustomModal | `CustomModal/CustomModal.tsx` (title, optional input, primary/secondary buttons) | CallSummary DeleteRenameModal (rename + delete), ProfileSettings (unsaved changes) | `features/calllog/presentation/call_summary_menu.dart:148` `CallSummaryTextModal` (rename + delete); ProfileSettings → `ConfirmationModal.show` | PRESENT | Delete is wired (`call_summary_actions.dart:98`) though, as in RN, the menu never opens it. |
| CustomSwitch | `CustomSwitch/CustomSwitch.tsx` (32x18 pill) | InteractionsBar/ReviewTranscriptHeader, CallSummary, ProfileSettings, SimulationFeedback | `profile_settings_screen.dart` `RnCustomSwitch` (also used by simulation_feedback_screen); Material `Switch` themed to RN colours (`app_theme.dart switchTheme`) in call_summary and review_details; branch `ReviewSwitch` | PRESENT | Material Switch is larger than the 32x18 RN pill (cosmetic). |
| CustomTabs | `CustomTabs/CustomTabs.tsx` (scrollable underline tabs, light/dark scheme) | SearchScreen, ListeningScreen resource search | Dark: `features/scribe/presentation/scribe_reference_search.dart:307`; Search tab: `search_screen.dart:300` `ChoiceChip` row | PARTIAL | v2: dark Listening variant ported (cd51b4d). Search tab still shows pill chips instead of RN's scrollable underline tabs. |
| DiscussionPost | `DiscussionPost/DiscussionPost.tsx` | DiscussionThread | `courses/presentation/discussion/discussion_post_tile.dart` | PRESENT | |
| DiscussionThread | `DiscussionThread/DiscussionThread.tsx` | CourseItemPlayer | `courses/presentation/discussion/discussion_thread.dart` | PRESENT | |
| Dropdown (CustomDropdown) | `Dropdown/Dropdown.tsx` | ReviewScreen sort, Leaderboard period, SimulationDetails language, SimPath modal language, RoleplayCasePlayer language, SimulationTranscript translation language, CallSummary custom fields, fieldRenderer | `core/widgets/custom_dropdown.dart` (review sort, leaderboard, transcript translation `simulation_transcript_tab.dart:547`); `scenario_language_dropdown.dart`; call summary custom fields `DropdownButtonFormField` (`call_summary_screen.dart:1554,1700,1718`) | PARTIAL | v2: translation-language dropdown landed (bc9381b). Remaining: call-summary custom-field dropdowns use Material `DropdownButtonFormField` styling, not RN CustomDropdown (cosmetic). |
| DropdownMenu | `DropdownMenu/DropdownMenu.tsx` | only `SummaryDropdown` / `FeedbackDropdown`, which are exported but never rendered | — | N/A | Dead in RN. |
| EmojiPicker | `EmojiPicker/EmojiPicker.tsx` (pill of platform emoji above icon; ADD/UPDATE/REMOVE) | ReviewComment, InteractionsBar | `review_widgets.dart:135` `ReviewEmojiPicker` (ADD/UPDATE/REMOVE) | PRESENT | |
| EmptyState | `EmptyState/EmptyState.tsx` | CallLog, CaseDetails, CourseOverview, CourseProgress, ReviewScreen, SimPathDetails, SuspendedAccount, UserAnalytics | `core/widgets/app_empty_state.dart` | PRESENT | ReviewScreen now uses it (`review_screen.dart:94,325`). |
| EmptyTranscript | `EmptyTranscript/EmptyTranscript.tsx` (icon + `transcription.empty`) | CallSummary transcript, SimulationFeedback transcript | `simulation_transcript_tab.dart` `_EmptyTranscript`; `features/calllog/presentation/call_transcript_tab.dart:114` `_EmptyTranscript` (`emptyTranscript.svg`) | PRESENT | |
| ErrorBoundary | `ErrorBoundary/ErrorBoundary.tsx` (crashlytics.recordError + "Something went wrong" + Try again reset) | App.tsx root | `core/errors/error_boundary.dart` `AppErrorBoundary` (`main.dart:128`) + `core/errors/crash_reporting.dart` (`ErrorWidget.builder`, `FlutterError.onError` → `recordError`) | PRESENT | Crashlytics no-ops until Firebase native config (GoogleService-Info.plist / google-services.json) ships — credential item, see §10. |
| FeedbackPopup | `FeedbackPopup/FeedbackPopup.tsx` | CallSummary, SimulationFeedback | `feedback_popup.dart` (SimFeedback + CallSummary `call_summary_screen.dart:702`) | PRESENT | |
| ForceUpdateModal | `ForceUpdateModal/ForceUpdateModal.tsx` + `hooks/useForceUpdate` (`appConfigApi.getForceUpdateConfig.minimumSupportedVersion` vs app version) | SplashScreen | `core/app_update/force_update.dart` (`/app-version/{ios,android}` `minimumSupportedVersion`) + `force_update_modal.dart` `ForceUpdateGate` (`main.dart:132`, `forceUpdateAlert.svg`) | PRESENT | v2: 0885d07. Store URLs depend on final bundle id (product decision). |
| IllustratedActionModal | `IllustratedActionModal/*.tsx` | SimulationDetails (ActiveSimulationModal), SimulationAssistant (EndingSoonModal) | `start_simulation/start_simulation_modals.dart` `ActiveSimulationModal`; `roleplay_voice_screen.dart` ending-soon state (`_showEndingSoon`) | PRESENT | |
| IllustratedModal | `IllustratedModal/IllustratedModal.tsx` | CaseDetails/SimPath (no credits), Listening end-call, Logout, SimAssistant end, SimDetails | `core/widgets/illustrated_modal.dart` (drawer logout, call_log start, scribe end confirmation); `LowCreditsModal` in start_simulation_modals; roleplay `_ConfirmOverlay` | PRESENT | |
| InfoTooltip | `InfoTooltip/InfoTooltip.tsx` | TabScreenHeader, Achievements, SimulationFeedback | `core/widgets/info_tooltip_icon.dart` (Material Tooltip, tap trigger) | PRESENT | Bubble styling differs from RN's walkthrough tooltip. |
| LanguageSelectorSheet | `LanguageSelectorSheet/*.tsx` | ProfileSettings | `account/presentation/language_selector_sheet.dart` | PRESENT | |
| LearningPathHeader / LearningPathListHeader / ProgressBar | `LearningPathDetails/*.tsx` | CaseDetails, CourseOverview, CourseProgress, SimPathDetails | `simulations/presentation/widgets/learning_path_widgets.dart` (`LearningPathHeader`, `LearningPathProgressBar`, list header); `learning_path_detail_view.dart` | PRESENT | |
| LevelIndicator | `LevelIndicator/LevelIndicator.tsx` | ProgressHeaderWidget, ProgressScreen | `core/widgets/level_indicator.dart` | PRESENT | Uses `CircularProgressIndicator` (no animation). |
| LineTextInput | `LineTextInput/LineTextInput.tsx` | CallLog, ShareForReview | `core/widgets/app_chat_input.dart` (send-button mode), `app_text_field.dart`, share screen TextField | PRESENT | |
| CallLogSkeleton | `LoadingSkeleton/CallLogSkeleton.tsx` | CallLog | `calllog/presentation/call_log_screen.dart` `_CallLogSkeleton` | PRESENT | |
| SimulationsSkeleton | `LoadingSkeleton/SimulationsSkeleton.tsx` | SimulationsScreen | `simulations/presentation/widgets/simulations_skeleton.dart` | PRESENT | |
| Message | `Message/Message.tsx` (timestamp + body row) | Conversation | `review_conversation.dart:53` `TranscriptMessageRow`; `simulation_transcript_tab.dart` `TranscriptItem` | PRESENT | |
| MessageThreadsBottomSheet | `MessageThreadsBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:640` `_MessageThreadsPage` | PRESENT | |
| NetworkImage | `NetworkImage/NetworkImage.tsx` (SvgUri → fetch+SvgXml fallback, spinner, error state) | BadgePopup, AchievementsScreen | `badge_popup.dart:312` `_BadgeImage` (SVG via flutter_svg, else bitmap); `achievements_screen.dart:271` `Image.network` | PARTIAL | BadgePopup handles SVG; the Achievements list still uses `Image.network` with no SVG support (SVG badge art renders blank) and no loading spinner. |
| NetworkLogs | `NetworkLogs/NetworkLogs.tsx` (draggable "Logs" bubble + react-native-network-logger) | App.tsx, gated `env.ENVIRONMENT === 'development'` | — | N/A | Dev-only tool. |
| NotificationModal | `NotificationModal/NotificationModal.tsx` | CaseDetails, SimDetails, SimPathDetails (pre-start) | `start_simulation_modals.dart` `PreStartNotificationModal` | PRESENT | |
| PostInput | `PostInput/PostInput.tsx` | DiscussionPost, DiscussionThread | `courses/presentation/discussion/discussion_post_input.dart` | PRESENT | Hard-caps at maxLength instead of showing RN's red over-limit state (documented). |
| PrivacyTooltip | `PrivacyTooltip/PrivacyTooltip.tsx` | Microphone + Conference ListeningScreen (data-safe bullets), CallSummary AddNotesSection (`summaryLoading.notesTooltip`) | `features/scribe/presentation/listening_chrome.dart:140` `showPrivacyTooltip` (anchored bubble; Scribe + Conference); `summary_generation_progress.dart:393` `summaryLoading.notesTooltip` | PRESENT | v2: d4ae9eb, 98ba567. |
| ProgressHeaderWidget | `ProgressHeaderWidget/*.tsx` | TabScreenHeader | `progress/presentation/progress_header_widget.dart` | PRESENT | |
| ReplyBottomSheet | `ReplyBottomSheet/ReplyBottomSheet.tsx` | ReviewDetails | `review_comment_sheets.dart:759` `_ReplyPage` | PRESENT | |
| ResourceArticleCard | `ResourceArticleCard/*.tsx` (category, tag chips, heading, 3-line content with View more/less, light/dark) | SearchScreen, ListeningScreen resource search (dark) | Dark: `scribe_reference_search.dart:441` `DarkResourceArticleCard` (tags, 3-line View more); light: `search_screen.dart:372` `ListTile` | PARTIAL | v2: dark in-call variant ported. Search tab results are still a `ListTile` (2-line content, category chip): no tag chips, no View more/less. |
| ReviewComment | `ReviewComment/ReviewComment.tsx` | All comment sheets, ReviewDetails general comments, ReviewScreen ExpandedComments | `review_widgets.dart:318` `ReviewCommentTile` / `:561` `ControlledCommentTile` | PRESENT | |
| ReviewTranscriptHeader | `ReviewTranscriptDetails/ReviewTranscriptHeader.tsx` | ReviewDetails | `review_details_parts.dart:23` | PRESENT | |
| InteractionsBar | `ReviewTranscriptDetails/InteractionsBar.tsx` | ReviewDetails | `review_details_parts.dart:519` | PRESENT | |
| ReviewTypeChip | `ReviewTypeChip/ReviewTypeChip.tsx` | ReviewTranscriptHeader, SimulationDetailsCard | `core/widgets/review_type_chip.dart` | PRESENT | |
| RichText | `RichText/RichText.tsx` | LearningPathDetails, CourseItemPlayer, SimulationAssistant, SimulationDetails | `core/widgets/html_rich_text.dart` `HtmlRichText` | PRESENT | |
| SearchableLocationDropdown | `SearchableLocationDropdown/*.tsx` (placesApi paged + search) | `utils/fieldRenderer.tsx` FieldType.SearchableDropdown (CallSummary location/custom fields), VoiceNoteSection | `features/calllog/presentation/searchable_location_dropdown.dart` + `data/places_repository.dart`, used at `call_summary_screen.dart:1538` | PRESENT | v2: 98ba567 / 9d4807b. |
| SessionRatingTrigger | `SessionRatingTrigger/*.tsx` | SimulationFeedback header | `simulations/presentation/widgets/feedback/feedback_widgets.dart` `SessionRatingTrigger` | PRESENT | Merged from parity/feedback. |
| ShinyText | `ShinyText/ShinyText.tsx` (shimmer sweep) | CallSummary SummaryGenerationProgress step label | `features/calllog/presentation/summary_generation_progress.dart:258` `ShinyText` (cycling steps :192) | PRESENT | |
| SimulationCard | `SimulationCard/SimulationCard.tsx` | CourseItemPlayer, SimulationsScreen | `simulations/presentation/widgets/simulation_card.dart` | PRESENT | |
| SimulationDetailsCard / SimulationDetailRow | `SimulationDetailsCard/*.tsx` | ReviewScreen card, ShareForReview | `reviews/presentation/simulation_details_card.dart` + `ReviewDetailRow` :155 | PARTIAL | View-more overflow measurement now matches RN (:84-90). Remaining: cover video not played (`:43` TODO) — VideoPreview gap. |
| SimulationTransitionSection / UpNextSimulationCard | `SimulationTransitionSection/*.tsx` | none (exported only; SimFeedback has its own UpNextSimulationCard) | — | N/A | Dead in RN. |
| StarRating | `StarRating/StarRating.tsx` | FeedbackPopup | `feedback_widgets.dart` `StarRatingRow`; `_SummaryFeedbackPopup` stars | PRESENT | |
| TabScreenHeader | `TabScreenHeader/TabScreenHeader.tsx` | CallLog, Leaderboard, Progress, Review, Search, Simulations, UserAnalytics | `core/widgets/tab_screen_header.dart` | PRESENT | |
| TabView | `TabView/TabView.tsx` (pill tabs; `tabWidthMode` equal/content) | ThreadsBottomSheet, Achievements, CallLog, CallSummary, Review, SimFeedback, Simulations, UserAnalytics | `core/widgets/app_tab_view.dart` `AppTabView` (+ `learn_tab_view.dart`); branch `_ContentWidthTabs` | PRESENT | Content-width mode exists for reviews (`review_screen.dart:358`). CallSummary uses its own tab bar. |
| ThreadsBottomSheet / GeneralCommentsList | `ThreadsBottomSheet/*.tsx` | ReviewDetails | `review_comment_sheets.dart:316` `_ThreadsPage` + `:479` `_GeneralList` | PRESENT | |
| Toast / ToastProvider / useToast | `Toast/*.tsx` (success/error styled, top/bottom, auto-hide) | App root; ~15 screens | Material `SnackBar` via `core/widgets/root_scaffold_messenger.dart` (e.g. `call_summary_actions.dart:11`) | PARTIAL | No success/error visual variants or top position. The earlier "missing toast" flows (share) are fixed. |
| UserProfileImage | `UserProfileImage/UserProfileImage.tsx` (image or initial, border, fallback icon) | ReviewComment, ReviewTranscriptHeader, LogoutScreen, ReviewDetails, ReviewScreen | `review_widgets.dart:23` `ReviewUserAvatar` (image or initial, 1pt border) | PRESENT | Used in reviews; other call sites (drawer) keep their own avatar. |
| VideoPreview | `VideoPreview/VideoPreview.tsx` | SimulationDetailsCard, SimulationDetailsScreen, SimulationPathDetailsScreen | `core/widgets/cover_video_preview.dart` (`simulation_details_screen.dart:178`, `simulation_details_modal.dart:243`) | PARTIAL | Not wired into `SimulationDetailsCard` (review cards, share screen) or the review header's scenario dialog (A2.5, A3.4). |

Not a component: `components/shared/commentBottomSheetStyles.ts` (a style sheet), so it has no row.

---

### Top gaps by user impact

All v1 top gaps for this area (transcript, pagination, focus refresh, ForceUpdate, ErrorBoundary, BadgePopup, reactions, general comments, share flow, places picker) are closed on master. What remains:

1. **Cover video is never played in review/share cards or the review header's scenario dialog** (A2.5, A3.4, VideoPreview, SimulationDetailsCard). `CoverVideoPreview` exists; it needs wiring into `simulation_details_card.dart:43` and `review_details_parts.dart:142`.
2. **The share screen never gets the scenario cover or description** (A4.3, A3.10). `ShareForReviewArgs` (`app_router.dart:50`) lacks the fields, though the screen accepts them.
3. **An edited review note stays stale on Review details** until the screen is reopened, and details don't refetch on app foreground or reconnect (A3.2).
4. **Achievements list renders SVG badge art blank** (NetworkImage). It uses `Image.network`, while BadgePopup already has an SVG-aware `_BadgeImage` that could be shared.
5. **Search tab cards and tabs are still Material** (ResourceArticleCard, CustomTabs). There are no tag chips and no View more/less, and pill chips replace underline tabs. The dark in-call variant is done.
6. **Toasts have no success/error styling or top position** (Toast).
7. **Cosmetic:** the call-summary custom-field dropdowns use Material styling (Dropdown), and the emoji picker has no search or recents (A4.4, scoped by design).

Icon substitutes in this slice: `core/widgets/info_tooltip_icon.dart:22` renders `Icons.info_outline` where RN renders `InfoIcon` (`assets/icons/info.svg`, which Flutter already ships) in TabScreenHeader (CallLog, Leaderboard, Progress, Review, Search, Simulations, UserAnalytics) and AchievementsScreen (`achievements_screen.dart:115,218`). `core/widgets/app_chat_input.dart:46` `Icons.send` has no callers on master (dead widget). The review and comment widgets use RN SVGs throughout.

---

## §4 Hooks, app shell, services, utils (and §6 Store)

This part covers §4 (Section A: hooks), §4b (Section B: app shell) and §6 (Section C: store).

### Parity ledger part: hooks, app shell, store

RN source: `ally-platform/ally-mobile/src` at `7a8ce0c19` · Flutter: `ally-mobile-flutter/lib` on `master` at `227db3a` (v2 re-audit, 2026-10-28). Every v1 PARTIAL/MISSING/MERGED row was re-read on master; rows changed in v2 say so in Notes. All branches are merged; there are no MERGED rows left.

Flutter paths below are relative to `lib/`.

#### Tallies

| Section | Rows | PRESENT | PARTIAL | MISSING | MERGED (was IN PROGRESS) | N/A |
|---|---|---|---|---|---|---|
| A. Hooks | 53 | 43 | 2 | 0 | 0 | 8 |
| B. App shell / services / utils | 62 | 48 | 4 | 5 | 0 | 5 |
| C. Store | 28 | 24 | 2 | 0 | 0 | 2 |
| **Total** | **143** | **115** | **8** | **5** | **0** | **15** |

v1 totals were 75 / 26 / 24 / 3 / 15.

Status key:
- **PRESENT**: the same behaviour exists, possibly built a different way.
- **PARTIAL**: some of the behaviour exists.
- **MISSING**: nothing equivalent exists. Every MISSING row was checked by reading the Flutter files and searching `lib/` under several names, not by one failed grep.
- **N/A**: dead code in RN, an RN-only wrapper, or dev-only.

---

#### Section A — Hooks (`src/hooks/`)

| Hook | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| useAppNavigation | Typed `useNavigation` for the native stack. | go_router `context.push/go` | N/A | Navigation wrapper only. |
| useAppleLogin | Apple sign-in requests email and full name, then POSTs `/auth/apple` with identityToken, authorizationCode and fullName. A suspended account (403 `USER_SUSPENDED`) is sent to SuspendedAccount. A cancel does nothing; any other error shows a toast. | `features/auth/presentation/login_screen.dart` (`_signInWithApple`), `features/auth/data/auth_repository.dart` (`loginWithApple`) | PRESENT | Cancel, suspended and toast handling are all mirrored. It won't complete for real until an Apple Developer setup exists for the Flutter bundle id. |
| useBadgePopup | Polls `GET /badges/me?viewedStatus=UNVIEWED` every 60s, only while the screen is focused and the user has `VIEW_USER_BADGES`; also refetches on focus and reconnect. Badges are queued: the first shows after 1s, auto-closes after 5s, then the next follows 350ms later. Closing calls `PATCH /badges/me/:id/viewed`. Mounted on SimulationsScreen, and on ReviewScreen for reviewer-only users. | `features/achievements/presentation/badge_popup.dart` (`BadgePopupHost`), hosted in `core/navigation/app_shell_screen.dart:52` | PRESENT | v2: ported (`a5d3ce7`, `557dc55`): 60s poll while the Learn tab (or Review tab for reviewer-only users) is showing, queue with 1s/5s/350ms timings, confetti, `PATCH /badges/me/:id/viewed` on close. Android back closes it first. |
| useBugReport | Validates description length, then `POST /bug-reports` with context (screen, appVersion, device, os, clientTimestamp). A 429 shows a rate-limit toast; success shows a toast and clears the field. | `features/bugreport/presentation/bug_report_screen.dart`, `features/bugreport/data/bug_report_repository.dart` | PRESENT | Handles 429 (`_httpTooManyRequests`). |
| useCallSummaryActions | Rename (`updateCallInfo`, then toast). Export: storage permission, `GET` export, save `.txt` to Documents/CallSummary (iOS) or Downloads (Android). Archive/unarchive with modal and toast. Delete (`summary: {}`, then `goBack` after 2s). Summary feedback POST. `handleGoBack` resets to CallLog and clears currentChat outside the log flow. | `features/calllog/presentation/call_summary_actions.dart`, `call_log_repository.dart:612-636`, `data/summary_file_export.dart` | PRESENT | v2: export (permission → `GET /chats/:id/export-summary` → `saveFile`) and delete (`PUT call-details {summary:{}}`, back after 2s) landed in `98ba567`/`9d4807b`. |
| useCallSummaryForm | Keeps a form baseline shared in the store. Reseeds on every summary refetch while keeping unsaved edits. Seeds manual notes with empty values. Saves only changed keys. Marks clean only the keys actually written, so an edit made during the save stays dirty. Section reset restores the server values. | `features/calllog/data/summary_form_state.dart`, `call_summary_screen.dart` | PRESENT | v2 (`0de134b`): `SummaryFormState.markSaved` only advances the baseline to the sent values, so in-flight edits stay dirty; a refetch of the same chat reseeds untouched fields. |
| useCallTranscriptDetails | Pages `/chats/:id/messages` with limit 20 and an offset. Sorts by `createdAt` for WEBRTC, otherwise `startSeconds` ASC. Timestamps are relative to the start. Infinite scroll. | `call_log_repository.dart:759-774` | PRESENT | v2 (`118522d`): limit 20 + offset paging, `sortOrder: ASC`, `sortBy` per provider. |
| useCommentActions | Comment CRUD with local optimistic patching: add (prepend), edit, delete with confirm, hide/unhide, emoji reaction add/update/remove count maths. Dismisses the keyboard; `onCommentsChanged` fires for parents. | `features/reviews/presentation/comment_list_controller.dart` | PRESENT | Re-read on master: `CommentListController` (add/edit/delete/hide/reactions, edit window). |
| useCounselorChat | When authenticated with `VIEW_COUNSELOR_CHAT`: `GET /chats/counsellor-chat`. On an active chat it sets currentChat and fires a callback; otherwise it clears currentChat unless the user is on Breathing, CallSummary or Listening. Re-checks on AppState background→active. Guards against concurrent checks. | `core/chat/active_chat_discovery.dart` (`checkForActiveChat`), `main.dart` (`didChangeAppLifecycleState`, auth listener) | PRESENT | No in-flight guard, so concurrent calls are possible (low risk). |
| useDebounce | Debounced callback, leading or trailing. | `Timer` used inline where needed | N/A | |
| useDrawerNavigation | Typed drawer navigation. | `core/navigation/drawer_menu_button.dart` (`DrawerMenuScope`) | N/A | |
| useForceUpdate | `GET /app-version/{ios,android}` returns `minimumSupportedVersion`, compared by semver against the app version. Splash shows a blocking ForceUpdateModal whose button opens the store, and navigation is held back. | `core/app_update/force_update.dart`, `force_update_modal.dart:22` (`ForceUpdateGate` in `main.dart` builder) | PRESENT | v2 (`0885d07`): `GET /app-version/{ios,android}`, RN `isVersionLower`, blocking modal over the whole app with store button. Store URLs are the RN app's listings (see release identity). |
| useGoogleLogin | `GoogleSignin.configure`, `hasPlayServices`, `signOut` before `signIn`, then POST `/auth/google` with the idToken. Suspended goes to SuspendedAccount; cancel and in-progress are silent; Play Services and other errors show a toast. | `login_screen.dart` (`_signInWithGoogle`, `GoogleSignIn.instance.initialize`) | PRESENT | Same signOut-first pattern. Needs a client id configured. |
| useHardwareBackPressHandler | Android back calls a custom callback, else `goBack`, else the system default. | `PopScope` in call_summary, box_breathing, login (OTP→email), celebration_modal, simulation_feedback, profile_settings, scribe_recording, roleplay_voice, start_simulation_modals, simulation_details_modal | PRESENT | Implemented per screen. |
| useHideReviewDetails | For a private review, fetch threads (limit 1), then reaction counts; hide the review section if both are empty. | `simulation_feedback_screen.dart` (`_hideReviewDetails`), `call_summary_screen.dart` | PRESENT | |
| useIsEvaluator | `EVALUATOR_ACCESS` permission check. | — | N/A | **Unused in RN**: no caller outside `hooks/index.ts`. |
| useKeyboardState | Keyboard show/hide listener (used by SearchableLocationDropdown). | `MediaQuery.viewInsets` | N/A | |
| useLanguageDropdown | Language options and map from `/languages?active&hasVoices` plus preferences. | — | N/A | **Unused in RN** (exported only). Preferences have their own Flutter port. |
| useLeaderboard | `GET /community/leaderboard?window&limit=50&offset`, deduped by userId, infinite scroll. `GET /community/leaderboard/my-rank`, refetched on focus. Flags the current user; window change resets the offset. | `features/leaderboard/data/leaderboard_repository.dart` (`LeaderboardController`, `myRankProvider`), `leaderboard_screen.dart` | PRESENT | |
| useLeaderboardNotification | Toggle stored under AsyncStorage `LEADERBOARD_NOTIFICATION_ENABLED` (default ON); schedules or cancels the weekly Notifee trigger. | `core/push/leaderboard_notification.dart` (`leaderboardNotificationEnabledProvider`), `profile_settings_screen.dart:496` | PRESENT | Same key name, in SharedPreferences. |
| useLearningPathDetails | Track or case details query, create a path or case session, look up the scenario session for an item, pull to refresh. | `simulations_repository.dart` (`createPathSession`, `createCaseSession`, `/learn/scenario-session/scenario-path-session-item/:id`, `/case-session-item/:id`), `simulation_path_details_screen.dart`, `case_details_screen.dart`, `learning_path_detail_view.dart` | PRESENT | |
| useListeningScreen | Derives isWebMicrophoneMode and isConferenceCall, the privacy tooltip list (noRecording / encrypted / noTrainingData / personalInfoRemoved), the tooltip insets and the start time. | `features/scribe/presentation/listening_chrome.dart:96-140` (`showPrivacyTooltip`) | PRESENT | v2 (`d4ae9eb`): privacy tooltip (`audioCall.privacy.*`) on both listening screens. |
| useLiveAudioStream | Mic permission check/request. A start request is held until init finishes (avoids a native crash). Streams 16kHz mono PCM base64. Permission denied: settings alert, and cancel goes back. Re-checks permission when the app returns to the foreground. Stops on unmount. | `scribe_recording_screen.dart:229-299`, `core/realtime/microphone_permission.dart` (`showPermissionSettingsAlert`) | PRESENT | v2: blocked mic shows the Cancel/Open-Settings alert; permission re-checked on foreground (`didChangeAppLifecycleState`). |
| useNavigationAwareCounselorChat | Tracks the current route. An active chat from Splash resets to [CallLog, Listening]; from Listening it does nothing; otherwise it navigates to Listening. Always subscribed to AppState. | `active_chat_discovery.dart` (`targetRouteForActiveChat`, `isListeningRoute`) | PRESENT | Uses `router.go` (replaces the stack) instead of reset/navigate; documented. |
| useNetworkConnectivity | NetInfo subscription: `isConnected` / `isInternetReachable` / `isOffline`. Drives NetworkDisconnected (network vs socket copy, Try-again hidden while offline) on the Listening screens. | `core/realtime/connectivity.dart:13` (`isOfflineProvider`), `network_disconnected.dart:43`, `scribe_recording_screen.dart:159` | PRESENT | v2 (`d4ae9eb`): `connectivity_plus` stream; NetworkDisconnected picks network vs socket copy from it. |
| usePaginatedComments | Comment pagination, 20 per page, append/reset, `hasMore`. | `features/reviews/presentation/comment_list_controller.dart` (`fetchPage(offset, limit)`) | PRESENT | Re-read on master. |
| usePermissionAlert | Alert with Cancel and "Open settings" (`openSettings()`); preset microphone variant. | `core/realtime/microphone_permission.dart:20-56`, `call_log_screen.dart:233` | PRESENT | v2: shared Cupertino alert with Open Settings; used by Scribe and start-simulation (roleplay now never starts without mic, so no alert is needed there). |
| useProfileImage | Image library (jpeg/png, 0.8 quality, 800px); rejects over 2MB or non-square. Save: presigned URL → PUT to S3 → PATCH `/users/profile-image` → delete the old image best-effort. Remove: delete + PATCH empty. | `features/account/presentation/profile_settings_screen.dart` (`_maxProfileImageBytes`, square check), `account_repository.dart` (`/users/profile-image-url`, PATCH `/users/profile-image`, delete) | PRESENT | |
| useProgressSummary | Two gates: the `VIEW_USER_RANK` permission and `GET progress-enabled`. Then the summary query, shared through one cache entry. | `features/progress/data/progress_repository.dart` (`progressEnabledProvider`, `viewUserRank` gate), `progress_header_widget.dart` | PRESENT | |
| useReactions | Reaction counts summary (emoji map, sorted), paged list (20) filtered by reaction, refresh. Swaps between simulation and scribe APIs via ReviewApiContext. | `features/reactions/presentation/reactions_screen.dart`, `reactions_repository.dart` | PRESENT | |
| useReviews | Reviews list: readFilter and sort, LIMIT 10 with offset paging, reset on filter change. | `features/reviews/data/reviews_repository.dart:20-33` | PRESENT | Re-read on master: limit 10, offset paging, `order: DESC`, readFilter/sort. |
| useScribeNoteCreationEnabled | `GET /settings/scribe-note-creation-enabled`, skipped unless `COUNSELOR_ACCESS` (otherwise 403). | `core/settings/settings_repository.dart` `scribeNoteCreationEnabledProvider`; `call_log_screen.dart:273` watches it only when `isCounselor` | PRESENT | |
| useScribeVoiceNoteEnabled | `GET /settings/scribe-voice-note-enabled`, gated by counsellor permission. | `settings_repository.dart:113`, `voice_note_section.dart:249` | PRESENT | v2 spot-check: `voice_note_section.dart:247-251` still watches the provider before the `isCounselor` short-circuit, so a non-counsellor that reaches the section fires one 403. Display is gated; cosmetic. Counted PRESENT. |
| useSearch | `searchDocuments` (PAGE_SIZE, category filter); `excludedIds` pagination; category counts; 250ms debounced suggestion filter; suggestion tap. | `features/search/data/search_repository.dart` (`excludedIds`, `categories`), `search_screen.dart` | PRESENT | |
| useShareScreenLogic | Share or edit-note: max 250 chars, emoji appended, create review or update status. Toast; on a server message, toast then go back. | `features/reviews/presentation/share_for_review_screen.dart` (`_maxNoteLength = 250`, `EmojiInsertPicker`, `isEditNote`) | PRESENT | Reworked again on `parity/reviews` (UI fidelity). |
| useSimulationCredits | Fetches `/simulation-credits` on every mounting screen when the user has `EDIT_SCENARIO_SESSION`, otherwise clears. Stores in the credits slice. `refreshCredits`, usage %, low-credit flag. | `simulations_repository.dart:120-131, 206-207` | PRESENT | v2 (`8e6ad33`): `endScenarioSession` emits the credits tag → `ref.invalidate(simulationCreditsProvider)`. |
| useSimulationSessionRecordingUrl | `GET` session recording presigned URL (2 attempts; a 404 means missing). `refreshFromPlaybackError` with a 4s cooldown for expired URLs. Feeds the TranscriptTab audio player. | `simulation_transcript_repository.dart:81-88`, `simulation_transcript_tab.dart:34` | PRESENT | v2 (`bc9381b`): `GET …/recording` presigned URL feeding the feedback-transcript player. |
| useSimulationTranscriptDetails | Pages `/learn/scenario-session/:id/messages` (limit 10, startSeconds ASC, **languageCode**) with a paging lock, id dedupe and MM:SS formatting. | `simulation_transcript_repository.dart:52-65` | PRESENT | v2 (`bc9381b`): optional `languageCode` for the transcript-language dropdown; repoll on change. |
| useSimulationTransition | Polls upcoming path/case scenario (5s, 4 tries); retry or start the next simulation. | — | N/A | **Unused in RN** (only a comment in `languageCodeEndpoints.ts`). |
| useSocket | One socket per owner, idempotent `connect`, a generation stamp against stale connects, auth as a function (fresh token on each reconnect), 5 reconnects, 1–5s delay, 10s timeout, forceNew, retry after failure 2s, emit/on/off. | `core/realtime/socket_service.dart` | PRESENT | No generation stamp and no 2s retry after failure. Minor. |
| useSocketConnection | Connects on screen focus, disconnects on blur. AppState: background disconnects (unless `disconnectOnBackground=false`), foreground reconnects. | `scribe_recording_screen.dart:229-233`, `conference_listening_screen.dart:113-118`, `core/chat/cloud_telephony_listener.dart` | PRESENT | v2: Scribe reconnects on foreground (RN `disconnectOnBackground:false` for recording); Conference disconnects on pause and reconnects on resume; app-wide telephony socket exists (Section B). |
| useStableFooterRenderer | Bottom-sheet footer render-stability shim. | — | N/A | Specific to `@gorhom/bottom-sheet`. |
| useStartSimulation | Checks or requests mic permission **before** creating the session (blocked: settings alert; denied: toast). Creates the scenario session; navigates to the assistant with token, LiveKit URL, scenario and reminders. 429 shows a retry modal; an `entityId` body shows the active-simulation modal. | `start_simulation_controller.dart:178-202` | PRESENT | v2 (`497317a`): mic checked/requested before the session (and credit) is created; blocked → settings alert. |
| useStoragePermissions | Android below 33 needs `WRITE_EXTERNAL_STORAGE`; denied shows a toast and opens settings. | `features/calllog/data/summary_file_export.dart:28-34` | PRESENT | v2: Android ≤ 28 requests storage, else granted. |
| useSummaryState | Lazy summary fetch; holds the loader for 3s after the summary arrives; latches manual-note status; **debounced (1s) notes autosave `POST /chats/:id/notes` while the summary generates** (AddNotesSection); refresh; clears summary state on unmount. | `call_summary_screen.dart:777`, `summary_generation_progress.dart:303`, `call_log_repository.dart:636` | PRESENT | v2 (`98ba567`): notes typed during generation autosave via debounced `POST /chats/:id/notes`. |
| useTabBackToHomeHandler | On Search, Community, Progress and UserAnalytics tab roots, Android back jumps to the first visible tab instead of leaving the app. | `core/navigation/app_shell_screen.dart:150` | PRESENT | v2 (`557dc55`): `PopScope(canPop: currentIndex == 0)` sends back to the first visible tab (applies to every non-first tab, a superset of RN's four). |
| useTabScreenHeader | The hamburger shows only on the first visible tab and opens the drawer. | `core/navigation/app_shell_screen.dart` (`onOpenDrawer: i == 0`), `drawer_menu_button.dart`, `core/widgets/tab_screen_header.dart` | PRESENT | |
| useToggleReviewPrivacy | PATCH review status: `IN_REVIEW` when on, `HIDDEN` when off, then a toast. | `simulation_feedback_screen.dart:361`, `call_summary_screen.dart:317`, `review_details_screen.dart:108` | PRESENT | |
| useTrackPlayerNavigation | Flattens the track by sorted sections and items; current/prev/next; `canAdvance` (completed or just completed); overall %. | `features/courses/presentation/course_item_player_screen.dart` (`_flattenTrackItems`, `goNextOrOverview`) | PRESENT | |
| useTranslate | `t` (typed) and `tVariable`. | `core/localization/translate_ref.dart` (`ref.t`, `ref.tr`) | PRESENT | |
| useUser | `checkAuth`: with a token, fetch `/users/me` and permissions, then set user, permissions and authenticated; on any failure, logout. `handleUserLogout`: **unregister push token**, then `handleLogout`, then `resetApiState`. | `core/auth/auth_state.dart`, `features/account/data/account_repository.dart` `currentUserProvider`, `core/permissions/permissions_repository.dart` | PARTIAL | v2: logout now deregisters push (`auth_state.dart:72-76`). Remaining: launch restores auth from the stored token only; a non-401 `/users/me` failure does not log out (lenient divergence; product call whether to match RN). |
| useVideoWatchProgress | Counts unique watched seconds (a jump over 2s counts as a seek). Reports every 10s or on a +10% change; flushes on unmount. | `features/courses/data/video_watch_progress.dart` | PRESENT | Ported almost line for line. |
| useVoiceNoteRecorder | WAV dictation 16k mono, start/pause/resume/stop/reset, streamed to file. **Auto-stops at 24MB** (upload cap). Deletes the file on reset; releases the mic on unmount. | `features/calllog/presentation/voice_note_recorder.dart` (`record` `AudioEncoder.wav`) | PARTIAL | Unchanged: no 24MB (`MAX_RECORDING_BYTES`) auto-stop, so a long dictation can exceed the 25MB upload limit. `durationMs` from a ticker. |

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
| App.tsx / ErrorBoundary | Catches render errors, shows a fallback with a reset that remounts the navigator, `crashlytics().recordError`. | `core/errors/crash_reporting.dart:24-51`, `core/errors/error_boundary.dart` (`AppErrorBoundary` in `main.dart`) | PRESENT | v2 (`0885d07`): `FlutterError.onError` + `PlatformDispatcher.onError` → Crashlytics (no-op without Firebase), `ErrorWidget.builder` → app-wide fallback with "Try again" (router back to `/splash`). Reporting needs the Firebase config files. |
| App.tsx | NetworkLogs overlay in development. | — | N/A | Dev only. |
| localization/i18n.ts | Synchronous English init; restores the saved UI language (`ally:ui:language`); 5 languages. | `core/localization/localization_controller.dart` (`build`, SharedPreferences `ui_language`) | PRESENT | Different key names (`ui_language`, `i18n_version`). Only matters for migrating an existing install. |
| localization/dynamic.ts | Behind `LANGUAGE_SELECTOR_FLAG`: fetch the CDN manifest; apply the cached bundle first; re-fetch namespaces when the version moves; cache per (version, lang); refresh every 30s and on foreground; network failure falls back to cache. | `localization_controller.dart` (`refresh`, `_pollTimer`, `didChangeAppLifecycleState`) | PRESENT | |
| dynamic.ts | On `languageChanged`: refresh and apply **that language's** cached or fetched resource. | `localization_controller.dart:140-170` | PRESENT | v2 (`8e0a859`): reuses the cache only if it holds this language for the current version, else fetches. |
| LanguageSelectorSheet | `changeLanguage`, persist, `forceRTL`, `api.util.resetApiState()` so content re-fetches in the new language. | `core/network/api_client.dart:46-51` | PRESENT | v2: `apiClientProvider` invalidates itself on a real language switch, so every provider refetches (RN `resetApiState`). |
| services/api.ts | Injects `languageCode` (the active UI language) into the allowlisted content endpoints: scenarios, paths, cases, simulation details, checklist, skills, reviews, badges, leaderboard, endScenarioSession, learn tracks, enrollTrack. | `core/network/language_code_interceptor.dart:27-81`, added in `api_client.dart` | PRESENT | v2 (`249653c`): central interceptor with RN's endpoint allowlist (query for GET, body for mutations). |
| services/api.ts | `/api/v1` prefix, with `/api/v2` for generate-otp, verify-otp and learn/scenarios (exact match). | `core/network/auth_interceptor.dart`, `api_routes.dart` | PRESENT | |
| services/api.ts | Bearer token from storage on every request. | `auth_interceptor.dart` `onRequest` | PRESENT | |
| services/api.ts | 401 → refresh with the refresh token → store new tokens → retry. No tokens, or refresh fails, logs out. | `auth_interceptor.dart` (single-flight `_refreshFuture`) | PRESENT | Better than RN: concurrent 401s share one refresh. |
| services/api.ts | Unrecoverable 401 → `handleLogout` + `resetApiState` + `auth.sessionExpired` toast. | `auth_state.dart` `sessionExpired()` | PRESENT | |
| RootNavigator | Swaps stacks on `isAuthenticated` (authed: CallLog, Listening, …; unauthed: Splash, SuspendedAccount). | `core/routing/app_router.dart` `computeRedirect` + `_RouterRefreshListenable` | PRESENT | |
| Splash | `checkAuth()` on launch; holds the UI while loading. | `AuthController._restore` + `/splash` `_LaunchScreen` (`isRestored`) | PARTIAL | Unchanged: token-only restore, no `/users/me` validation at launch (see useUser). |
| Splash | Authenticated with `profileCompleted === false` → CompleteProfile. | `computeRedirect` (`profileCompleted` gate) | PRESENT | |
| Splash | Authenticated with `VIEW_COUNSELOR_CHAT` → `checkCounselorChat`: active goes to [CallLog, Listening], otherwise CallLog. | `main.dart` auth listener → `checkForActiveChat` | PRESENT | |
| Splash | Force-update modal blocks all post-login routing. | `core/app_update/force_update_modal.dart:22` | PRESENT | v2: `ForceUpdateGate` overlays every route (incl. login) and swallows touches. |
| Splash | Login: a suspended error routes to SuspendedAccount (unauth stack). | `login_screen.dart` `_isSuspendedUserError` → `/suspended`; `computeRedirect` `isSuspended` | PRESENT | |
| Splash | Hardware back on the OTP step returns to email. | `login_screen.dart` `PopScope` | PRESENT | |
| RootNavigator | On auth, `getSummaryFields()` loads the tenant's visible summary fields into the store (`setSummaryVisibleFields`), used by CallSummaryDetails, SectionWrapper and VoiceNoteSection. | `core/settings/settings_repository.dart:75-141`, `call_summary_fields.dart:533-541` | PRESENT | v2 (`0de134b`): `GET /settings/summary-fields` → `summaryVisibleFieldsProvider` (kept alive); filters sections and voice-note targets. |
| RootNavigator + utils/deeplink.ts | Universal links `https://{ALLY_WEB_URL host}/summary/:id` → reset to [CallLog, CallSummary(callId, fromLogs)], kept pending until authenticated and summary fields are loaded; suppresses the active-chat auto-route while a link is in progress. | none | MISSING | Unchanged: no `app_links`/`uni_links` dependency, no `/summary` link handler. Route `/call-log/:id` still needs an in-memory `CallLogItem` extra (§1 row 7). |
| RootNavigator + deeplink.ts | `/course/:uuid` → CourseOverview once past Splash and CompleteProfile; kept pending through login; dropped if on Listening; launch URL handled once. | none (`/courses/:trackId` exists but nothing routes a link to it) | MISSING | Unchanged. |
| Native link claims | AASA `paths` and an Android `autoVerify` intent-filter `pathPrefix` for /summary and /course. | none | MISSING | Unchanged: no https intent filter in AndroidManifest; no `.entitlements`/associated-domains on iOS. Needs Apple team signing + `assetlinks.json`/AASA on the web host. |
| RootNavigator | App-wide socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` → `checkCounselorChat` → auto-route to Listening (an incoming conference call is answered from the phone with no screen open). | `core/chat/cloud_telephony_listener.dart`, `main.dart` auth listener | PRESENT | v2 (`d4ae9eb`): own `SocketService`, started on sign-in in `main.dart`, `USER_JOINED` → `checkForActiveChat`; disconnect on pause / reconnect on resume; stopped on sign-out. |
| useCounselorChat via RootNavigator | Foreground re-check for an active chat. | `main.dart` `didChangeAppLifecycleState(resumed)` | PRESENT | |
| RootNavigator | Leaderboard reminder when authenticated and `VIEW_COMMUNITY_LEADERBOARD` and enabled (null means ON): create channel, request permission, schedule weekly (Mon 11:00 from env). | `core/push/leaderboard_notification.dart` (`leaderboardNotificationSyncProvider`, `zonedSchedule` `dayOfWeekAndTime`) | PRESENT | Flutter also cancels it on logout; RN doesn't. |
| RootNavigator + pushNotificationService | When authenticated: create the `reminders` channel, request notification permission, register the FCM token (`POST /notifications/device-tokens` with platform), re-register on `onTokenRefresh`, show foreground messages via Notifee. | `core/navigation/app_shell_screen.dart` initState → `PushNotificationService.initializeAndRegister` | PARTIAL | Code is a full port; blocked only on the Firebase config files (credentials, §10 row 22). Registration fires once `/home` mounts. |
| pushNotificationService | `unregisterDeviceForPush` on logout: `DELETE` device token, then `messaging().deleteToken()`. | `core/push/push_notification_service.dart:237-260`, called from `core/auth/auth_state.dart:75` | PRESENT | v2 (`98b9518`): `DELETE` device token then `deleteToken`, best-effort, before tokens are cleared; skipped on session expiry like RN. |
| pushNotificationService | `displayRemoteMessage`: data-only `{title, body}`, skipped when body is empty; `reminders` channel; tap goes to the default action. | `displayReminderNotification` | PRESENT | Unique id per notification, as in RN. |
| RootNavigator | Foreground notification tap: leaderboard id → jump to the Leaderboard **tab**; reminder → Simulations or Notifications. | `notification_navigation.dart:50`, `push_notification_service.dart:127`, `core/navigation/home_tab_navigation.dart` | PRESENT | v2: leaderboard reminder now selects the Leaderboard **tab** (`homeTabLocation` → `goToHomeTab`). `router.go` still replaces the stack. |
| RootNavigator | Killed-app initial notification (authenticated only): reminder routing; leaderboard routing deduped through `LEADERBOARD_NOTIF_HANDLED_TS` (scheduledAt); waits until off Splash. | `initializeLocalNotifications` → `getNotificationAppLaunchDetails` | PRESENT | No `HANDLED_TS` dedupe (low impact, since launch details only fire on a real launch). |
| utils/notificationNavigation | `isReminderNotification` (type `ENGAGEMENT_REMINDER`); `handleReminderNavigation` (`screen` hint is Simulations, otherwise Notifications). | `core/push/notification_navigation.dart` | PRESENT | |
| notificationService | `getNextScheduledNotificationTime` from env day, hour and minute; weekly trigger; cancel. | `leaderboard_notification.dart` `nextWeeklyOccurrence`, `cancel` | PRESENT | |
| TabNavigator | Tabs filtered by permission; ACHIEVEMENTS only for reviewer-only users; initial tab is `getFirstVisibleTab`; unread-review dot (sim plus scribe unread count); lazy tabs; nothing renders while user is loading. | `core/navigation/app_shell_screen.dart`, `tab_config.dart`, `app_bottom_tab_bar.dart`, `unreadReviewCountProvider` | PRESENT | Spot-check v2: badge popup host + back handling added. Still shows raw `'$error'` with no retry if permissions fail to load (`app_shell_screen.dart:81`). |
| DrawerNavigator | Drawer with logout confirmation, then `handleUserLogout`. | `core/navigation/app_drawer.dart` `_confirmLogout` | PRESENT | Logout misses push deregistration (row above). |
| utils/navigation.ts | `navigateToTab` / `navigateToLearnTab` / `navigateToCallLogTab` reset into a specific tab (used by path/case/course/feedback/CallSummary exits). | `core/navigation/home_tab_navigation.dart` (`goToHomeTab`) | PARTIAL | v2: `goToHomeTab` exists and CallSummary / Box breathing use it (`call_summary_screen.dart:487`, `box_breathing_screen.dart:191`). Remaining: SimulationFeedback (`simulation_feedback_screen.dart:250,260`), course "Back to Learn" (`course_item_player_screen.dart:290`) and Scribe exit (`scribe_recording_screen.dart:521`) still `go('/home')`, landing on whichever tab was last selected instead of Learn/CallLog. |
| RootNavigator | `gestureEnabled: false` on CallSummary, CourseItemPlayer, CompleteProfile, SimulationAssistant and SimulationFeedback. | `PopScope` on call_summary, roleplay_voice, simulation_feedback; router redirect pins complete-profile | PRESENT | |
| contexts/ReviewApiContext | Swaps every comment, thread and reaction hook between the simulation and scribe review APIs. | `ReviewType` parameter + `ScribeReviewsRepository` / `ScribeReactionsRepository` (`review_details_screen.dart`, `reactions_screen.dart`) | PRESENT | |
| Keep-awake (useListeningCommon, SimulationAssistantScreen) | `activateKeepAwake` while listening or recording and during a live roleplay; deactivated on exit. | `core/realtime/keep_awake.dart`; `scribe_recording_screen.dart:149`, `conference_listening_screen.dart:89`, `roleplay_voice_screen.dart:235` | PRESENT | v2 (`b82d84f`, `d4ae9eb`): `wakelock_plus` on Scribe, Conference and live role play; released on dispose. |
| utils/asyncStorage | JSON get/set/remove over AsyncStorage. | SharedPreferences, plus `core/network/token_storage.dart` (secure storage) | PRESENT | |
| AsyncStorageKeys.ACCESS_TOKEN / REFRESH_TOKEN | Token pair. | `token_storage.dart` (same key names, Keychain/Keystore) | PRESENT | |
| AsyncStorageKeys.LEARN_ACCESS_TOKEN | — | — | N/A | Never read or written in RN. |
| AsyncStorageKeys.LEADERBOARD_NOTIFICATION_ENABLED | Toggle. | `leaderboardNotificationPrefsKey` (same name) | PRESENT | |
| AsyncStorageKeys.LEADERBOARD_NOTIF_HANDLED_TS | Cold-start tap dedupe. | none | MISSING | Unchanged. Low impact. |
| AsyncStorageKeys.ACTIVE_TRACK_CONTEXT | Set when a course roleplay or game launches; CourseItemPlayer refetches the track on focus to pick up completion. | `course_item_player_screen.dart` `_refetchTrackOnReturn` (in memory, route-aware) | PRESENT | Doesn't survive an app kill (RN's does). |
| AsyncStorageKeys.UI_LANGUAGE / I18N_VERSION | UI language plus dynamic version cache. | `localization_controller.dart` (`ui_language`, `i18n_version`) | PRESENT | |
| AsyncStorageKeys.AUDIO_PLAYBACK_RATE | Remembers the feedback-screen audio speed. | `features/reviews/presentation/simulation_audio_player.dart` cycles the rate but **doesn't save it** | MISSING | v2: the feedback recording player now exists (`bc9381b`) but the chosen speed is still not persisted (no SharedPreferences key). Low impact. |
| utils/logger | Console output only in development. | `debugPrint` | N/A | |
| utils/error.ts | `getErrorDetails` (message, else error, else "somethingWentWrong"), `isBackendApiError`. | ad hoc in `login_screen.dart`, `complete_profile_screen.dart` | PARTIAL | Unchanged in substance: helper logic exists locally in login/complete-profile/discussion, but no shared helper; raw `$error`/`$e` still shown in `call_log_screen.dart:248`, `review_screen.dart:48`, `user_analytics_screen.dart:176`, `profile_settings_screen.dart:260`, `call_summary_screen.dart:1150`, `learning_path_detail_view.dart:121`, `app_shell_screen.dart:81`. |
| utils/error.ts | `isSuspendedUserError` (403 + `USER_SUSPENDED` or "User suspended"). | `login_screen.dart` `_isSuspendedUserError` | PRESENT | |
| utils/fileOperations | `saveFile`: summary export `.txt` to iOS Documents/CallSummary or Android Downloads, plus `scanFile`. | `features/calllog/data/summary_file_export.dart:40-76` (+ MainActivity channel) | PRESENT | v2: `.txt` to iOS Documents/CallSummary or Android Downloads + media scan. |
| utils/imageUpload | `uploadImageToS3` (PUT blob to the presigned URL). | `account_repository.dart` (presign, then PUT) | PRESENT | |
| utils/bugReportContext | screen, appVersion, device label, os, timestamp. | `bug_report_repository.dart` `_buildContext` (PackageInfo) | PRESENT | |
| utils/version.ts | `getAppVersion`, semver `isVersionLower`. | `core/app_update/force_update.dart:26` | PRESENT | v2: `isVersionLower` ported. |
| utils/common `openAppStore` | Opens the platform store URL (ForceUpdateModal). | `core/app_update/force_update.dart:84` | PRESENT | v2. Opens the RN listings (`id6745545012`, `com.helloally.app`). |
| ListeningScreen NetworkDisconnected | Offline vs socket copy; Try-again hidden while offline. | `network_disconnected.dart:43` | PRESENT | v2: `isOffline` now comes from `isOfflineProvider`. |

---

#### Section C — Store (`src/store/`)

| Slice / item | RN behaviour | Flutter equivalent | Status | Notes |
|---|---|---|---|---|
| store.ts | `configureStore` combining user, chat, summary, credits and the RTK Query api. | Riverpod `ProviderScope` with per-feature providers | PRESENT | |
| store.ts | `setupListeners` enables `refetchOnFocus` / `refetchOnReconnect` (used by badges). | `core/navigation/screen_focus_listener.dart` | PARTIAL | v2: refetch-on-focus is ported as `ScreenFocusListener` (call log, reviews, leaderboard) and the badge popup refetches when its tab shows. No refetch-on-reconnect anywhere. Low impact. |
| api tagTypes | Tag invalidation keeps 21 cache families fresh after mutations (credits, unread counts, notifications, track detail, discussion, …). | repository `onInvalidate` tag callbacks | PRESENT | v2 (`8e6ad33`, `2c523b3`): per-repository cache tags mirror RN invalidations (e.g. `SimulationCacheTag` in `simulations_repository.dart:197-215`). |
| userSlice.initialState | `loading: true` until the token check finishes. | `AuthState.unknown` (`isRestored: false`) | PRESENT | |
| userSlice.setAuthenticated | Flag drives the stack swap. | `AuthController.state.isAuthenticated` | PRESENT | |
| userSlice.setLoading | Ends the launch wait. | `AuthState.isRestored` | PRESENT | |
| userSlice.setUser / clearUser | Current user from `/users/me`. | `currentUserProvider` (returns a never-completing future when signed out; refetches on auth change) | PRESENT | |
| userSlice.setPermissions | Permissions array drives tabs, drawer and gates. | `userPermissionsProvider` (`/authorization/permissions`), rebuilt through `apiClientProvider` on auth change | PRESENT | |
| userSlice.storeTokens (thunk) | Writes ACCESS and REFRESH tokens to AsyncStorage. | `TokenStorage.storeTokens` (secure storage) via `AuthController.signIn` and the interceptor refresh | PRESENT | Encrypted storage (deliberate). Tokens from an RN install wouldn't migrate, but the bundle id differs today. |
| userSlice.handleLogout (thunk) | Removes tokens, `setAuthenticated(false)`, `clearUser`, `setPermissions([])`. | `AuthController.logout()` (`TokenStorage.clear`, state false), with user and permissions providers rebuilt | PRESENT | |
| useUser.handleUserLogout | Best-effort **push token deregistration** (DELETE device token + FCM `deleteToken`) while auth is still valid, then logout. | `auth_state.dart:72-80` → `PushNotificationService.unregister` | PRESENT | v2. |
| useUser.handleUserLogout | `api.util.resetApiState()` drops every cached query. | `apiClientProvider` watches `isAuthenticated`; every repository watches it, so the cascade rebuilds | PRESENT | |
| api.ts handleUserLogout | Session expiry: logout + reset + toast `auth.sessionExpired`. | `AuthController.sessionExpired()` (snackbar, no toast if never signed in) | PRESENT | |
| useUser.checkAuth failure | Any `/users/me` failure logs out. | none | PARTIAL | Unchanged: lenient divergence (needs a product call). |
| Logout side effects: socket | Sockets close through screen unmount and focus cleanup (userId goes undefined). | Screens dispose `SocketService` when the redirect unmounts them; `socketServiceProvider` disposes on scope teardown | PRESENT | |
| Logout side effects: analytics | RN has **no** PostHog, and no Crashlytics `setUserId` or reset. | — | N/A | Nothing to port. Flutter has Crashlytics in pubspec but uses none of it. |
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

---

#### Top gaps by user impact (v2)

1. **No deep links**: `/summary/:id` and `/course/:uuid` universal links (Dart handler, `app_links` plugin, Android `autoVerify` intent filter, iOS associated-domains entitlement, AASA/assetlinks on the web host). `/call-log/:id` also can't open by id alone.
2. **Push and Crashlytics blocked on Firebase config** (`GoogleService-Info.plist`, `google-services.json` for the Flutter ids). The code is complete.
3. **Tab-targeted exits incomplete**: SimulationFeedback, course "Back to Learn" and Scribe exit `go('/home')` without `goToHomeTab`.
4. **Launch auth is token-only** (no `/users/me` validation; non-401 failures don't log out). Product call.
5. **Voice-note dictation has no 24MB auto-stop.**
6. **Raw exception text** in several error states (no shared `getErrorDetails`).
7. Low: no refetch-on-reconnect; feedback playback speed not persisted; no cold-start leaderboard-tap dedupe.

---


## §5 Backend endpoints (actually called by RN) and transport

### Endpoints and transport parity ledger (RN to Flutter)

- RN source of truth: `ally-platform/ally-mobile/src` (services/*.ts, constants/general.ts `API_ROUTES`, plus raw fetch/XHR/socket.io/LiveKit callers).
- **v2 re-audit (2026-10-28): Flutter master @ 227db3a.** Every PARTIAL/MISSING/MERGED row below was re-read on master; v1 statuses are kept in brackets as `(v2: was …)`. v1 note follows.
- Flutter (v1): `ally-mobile-flutter` **master @ e248a07**, the tip at 18:52 on 2026-10-28. `parity/feedback` was merged into master at 18:52 and the branch deleted, so Ask-AI and event-checklist now count as PRESENT on master. The only open in-flight branch is **`parity/reviews` @ a91ed21**. I also checked `feature/simkit`, which is already merged.
- "Called" means an RTK endpoint whose generated hook or `.endpoints.X.initiate` is referenced from non-test code under `src/`, or a raw call. Hooks that are only exported from `hooks/index.ts` and never invoked (`useLanguageDropdown`, `useSimulationTransition`) count as unused, so the endpoints that only they reach are listed as DEAD (transitive).
- Paths are shown without the `/api/v1` prefix. Both apps prepend `/api/{v1|v2}`, and v2 applies only to exact `/auth/generate-otp`, `/auth/verify-otp` and `/learn/scenarios`. Flutter matches this (`auth_interceptor.dart` `_isV2` uses exact equality).
- **(lang)** means the endpoint is in RN `LANGUAGE_CODE_ENDPOINTS`. RN `baseQuery` injects `languageCode=<i18n.resolvedLanguage>` into query params on GETs and into the body on mutations. **v2:** Flutter now has the same 18-entry allowlist in `core/network/language_code_interceptor.dart:27-46` (GET → query param, mutation → JSON body, caller value wins), registered before `AuthInterceptor` in `api_client.dart:55`. All (lang) rows are PRESENT on that axis.

#### Tallies

| Status | Count |
|---|---|
| PRESENT | 148 (143 RTK + 5 raw) (v1: 104) |
| PARTIAL | 2 (1 RTK + 1 raw) (v1: 21) |
| MISSING | 0 (v1: 11) |
| MERGED (was IN PROGRESS on parity/reviews) | 0 (v1: 14; all re-read on master → PRESENT) |
| DEAD (defined in RN, never called) | 25 (21 direct + 4 transitive) |
| **Called endpoints total** | 150 (144 RTK + 6 raw HTTP) |

Transport, realtime and cache findings are in separate sections below and are not counted in the table. v2 non-table residue: transport 1 PARTIAL (error normalisation), realtime 1 PARTIAL (socket retry-after-failure), cache 1 PARTIAL (review-details foreground refetch); everything else in §5.2–5.4 is PRESENT or divergent-by-design.

**v2 spot-check of PRESENT rows (16 checked: generateOtp, completeProfile, getCallLogs filter params incl. seconds + comma-joined multiselects, call-summary 403 transcript gate `call_summary_screen.dart:600`, mark-read ×3, quiz submit, article-read, journal/submit, reference-document search, startScenarioSession, getSimulationDetails, leaderboard, places, reviews list):** no regressions found.

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
| deleteDeviceToken | DELETE /notifications/device-tokens/:encodedToken | none | `unregisterDeviceForPush`, called from hooks/useUser logout | `PushNotificationService.unregister` (`core/push/push_notification_service.dart:246-260`) called from logout in `core/auth/auth_state.dart:75` | PRESENT (v2: was MISSING) |

##### Scribe: live chat, call log, call summary, notes
| RN endpoint | Method + path | Request shape | RN call site(s) | Flutter | Status |
|---|---|---|---|---|---|
| getCounsellorChat | GET /chats/counsellor-chat | none | useCounselorChat (RootNavigator, SplashScreen, CallLogScreen, useListeningCommon) | `ChatRepository.getCounsellorChat`, `core/chat/active_chat_discovery.dart` (cold launch + resume only) | PRESENT. The app-wide socket trigger is missing; see §3. |
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
| getReviewById (lang) | GET /scenario-session-reviews/:id | none; `keepUnusedDataFor:0`, refetchOnFocus/Reconnect | SimulationFeedbackScreen, SimulationReviewDetailsScreen | `ReviewsRepository.getReview`, `reviewDetailProvider` (`reviews_repository.dart`, autoDispose = fresh on every open); `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart:27`) injects `languageCode` | PARTIAL (v2): no refetch on app foreground/reconnect while the details screen stays open (RN `refetchOnFocus/Reconnect`). |
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
| (raw) i18n sync | GET `${I18N_BASE_URL}/manifest.json`, then GET `${base}/${currentVersion}/${lang}/${ns}.json` per namespace | no auth; cached in AsyncStorage per version+lang; refresh on start, on AppState active, every MANIFEST_RECHECK_MS, and on `languageChanged` | localization/dynamic.ts | `LocalizationController._refresh` (`core/localization/localization_controller.dart:141-185`) using a bare `Dio()` (correct, no API interceptor); 30s poll + resume; gated on `LANGUAGE_SELECTOR_FLAG` like RN | PARTIAL (v2): (1) language-change early return FIXED (`localization_controller.dart:150-157` now checks the cached resource for the current language, 8e0a859). (2) Still open: the default `I18N_BASE_URL` is `https://api.helloally.dev/i18n` (the dev env was retired 10-15), where RN defaults to empty, i.e. disabled. |

---

#### 2. Transport layer

| Concern | RN (`services/api.ts` etc.) | Flutter (`core/network/*`) | Status |
|---|---|---|---|
| Base URL | `env.API_BASE_URL + '/api/'` + `v1`/`v2` per exact-match list | `AppConfig.requireApiBaseUrl + '/api'`; interceptor prefixes `/v1` or `/v2` with exact match (`auth_interceptor.dart:47`) | PRESENT |
| Auth header | `authorization: Bearer <ACCESS_TOKEN>` from AsyncStorage in `prepareHeaders` | Same header from `flutter_secure_storage` (`token_storage.dart`, same key names) | PRESENT. Storage differs: Keychain/Keystore vs AsyncStorage, so tokens do not migrate across the app swap and users must log in again. |
| 401 refresh | On 401: no tokens means logout; else POST `/auth/refresh {refreshToken}` (through the same baseQuery, with the old bearer); store tokens; retry the original once; on failure, logout. No de-duplication. | Same contract; a bare `refreshDio` posts `/v1/auth/refresh`; concurrent 401s share one `_refreshFuture` (single-use refresh token race fixed); the retry goes via `refreshDio` (keeps `ResponseType.stream`) | PRESENT (Flutter is stricter: if the retried request 401s again it also logs out, where RN would just return the error) |
| Logout on refresh failure | `handleLogout()` + `api/resetApiState` + toast `auth.sessionExpired` | `AuthController.sessionExpired()`: clear tokens, auth state false, snackbar `auth.sessionExpired` (suppressed if already signed out); `apiClientProvider` watches auth, so every repository/provider is rebuilt (cache reset) | PRESENT. v2: explicit logout now deletes the device token (`auth_state.dart:75` → `push_notification_service.dart:246`); session-expiry doesn't, same as RN. |
| Retry | None (RTK default) | Riverpod `appRetryPolicy`: provider reads only, max 3, 400ms doubling, skips 4xx/cancel; mutations not retried | Divergent by design (OK) |
| Timeouts | None on RTK fetch; Ask-AI XHR has no explicit timeout; socket `timeout:10000` | Dio `connectTimeout 20s`, `receiveTimeout 90s` (inter-chunk); socket `setTimeout(10000)` | Divergent: an LLM endpoint (enhance, retry-summary, generate-from-audio) that is silent for more than 90s fails in Flutter but would succeed in RN |
| Language headers / params | No `Accept-Language`; injects `languageCode` param/body for 18 allowlisted endpoints (`languageCodeEndpoints.ts`) | `LanguageCodeInterceptor` (`core/network/language_code_interceptor.dart`), same 18 endpoints | PRESENT (v2: was PARTIAL) |
| App-version header | None. App version is sent only in bug-report `context` and the `SCRIBE_START_DIAGNOSTIC` socket payload. | None; bug-report `context.appVersion` sent; `SCRIBE_START_DIAGNOSTIC` emitted with `appVersion` (`scribe_recording_screen.dart:179-198`) | PRESENT (v2: was PARTIAL) |
| Tenant header | None (tenant comes from the JWT) | None | PRESENT (parity) |
| 403 suspended | `isSuspendedUserError`: 403 && (`error==='USER_SUSPENDED'` or `message==='User suspended'`) checked only at OTP/Google/Apple sign-in, then `SuspendedAccount` screen. Not global. | `login_screen.dart:55-65` same predicate after all three sign-in methods, then `/suspended`; router allows `/suspended` while unauthenticated | PRESENT |
| Other 403 | CallSummaryScreen hides transcript tab on 403 | `call_summary_screen.dart:964` 403 branch; `course_detail_screen.dart:88` 403 | PRESENT |
| Error normalisation and toast | `getErrorDetails`: `data.message \|\| data.error \|\| t('common.somethingWentWrong')` used by screens with `showToast` | No shared helper; a few screens parse `data['message']` (complete_profile, branching, start_simulation, voice note), many render raw `'$error'` / `'...: $e'` (DioException `toString`), v2 still raw: `app_shell_screen.dart:81`, `call_log_screen.dart:248`, `call_summary_screen.dart:999,1150`, `bug_report_screen.dart:81`, `course_progress_screen.dart:62`, `search_screen.dart:129,153`, `learning_path_detail_view.dart:98,121`, `simulation_details_screen.dart:125`, `preferences_screen.dart:43,46`. Only `login_screen.dart:71 _apiErrorMessage` ports `getErrorDetails`. | PARTIAL: users see raw Dio exception text in ~12 places; no shared helper |
| Network logger | `NetworkLogs` overlay in development | none | n/a (dev only) |

#### 3. Realtime: socket.io and LiveKit

| Item | RN | Flutter | Status |
|---|---|---|---|
| Client config | `io(API_BASE_URL + path, {path:'/socket.io', transports:['websocket','polling'], auth: cb with fresh token, reconnection 5 attempts 1-5s, timeout 10s, forceNew, autoConnect:false})` + manual retry timer after an open failure (`RETRY_AFTER_FAILURE_MS`) | `core/realtime/socket_service.dart`: identical options; **no retry-after-failure timer** (`connect()` has try/finally only); a single shared `SocketService` instance across namespaces | PARTIAL (v2 unchanged: still no `RETRY_AFTER_FAILURE_MS` timer in `socket_service.dart:37-95`) |
| Microphone namespace (`MICROPHONE_SOCKET_PATH` = /microphone-chat) listeners | `SESSION_CREATED`, `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `MESSAGE_RECEIVED`, `UTTERANCE_ENDED` | `scribe_recording_screen.dart:176-185`: all six | PRESENT |
| Microphone emits | `AUDIO_MESSAGE {audioData: base64 chunk, chatId}`, `START_AUDIO_CHAT {isLinear16Encoded:true, platform:'MOBILE', sampleRate:16000, mode:'SCRIBE'}` | `scribe_recording_screen.dart:227,237`: same payloads | PRESENT |
| `SCRIBE_START_DIAGNOSTIC` emit | `{afterMs, appVersion, ...gates}` at 5s/15s when the recording has not started | Emitted at 5s/15s with the RN gate fields (`scribe_recording_screen.dart:170-198`) | PRESENT (v2: was MISSING) |
| Cloud-telephony namespace (`CLOUD_TELEPHONY_PATH`) on ConferenceListeningScreen | on: `CHAT_ENDED`, `NUDGE`, `USER_JOINED`, `AUDIO_STREAM`; emits `AUDIO_CHAT_PAUSED/RESUMED {chatId}` behind a button that is hidden (`showPauseResumeButton={false}`), so effectively dead | `conference_listening_screen.dart:130-138`: same four listeners; no pause emit (parity, since RN hides it) | PRESENT |
| **App-wide** cloud-telephony socket | `RootNavigator.tsx:170` keeps a socket on `CLOUD_TELEPHONY_PATH` for the whole authenticated session; `USER_JOINED` calls `checkCounselorChat()` and auto-navigates into an incoming conference call while the app is in the foreground | `core/chat/cloud_telephony_listener.dart` (own `SocketService`, drops on background, reconnects on resume), started from `main.dart:104` | PRESENT (v2: was MISSING) |
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
| markSimulation/ScribeReviewAsRead: (no tags in RN either) | no invalidation of `unreadReviewCountProvider` | parity (both stale) |
| Polling / refetchOnFocus: `getBadges` every 60s + focus/reconnect; review details refetchOnFocus/Reconnect | `getBadges`: 60s poll + resume refetch in `badge_popup.dart:87,104`; call-log/review lists refetch on focus (`core/navigation/screen_focus_listener.dart`); review details only refetch on open (autoDispose) | PARTIAL (v2): only review-details foreground/reconnect refetch remains |

#### 5. DEAD RTK endpoints (defined in RN, never called)

Direct, with zero hook or initiate references outside tests:
`badgesApi.getBadgeCount` (GET /badges/me/count) · `callSummaryApi.getTags` (POST /chats/summary/tag-positivity-ratings) · `coursesApi.getTrackLanguages` (GET /learn/tracks/:id/languages) · `discussionApi.getDiscussionModeratorTenants` (GET /learn/track-items/:id/discussion/tenants) · `generalCommentsApi.getGeneralComments`, `addGeneralComment`, `deleteGeneralComment`, `updateGeneralComment`, `updateGeneralCommentVisibility` (/scenario-session-reviews/:id/general-comments, /general-comments/:id[/visibility]) · `scribeGeneralCommentsApi.getScribeGeneralComments`, `addScribeGeneralComment`, `deleteScribeGeneralComment`, `updateScribeGeneralComment`, `updateScribeGeneralCommentVisibility` · `notificationsApi.getUnreadNotificationCount` (GET /notifications/unread-count; Flutter also defines `unreadCount()` and never calls it) · `reviewsApi.getReview` · `searchApi.getCategories` (GET /reference-document/categories) · `simulationSummaryApi.getSimulationSkills` (GET /learn/scenario-session/:id/skills) · `simulationSummaryApi.getChatHistory` (the live path is the raw fetch in chatSessionManager) · `simulationsApi.listRooms` (GET /rooms) · `userApi.updateUserPreferences` (POST /users/preferences).

Transitive, reachable only from the unused hooks `useLanguageDropdown` / `useSimulationTransition`:
`simulationsApi.getAvailableLanguages` (GET /learn/scenario-languages?active&hasVoices) · `userApi.getUserPreferences` (GET /users/me/preferences) · `simulationsApi.getUpcomingScenario` (GET /learn/scenario-paths/:id/upcoming-scenario) · `simulationsApi.getUpcomingCaseScenario` (GET /learn/cases/:id/upcoming-scenario).

**Flutter-only calls to RN-dead endpoints:** `features/preferences/data/preferences_repository.dart` (Preferences screen) calls GET /users/me/preferences, POST /users/preferences `{default_language_id}`, and GET /learn/scenario-languages (without RN's `active=true&hasVoices=true` filter). RN's live simulation language picker uses `scenario.availableLanguages` from the scenario payload instead. This is extra Flutter surface with no RN counterpart; decide whether to keep it.

**v2:** Flutter now also ports (but never calls from UI) two RN-dead endpoints for API parity: `CoursesRepository.getTrackLanguages` (`courses_repository.dart:77-80`) and `DiscussionRepository.getModeratorTenants` (`discussion_repository.dart:30`). DEAD count unchanged.

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

- RN static keys referenced from code: **848**. All 848 exist in Flutter `en.json`, so **0 are missing**.
- Dynamic key templates in RN: **13 families**. All expansions exist in Flutter `en.json` because it is a superset of RN `en.json`.
- RN `en.json` keys absent from Flutter `en.json`: **1** (`auth.login.otp.expires`, replaced by `_one`/`_other` plural keys).
- English value drift: 0. hi/kn/mr/ta value drift on shared keys: 0.
- Flutter-only keys: **106**. In hi/kn/mr/ta, Flutter is missing **108** of its own en keys (106 Flutter-only plus the 2 plural keys).
- Flutter `t()` references not present in `en.json`: **0** (509 distinct literal refs checked).
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
| 8 | Dynamic CDN translation sync (`localization/dynamic.ts`, gated by `LANGUAGE_SELECTOR_FLAG`) | `I18N_BASE_URL` manifest + namespaces | `core/localization/localization_controller.dart` | PARTIAL | v2: language-change early return fixed (8e0a859). Still open: the default URL is `https://api.helloally.dev/i18n` (dev host retired 10-15); RN's default is empty (§9). |
| 9 | Hardcoded English UI literals in Flutter outside `t()` | RN also hardcodes some (`SUMMARY_STATUS_CONFIG` labels, summary field labels) | v2: 82 grep hits. Most mirror RN (summary field labels in `call_summary_fields.dart:102-283`, `status_badge.dart:36-43`). Flutter-only: `app_shell_screen.dart:111` "No accessible tabs for this account", `call_log_screen.dart:461,539` semantic labels 'Filter'/'Refresh' | PARTIAL | Spot-check only, not exhaustive. |

§7 tally v2: 9 rows — PRESENT 6, PARTIAL 2 (rows 8, 9), MISSING 0, N/A 1 (v1: 3/4/1/1).

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

Re-audited 2026-10-28 against Flutter `master` @ `227db3a`. RN is unchanged at `7a8ce0c19` (the only later `ally-mobile` commit, `fc1253ea7`, is a version bump).

Method:
- RN: an asset counts as used when a non-test RN `src` file imports its export name (from `@/assets`, `@/assets/icons` or a relative `assets` path) **and that file is rendered**. v2 traced render paths. That moved 7 assets, which v1 counted as used, to N/A, because their only importers are never mounted.
- Flutter: an asset counts as referenced when `lib/**/*.dart` contains `/<filename>` or `'<filename>` with an exact boundary. v1 matched bare substrings, so `replay.svg` hid the fact that `play.svg` is unused. Flutter still uses literal asset paths only, with no interpolated `assets/...$x`, which was re-checked.
- Status is per **file** (shipped and referenced somewhere). A file can be PRESENT here and still be swapped for a Material icon at another RN site. Those per-site gaps are listed in **8b**.

Overview:
- Flutter now ships **all 161 RN asset files**, including `sounds/startSimulation.mp3` and `sounds/endSimulation.mp3`, which are declared in `pubspec.yaml` and played by `lib/features/roleplay/presentation/simulation_sound_player.dart:11-12` from `roleplay_voice_screen.dart:239` (start) and `:512` (end).
- Fonts: all 7 are still bundled in `pubspec.yaml`. PRESENT.

| Bucket | Count | Status |
|---|---|---|
| RN-rendered and Flutter-referenced | 116 files + 7 fonts = 123 | PRESENT |
| RN-rendered, shipped in Flutter but **never referenced** | 19 | PARTIAL (listed below) |
| RN-rendered and **not shipped** in Flutter | 0 | — (both sounds now PRESENT) |
| RN-dead (unused, or used only by never-rendered RN components) | 26 | N/A |
| **Total** | **168** | |

### Status changes since v1 (32)

**PARTIAL → PRESENT (19)**

| Asset | Flutter reference |
|---|---|
| `images/summaryGenerated.png` | `lib/features/calllog/presentation/summary_generation_progress.dart:177` |
| `images/summaryFailed.png` | `summary_generation_progress.dart:152`. The Unauthorized view still uses a Material icon (see 8b #21). |
| `animations/summaryLoading.json` | `summary_generation_progress.dart:184` (Lottie) |
| `icons/shieldWithTick.svg` | `summary_generation_progress.dart:244` |
| `icons/page.svg` | `summary_generation_progress.dart:364` (AddNotesSection) |
| `icons/info.svg` | `summary_generation_progress.dart:394`. The tab-header/Achievements tooltip still uses Material (see 8b #29–30). |
| `icons/contract.svg` | `call_summary_screen.dart:461` (actions menu) |
| `icons/export.svg` | `call_summary_screen.dart:455` |
| `icons/edit.svg` | `call_summary_screen.dart:448`; `courses/presentation/discussion/discussion_post_tile.dart:236` |
| `icons/unarchive.svg` | `call_summary_screen.dart:467` |
| `icons/delete.svg` | `discussion_post_tile.dart:242`. VoiceNotePanel still uses Material (see 8b #27). |
| `icons/arrowRight.svg` | `courses/presentation/course_item_player_screen.dart:719`, `quiz/quiz_player.dart:277`, `quiz/quiz_question_widget.dart:207`. Call-summary SectionHeader still uses Material (see 8b #19). |
| `icons/pause.svg`, `icons/resume.svg` | `scribe/presentation/listening_controls.dart:72` |
| `icons/thumb.svg` | `scribe/presentation/nudge_section.dart:170` |
| `icons/networkDisconnected.svg` | `scribe/presentation/network_disconnected.dart:96` |
| `icons/endSession.svg` | `scribe/presentation/scribe_recording_screen.dart:589`, `roleplay/presentation/roleplay_voice_screen.dart:895` |
| `icons/forceUpdateAlert.svg` | `lib/core/app_update/force_update_modal.dart:98` |
| `icons/downArrow.svg` | `scribe/presentation/scribe_reference_search.dart:569` (dark Listening card). The Search tab card has no expand control (see 8b #31). |

**MISSING → PRESENT (2):** `sounds/startSimulation.mp3`, `sounds/endSimulation.mp3`, at `simulation_sound_player.dart:11-12`.

**PARTIAL → N/A (10).** v1 called these "used". Tracing the render paths showed the RN importer is never mounted:
- `images/carousel1..4.png`: only `SECURITY_CAROUSEL_SLIDES`, whose consumer SecurityCarousel is never rendered.
- `icons/call.svg`, `icons/transcript.svg`: SummaryDropdown is exported, never rendered.
- `icons/simulation.svg` (and `transcript.svg`): FeedbackDropdown is exported, never rendered.
- `icons/arrowUpRight.svg`, `animations/botThinking.json`: AskAiInitialState and ThinkingIndicator are reached only through `AskAI`, which is exported from `SimulationFeedbackScreen/components/index.ts` but never rendered. DebriefTab imports only `CitationsTable`, `types` and `useAskAIChat`.
- `images/conversation.png`: exported from `assets/images/index.ts`, imported nowhere.

**PRESENT → PARTIAL (1):** `icons/play.svg`. RN VoiceNotePanel renders it, and Flutter has never referenced it. v1's substring match on `replay.svg` hid this. It is a v1 miss, not a regression: `git log -S"icons/play.svg" -- lib` is empty.

### Remaining PARTIAL (19). RN renders these; Flutter ships the file and never uses it

- **Call summary section icons (17)** from RN `constants/summary.ts` `SECTION_LIST`, rendered by `CallSummaryDetails`: `callDetails`, `sessionSummary`, `flow`, `keyConcern`, `tableEye`, `magnifyEye`, `assessment`, `smile`, `brightnessAlert`, `prescriptions`, `handShare`, `newsStand`, `headsetMic`, `tag`, `database`, `intake`, `ongoingRisks`. Flutter: `call_summary_screen.dart:88-105` (`_sectionIcons`, Material), rendered at `:1384`. The comment at `:84-86` says the substitution is deliberate.
- `icons/goldenShield.svg`: the CallSummaryDetails privacy banner. Flutter `call_summary_screen.dart:1227` uses `Icons.shield_outlined`.
- `icons/play.svg`: the VoiceNotePanel resume button. Flutter `voice_note_section.dart:423` uses `Icons.play_arrow`.

### N/A (26). RN-dead; Flutter ships them unreferenced (deletion candidates)

`icons/{infoBlack,bars,callEnd,callHighlights,demogs,forward10,headphone,keyEvents,lightBulb,profileIcon,replay10,rightArrow,thumbUp}.svg`, `images/{listenLive,joinCall}.png`, `animations/listen.json` (16 from v1), plus `images/carousel{1..4}.png`, `images/conversation.png`, `icons/{call,transcript,simulation,arrowUpRight}.svg`, `animations/botThinking.json` (10 new).

### PRESENT spot-check (12 of 123, no regressions)

`google.svg` `auth/presentation/login_screen.dart:1084`; `splashAnimation.json` `login_screen.dart:38`; `rank1.svg` `leaderboard/presentation/leaderboard_screen.dart:37`; `badgeIcon.svg` `leaderboard_screen.dart:458`; `breathingBackground.png` `boxbreathing/presentation/box_breathing_screen.dart:220`; `breath.mp3` `boxbreathing/presentation/breath_sound_player.dart:51`; `logOut.png` `core/navigation/app_drawer.dart:180`; `suspendedAccount.svg` `suspended/presentation/suspended_account_screen.dart:34`; `emptyReviews.svg` `reviews/presentation/review_screen.dart:95`; `noCallRecords.svg` `calllog/presentation/call_log_screen.dart:731`; all 7 fonts and `assets/icons/`, `images/`, `animations/` declared in `pubspec.yaml`. No asset that was referenced at `cfb1672` has lost its reference.

---

### 8b Icon/asset visual sweep

Each row is an RN render site that draws a bundled SVG/PNG where Flutter master draws a Material `Icons.*` glyph or nothing. Method: every (RN rendered file → asset) import pair, 251 pairs over 128 files, was matched against the Flutter files that reference that asset. Every Flutter `Icons.*` use was then read; there are 35 across 6 files, and no `CupertinoIcons`, custom `IconData` or icon fonts. Rows where the Flutter counterpart uses the same SVG are omitted.

**Totals: 33 rows.** Call summary + voice note: 27 (18 section icons, 9 other). Shell/account: 3. Search: 1. Learn (course progress + simulation feedback): 2.

| # | Screen / component | RN asset (RN file that renders it) | Flutter file:line using the substitute | Substitute |
|---|---|---|---|---|
| 1 | Call summary, section header: Features & demographics | `callDetails.svg` (`constants/summary.ts:333` → `CallSummaryDetails`) | `lib/features/calllog/presentation/call_summary_screen.dart:88` (drawn at `:1384`) | `Icons.call_outlined` |
| 2 | … Session summary | `sessionSummary.svg` (`summary.ts:341`) | `call_summary_screen.dart:89` | `Icons.auto_awesome_outlined` |
| 3 | … Flow | `flow.svg` (`summary.ts:349`) | `call_summary_screen.dart:90` | `Icons.waves` |
| 4 | … Key concern | `keyConcern.svg` (`summary.ts:357`) | `call_summary_screen.dart:91` | `Icons.sentiment_dissatisfied_outlined` |
| 5 | … Objective observations | `tableEye.svg` (`summary.ts:365`) | `call_summary_screen.dart:92` | `Icons.visibility_outlined` |
| 6 | … Subjective observations | `magnifyEye.svg` (`summary.ts:373`) | `call_summary_screen.dart:93` | `Icons.search` |
| 7 | … Assessment | `assessment.svg` (`summary.ts:381`) | `call_summary_screen.dart:94` | `Icons.assignment_outlined` |
| 8 | … Dominant feelings | `smile.svg` (`summary.ts:389`) | `call_summary_screen.dart:95` | `Icons.sentiment_satisfied_outlined` |
| 9 | … Issues worked on | `brightnessAlert.svg` (`summary.ts:397`) | `call_summary_screen.dart:96` | `Icons.warning_amber_outlined` |
| 10 | … Key therapeutic techniques | `prescriptions.svg` (`summary.ts:405`) | `call_summary_screen.dart:97` | `Icons.healing_outlined` |
| 11 | … Referrals provided | `handShare.svg` (`summary.ts:413`) | `call_summary_screen.dart:98` | `Icons.volunteer_activism_outlined` |
| 12 | … Homework recommended | `newsStand.svg` (`summary.ts:421`) | `call_summary_screen.dart:99` | `Icons.library_books_outlined` |
| 13 | … Plan for next call | `headsetMic.svg` (`summary.ts:429`) | `call_summary_screen.dart:100` | `Icons.headset_mic_outlined` |
| 14 | … Tags | `tag.svg` (`summary.ts:437`) | `call_summary_screen.dart:101` | `Icons.label_outline` |
| 15 | … Metrics | `database.svg` (`summary.ts:445`) | `call_summary_screen.dart:102` | `Icons.storage_outlined` |
| 16 | … Intake | `intake.svg` (`summary.ts:453`) | `call_summary_screen.dart:103` | `Icons.assignment_ind_outlined` |
| 17 | … Ongoing risks | `ongoingRisks.svg` (`summary.ts:461`) | `call_summary_screen.dart:104` | `Icons.report_problem_outlined` |
| 18 | … Additional notes | `notes.svg` (`summary.ts:469`) | `call_summary_screen.dart:105`. `notes.svg` is used elsewhere: roleplay `session_info_tabs`. | `Icons.note_add_outlined` |
| 19 | Call summary, section expand/collapse caret | `arrowDown.svg` / `arrowRight.svg` (`CallSummaryScreen/components/CallSummaryDetails/SectionHeader.tsx:90,92`, 10×10) | `call_summary_screen.dart:1428` | `Icons.expand_less` / `Icons.expand_more` |
| 20 | Call summary, privacy banner | `goldenShield.svg` (`CallSummaryDetails/CallSummaryDetails.tsx`) | `call_summary_screen.dart:1227` (`_SummaryTabState`) | `Icons.shield_outlined` (orange400) |
| 21 | Call summary, unauthorized state | `images/summaryFailed.png` (`SummaryUnauthorized/SummaryUnauthorized.tsx:21`) | `call_summary_screen.dart:1800` (`_SummaryUnauthorizedView`) | `Icons.lock_outline` 48pt |
| 22 | Call summary, "view review" comment button | `chatBubble.svg` / `CommentIcon` (`CallSummaryScreen/CallSummaryScreen.tsx:531`) | `call_summary_screen.dart:685` | `Icons.comment_outlined` |
| 23 | Call summary, voice-note "Record" CTA | `mic.svg` (`VoiceNotePanel/VoiceNoteSection.tsx`) | `voice_note_section.dart:261` | `Icons.mic` |
| 24 | Voice-note panel, pause | `pause.svg` (`VoiceNotePanel/VoiceNotePanel.tsx:107`) | `voice_note_section.dart:416` | `Icons.pause` |
| 25 | Voice-note panel, resume | `play.svg` (`VoiceNotePanel.tsx:117`) | `voice_note_section.dart:423` | `Icons.play_arrow` |
| 26 | Voice-note panel, recording mic | `mic.svg` (`VoiceNotePanel.tsx:141`) | `voice_note_section.dart:448` | `Icons.mic` |
| 27 | Voice-note panel, discard | `delete.svg` (`VoiceNotePanel.tsx:156`) | `voice_note_section.dart:472` | `Icons.delete_outline` |
| 28 | Bug report, back button | `leftArrowIcon.svg` (`BugReportScreen/BugReportScreen.tsx:83`) | `lib/features/bugreport/presentation/bug_report_screen.dart:101`. Other screens use `BackTitleHeader` with the SVG. | `Icons.arrow_back` (Material `AppBar`) |
| 29 | Tab screen header, info tooltip (Analytics/Leaderboard/etc. tabs) | `info.svg` (`components/TabScreenHeader/TabScreenHeader.tsx:86`) | `lib/core/widgets/info_tooltip_icon.dart:22`, used by `core/widgets/tab_screen_header.dart:114` | `Icons.info_outline` |
| 30 | Achievements, badges / reviewer tooltips | `info.svg` (`AchievementsScreen/AchievementsScreen.tsx:131,217`) | `info_tooltip_icon.dart:22`, used by `features/achievements/presentation/achievements_screen.dart:115,218` | `Icons.info_outline` |
| 31 | Search tab, ResourceArticleCard expand | `downArrow.svg` (`components/ResourceArticleCard/ResourceArticleCard.tsx`, rendered by `SearchScreen.tsx:106`) | `lib/features/search/presentation/search_screen.dart:372`: a plain `ListTile` with no expand control or tags. The dark Listening card at `scribe_reference_search.dart:569` does use it. | nothing rendered |
| 32 | Course progress, role-play session row chevron | `chevronRight.svg` (`CourseProgressScreen/components/RoleplaySessionRow.tsx:53`) | `lib/features/courses/presentation/course_progress_screen.dart:637` | `Icons.chevron_right` |
| 33 | Simulation feedback, Summary tab title "help" (opens SimulationDetailsModal) | `help.svg` (`SimulationFeedbackScreen/components/SimulationSummary/SimulationSummary.tsx:76`) | `lib/features/simulations/presentation/widgets/feedback/feedback_widgets.dart:332` (`ShortSessionSummary` title, no icon). `SimulationDetailsModal` is opened only from `learning_path_detail_view.dart`. | nothing rendered (also loses the details modal) |

Flutter-only Material glyphs with no RN asset, so not parity gaps but worth knowing:
- `voice_note_section.dart:388` (`Icons.circle` recording dot) and `:429` (`Icons.stop`). RN VoiceNotePanel has neither control.
- `core/widgets/app_chat_input.dart:46` (`Icons.send`). `AppChatInput` has no callers in `lib/`, so it is dead code.

Reverse direction (Flutter ships the asset but never uses it): the 19 PARTIAL files above, plus the 26 N/A files. `notes.svg`, `mic.svg`, `pause.svg`, `delete.svg`, `arrowDown.svg`, `arrowRight.svg`, `info.svg`, `help.svg`, `chatBubble.svg`, `downArrow.svg`, `leftArrowIcon.svg`, `chevronRight.svg` and `summaryFailed.png` are referenced elsewhere in Flutter, so 8b rows 18–33 are wiring changes only, with no new asset work.

## §9 Config / env / flags

RN: `react-native-config` reads `env/.env*` via `src/config/env.ts` (`assertEnvVar` makes most values required). Flutter: `--dart-define(-from-file)` read through `lib/core/config/app_config.dart` and `lib/core/push/leaderboard_notification.dart`.

| # | RN var (required?) | RN consumers | Flutter equivalent & default | Status | Notes |
|---|---|---|---|---|---|
| 1 | `ENVIRONMENT` (req.) | `App.tsx` NetworkLogs gate, `utils/logger.ts` (logging on in development only), drawer "(Dev)" suffix | `AppConfig.environment`; default `development` in debug, `production` in release | PRESENT | |
| 2 | `API_BASE_URL` (req.) | `services/api.ts` | `AppConfig.apiBaseUrl` (default `''`, `requireApiBaseUrl` throws) | PRESENT | |
| 3 | `API_VERSION` (req.) | read by `env.ts` only; nothing uses it. Versions are per-endpoint: `/api/v1`, plus `/api/v2` for 3 routes | hardcoded v1, with v2 list in `api_routes.dart` | N/A | Dead in RN. |
| 4 | `ALLY_WEB_URL` (req.) | `utils/deeplink.ts` link allowlist, CallLog "Learn more" link, SimulationDetails copy-link | `AppConfig.allyWebUrl` (default `https://app.helloally.ai/`), used by `simulation_details_screen.dart:63` | PARTIAL | v2 (`c80310b`): now a dart-define (default prod). Remaining: the deep-link allowlist (deep links missing) and CallLog "Learn more" (`CallLogScreen.tsx:554` `openURL(ALLY_WEB_URL)`, not in `features/calllog`). |
| 5 | `MICROPHONE_SOCKET_PATH` (req.) | `hooks/useSocket.ts` (Scribe) | `AppConfig.microphoneSocketPath`, default `/microphone-chat` | PRESENT | |
| 6 | `CLOUD_TELEPHONY_PATH` (req.) | app-wide telephony socket, Conference listening | `AppConfig.cloudTelephonyPath`, default `/cloud-telephony-chat` | PRESENT | The value is ported, but the app-wide socket that uses it is MISSING (§4b). |
| 7 | `GOOGLE_WEB_CLIENT_ID` (req.) | `useGoogleLogin` `webClientId` | `AppConfig.googleWebClientId`, default `''` | PARTIAL | Unchanged. Needs an OAuth client for the Flutter package id (credentials). |
| 8 | `GOOGLE_IOS_CLIENT_ID` (req.) | `useGoogleLogin` `iosClientId` | `AppConfig.googleIosClientId`, default `''` | PARTIAL | Unchanged. Needs the iOS client + Info.plist `GIDClientID`/URL scheme (credentials). |
| 9 | `NOTIFICATION_SCHEDULE_DAY` (default 1) | `notificationService.ts` weekly leaderboard reminder | `leaderboard_notification.dart` `int.fromEnvironment`, default 1 | PRESENT | |
| 10 | `NOTIFICATION_SCHEDULE_HOUR` (default 11) | same | default 11 | PRESENT | |
| 11 | `NOTIFICATION_SCHEDULE_MINUTE` (default 0) | same | default 0 | PRESENT | |
| 12 | `LANGUAGE_SELECTOR_FLAG` (default false) | `i18n.ts` dynamic sync, `ProfileSettingsScreen` language row (2 places) | `AppConfig.languageSelectorEnabled` gates the sync in `localization_controller.dart` | PARTIAL | Unchanged: `profile_settings_screen.dart:279` renders the language row unconditionally; RN hides it behind the flag (`ProfileSettingsScreen.tsx:182,232`). |
| 13 | `I18N_BASE_URL` (default `''`) | `localization/dynamic.ts` | `AppConfig.i18nBaseUrl`, default `https://api.helloally.dev/i18n` | PARTIAL | Unchanged: `app_config.dart:51` still defaults to the retired `https://api.helloally.dev/i18n`. |
| 14 | Android manifest placeholder `${appLinkHost}` (Gradle, per flavor) | App Links intent filter | none | MISSING | Unchanged. |
| 15 | Per-environment Firebase config (`GoogleService-Info.plist`, `google-services.json`) | Firebase app, FCM, Crashlytics | none in repo | MISSING | Unchanged (credentials). |

Flutter-only flags: none beyond the above. Also listed as N/A: `NetworkLogs` and the logger are dev-only.

---

## §10 Native / platform

### 10a iOS `Info.plist` (RN `ios/ally/Info.plist` vs Flutter `ios/Runner/Info.plist`)

| # | Key | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 1 | `CFBundleDisplayName` | `Ally` | `Ally` | PARTIAL | v2 (`97c9f94`): display name is now `Ally`. Remaining: bundle id `com.helloally.allyMobileFlutter` vs RN prod id (release-identity decision). |
| 2 | `CFBundleURLTypes` (Google reversed client ids ×2) + `GIDClientID` | present | absent | MISSING | Unchanged. Needs the iOS OAuth client id (credentials). |
| 3 | `NSMicrophoneUsageDescription` | present | present (different, better copy) | PRESENT | |
| 4 | `NSPhotoLibraryUsageDescription` | present | present | PRESENT | |
| 5 | `NSCameraUsageDescription` | present | absent | N/A | Neither app captures camera (RN `launchCamera` unused; Flutter `ImageSource.gallery` only; role play is audio-only). |
| 6 | `NSLocationWhenInUseUsageDescription` | empty string | absent | N/A | RN has no geolocation calls. |
| 7 | `UIBackgroundModes` | `remote-notification` | `audio`, `remote-notification` | PRESENT | v2 (`9f08ca4`): `remote-notification` added alongside Flutter's `audio`. |
| 8 | `NSAppTransportSecurity` `NSAllowsLocalNetworking` | true | absent | N/A | Dev-only (local http backend). Add it if local-network testing on device is needed. |
| 9 | `UIAppFonts` (7 fonts) | listed | fonts bundled via pubspec | PRESENT | |
| 10 | `UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`, `UISupportsDocumentBrowser` | true | present | PRESENT | v2: all three keys set; export is ported. |
| 11 | `ITSAppUsesNonExemptEncryption` = false | present | false | PRESENT | v2. |
| 12 | `UIRequiredDeviceCapabilities` arm64 | present | absent | N/A | Flutter iOS builds are arm64-only anyway. |
| 13 | `UISupportedInterfaceOrientations` | Portrait only | Portrait (iPhone); iPad: all four | PRESENT | v2: iPhone list is Portrait only and `main.dart` calls `setPreferredOrientations([portraitUp])`. Residual: Flutter targets iPad (`TARGETED_DEVICE_FAMILY = "1,2"`; RN is iPhone-only) and keeps all four iPad orientations without `UIRequiresFullScreen`, so iPad can still rotate. Decide whether to ship iPad at all. |
| 14 | `UIViewControllerBasedStatusBarAppearance` false | present | absent | N/A | Flutter controls the status bar via `SystemUiOverlayStyle`. |
| 15 | `UIApplicationSceneManifest` (scene lifecycle, iOS 27) | SceneDelegate | `FlutterSceneDelegate` scene config | PRESENT | |
| 16 | `PrivacyInfo.xcprivacy` (app-level privacy manifest) | present (`ios/ally/PrivacyInfo.xcprivacy`) | `ios/Runner/PrivacyInfo.xcprivacy` | PRESENT | v2: added to Runner resources (UserDefaults, FileTimestamp reasons). |

### 10b iOS entitlements (RN `ios/ally/ally.entitlements`; **Flutter has no `.entitlements` file and no `CODE_SIGN_ENTITLEMENTS` in `project.pbxproj`**)

| # | Entitlement | RN | Flutter | Status |
|---|---|---|---|---|
| 17 | `aps-environment` (push) | development (prod via signing) | none | MISSING: Unchanged: still no `.entitlements` / `CODE_SIGN_ENTITLEMENTS`. |
| 18 | `com.apple.developer.applesignin` | Default | none | MISSING: Unchanged: Apple sign-in fails on device. |
| 19 | `com.apple.developer.associated-domains` `applinks:app.dev.helloally.ai`, `applinks:app.helloally.ai` | present | none | MISSING: Unchanged: no universal links. |

### 10c iOS AppDelegate / SceneDelegate

| # | Behaviour | RN (`AppDelegate.swift`) | Flutter (`AppDelegate.swift`, `SceneDelegate.swift`) | Status | Notes |
|---|---|---|---|---|---|
| 20 | Firebase configure at launch | `FirebaseApp.configure()` | `Firebase.initializeApp()` in Dart (`main.dart:32`) | PARTIAL | Unchanged: `main.dart` init is guarded and now also gates Crashlytics; fails without `GoogleService-Info.plist`. |
| 21 | Scene lifecycle (iOS 27 requirement) | custom SceneDelegate | implicit-engine FlutterSceneDelegate | PRESENT | |
| 22 | `GoogleService-Info.plist` / Android `google-services.json` | present | absent | MISSING | Unchanged (credentials). Blocks FCM, Crashlytics reporting and the Google Android client. |
| 23 | Cold-start URL / universal-link forwarding (`urlContexts`, `NSUserActivityTypeBrowsingWeb` → `RCTLinkingManager`) | present | none (no `app_links`/`uni_links` plugin, no Dart handler) | MISSING | Unchanged. |
| 24 | Warm deep links (`openURLContexts`, `continue userActivity`) | present | none | MISSING | Unchanged. |
| 25 | `UNUserNotificationCenter` delegate | via RN Firebase / notifee | set in `AppDelegate` for flutter_local_notifications | PRESENT | |
| 26 | Native module `CommentableTextView` (Swift + ObjC manager: text selection → "Comment" menu on the review transcript) | `ios/ally/CommentableText*.swift/.m` + `components/CommentableText/{Ios,Android}CommentableText.tsx` | `features/reviews/presentation/review_conversation.dart` (selection context menu) | PRESENT | Re-read on master (selection menu port in `review_conversation.dart:19-52`). |

### 10d Android manifest (RN `android/app/src/main/AndroidManifest.xml` vs Flutter)

| # | Item | RN | Flutter | Status | Notes |
|---|---|---|---|---|---|
| 27 | Package / applicationId, label | `com.helloally.app`, `@string/app_name` (Ally) | `com.helloally.ally_mobile_flutter`, label `Ally` | PARTIAL | v2: label is now `Ally`. applicationId `com.helloally.ally_mobile_flutter` vs RN `com.helloally.app` is the release-identity decision. |
| 28 | `INTERNET` | ✓ | ✓ | PRESENT | |
| 29 | `RECORD_AUDIO` | ✓ | ✓ | PRESENT | |
| 30 | `MODIFY_AUDIO_SETTINGS` | ✓ | ✓ | PRESENT | |
| 31 | `POST_NOTIFICATIONS` | ✓ | ✓ | PRESENT | |
| 32 | `RECEIVE_BOOT_COMPLETED` | ✓ | ✓ (plus the flutter_local_notifications boot receiver) | PRESENT | Reschedules the weekly reminder after reboot. |
| 33 | `SCHEDULE_EXACT_ALARM` | ✓ (notifee exact trigger) | absent | PRESENT (by design) | Flutter schedules with `AndroidScheduleMode.inexactAllowWhileIdle` (`leaderboard_notification.dart:126`), which needs no permission. The reminder may fire a few minutes late. |
| 34 | `WRITE_EXTERNAL_STORAGE` (maxSdk 28) + `requestLegacyExternalStorage` | ✓ | present (`maxSdkVersion=28`, `requestLegacyExternalStorage`) | PRESENT | v2: both added (export is ported). |
| 35 | `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` + `WAKE_LOCK` + `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + flutter_foreground_task service (`foregroundServiceType=microphone`) | **absent** | present | N/A | A Flutter addition: RN has no foreground service, so Android 14+ kills its mic in the background. Keep it. |
| 36 | App Links intent filter `autoVerify`, https `${appLinkHost}` `/summary`, `/course` | ✓ | absent | MISSING | Unchanged. |
| 37 | `launchMode` | `singleTask` | `singleTop` | PARTIAL | Unchanged (`singleTop`). Revisit with deep links. |
| 38 | `screenOrientation="portrait"` | ✓ | present | PRESENT | v2 (`9f08ca4`). |
| 39 | `allowBackup="false"` | ✓ | present | PRESENT | v2 (`9f08ca4`). |
| 40 | `windowSoftInputMode` | `adjustPan` | `adjustResize` (Flutter default) | N/A | Flutter handles insets itself. |
| 41 | `supportsRtl` | true | default | N/A | No RTL locales. |

### 10e Native modules (`package.json` dependencies) → Flutter plugins

| # | RN package (used in) | Flutter plugin / approach | Status | Notes |
|---|---|---|---|---|
| 42 | `@gorhom/bottom-sheet` (12 files) | `showModalBottomSheet` / `DraggableScrollableSheet` | PRESENT | Per-sheet parity in §2/§3. |
| 43 | `@invertase/react-native-apple-authentication` | `sign_in_with_apple` | PARTIAL | Unchanged: entitlement missing (row 18). |
| 44 | `@livekit/react-native` + `@livekit/react-native-webrtc` + `livekit-client` | `livekit_client` | PRESENT | v2: room-disconnect / agent-joined handling landed (`b82d84f`, §2 Learn). |
| 45 | `@notifee/react-native` (local display, channels, weekly trigger) | `flutter_local_notifications` | PRESENT | Foreground FCM display parity is in §4b. |
| 46 | `@react-native-async-storage/async-storage` | `shared_preferences` + `flutter_secure_storage` | PRESENT | Tokens move to secure storage, so existing users must log in again after migrating from the RN build (§5 transport). |
| 47 | `@react-native-clipboard/clipboard` | `flutter/services` `Clipboard` | PRESENT | |
| 48 | `@react-native-community/netinfo` (`useNetworkConnectivity`) | `connectivity_plus` (`core/realtime/connectivity.dart`) | PRESENT | v2. |
| 49 | `@react-native-firebase/app` + `messaging` | `firebase_core` + `firebase_messaging` | PARTIAL | Unchanged: config files absent (row 22). |
| 50 | `@react-native-firebase/crashlytics` (ErrorBoundary) | `firebase_crashlytics` | PRESENT | v2: wired (`core/errors/crash_reporting.dart`); reports only once the Firebase config exists. |
| 51 | `@react-native-google-signin/google-signin` | `google_sign_in` | PARTIAL | Unchanged (credentials: client ids, plist). |
| 52 | `@react-native-masked-view/masked-view` (ShinyText) | `ShaderMask` | see §3 ShinyText | PRESENT | |
| 53 | `@react-navigation/*` (bottom-tabs, drawer, native, native-stack) | `go_router` + custom shell/drawer | PRESENT | §1. |
| 54 | `@react-navigation/stack` | — | N/A | Unused in RN. |
| 55 | `@reduxjs/toolkit` + `react-redux` | `flutter_riverpod` | PRESENT | §6. |
| 56 | `@sayem314/react-native-keep-awake` (useListeningCommon, SimulationAssistantScreen) | `wakelock_plus` (`core/realtime/keep_awake.dart`) | PRESENT | v2. |
| 57 | `@shopify/react-native-skia` | — | N/A | Unused in RN. |
| 58 | `@wuba/react-native-echarts` + `echarts` (CustomLineChart) | — | N/A | CustomLineChart is never rendered (§3). |
| 59 | `i18next` + `react-i18next` | custom `localization_controller.dart` / `translations.dart` | PRESENT | §7. |
| 60 | `lodash` | — | N/A | No direct imports. |
| 61 | `lottie-react-native` (4 files) | `lottie` | PRESENT | v2: splash + `summaryLoading.json` (`summary_generation_progress.dart:184`). `botThinking.json` is RN-dead (only exported from `assets/animations/index.ts`). |
| 62 | `react-native-audio-api` (SimulationAudioPlayer) | `audioplayers` (`simulation_audio_player*.dart`) | PRESENT | v2: SimulationFeedback recording player landed (`bc9381b`). |
| 63 | `react-native-calendars` | — | N/A | Unused in RN. |
| 64 | `react-native-chart-kit` (ChartComponent) | — | N/A | ChartComponent is never rendered (§3). |
| 65 | `react-native-confetti-cannon` (CelebrationModal, QuizItemPlayer, BadgePopup) | `confetti` | PRESENT | v2: celebration modal, quiz player and badge popup all use `confetti`. |
| 66 | `react-native-config` | `--dart-define` / `AppConfig` | PRESENT | §9. |
| 67 | `react-native-fs` (fileOperations.saveFile, useVoiceNoteRecorder) | `path_provider` + `dart:io` | PRESENT | v2: export ported (`summary_file_export.dart`). |
| 68 | `react-native-gesture-handler` / `reanimated` / `screens` / `safe-area-context` / `keyboard-aware-scroll-view` / `size-matters` / `linear-gradient` / `svg` / `tab-view` | Flutter framework (`rn_scale.dart` for size-matters), `flutter_svg`, `TabBar` | PRESENT | Framework-level equivalents. |
| 69 | `react-native-image-picker` (useProfileImage) | `image_picker` | PRESENT | The jpeg/png restriction is missing (§2 account). |
| 70 | `react-native-live-audio-stream` (useLiveAudioStream, useVoiceNoteRecorder) | `record` (PCM stream) | PRESENT | |
| 71 | `react-native-network-logger` (NetworkLogs) | — | N/A | Dev-only "Logs" bubble (`ENVIRONMENT==='development'`). |
| 72 | `react-native-pager-view` | — | N/A | Unused in RN. |
| 73 | `react-native-permissions` (7 files: mic, notifications, photo; `openSettings`) | `permission_handler` | PRESENT | v2: Open-Settings alert (`microphone_permission.dart`). |
| 74 | `react-native-reanimated-carousel` (Carousel) | — | N/A | The Carousel is never rendered. |
| 75 | `react-native-sound-player` (breath.mp3, start/end simulation sounds) | `audioplayers` (`breath_sound_player.dart`) | PRESENT | v2 (`d12a201`): start/end simulation sounds (`roleplay/presentation/simulation_sound_player.dart`). |
| 76 | `react-native-version-check` (`utils/version.ts`: store URL + version compare) | `package_info_plus` + `core/app_update/force_update.dart` | PRESENT | v2: force update ported; store URLs are constants (`force_update.dart:17-18`). |
| 77 | `react-native-video` (VideoItemPlayer, QuestionMedia, VideoPreview) | `video_player` | PRESENT | v2: QuestionMedia video ported (`courses/presentation/question_media.dart`). |
| 78 | `react-native-walkthrough-tooltip` (InfoTooltip, PrivacyTooltip) | `info_tooltip_icon.dart`, `listening_chrome.dart` (`showPrivacyTooltip`) | PARTIAL | v2: PrivacyTooltip on both listening screens (`listening_chrome.dart`). Still missing on the call-summary AddNotesSection (RN `AddNotesSection.tsx:65`; nothing in `summary_generation_progress.dart`). |
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
| 1 | Crashlytics `log()` + `recordError(error, 'UnhandledRenderError')` from the global ErrorBoundary, with fallback UI | `components/ErrorBoundary/ErrorBoundary.tsx`, `App.tsx` | `core/errors/crash_reporting.dart`, `core/errors/error_boundary.dart` | PRESENT | v2 (`0885d07`): global handlers + fallback UI; reporting guarded on Firebase. |
| 2 | Crashlytics native crash reporting (auto, via RN Firebase) | native | the plugin is in pubspec, but there's no Firebase config file (§10 row 22) and no init | PARTIAL | v2: plugin initialised when Firebase is; blocked only on the config files (credentials). |
| 3 | `SCRIBE_START_DIAGNOSTIC` socket event at Scribe start (mic/device diagnostics to the backend) | `MicrophoneListeningScreen.tsx:450` | `core/realtime/socket_events.dart:17`, `scribe_recording_screen.dart:140-177` | PRESENT | v2 (`cd51b4d`): emitted at 5s/15s like RN. |
| 4 | Dev logger (`utils/logger.ts`, console only when `ENVIRONMENT==='development'`) | `utils/logger.ts` | `debugPrint` / `log` | N/A | Dev only. |


---

## Not determined / limits of this audit

- **v2 re-audit (2026-10-28, master `227db3a`).** Every v1 PARTIAL/MISSING/MERGED row was re-read on master, plus about 10% of PRESENT rows in the areas that changed. MERGED rows no longer exist: the reviews code was re-read on master and is PRESENT.
- **Runtime behaviour was still not exercised.** Nothing was built or run, so these are code-reading verdicts. Firebase-dependent paths (FCM registration and deregistration, Crashlytics reporting) can't be proven until the config files exist. The same goes for Google and Apple sign-in on device, the iPad orientation behaviour, and the force-update modal against a real `/app-version` response.
- **Hardcoded English literals in Flutter** (§7 row 9) were spot-checked by grep, not audited exhaustively.
- **Backend consumers were not checked.** Flutter now emits `SCRIBE_START_DIAGNOSTIC` and sends `enableRecommendations: true`; whether the backend still reads either is unverified.
- **Release identity is a product decision, not a parity verdict.** It covers the bundle id / applicationId (`com.helloally.app` vs `com.helloally.allyMobileFlutter` / `com.helloally.ally_mobile_flutter`) and whether Flutter ships as an update to the RN app. That choice affects token migration from AsyncStorage, the force-update store URLs (which currently point at the RN listings), Firebase and OAuth client registration, entitlements and signing. It also covers whether iPad is a supported target (Flutter `TARGETED_DEVICE_FAMILY = "1,2"`, RN iPhone-only).
- **Scripts and raw outputs:** `scratchpad/scripts/{i18n.py,assets2.py,v2_s4.py}`, `inventory/{i18n.json,assets_final.txt}`, and the per-part source files in `inventory/parts/`.
