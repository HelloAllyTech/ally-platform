import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/branching/branching_scenario_player.dart';

import '../../../../support/fake_translations.dart';
import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

/// n1 (photo, two choices) -> n2 (no photo, one choice) -> n3 (ending).
/// n1's other choice ends at once.
List<BranchingNode> _nodes({bool withImages = true}) => [
  BranchingNode(
    id: 'n1',
    title: 'The waiting room',
    text: 'A client seems distressed.',
    image: withImages ? BranchingImage(url: 'https://example.test/n1.jpg', alt: 'A waiting room') : null,
    choices: [
      BranchingChoice(id: 'c-open', text: 'Ask an open question', nextNodeId: 'n2'),
      BranchingChoice(id: 'c-bad', text: 'Change the subject', nextNodeId: 'n-bad'),
    ],
  ),
  BranchingNode(
    id: 'n2',
    text: 'They take a breath before answering.',
    choices: [BranchingChoice(id: 'c-wait', text: 'Give them a moment', nextNodeId: 'n3')],
  ),
  BranchingNode(
    id: 'n3',
    title: 'They open up',
    text: 'They tell you what happened.',
    outcome: BranchingOutcome.positive,
    score: 90,
    takeaway: 'Silence gives room.',
  ),
  BranchingNode(id: 'n-bad', text: 'They shut down.', outcome: BranchingOutcome.negative, score: 20),
];

StartItemPayload _payload({
  BranchingExperience? experience,
  bool withImages = true,
  String startNodeId = 'n1',
}) => StartItemPayload(
  trackItemProgressId: 'prog-1',
  type: 'BRANCHING_SCENARIO',
  branchingStartNodeId: startNodeId,
  branchingNodes: _nodes(withImages: withImages),
  branchingPassScore: 70,
  branchingCompleted: false,
  branchingEndingsReached: const [],
  branchingExhausted: false,
  branchingRecap: const [],
  branchingExperience: experience,
);

