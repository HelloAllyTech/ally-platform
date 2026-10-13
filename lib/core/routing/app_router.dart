import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/login_screen.dart';
import '../../features/courses/data/course_models.dart';
import '../../features/courses/presentation/course_detail_screen.dart';
import '../../features/courses/presentation/course_item_player_screen.dart';
import '../../features/courses/presentation/course_overview_screen.dart';
import '../../features/courses/presentation/course_progress_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/roleplay/presentation/roleplay_voice_screen.dart';
import '../../features/scribe/presentation/scribe_recording_screen.dart';
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
          );
        },
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
