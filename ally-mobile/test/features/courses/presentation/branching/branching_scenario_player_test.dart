import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/branching/branching_scenario_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

/// A two-scene graph: one choice leads to a passing ending, the other to a
/// failing one — enough to exercise choose/submit/score/retry without a
/// deep tree.
List<BranchingNode> _nodes() => [
  BranchingNode(
    id: 'n1',
    text: 'A client seems distressed.',
    choices: [
      BranchingChoice(id: 'c-good', text: 'Ask an open question', nextNodeId: 'n2-good'),
      BranchingChoice(id: 'c-bad', text: 'Change the subject', nextNodeId: 'n2-bad'),
    ],
  ),
  BranchingNode(
    id: 'n2-good',
    text: 'They open up.',
    outcome: BranchingOutcome.positive,
    score: 90,
    takeaway: 'Listening helps.',
  ),
  BranchingNode(id: 'n2-bad', text: 'They shut down.', outcome: BranchingOutcome.negative, score: 20),
];

StartItemPayload _payload({
  String? intro,
  int? passScore = 70,
  int? bestScore,
  bool completed = false,
  List<String> endingsReached = const [],
  bool exhausted = false,
  String? nextRoundAt,
  List<BranchingRecapEntry> recap = const [],
}) => StartItemPayload(
  trackItemProgressId: 'prog-1',
  type: 'BRANCHING_SCENARIO',
  branchingIntro: intro,
  branchingStartNodeId: 'n1',
  branchingNodes: _nodes(),
  branchingPassScore: passScore,
  branchingBestScore: bestScore,
  branchingCompleted: completed,
  branchingEndingsReached: endingsReached,
  branchingExhausted: exhausted,
  branchingNextRoundAt: nextRoundAt,
  branchingRecap: recap,
);

BranchingResult _result({
  required String endingNodeId,
  required int score,
  int? passScore = 70,
  bool passed = false,
  int attemptsUsed = 1,
  int? maxAttempts = 3,
  int? attemptsLeft = 2,
  bool itemCompleted = false,
  TrackItemCompletionResult? completion,
  bool exhausted = false,
  String? nextRoundAt,
  List<BranchingRecapEntry> recap = const [],
}) => BranchingResult(
  endingNodeId: endingNodeId,
  score: score,
  passScore: passScore,
  passed: passed,
  attemptsUsed: attemptsUsed,
  maxAttempts: maxAttempts,
  attemptsLeft: attemptsLeft,
  endingsReached: [endingNodeId],
  itemCompleted: itemCompleted,
  completion: completion,
  exhausted: exhausted,
  nextRoundAt: nextRoundAt,
  recap: recap,
);

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
  });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await pumpApp(
      tester,
      Scaffold(body: child),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  testWidgets('choosing through to an ending submits the path and shows the server score', (
    tester,
  ) async {
    when(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-good'])).thenAnswer(
      (_) async => _result(
        endingNodeId: 'n2-good',
        score: 90,
        passed: true,
        itemCompleted: true,
        completion: TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
      ),
    );

    var completedResult = false;
    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (_) => completedResult = true,
        onRequestNext: () {},
        onBack: () {},
      ),
    );

    expect(find.text('A client seems distressed.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('branching-choice-c-good')));
    await tester.pumpAndSettle();

    expect(find.text('They open up.'), findsOneWidget);
    expect(find.byKey(const Key('branching-score')), findsOneWidget);
    expect(completedResult, isTrue);
    verify(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-good'])).called(1);
  });

  testWidgets('a failing ending with attempts left shows Try again, not Continue', (tester) async {
    when(
      () => repository.recordBranchingResult(itemId: 'item-1', path: ['c-bad']),
    ).thenAnswer((_) async => _result(endingNodeId: 'n2-bad', score: 20, passed: false, attemptsLeft: 2));

    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
        onBack: () {},
      ),
    );

    await tester.tap(find.byKey(const Key('branching-choice-c-bad')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('branching-continue')), findsNothing);
    expect(find.byKey(const Key('branching-try-again')), findsOneWidget);
  });

  testWidgets('Try again restarts the run from the first scene', (tester) async {
    when(
      () => repository.recordBranchingResult(itemId: 'item-1', path: ['c-bad']),
    ).thenAnswer((_) async => _result(endingNodeId: 'n2-bad', score: 20, passed: false, attemptsLeft: 1));

    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
        onBack: () {},
      ),
    );

    await tester.tap(find.byKey(const Key('branching-choice-c-bad')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('branching-try-again')));
    await tester.pumpAndSettle();

    expect(find.text('A client seems distressed.'), findsOneWidget);
    expect(find.byKey(const Key('branching-score')), findsNothing);
  });

  testWidgets('a zero attempts-left failing ending with no replay-free hides Try again', (tester) async {
    when(
      () => repository.recordBranchingResult(itemId: 'item-1', path: ['c-bad']),
    ).thenAnswer((_) async => _result(endingNodeId: 'n2-bad', score: 20, passed: false, attemptsLeft: 0));

    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
        onBack: () {},
      ),
    );

    await tester.tap(find.byKey(const Key('branching-choice-c-bad')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('branching-try-again')), findsNothing);
    expect(find.byKey(const Key('branching-exhausted-plain')), findsWidgets);
  });

  testWidgets('a save failure shows a retry-save button that resubmits the same path', (tester) async {
    var callCount = 0;
    when(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-good'])).thenAnswer((_) async {
      callCount++;
      if (callCount == 1) throw DioException(requestOptions: RequestOptions(path: ''));
      return _result(endingNodeId: 'n2-good', score: 90, passed: true);
    });

    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
        onBack: () {},
      ),
    );

    await tester.tap(find.byKey(const Key('branching-choice-c-good')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('branching-retry-save')), findsOneWidget);

    await tester.tap(find.byKey(const Key('branching-retry-save')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('branching-score')), findsOneWidget);
    verify(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-good'])).called(2);
  });

  testWidgets(
    'an "used all attempts" error re-fetches the start payload and shows the exhausted pause',
    (tester) async {
      when(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-bad'])).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          response: Response(
            requestOptions: RequestOptions(path: ''),
            statusCode: 400,
            data: {'message': 'You have used all attempts for this round'},
          ),
        ),
      );
      when(() => repository.startTrackItem('item-1')).thenAnswer(
        (_) async => _payload(
          exhausted: true,
          nextRoundAt: '2099-01-01T00:00:00Z',
          recap: [BranchingRecapEntry(endingNodeId: 'n2-bad', score: 20, at: '2026-01-01T00:00:00Z')],
        ),
      );

      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
        ),
      );

      await tester.tap(find.byKey(const Key('branching-choice-c-bad')));
      // The pause screen's round timer re-arms itself every <=60s until the
      // round opens, which would make pumpAndSettle() hang forever — settle
      // manually with a single bounded pump instead.
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump();

      expect(find.byKey(const Key('branching-exhausted')), findsOneWidget);
      expect(find.byKey(const Key('branching-recap-row')), findsOneWidget);
    },
  );

  testWidgets('starting already in a pause with an open round shows Start a new round', (tester) async {
    await pump(
      tester,
      BranchingScenarioPlayer(
        payload: _payload(exhausted: true, nextRoundAt: '2000-01-01T00:00:00Z'),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
        onBack: () {},
      ),
    );
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump();

    expect(find.byKey(const Key('branching-start-round')), findsOneWidget);
  });
}
