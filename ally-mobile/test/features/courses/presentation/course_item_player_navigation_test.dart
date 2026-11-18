import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_button.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';

import '../../../support/pump_router_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

/// A 2-item, single-section track: item1 (unlocked) -> item2 (unlocked,
/// the track's last item) — enough to exercise Prev/Next, the "Finish"
/// label swap on the last item, and the per-section progress rail without
/// the noise of a second section.
TrackDetail _trackDetail({TrackItemStatus item1Status = TrackItemStatus.unlocked}) =>
    TrackDetail(
      id: 'track-1',
      title: 'Track',
      description: null,
      coverImageUrl: null,
      status: 'IN_PROGRESS',
      totalItems: 2,
      completedItems: item1Status == TrackItemStatus.completed ? 1 : 0,
      enrolled: true,
      trackEnrollmentId: 'enr-1',
      sections: [
        TrackSection(
          id: 'section-a',
          title: 'Section A',
          order: 0,
          items: [
            TrackDetailItem(
              id: 'item1',
              type: TrackItemType.article,
              order: 0,
              title: 'Item One',
              description: null,
              status: item1Status,
              score: null,
              maxWatchedPct: null,
            ),
            TrackDetailItem(
              id: 'item2',
              type: TrackItemType.article,
              order: 1,
              title: 'Item Two',
              description: null,
              status: TrackItemStatus.unlocked,
              score: null,
              maxWatchedPct: null,
            ),
          ],
        ),
      ],
    );

StartItemPayload _articlePayload(String html) => StartItemPayload(
  trackItemProgressId: 'p1',
  type: 'ARTICLE',
  html: html,
  articleQuestions: const [],
);

CourseButton _button(WidgetTester tester, String key) => tester.widget<CourseButton>(find.byKey(Key(key)));

/// The article's footer unlocks after RN's 3s no-scroll grace period.
Future<void> _markRead(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pump();
  await tester.tap(find.text('Mark as read'));
  await tester.pumpAndSettle();
}

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    when(() => repository.getLearnTrackDetail('track-1'))
        .thenAnswer((_) async => _trackDetail());
    when(() => repository.startTrackItem('item1'))
        .thenAnswer((_) async => _articlePayload('<p>One</p>'));
    when(() => repository.startTrackItem('item2'))
        .thenAnswer((_) async => _articlePayload('<p>Two</p>'));
    when(() => repository.markArticleRead(any())).thenAnswer(
      (_) async =>
          TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
    );
  });

  List<GoRoute> routes() => [
    GoRoute(
      path: '/courses/item/item1',
      builder: (context, state) => CourseItemPlayerScreen(
        trackId: 'track-1',
        item: TrackDetailItem(
          id: 'item1',
          type: TrackItemType.article,
          order: 0,
          title: 'Item One',
          description: null,
          status: TrackItemStatus.unlocked,
          score: null,
          maxWatchedPct: null,
        ),
      ),
    ),
    GoRoute(path: '/courses/track-1', builder: (context, state) => const Text('OVERVIEW')),
  ];

  testWidgets(
    'Prev is disabled on the first item, Next is disabled until it completes, and the rail shows both items',
    (tester) async {
      await pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: routes(),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      expect(
        _button(tester, 'player-prev-button').isDisabled,
        isTrue,
      );
      expect(
        _button(tester, 'player-next-button').isDisabled,
        isTrue,
        reason: 'item1 has not reported completion yet',
      );
      expect(find.byKey(const ValueKey('progress-segment-item1')), findsOneWidget);
      expect(find.byKey(const ValueKey('progress-segment-item2')), findsOneWidget);
      expect(find.text('0% complete'), findsOneWidget);

      await _markRead(tester);

      expect(
        _button(tester, 'player-next-button').isDisabled,
        isFalse,
        reason: 'markArticleRead resolved, unlocking forward navigation',
      );
    },
  );

  testWidgets(
    'tapping Next after completion re-fetches the next item in place, and Prev becomes enabled',
    (tester) async {
      await pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: routes(),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      await _markRead(tester);
      await tester.tap(find.byKey(const Key('player-next-button')));
      await tester.pumpAndSettle();

      verify(() => repository.startTrackItem('item2')).called(1);
      expect(
        _button(tester, 'player-prev-button').isDisabled,
        isFalse,
        reason: 'item2 is no longer the first item',
      );
      // The last item's Next button relabels to Finish.
      expect(find.widgetWithText(CourseButton, 'Finish'), findsOneWidget);
    },
  );

  testWidgets('tapping Finish on the last item, once completed, exits to the track overview', (
    tester,
  ) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/courses/item/item1',
      routes: routes(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    await _markRead(tester);
    await tester.tap(find.byKey(const Key('player-next-button')));
    await tester.pumpAndSettle();

    await _markRead(tester);
    await tester.tap(find.widgetWithText(CourseButton, 'Finish'));
    await tester.pumpAndSettle();

    expect(find.text('OVERVIEW'), findsOneWidget);
  });

  testWidgets('the exit (X) button in the top bar also leaves to the track overview', (
    tester,
  ) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/courses/item/item1',
      routes: routes(),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byKey(const Key('player-exit-button')));
    await tester.pumpAndSettle();

    expect(find.text('OVERVIEW'), findsOneWidget);
  });

  testWidgets(
    'iOS swipe-back is disabled (RN gestureEnabled:false); Android back leaves for the overview',
    (tester) async {
      await pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: routes(),
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      final route = ModalRoute.of(tester.element(find.byType(CourseItemPlayerScreen)))!;
      expect(route.popGestureEnabled, isFalse);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('OVERVIEW'), findsOneWidget);
      expect(find.byType(CourseItemPlayerScreen), findsNothing);
    },
  );
}
