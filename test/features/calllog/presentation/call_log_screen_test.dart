import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';
import 'package:ally_mobile_flutter/core/widgets/app_empty_state.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_screen.dart';

import '../../../support/fake_permission_platform.dart';
import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

CallLogItem _log({
  int id = 42,
  String status = 'SUCCESS',
  String? summaryStatus,
  String? sessionName = 'Walk-in #1',
  int? chatId = -1,
}) =>
    CallLogItem(
      id: id,
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:10:00Z',
      status: status,
      summaryStatus: summaryStatus,
      sessionName: sessionName,
      score: 91,
      // A real row has `details.chatId` (the chat's own id); -1 means "same as id".
      chatId: chatId == -1 ? id : chatId,
    );

SimulationLogItem _simLog({String id = '7'}) => SimulationLogItem(
      id: id,
      startedAt: '2026-01-02T10:00:00Z',
      endedAt: '2026-01-02T10:10:00Z',
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
        builder: (context, state) => Text(
          'Feedback for ${state.pathParameters['sessionId']}'
          ' fromLogs=${state.uri.queryParameters['fromLogs']}',
        ),
      ),
      GoRoute(path: '/scribe', builder: (context, state) => const Text('Scribe recording')),
    ];

MockCallLogRepository _repository({
  List<CallLogItem> realLogs = const [],
  List<CallLogItem> archivedLogs = const [],
  List<SimulationLogItem> simulationLogs = const [],
}) {
  final repository = MockCallLogRepository();
  when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false))
      .thenAnswer((_) async => realLogs);
  when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: true))
      .thenAnswer((_) async => archivedLogs);
  when(() => repository.getSimulationLogs(limit: kCallLogPageSize)).thenAnswer((_) async => simulationLogs);
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

    expect(find.textContaining('Session'), findsOneWidget);
    expect(find.textContaining('Logs'), findsOneWidget);
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

    expect(find.textContaining('Difficult client'), findsOneWidget);
    expect(find.text('Walk-in #1'), findsNothing);

    await tester.tap(find.textContaining('Difficult client'));
    await tester.pumpAndSettle();
    // Reached from the logs list, so SimulationFeedbackScreen's own
    // leave-without-rating prompt must not force itself on exit — mirrors
    // RN's `route.params.fromLogs`.
    expect(find.text('Feedback for 7 fromLogs=true'), findsOneWidget);
  });

  testWidgets(
    'archive action switches into the Archives view with a back button; rows have no swipe-to-archive',
    (tester) async {
      final repository = _repository(realLogs: [_log()], archivedLogs: [_log(id: 99)]);

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
          visibleChatTypesProvider.overrideWith((ref) async => const ['MICROPHONE_CHAT']),
        ],
      );

      // RN has no swipe gesture on this list.
      expect(find.byType(Dismissible), findsNothing);

      expect(find.byKey(const Key('call-log-actions-menu')), findsOneWidget);
      await tester.tap(find.byKey(const Key('call-log-actions-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Archives').last);
      await tester.pumpAndSettle();

      expect(find.text('Archives'), findsWidgets);
      expect(find.text('Walk-in #1'), findsOneWidget); // id 99's session name
      expect(find.byKey(const Key('call-log-archive-back')), findsOneWidget);
      expect(
        find.byKey(const Key('call-log-actions-menu')),
        findsNothing,
        reason: 'no archive action while already viewing archives',
      );

      await tester.tap(find.byKey(const Key('call-log-archive-back')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('call-log-archive-back')), findsNothing);
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
          visibleChatTypesProvider.overrideWith((ref) async => const ['MICROPHONE_CHAT']),
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
          visibleChatTypesProvider.overrideWith((ref) async => const ['MICROPHONE_CHAT']),
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

  testWidgets(
    'Create Note is offered alongside Start Scribe Mode for a counsellor with the tenant toggle on, '
    'and the FAB stays offered even without startMicrophoneChat as long as Create Note is on offer',
    (tester) async {
      final repository = _repository();

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewCallLogs, UserPermissions.counselorAccess],
          ),
          scribeNoteCreationEnabledProvider.overrideWith((ref) async => true),
        ],
      );

      expect(
        find.byKey(const Key('start-session-fab')),
        findsOneWidget,
        reason: 'offered on Create Note alone, with no startMicrophoneChat permission at all',
      );
      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();

      expect(find.text('Start Scribe Mode'), findsNothing, reason: 'no startMicrophoneChat permission');
      expect(find.text('Start Dictation Mode'), findsOneWidget);
    },
  );

  testWidgets(
    'tapping Create Note creates the note, closes the sheet, then opens its summary',
    (tester) async {
      final repository = _repository();
      when(() => repository.createNote()).thenAnswer((_) async => (chatId: 55, name: 'CALL-55-2026-10-27'));

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.counselorAccess,
              UserPermissions.startMicrophoneChat,
            ],
          ),
          scribeNoteCreationEnabledProvider.overrideWith((ref) async => true),
          visibleChatTypesProvider.overrideWith((ref) async => const ['MICROPHONE_CHAT']),
        ],
      );

      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Dictation Mode'));
      await tester.pumpAndSettle();

      verify(() => repository.createNote()).called(1);
      expect(find.textContaining('By starting, you confirm'), findsNothing, reason: 'sheet closed');
      expect(find.text('Summary for 55'), findsOneWidget);
    },
  );

  testWidgets(
    'a failed Create Note leaves the sheet open and shows an error toast instead of navigating',
    (tester) async {
      final repository = _repository();
      when(() => repository.createNote()).thenThrow(Exception('network down'));

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        // `_createNote`'s failure path shows its toast via the app-wide
        // `rootScaffoldMessengerKey`, not a context-local ScaffoldMessenger
        // (see that key's own doc comment on why) — this harness needs to be
        // wired to that exact global key for the snackbar to show up here.
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewCallLogs, UserPermissions.counselorAccess],
          ),
          scribeNoteCreationEnabledProvider.overrideWith((ref) async => true),
        ],
      );

      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Dictation Mode'));
      await tester.pumpAndSettle();

      verify(() => repository.createNote()).called(1);
      expect(find.text('Start Dictation Mode'), findsOneWidget, reason: 'sheet stayed open');
      expect(find.text("Couldn't create the note. Please try again."), findsOneWidget);
    },
  );

  testWidgets(
    'Create Note is not offered for a counsellor when the tenant toggle is off',
    (tester) async {
      final repository = _repository();

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.counselorAccess,
              UserPermissions.startMicrophoneChat,
            ],
          ),
          scribeNoteCreationEnabledProvider.overrideWith((ref) async => false),
          visibleChatTypesProvider.overrideWith((ref) async => const ['MICROPHONE_CHAT']),
        ],
      );

      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();

      expect(find.text('Start Scribe Mode'), findsOneWidget);
      expect(find.text('Start Dictation Mode'), findsNothing);
    },
  );

  testWidgets(
    'a greyed, inert FAB when the tenant has disabled microphone chat and there is no Create Note '
    'capability — RN keeps the button (canStartCall) but disables it (canOfferAnySessionType)',
    (tester) async {
      final repository = _repository();

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [UserPermissions.viewCallLogs, UserPermissions.startMicrophoneChat],
          ),
          visibleChatTypesProvider.overrideWith((ref) async => const []),
        ],
      );

      expect(find.byKey(const Key('start-session-fab')), findsOneWidget);
      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();
      expect(find.text('Start Scribe Mode'), findsNothing);
      expect(find.text('Start Dictation Mode'), findsNothing);
    },
  );

  testWidgets(
    'Start Scribe Mode is hidden but Create Note still offered when the tenant has disabled '
    'microphone chat but the counsellor note-creation toggle is on',
    (tester) async {
      final repository = _repository();

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.counselorAccess,
              UserPermissions.startMicrophoneChat,
            ],
          ),
          scribeNoteCreationEnabledProvider.overrideWith((ref) async => true),
          visibleChatTypesProvider.overrideWith((ref) async => const []),
        ],
      );

      expect(find.byKey(const Key('start-session-fab')), findsOneWidget);
      await tester.tap(find.byKey(const Key('start-session-fab')));
      await tester.pumpAndSettle();

      expect(
        find.text('Start Scribe Mode'),
        findsNothing,
        reason: 'the permission is held, but the tenant has not enabled MICROPHONE_CHAT',
      );
      expect(find.text('Start Dictation Mode'), findsOneWidget);
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
    'no FAB for a cloud-telephony-only permission either — "Start Session" only ever starts '
    'Scribe recording, and a conference call is never user-initiated (matches RN\'s own '
    'canOfferAnySessionType gate, which never considers cloud-telephony permission)',
    (tester) async {
      final repository = _repository();

      await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: _routes(),
        overrides: [
          callLogRepositoryProvider.overrideWithValue(repository),
          userPermissionsProvider.overrideWith(
            (ref) async => [
              UserPermissions.viewCallLogs,
              UserPermissions.startCloudTelephonyChat,
            ],
          ),
        ],
      );

      expect(find.byKey(const Key('start-session-fab')), findsNothing);
    },
  );

  testWidgets('scrolling near the bottom of the real-logs list loads the next page and appends it', (
    tester,
  ) async {
    final repository = MockCallLogRepository();
    final page1 = List.generate(kCallLogPageSize, (i) => _log(id: i + 1));
    final page2 = [
      CallLogItem(
        id: 100,
        startedAt: '2026-01-01T10:00:00Z',
        endedAt: '2026-01-01T10:10:00Z',
        status: 'SUCCESS',
        sessionName: null,
        score: null,
      ),
    ];
    when(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false)).thenAnswer((_) async => page1);
    when(() => repository.getCallLogs(limit: kCallLogPageSize, offset: kCallLogPageSize, archive: false))
        .thenAnswer((_) async => page2);

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

    expect(find.text('ID-100'), findsNothing, reason: 'page 2 not loaded yet');

    // A single large drag pins the scroll position near the (pre-append)
    // bottom, which crosses the near-bottom `loadMore` threshold; appending
    // page 2 then grows `maxScrollExtent` again, so a further drag is
    // needed to actually scroll the new last row into view —
    // `dragUntilVisible` handles both in one go.
    await tester.dragUntilVisible(
      find.text('ID-100'),
      find.byType(ListView),
      const Offset(0, -300),
    );
    await tester.pumpAndSettle();

    verify(() => repository.getCallLogs(limit: kCallLogPageSize, offset: kCallLogPageSize, archive: false))
        .called(1);
  });

  testWidgets('pull-to-refresh re-fetches the real-logs list from page 0', (tester) async {
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

    verify(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false)).called(1);

    // Don't await `show()` directly — its returned future only resolves once
    // the indicator's dismiss animation plays out, which needs pumped
    // frames to advance; awaiting it inline stalls forever under fake async
    // (same gotcha `leaderboard_screen_test.dart` documents for the same
    // `RefreshIndicator` pattern).
    unawaited(tester.state<RefreshIndicatorState>(find.byType(RefreshIndicator)).show());
    await tester.pump();
    await tester.pumpAndSettle();

    verify(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false)).called(1);
  });

  testWidgets(
    'rows show the summaryStatus pill (not the chat status) and fall back to the chat id for a title',
    (tester) async {
      final repository = _repository(
        realLogs: [
          _log(id: 15, status: 'ENDED', summaryStatus: 'FAILED', sessionName: null),
          _log(id: 11, status: 'ENDED', summaryStatus: 'SUCCESS', sessionName: 'CALL-11-2026-07-27'),
        ],
      );

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

      expect(find.text('15'), findsOneWidget);
      expect(find.text('Error'), findsOneWidget);
      expect(find.text('CALL-11-2026-07-27'), findsOneWidget);
      expect(find.text('Generated'), findsOneWidget);
    },
  );

  testWidgets(
    'like RN, the first page drops rows whose details.chatId matches the (absent) current chat — '
    'i.e. rows ally-be returned with empty details',
    (tester) async {
      final repository = _repository(
        realLogs: [
          _log(id: 16, sessionName: 'No details yet', chatId: null),
          _log(id: 15, sessionName: 'Has details'),
        ],
      );

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

      expect(find.text('No details yet'), findsNothing);
      expect(find.text('Has details'), findsOneWidget);
    },
  );

  testWidgets('the header refresh button re-fetches the visible list', (tester) async {
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
    verify(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false)).called(1);

    await tester.tap(find.byKey(const Key('call-log-refresh')));
    await tester.pumpAndSettle();

    verify(() => repository.getCallLogs(limit: kCallLogPageSize, archive: false)).called(1);
    expect(find.text('Walk-in #1'), findsOneWidget);
  });

  testWidgets('the empty state shows RN\'s illustration, title and description', (tester) async {
    final repository = _repository();

    await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: _routes(),
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith((ref) async => [UserPermissions.viewCallLogs]),
      ],
    );

    expect(find.byType(AppEmptyState), findsOneWidget);
    expect(find.text('No call logs found'), findsOneWidget);
    expect(find.text('Your active call will be shown here.'), findsOneWidget);
  });
}
