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
import '../../features/preferences/presentation/preferences_screen.dart';
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
}) {
  // Launch: wait on the blank splash until the stored session is read.
  if (!isRestored) return matchedLocation == '/splash' ? null : '/splash';
  final isLaunching = matchedLocation == '/splash';
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
      final user = ref.read(currentUserProvider).value;
      return computeRedirect(
        isAuthenticated: isAuthenticated,
        matchedLocation: state.matchedLocation,
        profileCompleted: user?.profileCompleted,
        isRestored: auth.isRestored,
      );
    },
    routes: [
      GoRoute(path: '/splash', builder: (context, state) => const _LaunchScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/home',
        builder: (context, state) => const AppShellScreen(),
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
        path: '/preferences',
        builder: (context, state) => const PreferencesScreen(),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/scribe',
        builder: (context, state) {
          final userId = ref.read(currentUserProvider).value?.id.toString() ?? 'dev-user';
          return ScribeRecordingScreen(userId: userId);
        },
      ),
      GoRoute(
        path: '/conference-listening/:chatId',
        builder: (context, state) {
          final userId = ref.read(currentUserProvider).value?.id.toString() ?? 'dev-user';
          return ConferenceListeningScreen(
            chatId: int.parse(state.pathParameters['chatId']!),
            userId: userId,
          );
        },
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
          final args = state.extra as ({String trackId, TrackDetailItem item});
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
        builder: (context, state) {
          final log = state.extra as CallLogItem;
          return CallSummaryScreen(log: log);
        },
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
          final args = state.extra as ShareForReviewArgs?;
          return ShareForReviewScreen(
            scenarioSessionId: state.pathParameters['scenarioSessionId']!,
            reviewId: args?.reviewId,
            isEditNote: args?.reviewId != null,
            initialNote: args?.note,
            isScribe: args?.isScribe ?? false,
            contextTitle: args?.contextTitle,
            contextDateTime: args?.contextDateTime,
            contextDuration: args?.contextDuration,
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
      if (previous?.value?.profileCompleted != next.value?.profileCompleted) {
        notifyListeners();
      }
    });
  }
}

/// Shown for the moment it takes to read the stored session at launch;
/// blank like the native launch screen it follows.
class _LaunchScreen extends StatelessWidget {
  const _LaunchScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(backgroundColor: Colors.white);
}
