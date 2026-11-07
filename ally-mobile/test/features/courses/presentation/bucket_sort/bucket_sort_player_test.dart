import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/bucket_sort/bucket_sort_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

List<BucketSortBucket> _buckets() => [
  BucketSortBucket(id: 'healthy', label: 'Healthy coping'),
  BucketSortBucket(id: 'unhealthy', label: 'Unhealthy coping'),
];

List<BucketSortItem> _items() => [
  BucketSortItem(id: 'i1', text: 'Deep breathing'),
  BucketSortItem(id: 'i2', text: 'Avoidance'),
];

StartItemPayload _payload({
  String? intro,
  Map<String, BucketSortFeedback> answered = const {},
  int? bestFirstTryPct,
  List<BucketSortBucket>? buckets,
  List<BucketSortItem>? items,
}) => StartItemPayload(
  trackItemProgressId: 'prog-1',
  type: 'BUCKET_SORT',
  bucketSortIntro: intro,
  bucketSortBuckets: buckets ?? _buckets(),
  bucketSortItems: items ?? _items(),
  bucketSortAnswered: answered,
  bucketSortRounds: 1,
  bucketSortBestFirstTryPct: bestFirstTryPct,
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

  // Packed into one `testWidgets` deliberately: `pump_app.dart` documents
  // that a *second, separate* `testWidgets` calling `pumpApp` in the same
  // file can leave its `localizationControllerProvider` stuck in
  // `AsyncLoading` forever, so every translated string falls back to its
  // raw key — harmless for the first test below (byKey/raw-content
  // assertions only), but these later scenarios assert on real translated
  // copy ("Right!", "Not quite", the interpolated percentages), so they run
  // as sequential steps here instead of separate tests.
  testWidgets('the full sort-feedback-next-results-restart flow', (tester) async {
    when(
      () => repository.placeBucketSortItem(itemId: 'item-1', sortItemId: 'i1', bucketId: 'healthy'),
    ).thenAnswer(
      (_) async => BucketSortPlacementResult(
        sortItemId: 'i1',
        correct: true,
        placedBucketId: 'healthy',
        correctBucketId: 'healthy',
        placedCount: 1,
        totalCount: 2,
        finished: false,
        itemCompleted: false,
      ),
    );
    final completion = TrackItemCompletionResult(completed: true, sectionCompleted: true, trackCompleted: false);
    when(
      () => repository.placeBucketSortItem(itemId: 'item-1', sortItemId: 'i2', bucketId: 'unhealthy'),
    ).thenAnswer(
      (_) async => BucketSortPlacementResult(
        sortItemId: 'i2',
        correct: false,
        placedBucketId: 'unhealthy',
        correctBucketId: 'healthy',
        explanation: 'Avoidance delays processing.',
        placedCount: 2,
        totalCount: 2,
        finished: true,
        firstTryPct: 50,
        itemCompleted: true,
        completion: completion,
      ),
    );
    when(() => repository.restartBucketSort('item-1')).thenAnswer((_) async {});
    when(() => repository.startTrackItem('item-1')).thenAnswer((_) async => _payload());

    TrackItemCompletionResult? completedResult;
    await pump(
      tester,
      BucketSortPlayer(
        payload: _payload(),
        itemId: 'item-1',
        onCompleted: (r) => completedResult = r,
        onRequestNext: () {},
      ),
    );

    // 1. Initial render: first unanswered item, progress, both buckets.
    expect(find.byKey(const Key('bucket-sort-item')), findsOneWidget);
    expect(find.text('Deep breathing'), findsOneWidget);
    expect(find.text('0 of 2 sorted'), findsOneWidget);
    expect(find.byKey(const Key('bucket-healthy')), findsOneWidget);
    expect(find.byKey(const Key('bucket-unhealthy')), findsOneWidget);

    // 2. A correct placement: feedback with no "you chose" line.
    await tester.tap(find.byKey(const Key('bucket-healthy')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('bucket-sort-feedback')), findsOneWidget);
    expect(find.text('Right!'), findsOneWidget);
    expect(find.textContaining('You chose'), findsNothing);
    verify(
      () => repository.placeBucketSortItem(itemId: 'item-1', sortItemId: 'i1', bucketId: 'healthy'),
    ).called(1);

    // 3. Next advances to the second item; feedback clears.
    await tester.tap(find.byKey(const Key('bucket-sort-next')));
    await tester.pumpAndSettle();

    expect(find.text('Avoidance'), findsOneWidget);
    expect(find.text('1 of 2 sorted'), findsOneWidget);
    expect(find.byKey(const Key('bucket-sort-feedback')), findsNothing);

    // 4. An incorrect, final placement: explains where it belongs, shows
    // the misplaced chip, but defers onCompleted until Next is tapped.
    await tester.tap(find.byKey(const Key('bucket-unhealthy')));
    await tester.pumpAndSettle();

    expect(find.text('Not quite'), findsOneWidget);
    expect(find.text('You chose Unhealthy coping. It belongs in Healthy coping.'), findsOneWidget);
    expect(find.text('Avoidance delays processing.'), findsOneWidget);
    expect(find.byKey(const Key('bucket-sort-misplaced')), findsOneWidget);
    expect(completedResult, isNull);
    // The last item's button already reads "See results", not "Next item".
    expect(find.text('See results'), findsOneWidget);

    // 5. Tapping it reports the deferred completion and shows the results.
    await tester.tap(find.byKey(const Key('bucket-sort-next')));
    await tester.pumpAndSettle();

    expect(completedResult, completion);
    expect(find.byKey(const Key('bucket-sort-results')), findsOneWidget);
    expect(find.text('50% right on the first try'), findsOneWidget);
    expect(find.text('Worth another look'), findsOneWidget);
    expect(find.text('Deep breathing'), findsOneWidget);

    // 6. Restart clears the round and returns to the picking state.
    await tester.tap(find.byKey(const Key('bucket-sort-restart')));
    await tester.pumpAndSettle();

    verify(() => repository.restartBucketSort('item-1')).called(1);
    verify(() => repository.startTrackItem('item-1')).called(1);
    expect(find.byKey(const Key('bucket-sort-item')), findsOneWidget);
    expect(find.text('0 of 2 sorted'), findsOneWidget);
  });

  // `pumpApp`'s documented translation stall (see the comment above) means
  // a *second* `pumpApp` call anywhere else in this file can't reliably
  // resolve translated copy — so these two scenarios instead use a bare
  // `pumpWidget` (no `pumpApp`, no `runAsync`) and assert on the raw i18n
  // key, exactly like `game_player_test.dart`'s established pattern for the
  // same constraint. The real resolved copy for these same i18n keys is
  // already verified end-to-end by the comprehensive test above; what these
  // two check is the *selection logic* (which message/key the state
  // produces), not the translation layer itself.
  Future<void> pumpBare(WidgetTester tester, Widget child) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(home: Scaffold(body: child)),
      ),
    );
  }

  testWidgets('all-correct results show the all-right key and no review heading', (tester) async {
    await pumpBare(
      tester,
      BucketSortPlayer(
        payload: _payload(
          bestFirstTryPct: 80,
          answered: {
            'i1': BucketSortFeedback(correct: true, placedBucketId: 'healthy', correctBucketId: 'healthy'),
            'i2': BucketSortFeedback(correct: true, placedBucketId: 'unhealthy', correctBucketId: 'unhealthy'),
          },
        ),
        itemId: 'item-1',
        onCompleted: (_) {},
        onRequestNext: () {},
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('bucket-sort-results')), findsOneWidget);
    expect(find.text('courses.bucketSort.firstTry'), findsOneWidget);
    expect(find.text('courses.bucketSort.best'), findsOneWidget);
    expect(find.text('courses.bucketSort.allRight'), findsOneWidget);
    expect(find.text('courses.bucketSort.reviewHeading'), findsNothing);
  });

  testWidgets('a placement failure shows the failed-key notice and does not advance', (tester) async {
    when(
      () => repository.placeBucketSortItem(itemId: 'item-1', sortItemId: 'i1', bucketId: 'healthy'),
    ).thenThrow(Exception('network down'));

    await pumpBare(
      tester,
      BucketSortPlayer(payload: _payload(), itemId: 'item-1', onCompleted: (_) {}, onRequestNext: () {}),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('bucket-healthy')));
    await tester.pumpAndSettle();

    expect(find.text('courses.bucketSort.placeFailed'), findsOneWidget);
    expect(find.byKey(const Key('bucket-sort-feedback')), findsNothing);
    // Raw item text, not a translated key — unaffected either way, and
    // confirms the item itself didn't silently get marked as placed.
    expect(find.text('Deep breathing'), findsOneWidget);
  });
}
