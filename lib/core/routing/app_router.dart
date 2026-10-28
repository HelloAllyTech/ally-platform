import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/account/data/account_repository.dart';
import '../../features/account/presentation/complete_profile_screen.dart';
import '../../features/account/presentation/profile_settings_screen.dart';
import '../../features/achievements/presentation/achievements_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/boxbreathing/presentation/box_breathing_screen.dart';
import '../../features/bugreport/presentation/bug_report_screen.dart';
import '../../features/calllog/data/call_log_repository.dart';
import '../../features/calllog/presentation/call_log_screen.dart';
import '../../features/calllog/presentation/call_summary_screen.dart';
import '../../features/community/presentation/community_screen.dart';
import '../../features/courses/data/course_models.dart';
import '../../features/courses/presentation/course_detail_screen.dart';
import '../../features/courses/data/start_item_payload.dart';
import '../../features/courses/presentation/breathing_exercise_screen.dart';
import '../../features/courses/presentation/course_item_player_screen.dart';
import '../../features/courses/presentation/course_progress_screen.dart';
import '../../features/leaderboard/presentation/leaderboard_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/progress/presentation/progress_screen.dart';
import '../../features/reactions/presentation/reactions_screen.dart';
import '../../features/reviews/presentation/review_details_screen.dart';
import '../../features/reviews/presentation/review_screen.dart';
import '../../features/reviews/presentation/share_for_review_screen.dart';
import '../../features/roleplay/presentation/roleplay_voice_screen.dart';
import '../../features/scribe/presentation/conference_listening_screen.dart';
import '../../features/scribe/presentation/scribe_recording_screen.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/simulations/data/simulation_models.dart';
import '../../features/simulations/presentation/case_details_screen.dart';
import '../../features/suspended/presentation/suspended_account_screen.dart';
import '../../features/simulations/presentation/simulation_details_screen.dart';
import '../../features/simulations/presentation/simulation_feedback_screen.dart';
import '../../features/simulations/presentation/simulation_path_details_screen.dart';
import '../../features/simulations/presentation/simulations_screen.dart';
import '../auth/auth_state.dart';
import '../navigation/app_shell_screen.dart';
import '../navigation/home_tab_navigation.dart';
import '../localization/translate_ref.dart';
import '../theme/app_colors.dart';
import 'launch_splash.dart';
import '../widgets/review_type_chip.dart';

/// `extra` shape for `/share-for-review/:scenarioSessionId` — one record
/// covers both real callers (edit-note's `reviewId`/`note`, and a fresh
/// share's session `contextDateTime`/`contextDuration`) since a route's
/// `extra` is a single `Object?` slot, not per-caller overloads.
typedef ShareForReviewArgs = ({
  String? reviewId,
  String? note,
  String? contextDateTime,
  String? contextDuration,
  bool isScribe,
  String? contextTitle,
});

/// [ShareForReviewArgs] plus the scenario context card's media and
/// description (RN `ShareSimulationScreen` `scenarioData.coverImageUrl /
/// coverVideoUrl / description`) — passed by the simulation callers
/// (Feedback's share, review details' edit-note). A separate record so the
/// scribe caller's plain [ShareForReviewArgs] keeps working unchanged.
typedef ShareSimulationForReviewArgs = ({
  ShareForReviewArgs args,
  String? coverImageUrl,
  String? coverVideoUrl,
  String? description,
});

