import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';

import '../../../support/pump_router_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackDetailItem _item() => TrackDetailItem(
  id: 'item1',
  type: TrackItemType.branchingScenario,
  order: 0,
  title: 'Scenario quiz',
  description: null,
  status: TrackItemStatus.unlocked,
  score: null,
  maxWatchedPct: null,
);

TrackDetail _trackDetail() => TrackDetail(
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'IN_PROGRESS',
  totalItems: 1,
  completedItems: 0,
  enrolled: true,
  trackEnrollmentId: 'enr-1',
  sections: [TrackSection(id: 'section-a', title: 'Section A', order: 0, items: [_item()])],
);

StartItemPayload _payload(BranchingExperience? experience) => StartItemPayload(
  trackItemProgressId: 'p1',
  type: 'BRANCHING_SCENARIO',
  branchingStartNodeId: 'n1',
  branchingNodes: [
    BranchingNode(
      id: 'n1',
      title: 'The waiting room',
      text: 'A client seems distressed.',
      image: BranchingImage(url: 'https://example.test/n1.jpg'),
      choices: [BranchingChoice(id: 'c1', text: 'Sit down beside them', nextNodeId: 'n2')],
    ),
    BranchingNode(id: 'n2', text: 'They open up.', outcome: BranchingOutcome.positive, score: 90),
  ],
  branchingCompleted: false,
  branchingEndingsReached: const [],
  branchingExhausted: false,
  branchingRecap: const [],
  branchingExperience: experience,
);

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    when(() => repository.getLearnTrackDetail('track-1')).thenAnswer((_) async => _trackDetail());
  });

  Future<void> pump(WidgetTester tester) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/courses/item/item1',
      routes: [
        GoRoute(
          path: '/courses/item/item1',
          builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item()),
        ),
        GoRoute(path: '/courses/track-1', builder: (context, state) => const Text('OVERVIEW')),
      ],
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  testWidgets('a story scenario floats the top bar over the photo and hides the bottom nav', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _payload(BranchingExperience.story));

    await pump(tester);

    expect(find.byKey(const Key('branching-story-photo')), findsOneWidget);
    expect(find.byKey(const ValueKey('player-top-bar-overlay')), findsOneWidget);
    expect(find.byKey(const Key('player-exit-button')), findsOneWidget);
    expect(find.byKey(const Key('player-next-button')), findsNothing);
    expect(find.byKey(const Key('player-prev-button')), findsNothing);

    // The close button still leaves the item.
    await tester.tap(find.byKey(const Key('player-exit-button')));
    await tester.pumpAndSettle();
    expect(find.text('OVERVIEW'), findsOneWidget);
  });

  testWidgets('a classic scenario keeps the normal top bar and the bottom nav', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _payload(null));

    await pump(tester);

    expect(find.byKey(const Key('branching-story-photo')), findsNothing);
    expect(find.byKey(const ValueKey('player-top-bar-overlay')), findsNothing);
    expect(find.byKey(const Key('player-exit-button')), findsOneWidget);
    expect(find.byKey(const Key('player-next-button')), findsOneWidget);
    // The single-choice button shows in classic too.
    expect(find.byKey(const Key('branching-choice-c1')), findsOneWidget);
  });
}
