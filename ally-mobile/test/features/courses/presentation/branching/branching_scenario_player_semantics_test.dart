import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

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

// Own file: one `pumpApp` per file, so the translated labels resolve
// (see bucket_sort_player_test.dart's note).
void main() {
  testWidgets('RN screen-reader labels: the exhausted pause reads as a labelled recap list of rows', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpApp(
      tester,
      Scaffold(
        body: BranchingScenarioPlayer(
          payload: _payload(
            exhausted: true,
            nextRoundAt: '2000-01-01T00:00:00Z',
            recap: [BranchingRecapEntry(endingNodeId: 'n2-bad', score: 20, at: '2026-01-01T00:00:00Z')],
          ),
          itemId: 'item-1',
          onCompleted: (_) {},
          onRequestNext: () {},
          onBack: () {},
        ),
      ),
      overrides: [coursesRepositoryProvider.overrideWithValue(MockCoursesRepository())],
    );
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump();

    // RN accessibilityRole="list" + accessibilityLabel={recapLabel}.
    expect(
      tester.getSemantics(find.byKey(const Key('branching-recap-list'))),
      matchesSemantics(label: 'Your attempts this round'),
    );
    // RN: each row is one `accessible` element, "outcome. text. score"
    // joined with ". " as RN does (so a text ending in "." reads "..").
    expect(
      find.bySemanticsLabel('Negative outcome. They shut down.. Score 20 / 100'),
      findsOneWidget,
    );
    handle.dispose();
  });
}
