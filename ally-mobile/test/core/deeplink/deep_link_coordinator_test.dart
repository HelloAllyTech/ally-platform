import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:ally_mobile_flutter/core/deeplink/deep_link_binding.dart';
import 'package:ally_mobile_flutter/core/deeplink/deep_link_coordinator.dart';

class _FakeNavigator implements DeepLinkNavigator {
  @override
  String currentPath = '/splash';

  final List<String> log = [];

  @override
  Future<void> openCallSummary(int callId) async => log.add('summary:$callId');

  @override
  void openCourse(String trackId) => log.add('course:$trackId');
}

/// The pending-link flow of RN RootNavigator: summary links wait for
/// sign-in and the summary fields, course links for sign-in and a landed
/// route; both are held through sign-in.
void main() {
  const uuid = '3f2a6c1e-9b7d-4e2a-8c1f-0a1b2c3d4e5f';
  final summaryUri = Uri.parse('https://app.helloally.ai/summary/42');
  final courseUri = Uri.parse('https://app.helloally.ai/course/$uuid');

  late _FakeNavigator navigator;
  late Completer<bool> fields;
  late int fieldLoads;
  late DeepLinkCoordinator coordinator;

  setUp(() {
    navigator = _FakeNavigator();
    fields = Completer<bool>();
    fieldLoads = 0;
    coordinator = DeepLinkCoordinator(
      navigator: navigator,
      loadSummaryFields: () {
        fieldLoads++;
        return fields.future;
      },
    );
  });

  group('summary link', () {
    test('signed out: held through sign-in, then opened once the summary fields load', () async {
      coordinator.handleUri(summaryUri);
      await pumpEventQueue();
      expect(navigator.log, isEmpty);
      expect(coordinator.pendingCallId, 42);
      expect(fieldLoads, 0, reason: 'nothing to load before sign-in');

      coordinator.setAuthenticated(true);
      await pumpEventQueue();
      expect(navigator.log, isEmpty, reason: 'summary fields still loading');

      fields.complete(true);
      await pumpEventQueue();
      expect(navigator.log, ['summary:42']);
      expect(coordinator.pendingCallId, isNull);
    });

    test('signed in with fields loaded: opens right away', () async {
      fields.complete(true);
      coordinator.setAuthenticated(true);
      coordinator.handleUri(summaryUri);
      await pumpEventQueue();
      expect(navigator.log, ['summary:42']);
    });

    test('a failed summary-fields load keeps the link held; the next sign-in retries', () async {
      coordinator.handleUri(summaryUri);
      coordinator.setAuthenticated(true);
      fields.complete(false);
      await pumpEventQueue();
      expect(navigator.log, isEmpty);
      expect(coordinator.pendingCallId, 42);

      fields = Completer<bool>()..complete(true);
      coordinator.setAuthenticated(false);
      coordinator.setAuthenticated(true);
      await pumpEventQueue();
      expect(navigator.log, ['summary:42']);
    });

    test('a newer summary link replaces a held one', () async {
      coordinator.handleUri(summaryUri);
      coordinator.handleUri(Uri.parse('https://app.helloally.ai/summary/7'));
      coordinator.setAuthenticated(true);
      fields.complete(true);
      await pumpEventQueue();
      expect(navigator.log, ['summary:7']);
    });
  });

  group('course link', () {
    test('signed out: held through sign-in and the post-login routes', () {
      coordinator.handleUri(courseUri);
      expect(navigator.log, isEmpty);

      navigator.currentPath = '/login';
      coordinator.setAuthenticated(true);
      expect(navigator.log, isEmpty, reason: 'still on the way in');

      navigator.currentPath = '/complete-profile';
      coordinator.openPendingCourse();
      expect(navigator.log, isEmpty);

      navigator.currentPath = '/home';
      coordinator.openPendingCourse();
      expect(navigator.log, ['course:$uuid']);

      coordinator.openPendingCourse();
      expect(navigator.log, ['course:$uuid'], reason: 'opens once');
    });

    test('signed in on a regular screen: opens right away', () {
      coordinator.setAuthenticated(true);
      navigator.currentPath = '/home';
      coordinator.handleUri(courseUri);
      expect(navigator.log, ['course:$uuid']);
    });

    test('dropped, not deferred, while a listening screen is open', () {
      coordinator.setAuthenticated(true);
      navigator.currentPath = '/conference-listening/9';
      coordinator.handleUri(courseUri);
      expect(navigator.log, isEmpty);
      expect(coordinator.pendingTrackId, isNull);

      navigator.currentPath = '/home';
      coordinator.openPendingCourse();
      expect(navigator.log, isEmpty);
    });
  });

  test('unsupported links do nothing', () async {
    coordinator.setAuthenticated(true);
    navigator.currentPath = '/home';
    coordinator.handleUri(Uri.parse('https://example.com/summary/1'));
    coordinator.handleUri(Uri.parse('https://app.helloally.ai/course/not-a-uuid'));
    await pumpEventQueue();
    expect(navigator.log, isEmpty);
    expect(fieldLoads, 0);
  });

  group('GoRouterDeepLinkNavigator', () {
    Widget page(String name) => Scaffold(body: Text(name));

    GoRouter buildRouter() => GoRouter(
          initialLocation: '/splash',
          routes: [
            GoRoute(path: '/splash', builder: (_, _) => page('splash')),
            GoRoute(path: '/home', builder: (_, _) => page('home')),
            GoRoute(path: '/call-log/:id', builder: (_, s) => page('summary ${s.pathParameters['id']}')),
            GoRoute(path: '/courses/:trackId', builder: (_, s) => page('course ${s.pathParameters['trackId']}')),
          ],
        );

    testWidgets('a summary resets to [home, summary], so back returns home', (tester) async {
      final router = buildRouter();
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      final nav = GoRouterDeepLinkNavigator(router);

      final done = nav.openCallSummary(42);
      await tester.pumpAndSettle();
      await done;
      await tester.pumpAndSettle();
      expect(find.text('summary 42'), findsOneWidget);
      expect(nav.currentPath, '/call-log/42');

      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });

    testWidgets('a course is pushed on top of the current screen', (tester) async {
      final router = buildRouter();
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      router.go('/home');
      await tester.pumpAndSettle();

      GoRouterDeepLinkNavigator(router).openCourse(uuid);
      await tester.pumpAndSettle();
      expect(find.text('course $uuid'), findsOneWidget);

      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });
  });
}
