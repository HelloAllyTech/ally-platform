import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_summary_screen.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';

import '../../../support/pump_router_app.dart';

class MockCallLogRepository extends Mock implements CallLogRepository {}

class MockScribeReviewsRepository extends Mock implements ScribeReviewsRepository {}

class MockScribeReactionsRepository extends Mock implements ScribeReactionsRepository {}

class _FakeUrlLauncherPlatform extends UrlLauncherPlatform {
  final List<String> launchedUrls = [];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launchedUrls.add(url);
    return true;
  }
}

final _log = CallLogItem(
  id: 1001,
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T10:10:00Z',
  status: 'generated',
  sessionName: 'Walk-in #1',
  score: null,
);

CallSummaryDetails _summary({
  String? archivedAt,
  String? reviewId,
  String? reviewStatus,
  String? reviewNote,
  String? reviewCreatedAt,
  bool hasTranscript = true,
}) => CallSummaryDetails.fromJson({
  'id': 1001,
  'summaryStatus': 'SUCCESS',
  'archivedAt': archivedAt,
  'reviewId': reviewId,
  'reviewStatus': reviewStatus,
  'reviewNote': reviewNote,
  'reviewCreatedAt': reviewCreatedAt,
  'details': {
    'summary': {'sessionSummary': 'All good'},
    'callInfo': <String, dynamic>{},
    if (hasTranscript) 'transcript': 'the transcript text',
  },
});

Future<GoRouter> _pump(
  WidgetTester tester, {
  required MockCallLogRepository repository,
  MockScribeReviewsRepository? scribeReviewsRepository,
  MockScribeReactionsRepository? scribeReactionsRepository,
}) async {
  final router = await pumpRouterApp(
    tester,
    initialLocation: '/call-log',
    routes: [
      GoRoute(path: '/call-log', builder: (context, state) => const Text('CALL_LOG')),
      GoRoute(
        path: '/call-log/1001',
        builder: (context, state) => CallSummaryScreen(log: _log),
      ),
      GoRoute(
        path: '/share-for-review/:scenarioSessionId',
        builder: (context, state) => Text(
          'SHARE_SCREEN:${state.pathParameters['scenarioSessionId']}:${state.extra}',
        ),
      ),
      GoRoute(
        path: '/reviews/:reviewId',
        builder: (context, state) =>
            Text('REVIEW_DETAILS:${state.pathParameters['reviewId']}:${state.extra}'),
      ),
    ],
    overrides: [
      callLogRepositoryProvider.overrideWithValue(repository),
      userPermissionsProvider.overrideWith(
        (ref) async => const [UserPermissions.viewScribeReview, UserPermissions.editSummaryFeedback],
      ),
      if (scribeReviewsRepository != null)
        scribeReviewsRepositoryProvider.overrideWithValue(scribeReviewsRepository),
      if (scribeReactionsRepository != null)
        scribeReactionsRepositoryProvider.overrideWithValue(scribeReactionsRepository),
    ],
    scaffoldMessengerKey: rootScaffoldMessengerKey,
  );
  router.push('/call-log/1001');
  await tester.pumpAndSettle();
  return router;
}