BranchingResult _passed(String endingNodeId, int score) => BranchingResult(
  endingNodeId: endingNodeId,
  score: score,
  passScore: 70,
  passed: true,
  attemptsUsed: 1,
  maxAttempts: 3,
  attemptsLeft: 2,
  endingsReached: [endingNodeId],
  itemCompleted: true,
  completion: TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
  exhausted: false,
  recap: const [],
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
      overrides: [fixedTranslationsOverride(), coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  group('single-choice scene', () {
    testWidgets('classic: one solid button instead of the prompt and boxes, recorded as that choice', (
      tester,
    ) async {
      when(
        () => repository.recordBranchingResult(itemId: 'item-1', path: ['c-wait']),
      ).thenAnswer((_) async => _passed('n3', 90));

      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(startNodeId: 'n2'),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
        ),
      );

      expect(find.text('They take a breath before answering.'), findsOneWidget);
      expect(find.text('What do you do?'), findsNothing);
      final button = find.byKey(const Key('branching-choice-c-wait'));
      expect(button, findsOneWidget);
      expect(find.descendant(of: button, matching: find.text('Give them a moment')), findsOneWidget);
      // Solid primary fill, not the bordered choice box.
      expect(find.descendant(of: button, matching: find.byType(InkWell)), findsNothing);

      await tester.tap(button);
      await tester.pumpAndSettle();

      verify(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-wait'])).called(1);
      expect(find.byKey(const Key('branching-score')), findsOneWidget);
    });

    testWidgets('classic: two or more choices keep the prompt and choice boxes', (tester) async {
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

      expect(find.text('What do you do?'), findsOneWidget);
      expect(find.byKey(const Key('branching-choice-c-open')), findsOneWidget);
      expect(find.byKey(const Key('branching-choice-c-bad')), findsOneWidget);
    });
  });

  group('story experience', () {
    testWidgets('shows the photo and a sheet with title, text and choices; reports immersive', (tester) async {
      final reported = <bool>[];
      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(experience: BranchingExperience.story),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
          onImmersiveChanged: reported.add,
        ),
      );

      expect(find.byKey(const Key('branching-story-photo')), findsOneWidget);
      final sheet = find.byKey(const Key('branching-story-sheet'));
      expect(sheet, findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('The waiting room')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('A client seems distressed.')), findsOneWidget);
      expect(
        find.descendant(of: sheet, matching: find.byKey(const Key('branching-choice-c-open'))),
        findsOneWidget,
      );
      // No prompt line, no previous choice before the first decision.
      expect(find.text('What do you do?'), findsNothing);
      expect(find.byKey(const Key('branching-story-previous-choice')), findsNothing);
      expect(reported, [true]);
    });

    testWidgets('after a choice: the previous choice line, the carried-over photo and the single button', (
      tester,
    ) async {
      when(
        () => repository.recordBranchingResult(itemId: 'item-1', path: ['c-open', 'c-wait']),
      ).thenAnswer((_) async => _passed('n3', 90));
      var nextRequested = false;

      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(experience: BranchingExperience.story),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () => nextRequested = true,
          onBack: () {},
        ),
      );

      await tester.tap(find.byKey(const Key('branching-choice-c-open')));
      await tester.pumpAndSettle();

      // n2 has no image of its own: n1's photo carries over.
      expect(find.byKey(const Key('branching-story-photo')), findsOneWidget);
      expect(find.byKey(const Key('branching-story-previous-choice')), findsOneWidget);
      expect(find.text('You: Ask an open question'), findsOneWidget);
      expect(find.text('What do you do?'), findsNothing);

      final button = find.byKey(const Key('branching-choice-c-wait'));
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();

      verify(() => repository.recordBranchingResult(itemId: 'item-1', path: ['c-open', 'c-wait'])).called(1);

      // The ending, in the sheet: badge, title, takeaway, score, Continue.
      final sheet = find.byKey(const Key('branching-story-sheet'));
      expect(find.descendant(of: sheet, matching: find.text('Positive outcome')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('They open up')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.text('Silence gives room.')), findsOneWidget);
      expect(find.descendant(of: sheet, matching: find.byKey(const Key('branching-score'))), findsOneWidget);
      final continueButton = find.byKey(const Key('branching-continue'));
      expect(find.descendant(of: sheet, matching: continueButton), findsOneWidget);

      await tester.ensureVisible(continueButton);
      await tester.tap(continueButton);
      expect(nextRequested, isTrue);
    });

    testWidgets('a story scenario with no images at all plays the classic layout', (tester) async {
      final reported = <bool>[];
      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(experience: BranchingExperience.story, withImages: false),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
          onImmersiveChanged: reported.add,
        ),
      );

      expect(find.byKey(const Key('branching-story-sheet')), findsNothing);
      expect(find.byKey(const Key('branching-story-photo')), findsNothing);
      expect(find.text('What do you do?'), findsOneWidget);
      expect(reported, isEmpty);
    });

    testWidgets('a classic scenario with images keeps the classic layout', (tester) async {
      final reported = <bool>[];
      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: _payload(),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
          onImmersiveChanged: reported.add,
        ),
      );

      expect(find.byKey(const Key('branching-story-sheet')), findsNothing);
      expect(reported, isEmpty);
    });

    testWidgets('the out-of-attempts pause stays classic and reports not immersive', (tester) async {
      final reported = <bool>[];
      await pump(
        tester,
        BranchingScenarioPlayer(
          payload: StartItemPayload(
            trackItemProgressId: 'prog-1',
            type: 'BRANCHING_SCENARIO',
            branchingStartNodeId: 'n1',
            branchingNodes: _nodes(),
            branchingPassScore: 70,
            branchingExhausted: true,
            branchingNextRoundAt: '2099-01-01T00:00:00Z',
            branchingRecap: const [],
            branchingExperience: BranchingExperience.story,
          ),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
          onImmersiveChanged: reported.add,
        ),
      );

      expect(find.byKey(const Key('branching-exhausted')), findsOneWidget);
      expect(find.byKey(const Key('branching-story-sheet')), findsNothing);
      expect(reported, isEmpty);
    });
  });
}
