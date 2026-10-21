import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
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

    final router = _router();
    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: router,
    );
    await tester.pumpAndSettle();

    expect(find.text('Failed to generate session summary'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Retry'), findsOneWidget);

    await tester.tap(find.widgetWithText(AppButton, 'Retry'));
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

    final router = _router();
    await _pump(
      tester,
      overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      router: router,
    );
    await tester.pumpAndSettle();

    expect(find.text('No audio detected'), findsOneWidget);
    expect(find.text('Failed to generate session summary'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Retry'), findsNothing);
    expect(find.text("See if its ready"), findsNothing);
    expect(find.text("I'll check later"), findsOneWidget);
  });
}
