import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

CallLogItem _log({int id = 42, String status = 'SUCCESS'}) => CallLogItem(
      id: id,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:10:00Z',
      status: status,
      sessionName: 'Walk-in #1',
      score: 91,
    );

SimulationLogItem _simLog({int id = 7}) => SimulationLogItem(
      id: id,
      startedAt: '2026-01-02T10:00:00Z',
      status: 'SUCCESS',
      scenarioTitle: 'Difficult client',
      score: 80,
    );

List<GoRoute> _routes() => [
      GoRoute(path: '/call-log', builder: (context, state) => const CallLogScreen()),
      GoRoute(
        path: '/call-log/:id',
        builder: (context, state) => Text('Summary for ${(state.extra as CallLogItem).id}'),
      ),
      GoRoute(
        path: '/simulations/feedback/:sessionId',
        builder: (context, state) =>
            Text('Feedback for ${state.pathParameters['sessionId']}'),
      ),
      GoRoute(path: '/scribe', builder: (context, state) => const Text('Scribe recording')),
    ];

MockCallLogRepository _repository({
  List<CallLogItem> realLogs = const [],
  List<CallLogItem> archivedLogs = const [],
  List<SimulationLogItem> simulationLogs = const [],
}) {
  final repository = MockCallLogRepository();
  when(() => repository.getCallLogs(archive: false)).thenAnswer((_) async => realLogs);
  when(() => repository.getCallLogs(archive: true)).thenAnswer((_) async => archivedLogs);
  when(() => repository.getSimulationLogs()).thenAnswer((_) async => simulationLogs);
  return repository;
}

