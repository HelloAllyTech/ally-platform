import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';

import '../../../support/fake_translations.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generating',
  sessionName: 'Walk-in #1',
  score: null,
);

CallSummaryDetails _pendingSummary() =>
    CallSummaryDetails.fromJson({'id': 1001, 'summaryStatus': 'PENDING', 'details': <String, dynamic>{}});

CallSummaryDetails _failedSummary() =>
    CallSummaryDetails.fromJson({'id': 1001, 'summaryStatus': 'FAILED', 'details': <String, dynamic>{}});

CallSummaryDetails _noAudioSummary() =>
    CallSummaryDetails.fromJson({'id': 1001, 'summaryStatus': 'NO_AUDIO', 'details': <String, dynamic>{}});

/// A still-generating summary keeps a `CircularProgressIndicator` on screen
/// indefinitely, so (unlike `pumpRouterApp`, which always calls
/// `pumpAndSettle()` internally) this pumps just enough frames to resolve
/// the initial fetch and render — the same bounded-pump workaround used
/// elsewhere in this codebase for an indeterminate spinner.
Future<void> _pump(
  WidgetTester tester, {
  required List<Override> overrides,
  required GoRouter router,
}) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [fixedTranslationsOverride(), ...overrides],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

GoRouter _router() => GoRouter(
  initialLocation: '/call-log/1001',
  routes: [
    GoRoute(path: '/call-log/1001', builder: (context, state) => CallSummaryScreen(log: _log)),
  ],
);

void main() {
  testWidgets('a pending summary shows the generating state with See if its ready', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _pendingSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: _router(),
    );

    expect(
      find.text('This process may take some time. Please feel free to check back later.'),
      findsOneWidget,
    );
    expect(find.text('See if its ready'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
    expect(find.text("I'll check later"), findsOneWidget);
  });

  testWidgets('See if its ready re-fetches the summary', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _pendingSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: _router(),
    );

    await tester.tap(find.text('See if its ready'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => repository.getCallSummary(1001)).called(greaterThan(1));
  });

  testWidgets('a failed summary shows Retry, which calls retrySummary then refetches', (
    tester,
  ) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _failedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    when(() => repository.retrySummary(1001)).thenAnswer(
      (_) async => (success: true, message: 'Regenerating'),
    );

    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: _router(),
    );
    await tester.pumpAndSettle();

    expect(find.text('Failed to generate session summary'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.byKey(const Key('summary-progress-primary')));
    await tester.pumpAndSettle();

    verify(() => repository.retrySummary(1001)).called(1);
    verify(() => repository.getCallSummary(1001)).called(greaterThan(1));
  });

  testWidgets('a NO_AUDIO summary shows the no-audio tag with no retry/see-if-ready button', (
    tester,
  ) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _noAudioSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: _router(),
    );
    await tester.pumpAndSettle();

    expect(find.text('No audio detected'), findsOneWidget);
    expect(find.text('Failed to generate session summary'), findsOneWidget);
    expect(find.byKey(const Key('summary-progress-primary')), findsNothing);
    expect(find.text("I'll check later"), findsOneWidget);
  });

  testWidgets('from the logs the steps start at "Generating summary", with the ETA', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer(
      (_) async => CallSummaryDetails.fromJson({
        'id': 1001,
        'summaryStatus': 'IN_PROGRESS',
        'details': {'callDuration': 2503},
      }),
    );
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(tester, overrides: [callLogRepositoryProvider.overrideWithValue(repository)], router: _router());

    expect(find.text('Generating summary...'), findsOneWidget);
    // 178s × 1.2 → 4 min (RN getEstimatedSummaryGenerationTime).
    expect(find.text('Estimated time: ~ 4 min'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('Enriching summary...'), findsOneWidget);
  });

  testWidgets('notes typed while generating are saved 1s after the last keystroke', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _pendingSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    when(() => repository.updateNotes(1001, any())).thenAnswer((_) async {});

    await _pump(tester, overrides: [callLogRepositoryProvider.overrideWithValue(repository)], router: _router());

    expect(find.byKey(const Key('add-notes-input')), findsNothing, reason: 'collapsed by default');
    await tester.ensureVisible(find.byKey(const Key('add-notes-header')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('add-notes-header')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('add-notes-input')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('add-notes-input')), 'Call');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.enterText(find.byKey(const Key('add-notes-input')), 'Call back Monday');
    await tester.pump(const Duration(milliseconds: 999));
    verifyNever(() => repository.updateNotes(any(), any()));
    await tester.pump(const Duration(milliseconds: 2));

    verify(() => repository.updateNotes(1001, 'Call back Monday')).called(1);
  });

  testWidgets("I'll check later goes to the Call Log tab", (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _pendingSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    final router = GoRouter(
      initialLocation: '/call-log/1001',
      routes: [
        GoRoute(path: '/call-log/1001', builder: (context, state) => CallSummaryScreen(log: _log)),
        GoRoute(path: '/home', builder: (context, state) => Text('HOME ${state.uri.queryParameters['tab']}')),
      ],
    );

    await _pump(tester, overrides: [callLogRepositoryProvider.overrideWithValue(repository)], router: router);
    await tester.tap(find.byKey(const Key('summary-progress-check-later')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('HOME CallLog'), findsOneWidget);
  });
}
