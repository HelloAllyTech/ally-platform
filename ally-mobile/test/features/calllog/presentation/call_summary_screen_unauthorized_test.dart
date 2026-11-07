import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

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

void main() {
  testWidgets(
    'a 403 on the summary fetch shows the unauthorized view, and Go back pops',
    (tester) async {
      final repository = MockCallLogRepository();
      when(() => repository.getCallSummary(1001)).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          response: Response(statusCode: 403, requestOptions: RequestOptions(path: '')),
        ),
      );
      when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/call-log',
        routes: [
          GoRoute(path: '/call-log', builder: (context, state) => const _CallLogMarker()),
          GoRoute(
            path: '/call-log/1001',
            builder: (context, state) => CallSummaryScreen(log: _log),
          ),
        ],
        overrides: [callLogRepositoryProvider.overrideWithValue(repository)],
      );
      router.push('/call-log/1001');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('summary-unauthorized-image')), findsOneWidget); // RN summaryFailed.png
      expect(find.text('Summary Not Found'), findsOneWidget);
      expect(find.text('The summary you are looking for does not exist.'), findsOneWidget);

      await tester.tap(find.text('Go back'));
      await tester.pumpAndSettle();

      expect(find.byType(_CallLogMarker), findsOneWidget);
    },
  );
}

class _CallLogMarker extends StatelessWidget {
  const _CallLogMarker();

  @override
  Widget build(BuildContext context) => const Text('CALL_LOG');
}
