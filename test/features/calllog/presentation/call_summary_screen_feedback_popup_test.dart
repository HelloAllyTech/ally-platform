import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';

import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generated',
  sessionName: 'Walk-in #1',
  score: null,
);

CallSummaryDetails _generatedSummary({bool feedbackAdded = false}) => CallSummaryDetails.fromJson({
  'id': 1001,
  'summaryStatus': 'SUCCESS',
  'details': {
    'summary': {'sessionSummary': 'All good'},
    'callInfo': {'isSummaryFeedbackAdded': feedbackAdded},
  },
});

Future<GoRouter> _pump(
  WidgetTester tester, {
  required MockCallLogRepository repository,
  List<String> permissions = const [UserPermissions.editSummaryFeedback],
  DateTime Function() now = DateTime.now,
}) {
  return pumpRouterApp(
    tester,
    initialLocation: '/call-log',
    routes: [
      GoRoute(path: '/call-log', builder: (context, state) => const Text('CALL_LOG')),
      GoRoute(
        path: '/call-log/1001',
        builder: (context, state) => CallSummaryScreen(log: _log, now: now),
      ),
    ],
    overrides: [
      callLogRepositoryProvider.overrideWithValue(repository),
      userPermissionsProvider.overrideWith((ref) async => permissions),
    ],
  ).then((router) {
    router.push('/call-log/1001');
    return router;
  });
}

void main() {
  testWidgets(
    'backing out 30s+ after viewing a fresh AI summary prompts for feedback before leaving',
    (tester) async {
      final repository = MockCallLogRepository();
      when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
      when(() => repository.addSummaryFeedback(chatId: 1001, rating: 4, comment: 'Nice'))
          .thenAnswer((_) async {});

      var elapsed = Duration.zero;
      await _pump(
        tester,
        repository: repository,
        now: () => DateTime(2026, 1, 1).add(elapsed),
      );
      await tester.pumpAndSettle();

      elapsed = const Duration(seconds: 31);
      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.text('Rate the AI-generated summary?'), findsOneWidget);
      // Still on the summary screen — the pop was intercepted, not let through.
      expect(find.text('CALL_LOG'), findsNothing);

      await tester.tap(find.byIcon(Icons.star_border).at(3));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'Nice');
      await tester.pump();
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      verify(() => repository.addSummaryFeedback(chatId: 1001, rating: 4, comment: 'Nice')).called(1);
      expect(find.text('CALL_LOG'), findsOneWidget, reason: 'submitting also navigates back');
    },
  );

  testWidgets('dismissing the feedback popup (X) leaves without submitting', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    var elapsed = Duration.zero;
    await _pump(tester, repository: repository, now: () => DateTime(2026, 1, 1).add(elapsed));
    await tester.pumpAndSettle();

    elapsed = const Duration(seconds: 31);
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    verifyNever(
      () => repository.addSummaryFeedback(
        chatId: any(named: 'chatId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
      ),
    );
    expect(find.text('CALL_LOG'), findsOneWidget);
  });

  testWidgets('backing out immediately (under 30s) leaves without prompting', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(tester, repository: repository);
    await tester.pumpAndSettle();

    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsNothing);
    expect(find.text('CALL_LOG'), findsOneWidget);
  });

  testWidgets('no prompt when feedback was already given, even after 30s', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001))
        .thenAnswer((_) async => _generatedSummary(feedbackAdded: true));
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    var elapsed = Duration.zero;
    await _pump(tester, repository: repository, now: () => DateTime(2026, 1, 1).add(elapsed));
    await tester.pumpAndSettle();

    elapsed = const Duration(seconds: 31);
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsNothing);
    expect(find.text('CALL_LOG'), findsOneWidget);
  });

  testWidgets('no prompt without edit:summary:feedback permission, even after 30s', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    var elapsed = Duration.zero;
    await _pump(
      tester,
      repository: repository,
      permissions: const [],
      now: () => DateTime(2026, 1, 1).add(elapsed),
    );
    await tester.pumpAndSettle();

    elapsed = const Duration(seconds: 31);
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsNothing);
    expect(find.text('CALL_LOG'), findsOneWidget);
  });
}