/// The redirect gate's actual decision logic, extracted to a pure top-level
/// function so it's testable without constructing a real [GoRouterState]
/// (whose constructor needs a private `RouteConfiguration` not obtainable
/// outside go_router) or a full widget tree. Mechanical extraction only —
/// same branches, same order, same outputs as before; see
/// `test/core/routing/app_router_test.dart` for the behavior this locks in.
@visibleForTesting
String? computeRedirect({
  required bool isAuthenticated,
  required String matchedLocation,
  required bool? profileCompleted,
  bool isRestored = true,
  bool isSplashFinished = true,
  bool isUserLoading = false,
}) {
  // Launch: RN's SplashScreen plays its animation on every cold start and
  // only routes once it has ended (`isAnimationEnded`) and, signed in, once
  // `/users/me` has settled (`isUserLoading`), so the profile-completion
  // gate is known. A failed `/users/me` still moves on (no logout on
  // network errors; a 401 is the auth interceptor's job).
  if (!isRestored) return matchedLocation == '/splash' ? null : '/splash';
  final isLaunching = matchedLocation == '/splash';
  if (isLaunching && (!isSplashFinished || (isAuthenticated && isUserLoading))) return null;
  // Signed in, the splash leaves exactly like /login does (to Home or
  // complete-profile below); signed out, the generic rule sends it to /login.
  final isLoggingIn = matchedLocation == '/login' || (isLaunching && isAuthenticated);
  final isCompletingProfile = matchedLocation == '/complete-profile';
  // RN keeps SuspendedAccountScreen as a sibling of the login screen inside
  // the same "not authenticated" stack branch (RootNavigator.tsx's `else`
  // arm) — no redirect logic to fight there. go_router's redirect gate needs
  // this spelled out explicitly, or a suspended user pushed here while still
  // unauthenticated gets immediately bounced back to /login by the branch
  // below before ever seeing the screen.
  final isSuspended = matchedLocation == '/suspended';

  if (!isAuthenticated && !isLoggingIn && !isSuspended) return '/login';
  if (!isAuthenticated) return null;

  // `profileCompleted == null` means "not yet known" (the very first
  // `/users/me` fetch is still in flight) rather than "incomplete", so no
  // redirect fires on it until there's a real answer.
  final profileIncomplete = profileCompleted != null && !profileCompleted;

  if (isLoggingIn) return profileIncomplete ? '/complete-profile' : '/home';
  if (profileIncomplete && !isCompletingProfile) return '/complete-profile';
  if (!profileIncomplete && isCompletingProfile) return '/home';
  return null;
}

