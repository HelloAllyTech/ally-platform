import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_screen.dart';

import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

void main() {
  setUpAll(() {
    registerFallbackValue(const CallLogFilterState());
  });

  testWidgets(
    'picking a Status chip and tapping Apply refetches with that filter and shows the active-count badge',
    (tester) async {
      final repository = MockCallLogRepository();
      when(() => repository.getCallLogs(archive: false, filter: any(named: 'filter')))
          .thenAnswer((_) async => []);

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: [
          GoRoute(path: '/call-log', builder: (context, state) => const CallLogScreen()),
        ],
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewCallLogs, UserPermissions.viewChatDetails],
          ),
        ],
      );

      // Only the first call (the default, empty filter) has happened so far.
      verify(
        () => repository.getCallLogs(archive: false, filter: const CallLogFilterState()),
      ).called(1);

      await tester.tap(find.byIcon(Icons.filter_list));
      await tester.pumpAndSettle();

      expect(find.text('Filters'), findsOneWidget);
      await tester.tap(find.text('Generated'));
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();

      verify(
        () => repository.getCallLogs(
          archive: false,
          filter: const CallLogFilterState(statuses: ['SUCCESS']),
        ),
      ).called(1);
      expect(find.text('1'), findsOneWidget, reason: 'the active-filter-count badge');
    },
  );

  testWidgets('Clear resets the draft before Apply, and the badge disappears', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallLogs(archive: false, filter: any(named: 'filter')))
        .thenAnswer((_) async => []);

    await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: [
        GoRoute(path: '/call-log', builder: (context, state) => const CallLogScreen()),
      ],
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith(
          (ref) async => [UserPermissions.viewCallLogs, UserPermissions.viewChatDetails],
        ),
      ],
    );

    await tester.tap(find.byIcon(Icons.filter_list));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Generated'));
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(find.text('1'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.filter_list));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Clear'));
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    verify(
      () => repository.getCallLogs(archive: false, filter: const CallLogFilterState()),
    ).called(2); // the initial fetch, then the Clear-triggered refetch.
    expect(find.text('1'), findsNothing);
  });
}
