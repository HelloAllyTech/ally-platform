import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_state.dart';
import '../routing/app_router.dart';
import '../settings/settings_repository.dart';
import 'deep_link_coordinator.dart';

/// The links the OS hands the app: `main.dart` overrides this with
/// `AppLinks().uriLinkStream` (the cold-start link, then every warm one).
/// Empty by default so widget tests that build the app never touch the
/// app_links platform channel.
final deepLinkStreamProvider = Provider<Stream<Uri>>((ref) => const Stream.empty());

/// Wires [DeepLinkCoordinator] to the router, auth state and the link
/// stream. `main.dart` watches this once, as RN mounts RootNavigator's link
/// effects once.
final deepLinkBindingProvider = Provider<DeepLinkCoordinator>((ref) {
  final router = ref.watch(appRouterProvider);
  final coordinator = DeepLinkCoordinator(
    navigator: GoRouterDeepLinkNavigator(router),
    loadSummaryFields: () async {
      try {
        await ref.read(summaryVisibleFieldsProvider.future);
        return true;
      } catch (_) {
        return false;
      }
    },
  );

  coordinator.setAuthenticated(ref.read(authControllerProvider).isAuthenticated);
  ref.listen(authControllerProvider, (previous, next) => coordinator.setAuthenticated(next.isAuthenticated));

  // RN re-runs openPendingCourse on every navigation state change.
  void onRouteChange() => coordinator.openPendingCourse();
  router.routerDelegate.addListener(onRouteChange);
  ref.onDispose(() => router.routerDelegate.removeListener(onRouteChange));

  final subscription = ref.watch(deepLinkStreamProvider).listen(
    coordinator.handleUri,
    // A malformed link from the OS must never take the app down.
    onError: (Object _) {},
  );
  ref.onDispose(subscription.cancel);

  return coordinator;
});

/// [DeepLinkNavigator] over the app's [GoRouter].
class GoRouterDeepLinkNavigator implements DeepLinkNavigator {
  GoRouterDeepLinkNavigator(this.router);

  final GoRouter router;

  /// The top screen's location. `currentConfiguration.uri` stays at the
  /// last `go` location under pushed screens (a pushed `/scribe` still reads
  /// `/home` there), so the top match's location is used instead.
  @override
  String get currentPath {
    final config = router.routerDelegate.currentConfiguration;
    return config.lastOrNull?.matchedLocation ?? config.uri.path;
  }

  /// RN resets the stack to [CallLog, CallSummary]. go_router has no
  /// multi-route reset, so: go to the home shell (RN's `CALL_LOG` route is
  /// the drawer/tab root), wait for it to land, then push the summary on
  /// top so its back button returns to Home (`fromLogs: true` pops).
  @override
  Future<void> openCallSummary(int callId) async {
    router.go('/home');
    for (var frame = 0; frame < 10 && currentPath != '/home'; frame++) {
      await WidgetsBinding.instance.endOfFrame;
    }
    unawaited(router.push('/call-log/$callId'));
  }

  @override
  void openCourse(String trackId) {
    unawaited(router.push('/courses/$trackId'));
  }
}