/// Mirrors RootNavigator's behavior (mentioned in `api.ts`'s logout comment:
/// "the navigator swaps to the auth stack the moment `isAuthenticated`
/// flips") using go_router's `redirect`, re-evaluated via `refreshListenable`
/// whenever auth state changes — no manual navigation calls scattered around
/// sign-in/logout call sites.
///
/// Also enforces the real app's first-login gate: a bulk-created account
/// with `profileCompleted == false` (per `src/types/user.ts`'s own comment)
/// gets forced to CompleteProfileScreen before reaching anything else,
/// same as RootNavigator does. Previously a documented TODO; now wired.
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: _RouterRefreshListenable(ref),
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final isAuthenticated = auth.isAuthenticated;
      // Profile-completion status isn't known synchronously — read
      // whatever's currently cached (null while the very first fetch is
      // still in flight) rather than block routing on it.
      final userAsync = ref.read(currentUserProvider);
      return computeRedirect(
        isAuthenticated: isAuthenticated,
        matchedLocation: state.matchedLocation,
        profileCompleted: userAsync.value?.profileCompleted,
        isRestored: auth.isRestored,
        isSplashFinished: ref.read(launchSplashProvider).finished,
        isUserLoading: !userAsync.hasValue && !userAsync.hasError,
      );
    },
    routes: [
      GoRoute(path: '/splash', builder: (context, state) => const LaunchSplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/home',
        builder: (context, state) => AppShellScreen(
          tabRequest: state.extra is HomeTabRequest ? state.extra as HomeTabRequest : null,
        ),
      ),
      GoRoute(
        path: '/complete-profile',
        builder: (context, state) => const CompleteProfileScreen(),
      ),
      GoRoute(
        path: '/profile',
        builder: (context, state) => const ProfileSettingsScreen(),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/scribe',
        builder: (context, state) => _CurrentUserGate(builder: (userId) => ScribeRecordingScreen(userId: userId)),
      ),
      GoRoute(
        path: '/conference-listening/:chatId',
        builder: (context, state) => _CurrentUserGate(
          builder: (userId) => ConferenceListeningScreen(
            chatId: int.parse(state.pathParameters['chatId']!),
            userId: userId,
          ),
        ),
      ),
      GoRoute(
        path: '/courses/:trackId',
        builder: (context, state) =>
            CourseDetailScreen(trackId: state.pathParameters['trackId']!),
      ),
      GoRoute(
        path: '/courses/:trackId/progress',
        builder: (context, state) =>
            CourseProgressScreen(trackId: state.pathParameters['trackId']!),
      ),
      GoRoute(
        path: '/courses/item/:itemId',
        builder: (context, state) {
          final extra = state.extra;
          // A discussion-reply notification opens the player by id alone.
          if (extra is CourseItemPlayerArgs) {
            return CourseItemPlayerScreen(
              trackId: extra.trackId,
              item: extra.item,
              itemId: state.pathParameters['itemId'],
              highlightPostId: extra.highlightPostId,
            );
          }
          final args = extra as ({String trackId, TrackDetailItem item});
          return CourseItemPlayerScreen(trackId: args.trackId, item: args.item);
        },
      ),
      GoRoute(
        path: '/breathing-exercise',
        builder: (context, state) =>
            BreathingExerciseScreen(config: state.extra as BreathingExerciseContent),
      ),
      GoRoute(
        path: '/roleplay',
        builder: (context, state) {
          // `extra` mirrors RN's route.params for liveKitServerUrl/
          // accessToken/scenario — `scenario` carries the timer/pause/
          // focus-mode config the live call UI needs (maxTimeValue,
          // pauseEnabled, experienceMode, title, triggerWarnings).
          final params = state.extra as Map<String, dynamic>? ?? const {};
          return RoleplayVoiceScreen(
            liveKitServerUrl: params['liveKitServerUrl'] as String? ?? '',
            accessToken: params['accessToken'] as String? ?? '',
            scenarioSessionId: params['scenarioSessionId'] as String?,
            scenario: params['scenario'] as Scenario?,
            pathId: params['pathId'] as String?,
            caseId: params['caseId'] as String?,
            languageId: params['languageId'] as int?,
          );
        },
      ),
      GoRoute(
        path: '/simulations',
        builder: (context, state) => const SimulationsScreen(),
      ),
      GoRoute(
        path: '/simulations/:scenarioId',
        builder: (context, state) => SimulationDetailsScreen(
          scenarioId: int.parse(state.pathParameters['scenarioId']!),
          initialScenario: state.extra as Scenario?,
        ),
      ),
      GoRoute(
        path: '/simulation-paths/:pathId',
        builder: (context, state) => SimulationPathDetailsScreen(
          pathId: state.pathParameters['pathId']!,
        ),
      ),
      GoRoute(
        path: '/leaderboard',
        builder: (context, state) => const LeaderboardScreen(),
      ),
      GoRoute(
        path: '/achievements',
        builder: (context, state) => const AchievementsScreen(),
      ),
      GoRoute(
        path: '/progress',
        builder: (context, state) => const ProgressScreen(),
      ),
      GoRoute(
        path: '/bug-report',
        builder: (context, state) => BugReportScreen(screenName: state.extra as String?),
      ),
      GoRoute(
        path: '/search',
        builder: (context, state) => const SearchScreen(),
      ),
      GoRoute(
        path: '/simulations/feedback/:sessionId',
        builder: (context, state) => SimulationFeedbackScreen(
          scenarioSessionId: state.pathParameters['sessionId']!,
          fromLogs: state.uri.queryParameters['fromLogs'] == 'true',
          pathId: state.uri.queryParameters['pathId'],
          caseId: state.uri.queryParameters['caseId'],
          languageId: int.tryParse(state.uri.queryParameters['languageId'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/reviews',
        builder: (context, state) => const ReviewScreen(),
      ),
      GoRoute(
        path: '/reviews/:reviewId',
        builder: (context, state) => ReviewDetailsScreen(
          reviewId: state.pathParameters['reviewId']!,
          reviewType: (state.extra as ReviewType?) ?? ReviewType.simulation,
        ),
      ),
      GoRoute(
        path: '/call-log',
        builder: (context, state) => const CallLogScreen(),
      ),
      GoRoute(
        path: '/call-log/:id',
        // `extra` (the list row) is optional, so a deep link or restored
        // route still opens; `?live=1` is the post-call flow (RN navigates
        // to CallSummary with no `callId`).
        builder: (context, state) => CallSummaryScreen(
          log: state.extra is CallLogItem ? state.extra as CallLogItem : null,
          chatId: int.tryParse(state.pathParameters['id'] ?? ''),
          fromLogs: state.uri.queryParameters['live'] != '1',
        ),
      ),
      GoRoute(
        // RN Breathing's "View call summary" with no current chat.
        path: '/call-summary',
        builder: (context, state) => const CallSummaryScreen(fromLogs: false),
      ),
      GoRoute(
        path: '/community',
        builder: (context, state) => const CommunityScreen(),
      ),
      GoRoute(
        path: '/suspended',
        builder: (context, state) => const SuspendedAccountScreen(),
      ),
      GoRoute(
        path: '/box-breathing',
        // `?chatId=` — the call that just ended (Scribe passes it), for
        // the screen's "View Call Summary" button.
        builder: (context, state) => BoxBreathingScreen(
          chatId: int.tryParse(state.uri.queryParameters['chatId'] ?? ''),
        ),
      ),
      GoRoute(
        path: '/cases/:caseId',
        builder: (context, state) =>
            CaseDetailsScreen(caseId: state.pathParameters['caseId']!),
      ),
      GoRoute(
        path: '/share-for-review/:scenarioSessionId',
        builder: (context, state) {
          // Edit-note mode (from ReviewDetailsScreen) passes reviewId/note;
          // the fresh-share flow (from SimulationFeedbackScreen) instead
          // passes the session's own date/duration as the context card's
          // data — one combined optional-fields record covers both, since
          // the path's own `scenarioSessionId` is a dummy value in edit
          // mode anyway (editing only PATCHes the existing review, it
          // never needs the session id).
          final extra = state.extra;
          final scenario = extra is ShareSimulationForReviewArgs ? extra : null;
          final args = scenario?.args ?? (extra is ShareForReviewArgs ? extra : null);
          return ShareForReviewScreen(
            scenarioSessionId: state.pathParameters['scenarioSessionId']!,
            reviewId: args?.reviewId,
            isEditNote: args?.reviewId != null,
            initialNote: args?.note,
            isScribe: args?.isScribe ?? false,
            contextTitle: args?.contextTitle,
            contextDateTime: args?.contextDateTime,
            contextDuration: args?.contextDuration,
            contextCoverImageUrl: scenario?.coverImageUrl,
            contextCoverVideoUrl: scenario?.coverVideoUrl,
            contextDescription: scenario?.description,
          );
        },
      ),
      GoRoute(
        path: '/reactions/:reviewId',
        builder: (context, state) => ReactionsScreen(
          reviewId: state.pathParameters['reviewId']!,
          reviewType: (state.extra as ReviewType?) ?? ReviewType.simulation,
        ),
      ),
    ],
  );
});

