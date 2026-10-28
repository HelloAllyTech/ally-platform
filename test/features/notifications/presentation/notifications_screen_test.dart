import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/notifications/data/notification_item.dart';
import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';
import 'package:ally_mobile_flutter/features/notifications/presentation/notifications_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';
import '../../../support/prewarm_translations.dart';

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

NotificationItem _item({
  required String id,
  required String title,
  required String body,
  String? readAt,
  String type = 'SYSTEM',
  Map<String, dynamic>? data,
}) =>
    NotificationItem(
      id: id,
      type: type,
      title: title,
      body: body,
      readAt: readAt,
      createdAt: '2026-10-01T10:00:00.000Z',
      data: data,
    );

({List<NotificationItem> items, int count}) _page(List<NotificationItem> items) =>
    (items: items, count: items.length);

void main() {
  late MockNotificationsRepository repository;

  setUp(() {
    repository = MockNotificationsRepository();
  });

  testWidgets('shows a loading indicator while the list is in flight', (tester) async {
    final completer = Completer<({List<NotificationItem> items, int count})>();
    when(() => repository.list()).thenAnswer((_) => completer.future);

    // A never-resolving list future keeps CircularProgressIndicator's own
    // indeterminate animation ticking forever, so `pumpAndSettle` (used by
    // the shared `pumpApp` helper) would time out here — pump explicitly
    // instead, same sequencing as `pumpApp` minus the final settle.
    await preWarmTranslations(tester);
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
        child: const MaterialApp(home: NotificationsScreen()),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows an error message when loading fails', (tester) async {
    when(() => repository.list()).thenThrow(Exception('network down'));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('Failed to load notifications'), findsOneWidget);
  });

  testWidgets('shows the empty message when there are no notifications', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([]));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text("You're all caught up — no notifications yet."), findsOneWidget);
  });

  testWidgets('renders read and unread notifications with the right styling', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
          _item(id: 'n2', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Unread title'), findsOneWidget);
    expect(find.text('Read title'), findsOneWidget);
    // RN marks unread rows with an 8pt primary dot (and a grey50 row).
    expect(find.byKey(const Key('unread-dot')), findsOneWidget);
  });

  testWidgets('tapping an unread notification marks it read and refreshes', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
        ]));
    when(() => repository.markRead('n1')).thenAnswer((_) async {});

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Unread title'));
    await tester.pumpAndSettle();

    verify(() => repository.markRead('n1')).called(1);
  });

  testWidgets('tapping an already-read notification does not call markRead', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([
          _item(id: 'n2', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Read title'));
    await tester.pumpAndSettle();

    verifyNever(() => repository.markRead(any()));
  });

  testWidgets('mark all read calls the repository', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
        ]));
    when(() => repository.markAllRead()).thenAnswer((_) async {});

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();

    verify(() => repository.markAllRead()).called(1);
  });

  testWidgets('hides "Mark all read" entirely when nothing is unread', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([
          _item(id: 'n1', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]));

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Mark all read'), findsNothing);
  });

  testWidgets('shows a relative "time ago" timestamp per item', (tester) async {
    when(() => repository.list()).thenAnswer(
      (_) async => _page([_item(id: 'n1', title: 'Unread title', body: 'Unread body')]),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    // createdAt is 2026-10-01, well over a week before "today" in these
    // tests — RN's own `timeAgo` falls back to a plain date past 7 days.
    expect(find.textContaining('10/1/2026'), findsOneWidget);
  });

  testWidgets('has a real back button that pops the route', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => _page([]));

    final router = await pumpRouterApp(
      tester,
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (context, state) => const Scaffold(body: Text('HOME'))),
        GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
      ],
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );
    router.push('/notifications');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('back-title-header-back')));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('scrolling near the bottom loads the next page and appends it', (tester) async {
    final page1 = List.generate(
      20,
      (i) => _item(id: 'n$i', title: 'Title $i', body: 'Body $i'),
    );
    final page2 = [_item(id: 'n20', title: 'Title 20', body: 'Body 20')];
    when(() => repository.list(limit: 25, offset: 0)).thenAnswer(
      (_) async => (items: page1, count: 21),
    );
    when(() => repository.list(limit: 25, offset: 20)).thenAnswer(
      (_) async => (items: page2, count: 21),
    );

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Title 20'), findsNothing, reason: 'not loaded yet');

    await tester.drag(find.byType(ListView), const Offset(0, -20000));
    await tester.pumpAndSettle();

    verify(() => repository.list(limit: 25, offset: 20)).called(1);
    await tester.drag(find.byType(ListView), const Offset(0, -20000));
    await tester.pumpAndSettle();
    expect(find.text('Title 20'), findsOneWidget);
  });

  testWidgets('tapping a course-discussion-reply notification navigates to the track', (tester) async {
    when(() => repository.list()).thenAnswer(
      (_) async => _page([
        _item(
          id: 'n1',
          title: 'New reply',
          body: 'Someone replied',
          type: 'COURSE_DISCUSSION_REPLY',
          data: {'trackId': 't1', 'itemId': 'i1', 'postId': 'p1'},
        ),
      ]),
    );
    when(() => repository.markRead('n1')).thenAnswer((_) async {});

    await pumpRouterApp(
      tester,
      initialLocation: '/notifications',
      routes: [
        GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
        GoRoute(
          path: '/courses/:trackId',
          builder: (context, state) => Text('TRACK:${state.pathParameters['trackId']}'),
        ),
      ],
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('New reply'));
    await tester.pumpAndSettle();

    verify(() => repository.markRead('n1')).called(1);
    expect(find.text('TRACK:t1'), findsOneWidget);
  });
}
