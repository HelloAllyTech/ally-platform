import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
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
      when(
        () => repository.addSummaryFeedback(
          chatId: 1001,
          rating: 5,
          comment: 'Nice',
          issues: const [],
          tags: any(named: 'tags'),
        ),
      ).thenAnswer((_) async {});

      var elapsed = Duration.zero;
      await _pump(
        tester,
        repository: repository,
        now: () => DateTime(2026, 1, 1).add(elapsed),
      );
      await tester.pumpAndSettle();

      elapsed = const Duration(seconds: 31);
      await tester.tap(find.byKey(const Key('call-summary-back')));
      await tester.pumpAndSettle();

      expect(find.text('Rate the AI-generated summary?'), findsOneWidget);
      // Still on the summary screen — the pop was intercepted, not let through.
      expect(find.text('CALL_LOG'), findsNothing);

      // 5 stars: no issue chips, the comment box shows (RN FeedbackPopup).
      await tester.tap(find.byKey(const ValueKey('feedback-popup-star-5')));
      await tester.pump();
      expect(find.byKey(const ValueKey('feedback-issue-OTHER')), findsNothing);
      await tester.enterText(find.byKey(const Key('feedback-popup-comment')), 'Nice');
      await tester.pump();
      await tester.tap(find.byKey(const Key('feedback-popup-submit')));
      await tester.pumpAndSettle();

      verify(
        () => repository.addSummaryFeedback(
          chatId: 1001,
          rating: 5,
          comment: 'Nice',
          issues: const [],
          tags: any(named: 'tags'),
        ),
      ).called(1);
      expect(find.text('CALL_LOG'), findsOneWidget, reason: 'submitting also navigates back');
    },
  );

  testWidgets('a 1-4 star rating shows the issue chips and submits the picked issues', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    when(
      () => repository.addSummaryFeedback(
        chatId: any(named: 'chatId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
        issues: any(named: 'issues'),
        tags: any(named: 'tags'),
      ),
    ).thenAnswer((_) async {});

    var elapsed = Duration.zero;
    await _pump(tester, repository: repository, now: () => DateTime(2026, 1, 1).add(elapsed));
    await tester.pumpAndSettle();
    elapsed = const Duration(seconds: 31);
    await tester.tap(find.byKey(const Key('call-summary-back')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('feedback-popup-star-3')));
    await tester.pump();
    expect(find.byKey(const Key('feedback-popup-comment')), findsNothing, reason: 'comment only with Other');
    await tester.tap(find.byKey(const ValueKey('feedback-issue-INACCURATE')));
    await tester.tap(find.byKey(const ValueKey('feedback-issue-OTHER')));
    await tester.pump();
    expect(find.byKey(const Key('feedback-popup-comment')), findsOneWidget);
    await tester.tap(find.byKey(const Key('feedback-popup-submit')));
    await tester.pumpAndSettle();

    verify(
      () => repository.addSummaryFeedback(
        chatId: 1001,
        rating: 3,
        comment: '',
        issues: const ['INACCURATE', 'OTHER'],
        tags: const [],
      ),
    ).called(1);
  });

  testWidgets('closing the feedback popup only hides it (RN hideSummaryFeedbackPopup)', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    var elapsed = Duration.zero;
    await _pump(tester, repository: repository, now: () => DateTime(2026, 1, 1).add(elapsed));
    await tester.pumpAndSettle();

    elapsed = const Duration(seconds: 31);
    await tester.tap(find.byKey(const Key('call-summary-back')));
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsOneWidget);

    await tester.tap(find.byKey(const Key('feedback-popup-backdrop')), warnIfMissed: false);
    await tester.pumpAndSettle();

    verifyNever(
      () => repository.addSummaryFeedback(
        chatId: any(named: 'chatId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
      ),
    );
    expect(find.text('Rate the AI-generated summary?'), findsNothing);
    expect(find.text('CALL_LOG'), findsNothing);
  });

  testWidgets('the live flow prompts on back at once and leaves to the Call Log tab', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary(feedbackAdded: true));
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    final router = await pumpRouterApp(
      tester,
      initialLocation: '/call-log',
      routes: [
        GoRoute(path: '/call-log', builder: (context, state) => const Text('CALL_LOG')),
        GoRoute(path: '/home', builder: (context, state) => Text('HOME ${state.uri.queryParameters['tab']}')),
        GoRoute(
          path: '/call-log/1001',
          builder: (context, state) => const CallSummaryScreen(chatId: 1001, fromLogs: false),
        ),
      ],
      overrides: [
        callLogRepositoryProvider.overrideWithValue(repository),
        userPermissionsProvider.overrideWith((ref) async => const [UserPermissions.editSummaryFeedback]),
      ],
    );
    router.push('/call-log/1001');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // RN canShowSummary: the live flow holds "Setting up" for 3s.
    expect(find.text('Setting up your summary screen'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();
    expect(find.text('Setting up your summary screen'), findsNothing);

    await tester.tap(find.byKey(const Key('call-summary-back')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    // Feedback already given → no prompt; live flow resets to Call Log tab.
    expect(find.text('HOME CallLog'), findsOneWidget);
  });

  testWidgets('backing out immediately (under 30s) leaves without prompting', (tester) async {
    final repository = MockCallLogRepository();
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _generatedSummary());
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

    await _pump(tester, repository: repository);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('call-summary-back')));
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
    await tester.tap(find.byKey(const Key('call-summary-back')));
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
    await tester.tap(find.byKey(const Key('call-summary-back')));
    await tester.pumpAndSettle();

    expect(find.text('Rate the AI-generated summary?'), findsNothing);
    expect(find.text('CALL_LOG'), findsOneWidget);
  });
}