/// Bridges Riverpod state to a plain ChangeNotifier, which is what
/// go_router's `refreshListenable` expects. Listens to both auth state
/// (sign-in/out) and the current user fetch (so the profileCompleted gate
/// above re-evaluates the moment that resolves, rather than only on the
/// next unrelated navigation).
class _RouterRefreshListenable extends ChangeNotifier {
  _RouterRefreshListenable(Ref ref) {
    ref.listen(authControllerProvider, (previous, next) {
      if (previous?.isAuthenticated != next.isAuthenticated || previous?.isRestored != next.isRestored) {
        notifyListeners();
      }
    });
    ref.listen(currentUserProvider, (previous, next) {
      bool settled(AsyncValue<Object?>? v) => v != null && (v.hasValue || v.hasError);
      if (previous?.value?.profileCompleted != next.value?.profileCompleted || settled(previous) != settled(next)) {
        notifyListeners();
      }
    });
    ref.listen(launchSplashProvider, (previous, next) {
      if (previous?.finished != next.finished) notifyListeners();
    });
  }
}

/// The listening screens key their socket and transcript speaker on the
/// signed-in user's id (RN reads it from the Redux user, always loaded by
/// then). Until `/users/me` resolves, show the listening screen's dark
/// background with a spinner rather than starting a session under a
/// made-up id.
class _CurrentUserGate extends ConsumerWidget {
  const _CurrentUserGate({required this.builder});

  final Widget Function(String userId) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final userId = user.value?.id.toString();
    if (userId != null) return builder(userId);
    return Scaffold(
      backgroundColor: AppColors.darkGray7,
      body: Center(
        child: user.hasError && !user.isLoading
            ? Text(ref.t('common.somethingWentWrong'), style: const TextStyle(color: Colors.white))
            : const CircularProgressIndicator.adaptive(),
      ),
    );
  }
}