void main() {
  late MockCallLogRepository repository;
  late MockScribeReviewsRepository scribeReviewsRepository;
  late MockScribeReactionsRepository scribeReactionsRepository;

  setUp(() {
    repository = MockCallLogRepository();
    scribeReviewsRepository = MockScribeReviewsRepository();
    scribeReactionsRepository = MockScribeReactionsRepository();
    when(() => repository.getChatMessages(1001)).thenAnswer((_) async => []);
    when(() => scribeReviewsRepository.getThreads(any(), limit: any(named: 'limit')))
        .thenAnswer((_) async => (threads: const <ReviewThread>[], count: 0));
    when(() => scribeReactionsRepository.getReactionsCount(any()))
        .thenAnswer((_) async => <String, int>{});
  });

  testWidgets('the share switch only shows for a SUCCESS summary with a transcript, not archived', (
    tester,
  ) async {
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    expect(find.text('Share'), findsOneWidget);
    expect(find.byType(Switch), findsOneWidget);
  });

  testWidgets('the share switch is hidden when there is no transcript yet', (tester) async {
    when(() => repository.getCallSummary(1001))
        .thenAnswer((_) async => _summary(hasTranscript: false));
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    expect(find.byType(Switch), findsNothing);
  });

  testWidgets('the share switch is hidden once the session is archived', (tester) async {
    when(() => repository.getCallSummary(1001))
        .thenAnswer((_) async => _summary(archivedAt: '2026-01-02T00:00:00Z'));
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    expect(find.byType(Switch), findsNothing);
  });

  testWidgets('toggling share ON with no existing review opens the scribe share screen', (
    tester,
  ) async {
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(find.textContaining('SHARE_SCREEN:1001'), findsOneWidget);
    expect(
      find.textContaining('isScribe: true'),
      findsOneWidget,
      reason: "the record's toString should show isScribe: true",
    );
  });

  testWidgets(
    'toggling share ON for a review created under 10 minutes ago reopens the share screen too',
    (tester) async {
      when(() => repository.getCallSummary(1001)).thenAnswer(
        (_) async => _summary(
          reviewId: 'rev-1',
          reviewStatus: 'HIDDEN',
          reviewNote: 'draft note',
          reviewCreatedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 2)).toIso8601String(),
        ),
      );
      await _pump(
        tester,
        repository: repository,
        scribeReviewsRepository: scribeReviewsRepository,
        scribeReactionsRepository: scribeReactionsRepository,
      );

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      expect(find.textContaining('SHARE_SCREEN:1001'), findsOneWidget);
      verifyNever(
        () => scribeReviewsRepository.updateReviewStatus(
          reviewId: any(named: 'reviewId'),
          status: any(named: 'status'),
        ),
      );
    },
  );

  testWidgets('toggling share ON for an older review flips its status directly, no navigation', (
    tester,
  ) async {
    when(() => repository.getCallSummary(1001)).thenAnswer(
      (_) async => _summary(
        reviewId: 'rev-1',
        reviewStatus: 'HIDDEN',
        reviewCreatedAt: DateTime.now().toUtc().subtract(const Duration(hours: 1)).toIso8601String(),
      ),
    );
    when(
      () => scribeReviewsRepository.updateReviewStatus(reviewId: 'rev-1', status: 'IN_REVIEW'),
    ).thenAnswer((_) async {});

    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(find.text('CALL_LOG'), findsNothing, reason: 'should still be on CallSummaryScreen');
    verify(
      () => scribeReviewsRepository.updateReviewStatus(reviewId: 'rev-1', status: 'IN_REVIEW'),
    ).called(1);
    expect(find.text('Privacy setting updated'), findsOneWidget);
  });

  testWidgets('toggling share OFF flips an already-shared review to HIDDEN', (tester) async {
    when(() => repository.getCallSummary(1001)).thenAnswer(
      (_) async => _summary(
        reviewId: 'rev-1',
        reviewStatus: 'IN_REVIEW',
        reviewCreatedAt: DateTime.now().toUtc().subtract(const Duration(hours: 1)).toIso8601String(),
      ),
    );
    when(
      () => scribeReviewsRepository.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN'),
    ).thenAnswer((_) async {});

    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    verify(
      () => scribeReviewsRepository.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN'),
    ).called(1);
  });

  testWidgets('3-dot menu: Rename updates the summary name', (tester) async {
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    when(() => repository.updateSummaryName(1001, 'New name')).thenAnswer((_) async {});

    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Rename'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'New name');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    verify(() => repository.updateSummaryName(1001, 'New name')).called(1);
    expect(find.text('Summary name updated successfully'), findsOneWidget);
  });

  testWidgets('3-dot menu: Data Policy opens the privacy URL externally', (tester) async {
    final fakeLauncher = _FakeUrlLauncherPlatform();
    UrlLauncherPlatform.instance = fakeLauncher;

    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Data Policy'));
    await tester.pumpAndSettle();

    expect(fakeLauncher.launchedUrls, ['https://app.helloally.ai/privacy']);
  });

  testWidgets('3-dot menu: Archive Session archives after confirmation', (tester) async {
    when(() => repository.getCallSummary(1001)).thenAnswer((_) async => _summary());
    when(() => repository.archiveCallLog(1001, archive: true)).thenAnswer((_) async {});

    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    await tester.tap(find.byType(PopupMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Archive Session'));
    await tester.pumpAndSettle();

    // Confirmation modal: confirm button shares the same label as the menu
    // item ("Archive"), so tap the one inside the dialog specifically.
    await tester.tap(find.widgetWithText(AppButton, 'Archive').last);
    await tester.pumpAndSettle();

    verify(() => repository.archiveCallLog(1001, archive: true)).called(1);
    expect(find.text('Session archived successfully'), findsOneWidget);
  });

  testWidgets('the floating review button is hidden for a private review with no engagement yet', (
    tester,
  ) async {
    when(() => repository.getCallSummary(1001))
        .thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('the floating review button shows for a non-private review, and navigates to it', (
    tester,
  ) async {
    when(() => repository.getCallSummary(1001))
        .thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));
    await _pump(
      tester,
      repository: repository,
      scribeReviewsRepository: scribeReviewsRepository,
      scribeReactionsRepository: scribeReactionsRepository,
    );

    expect(find.byType(FloatingActionButton), findsOneWidget);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    expect(find.textContaining('REVIEW_DETAILS:rev-1'), findsOneWidget);
  });

  testWidgets(
    'the floating review button shows for a private review that already has a thread',
    (tester) async {
      when(() => repository.getCallSummary(1001))
          .thenAnswer((_) async => _summary(reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
      when(() => scribeReviewsRepository.getThreads('rev-1', limit: 1)).thenAnswer(
        (_) async => (
          threads: [
            ReviewThread.fromJson({
              'id': 't1',
              'createdBy': {'id': 1, 'name': 'Someone'},
            }),
          ],
          count: 1,
        ),
      );

      await _pump(
        tester,
        repository: repository,
        scribeReviewsRepository: scribeReviewsRepository,
        scribeReactionsRepository: scribeReactionsRepository,
      );

      expect(find.byType(FloatingActionButton), findsOneWidget);
    },
  );
}
