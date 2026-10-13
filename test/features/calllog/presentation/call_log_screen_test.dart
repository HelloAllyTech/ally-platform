import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_log_screen.dart';

import '../../../support/pump_app.dart';

/// Like [pumpApp], but settles with a plain `pump()` instead of
/// `pumpAndSettle()` — needed only for asserting the *loading* state, since
/// an indeterminate `CircularProgressIndicator` schedules frames forever and
/// `pumpAndSettle()` times out waiting for animations to stop.
Future<void> _pumpAppWithoutSettling(WidgetTester tester, Widget child, {List<Override> overrides = const []}) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(ProviderScope(overrides: overrides, child: MaterialApp(home: child)));
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pump();
}

class MockCallLogRepository extends Mock implements CallLogRepository {}

void main() {
  testWidgets(
    'CallLogScreen: loading, error, empty, data, archive, and navigation',
    (tester) async {
      // --- Loading state: shows a spinner before the future resolves. ---
      final loadingRepository = MockCallLogRepository();
      final neverCompletes = Completer<List<CallLogItem>>();
      when(() => loadingRepository.getCallLogs()).thenAnswer((_) => neverCompletes.future);

      await _pumpAppWithoutSettling(
        tester,
        const CallLogScreen(),
        overrides: [callLogRepositoryProvider.overrideWithValue(loadingRepository)],
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // --- Error state. ---
      final errorRepository = MockCallLogRepository();
      when(() => errorRepository.getCallLogs()).thenThrow(Exception('network down'));

      await pumpApp(
        tester,
        const CallLogScreen(),
        overrides: [callLogRepositoryProvider.overrideWithValue(errorRepository)],
      );

      expect(find.textContaining('Something went wrong'), findsOneWidget);

      // --- Empty state. ---
      final emptyRepository = MockCallLogRepository();
      when(() => emptyRepository.getCallLogs()).thenAnswer((_) async => []);

      await pumpApp(
        tester,
        const CallLogScreen(),
        overrides: [callLogRepositoryProvider.overrideWithValue(emptyRepository)],
      );

      expect(find.text('No call logs found'), findsOneWidget);

      // --- Data state + archive + navigation. ---
      final log = CallLogItem(
        id: 42,
        startedAt: '2026-01-01T10:00:00Z',
        endedAt: '2026-01-01T10:10:00Z',
        status: 'generated',
        sessionName: 'Walk-in #1',
        score: 91,
      );
      final dataRepository = MockCallLogRepository();
      when(() => dataRepository.getCallLogs()).thenAnswer((_) async => [log]);
      when(() => dataRepository.archiveCallLog(42)).thenAnswer((_) async {});

      await pumpRoutedApp(
        tester,
        initialLocation: '/call-log',
        routes: [
          GoRoute(path: '/call-log', builder: (context, state) => const CallLogScreen()),
          GoRoute(
            path: '/call-log/:id',
            builder: (context, state) => Text('Summary for ${(state.extra as CallLogItem).id}'),
          ),
        ],
        overrides: [callLogRepositoryProvider.overrideWithValue(dataRepository)],
      );

      expect(find.text('Walk-in #1'), findsOneWidget);
      expect(find.textContaining('generated'), findsOneWidget);
      expect(find.text('91'), findsOneWidget);

      // Tapping the row navigates to the call summary screen, carrying the log.
      await tester.tap(find.text('Walk-in #1'));
      await tester.pumpAndSettle();

      expect(find.text('Summary for 42'), findsOneWidget);

      // --- Swipe-to-archive, on a fresh mount of its own. ---
      final archiveRepository = MockCallLogRepository();
      when(() => archiveRepository.getCallLogs()).thenAnswer((_) async => [log]);
      when(() => archiveRepository.archiveCallLog(42)).thenAnswer((_) async {});

      await pumpApp(
        tester,
        const CallLogScreen(),
        overrides: [callLogRepositoryProvider.overrideWithValue(archiveRepository)],
      );

      await tester.drag(find.byKey(const ValueKey(42)), const Offset(-500, 0));
      await tester.pumpAndSettle();

      verify(() => archiveRepository.archiveCallLog(42)).called(1);
    },
  );
}
