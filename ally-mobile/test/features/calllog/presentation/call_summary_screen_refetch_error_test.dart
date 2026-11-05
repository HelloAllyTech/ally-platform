import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart' show toastHostBuilder;

class MockCallLogRepository extends Mock implements CallLogRepository {}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generated',
  sessionName: 'Walk-in #1',
  score: null,
);

CallSummaryDetails _summary() => CallSummaryDetails.fromJson({
  'id': 1001,
  'summaryStatus': 'SUCCESS',
  'details': {
    'summary': {'sessionSummary': 'All good'},
    'callInfo': <String, dynamic>{},
  },
});

DioException _serverError() => DioException(
  requestOptions: RequestOptions(path: ''),
  response: Response(statusCode: 500, requestOptions: RequestOptions(path: '')),
);

/// Pumps the summary with Riverpod's automatic retry off, so each
/// `getCallSummary` call is one fetch the test triggered itself (RN's RTK
/// Query doesn't retry either).
Future<void> _pump(WidgetTester tester, MockCallLogRepository repository) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(
    initialLocation: '/call-log/1001',
    routes: [GoRoute(path: '/call-log/1001', builder: (context, state) => CallSummaryScreen(log: _log))],
  );
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [fixedTranslationsOverride(), callLogRepositoryProvider.overrideWithValue(repository)],
      child: MaterialApp.router(routerConfig: router, builder: toastHostBuilder),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets('a failed refetch keeps the summary that already loaded (RN RTK Query keeps data)', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(tester, repository);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ai-warning-shield')), findsOneWidget);

    when(() => repository.getCallSummary(1001)).thenThrow(_serverError());
    ProviderScope.containerOf(tester.element(find.byType(CallSummaryScreen))).invalidate(callSummaryProvider(1001));
    await tester.pumpAndSettle();

    verify(() => repository.getCallSummary(1001)).called(2);
    expect(find.byKey(const Key('ai-warning-shield')), findsOneWidget, reason: 'the loaded summary stays on screen');
    expect(find.text('See if its ready'), findsNothing);
  });

  testWidgets('a first load that fails shows the progress view with See if its ready / Check later, not bare text', (
    tester,
  ) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenThrow(_serverError());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(tester, repository);

    expect(find.text('See if its ready'), findsOneWidget);
    expect(find.text("I'll check later"), findsOneWidget);

    // "See if its ready" refetches; once it succeeds the summary renders.
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    await tester.tap(find.byKey(const Key('summary-progress-primary')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    verify(() => repository.getCallSummary(1001)).called(2);
    expect(find.text('See if its ready'), findsNothing);
  });
}
