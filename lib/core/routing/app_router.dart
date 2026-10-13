import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
import '../../features/courses/presentation/course_item_player_screen.dart';
import '../../features/courses/presentation/course_overview_screen.dart';
import '../../features/courses/presentation/course_progress_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/leaderboard/presentation/leaderboard_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/reviews/presentation/review_details_screen.dart';
import '../../features/reviews/presentation/review_screen.dart';
import '../../features/roleplay/presentation/roleplay_voice_screen.dart';
import '../../features/scribe/presentation/scribe_recording_screen.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/suspended/presentation/suspended_account_screen.dart';
import '../../features/simulations/presentation/simulation_details_screen.dart';
import '../../features/simulations/presentation/simulation_feedback_screen.dart';
import '../../features/simulations/presentation/simulation_path_details_screen.dart';
import '../../features/simulations/presentation/simulations_screen.dart';
import '../auth/auth_state.dart';

/// Mirrors RootNavigator's behavior (mentioned in `api.ts`'s logout comment:
/// "the navigator swaps to the auth stack the moment `isAuthenticated`
/// flips") using go_router's `redirect`, re-evaluated via `refreshListenable`
/// whenever auth state changes — no manual navigation calls scattered around
/// sign-in/logout call sites.
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/login',
    refreshListenable: _AuthStateListenable(ref),
    redirect: (context, state) {
      final isAuthenticated = ref.read(authControllerProvider).isAuthenticated;
      final isLoggingIn = state.matchedLocation == '/login';

      if (!isAuthenticated && !isLoggingIn) return '/login';
      if (isAuthenticated && isLoggingIn) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
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
        builder: (context, state) {
          // Dev-only: real navigation will carry the actual signed-in
          // user's id once auth/profile screens are ported.
          return const ScribeRecordingScreen(userId: 'dev-user');
        },
      ),
      GoRoute(
        path: '/courses',
        builder: (context, state) => const CourseOverviewScreen(),
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
          final item = state.extra as TrackDetailItem;
          return CourseItemPlayerScreen(item: item);
        },
      ),
      GoRoute(
        path: '/roleplay',
        builder: (context, state) {
          // `extra` mirrors RN's route.params for liveKitServerUrl/
          // accessToken — a real session-creation screen supplies these in
          // a later phase; this route exists to exercise the connection
          // itself against a real backend-issued pair.
          final params = state.extra as Map<String, String>? ?? const {};
          return RoleplayVoiceScreen(
            liveKitServerUrl: params['liveKitServerUrl'] ?? '',
            accessToken: params['accessToken'] ?? '',
            scenarioSessionId: params['scenarioSessionId'],
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
        ),
      ),
      GoRoute(
        path: '/simulation-paths/:pathId',
        builder: (context, state) =>
            SimulationPathDetailsScreen(pathId: state.pathParameters['pathId']!),
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
        path: '/bug-report',
        builder: (context, state) => const BugReportScreen(),
      ),
      GoRoute(
        path: '/search',
        builder: (context, state) => const SearchScreen(),
      ),
      GoRoute(
        path: '/simulations/feedback/:sessionId',
        builder: (context, state) => SimulationFeedbackScreen(
          scenarioSessionId: state.pathParameters['sessionId']!,
        ),
      ),
      GoRoute(
        path: '/reviews',
        builder: (context, state) => const ReviewScreen(),
      ),
      GoRoute(
        path: '/reviews/:reviewId',
        builder: (context, state) =>
            ReviewDetailsScreen(reviewId: state.pathParameters['reviewId']!),
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
        builder: (context, state) => const BoxBreathingScreen(),
      ),
    ],
  );
});

/// Bridges Riverpod's StateNotifier to a plain ChangeNotifier, which is what
/// go_router's `refreshListenable` expects.
class _AuthStateListenable extends ChangeNotifier {
  _AuthStateListenable(Ref ref) {
    ref.listen(authControllerProvider, (previous, next) {
      if (previous?.isAuthenticated != next.isAuthenticated) {
        notifyListeners();
      }
    });
  }
}
