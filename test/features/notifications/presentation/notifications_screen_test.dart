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
}) =>
    NotificationItem(
      id: id,
      type: 'SYSTEM',
      title: title,
      body: body,
      readAt: readAt,
      createdAt: '2026-10-01T10:00:00.000Z',
    );

void main() {
  late MockNotificationsRepository repository;

  setUp(() {
    repository = MockNotificationsRepository();
  });

  testWidgets('shows a loading indicator while the list is in flight', (tester) async {
    final completer = Completer<List<NotificationItem>>();
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
    when(() => repository.list()).thenAnswer((_) async => []);

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text("You're all caught up — no notifications yet."), findsOneWidget);
  });

  testWidgets('renders read and unread notifications with the right styling', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => [
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
          _item(id: 'n2', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]);

    await preWarmTranslations(tester);
    await pumpApp(
      tester,
      const NotificationsScreen(),
      overrides: [notificationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Unread title'), findsOneWidget);
    expect(find.text('Read title'), findsOneWidget);
    expect(find.byIcon(Icons.notifications_active), findsOneWidget);
    expect(find.byIcon(Icons.notifications_none), findsOneWidget);
  });

  testWidgets('tapping an unread notification marks it read and refreshes', (tester) async {
    when(() => repository.list()).thenAnswer((_) async => [
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
        ]);
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
    when(() => repository.list()).thenAnswer((_) async => [
          _item(id: 'n2', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]);

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
    when(() => repository.list()).thenAnswer((_) async => [
          _item(id: 'n1', title: 'Unread title', body: 'Unread body'),
        ]);
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
    when(() => repository.list()).thenAnswer((_) async => [
          _item(id: 'n1', title: 'Read title', body: 'Read body', readAt: '2026-10-02T00:00:00.000Z'),
        ]);

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
      (_) async => [_item(id: 'n1', title: 'Unread title', body: 'Unread body')],
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
    when(() => repository.list()).thenAnswer((_) async => []);

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

    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });
}
