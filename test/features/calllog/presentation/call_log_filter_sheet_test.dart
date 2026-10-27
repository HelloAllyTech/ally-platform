import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/data/custom_fields_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_screen.dart';

import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

class MockCustomFieldsRepository extends Mock implements CustomFieldsRepository {}

void main() {
  setUpAll(() {
    registerFallbackValue(const CallLogFilterState());
  });

  testWidgets(
    'picking a Status chip and tapping Apply refetches with that filter and shows the active-count badge',
    (tester) async {
      final repository = MockCallLogRepository();
      when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false, filter: any(named: 'filter')))
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
        () => repository.getCallLogs(limit: kCallLogPageSize, archive: false, filter: const CallLogFilterState()),
      ).called(1);

      await tester.tap(find.byIcon(Icons.filter_list));
      await tester.pumpAndSettle();

      expect(find.text('Filters'), findsOneWidget);
      await tester.tap(find.text('Generated'));
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();

      verify(
        () => repository.getCallLogs(
          limit: kCallLogPageSize,
          archive: false,
          filter: const CallLogFilterState(statuses: ['SUCCESS']),
        ),
      ).called(1);
      expect(find.text('1'), findsOneWidget, reason: 'the active-filter-count badge');
    },
  );

  testWidgets('Clear resets the draft before Apply, and the badge disappears', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false, filter: any(named: 'filter')))
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
      () => repository.getCallLogs(limit: kCallLogPageSize, archive: false, filter: const CallLogFilterState()),
    ).called(2); // the initial fetch, then the Clear-triggered refetch.
    expect(find.text('1'), findsNothing);
  });

  testWidgets(
    'custom fields: a filterable definition renders and selecting it refetches with fieldFilters',
    (tester) async {
      final repository = MockCallLogRepository();
      final customFieldsRepository = MockCustomFieldsRepository();
      when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false, filter: any(named: 'filter')))
          .thenAnswer((_) async => []);
      when(() => customFieldsRepository.getDefinitions()).thenAnswer(
        (_) async => [
          CustomFieldDefinition(
            id: 'cf-risk',
            name: 'Risk Level',
            fieldType: CustomFieldType.singleSelect,
            sectionKey: 'intake',
            editPermission: CustomFieldEditPermission.both,
            options: const [
              CustomFieldOption(id: 'opt-low', label: 'Low', order: 1),
              CustomFieldOption(id: 'opt-high', label: 'High', order: 2),
            ],
          ),
          // Explicitly unfilterable: must not appear in the sheet at all.
          const CustomFieldDefinition(
            id: 'cf-hidden',
            name: 'Internal Notes',
            fieldType: CustomFieldType.text,
            sectionKey: 'intake',
            editPermission: CustomFieldEditPermission.both,
            filterable: false,
          ),
        ],
      );

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: [
          GoRoute(path: '/call-log', builder: (context, state) => const CallLogScreen()),
        ],
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          customFieldsRepositoryProvider.overrideWithValue(customFieldsRepository),
          customFieldsEnabledProvider.overrideWith((ref) async => true),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewCallLogs, UserPermissions.viewChatDetails],
          ),
        ],
      );

      await tester.tap(find.byIcon(Icons.filter_list));
      await tester.pumpAndSettle();

      // The custom-fields section is appended after every built-in filter
      // (Date & Time/Duration/Mode/Status/Channel) — below the fold in the
      // sheet's lazily-built ListView until scrolled into view.
      final filterList = find.byType(ListView).first;
      await tester.dragUntilVisible(find.text('Risk Level'), filterList, const Offset(0, -300));
      await tester.pumpAndSettle();

      expect(find.text('Risk Level'), findsOneWidget);
      expect(find.text('Low'), findsOneWidget);
      expect(find.text('High'), findsOneWidget);
      expect(find.text('Internal Notes'), findsNothing);

      await tester.ensureVisible(find.text('High'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('High'));
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();

      verify(
        () => repository.getCallLogs(
          limit: kCallLogPageSize,
          archive: false,
          filter: const CallLogFilterState(
            customFieldValues: {
              'cf-risk': ['opt-high'],
            },
          ),
        ),
      ).called(1);
      expect(find.text('1'), findsOneWidget, reason: 'the active-filter-count badge');
    },
  );
}