// Each permission/data combination below is its own `testWidgets` rather
// than sequential pumps in one body: `pumpRouterApp`'s `tester.pumpWidget`
// calls with a structurally-identical tree (same ProviderScope/
// MaterialApp.router shape) across pumps were found (empirically, via a
// debug dump) to let go_router/Riverpod reuse the *previous* pump's already-
// resolved `userPermissionsProvider` value instead of re-fetching the new
// override — a real-permission-set test would see stale permissions from
// the previous scenario. Starting a fresh `testWidgets` for each permission
// set sidesteps this with a guaranteed-clean teardown between them. (This
// is a different failure mode than the translations-provider stall
// `pumpRouterApp`'s own doc comment describes — that one is specifically
// about a provider resolving through real async I/O and is safe to pump
// sequentially; this one is about a provider override changing value
// between pumps.)
void main() {
  testWidgets('only VIEW_CALL_LOGS: no tab switcher, real list renders directly', (tester) async {
    final repository = _repository(realLogs: [_log()]);

    await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: _routes(),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith(
          (ref) async => [UserPermissions.viewCallLogs, UserPermissions.viewChatDetails],
        ),
      ],
    );

    expect(find.text('Real call logs'), findsNothing);
    expect(find.text('Role play'), findsNothing);
    expect(find.text('Walk-in #1'), findsOneWidget);
    expect(find.text('Generated'), findsOneWidget);

    await tester.tap(find.text('Walk-in #1'));
    await tester.pumpAndSettle();
    expect(find.text('Summary for 42'), findsOneWidget);
  });

  testWidgets('both permissions: tab switcher appears and switches data sources', (tester) async {
    final repository = _repository(realLogs: [_log()], simulationLogs: [_simLog()]);

    await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: _routes(),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith(
          (ref) async => [
            UserPermissions.viewCallLogs,
            UserPermissions.viewScenarioSession,
            UserPermissions.viewChatDetails,
            UserPermissions.viewScenarioSessionDetails,
          ],
        ),
      ],
    );

    expect(find.text('Real call logs'), findsOneWidget);
    expect(find.text('Role play'), findsOneWidget);
    expect(find.text('Walk-in #1'), findsOneWidget);

    await tester.tap(find.text('Role play'));
    await tester.pumpAndSettle();

    expect(find.text('Difficult client'), findsOneWidget);
    expect(find.text('Walk-in #1'), findsNothing);

    await tester.tap(find.text('Difficult client'));
    await tester.pumpAndSettle();
    expect(find.text('Feedback for 7'), findsOneWidget);
  });

  testWidgets(
    'archive action switches into the Archives view with a back button, and swipe-to-archive '
    'requires confirming before it actually archives',
    (tester) async {
      final repository = _repository(realLogs: [_log()], archivedLogs: [_log(id: 99)]);
      when(() => repository.archiveCallLog(42)).thenAnswer((_) async {});

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.archiveCallLog,
              UserPermissions.viewChatDetails,
              UserPermissions.startMicrophoneChat,
            ],
          ),
        ],
      );

      expect(find.byIcon(Icons.more_vert), findsOneWidget);
      await tester.tap(find.byIcon(Icons.more_vert));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Archives').last);
      await tester.pumpAndSettle();

      expect(find.text('Archives'), findsWidgets);
      expect(find.text('Walk-in #1'), findsOneWidget); // id 99's session name
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
      expect(
        find.byIcon(Icons.more_vert),
        findsNothing,
        reason: 'no archive action while already viewing archives',
      );

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.arrow_back), findsNothing);

      // Swiping alone no longer archives immediately — RN has no such
      // instant gesture at all (archiving only happens via CallSummaryScreen's
      // own confirmation modal), and a bare swipe used to archive silently
      // and irreversibly on an accidental touch. The swipe now only opens
      // that same real confirmation copy; archiveCallLog fires only once
      // its own Archive button is tapped.
      await tester.drag(find.byKey(const ValueKey(42)), const Offset(-500, 0));
      await tester.pumpAndSettle();
      verifyNever(() => repository.archiveCallLog(42));
      expect(
        find.textContaining('This will hide it from session logs'),
        findsOneWidget,
      );

      await tester.tap(find.widgetWithText(AppButton, 'Archive'));
      await tester.pumpAndSettle();
      verify(() => repository.archiveCallLog(42)).called(1);
    },
  );

  testWidgets(
    'tapping the FAB shows the consent sheet, and confirming with mic permission granted pushes into Scribe recording',
    (tester) async {
      PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({
        Permission.microphone: PermissionStatus.granted,
      });
      final repository = _repository(realLogs: [_log()]);

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.startMicrophoneChat,
            ],
          ),
        ],
      );

      expect(find.byKey(const Key('start-session-fab')), findsOneWidget);
      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();
      expect(find.textContaining('By starting, you confirm'), findsOneWidget);

      await tester.tap(find.text('Start Scribe Mode'));
      await tester.pumpAndSettle();
      expect(find.text('Scribe recording'), findsOneWidget);
    },
  );

  testWidgets(
    'denied mic permission closes the sheet and shows the microphone-settings alert instead',
    (tester) async {
      final fakePlatform = FakePermissionHandlerPlatform({
        Permission.microphone: PermissionStatus.denied,
      });
      PermissionHandlerPlatform.instance = fakePlatform;
      final repository = _repository(realLogs: [_log()]);

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.startMicrophoneChat,
            ],
          ),
        ],
      );

      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Scribe Mode'));
      await tester.pumpAndSettle();

      expect(find.text('Scribe recording'), findsNothing);
      expect(find.text('Allow microphone permission'), findsOneWidget);

      await tester.tap(find.text('Open Settings'));
      await tester.pumpAndSettle();
      expect(fakePlatform.openedSettings, isTrue);
    },
  );

  testWidgets('no FAB when the user cannot start a call', (tester) async {
    final repository = _repository();

    await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: _routes(),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith(
          (ref) async => [UserPermissions.viewCallLogs],
        ),
      ],
    );

    expect(find.byKey(const Key('start-session-fab')), findsNothing);
    expect(find.text('No call logs found'), findsOneWidget);
  });

  testWidgets(
    'cancelling the swipe-to-archive confirmation leaves the row in place and never archives',
    (tester) async {
      final repository = _repository(realLogs: [_log()]);

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.archiveCallLog,
            ],
          ),
        ],
      );

      await tester.drag(find.byKey(const ValueKey(42)), const Offset(-500, 0));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(AppButton, 'Cancel'));
      await tester.pumpAndSettle();

      verifyNever(() => repository.archiveCallLog(any()));
      expect(find.text('Walk-in #1'), findsOneWidget, reason: 'row is still there, not dismissed');
    },
  );
}
