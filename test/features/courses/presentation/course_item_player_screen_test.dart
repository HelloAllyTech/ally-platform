import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/html_rich_text.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/celebration_modal.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/game/game_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/journal/journal_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_item_player.dart';

import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackDetailItem _item({TrackItemType type = TrackItemType.article}) =>
    TrackDetailItem(
      id: 'item1',
      type: type,
      order: 0,
      title: 'Item title',
      description: null,
      status: TrackItemStatus.unlocked,
      score: null,
      maxWatchedPct: null,
    );

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
  });

  Future<void> pump(WidgetTester tester) async {
    await pumpApp(
      tester,
      CourseItemPlayerScreen(trackId: 'track-1', item: _item()),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  testWidgets('shows a loading indicator while startTrackItem is in flight', (
    tester,
  ) async {
    when(() => repository.startTrackItem('item1'))
        .thenAnswer((_) => Completer<StartItemPayload>().future);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(home: CourseItemPlayerScreen(trackId: 'track-1', item: _item())),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows an error message when startTrackItem fails', (
    tester,
  ) async {
    when(() => repository.startTrackItem('item1')).thenThrow(Exception('boom'));

    await pump(tester);

    // `_start()`'s catch block computes `_error` via `ref.tr()` (a one-time
    // read, by design — see translate_ref.dart) at the moment the mocked
    // call throws, which happens synchronously before localization has had
    // any chance to load; the raw key is baked into `_error` permanently
    // (nothing re-reads it later), so that's the real, deterministic
    // rendered text here rather than the translated copy.
    expect(find.textContaining('courses.player.loadFailed'), findsOneWidget);
    expect(find.textContaining('boom'), findsOneWidget);
  });

  testWidgets('QUIZ payload renders QuizPlayer', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'QUIZ',
        quiz: SanitizedQuiz(
          passScore: 70,
          maxAttempts: 3,
          questions: const [],
          totalPoints: 0,
        ),
        attemptsUsed: 0,
        maxAttempts: 3,
      ),
    );

    await pump(tester);

    expect(find.byType(QuizPlayer), findsOneWidget);
  });

  testWidgets('ARTICLE payload renders the article view (HtmlRichText)', (
    tester,
  ) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'ARTICLE',
        html: '<p>Hello world</p>',
        articleQuestions: const [],
      ),
    );

    await pump(tester);

    expect(find.byType(HtmlRichText), findsOneWidget);
    expect(find.text('courses.article.markRead'), findsOneWidget);
  });

  testWidgets('VIDEO payload renders VideoItemPlayer', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        // A non-s3 source renders VideoFallbackCard rather than the real
        // `video_player`-backed VideoPlayerWidget, which needs a platform
        // channel this test doesn't set up — see video_item_player_test.dart
        // for coverage of the native path. This still proves the dispatcher
        // picked VideoItemPlayer for a VIDEO payload.
        videoSource: 'youtube',
        videoUrl: 'https://youtube.com/watch?v=abc',
        durationSeconds: 60,
        interjections: const [],
      ),
    );

    await pump(tester);

    expect(find.byType(VideoItemPlayer), findsOneWidget);
  });

  testWidgets('JOURNAL payload renders JournalPlayer', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'JOURNAL',
        journalPrompts: const [],
        journalSavedResponses: const [],
      ),
    );

    await pump(tester);

    expect(find.byType(JournalPlayer), findsOneWidget);
  });

  testWidgets('GAME payload renders GamePlayer', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'GAME',
        // Deliberately an unrecognized gameKey: a recognized one would
        // drive `GamePlayer` into constructing a real `WebViewController`,
        // which has no platform channel in `flutter test` and crashes (see
        // game_player_test.dart's file doc comment). The dispatch itself —
        // GAME payload -> GamePlayer — doesn't depend on the gameKey being
        // valid.
        gameKey: 'NOT_A_REAL_GAME',
        gameIntro: 'intro',
      ),
    );

    await pump(tester);

    expect(find.byType(GamePlayer), findsOneWidget);
  });

  testWidgets(
    'a GAME payload with gameKey BREATHING_EXERCISE renders the intro card instead of '
    'GamePlayer, and reports a section completion immediately without ever tapping Start',
    (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer(
        (_) async => StartItemPayload(
          trackItemProgressId: 'p1',
          type: 'GAME',
          gameKey: 'BREATHING_EXERCISE',
          gameIntro: 'Settle in before we begin.',
          gameCompletion: TrackItemCompletionResult(
            completed: true,
            sectionCompleted: true,
            trackCompleted: false,
          ),
          breathingExercise: BreathingExerciseContent(
            inhaleSeconds: 4,
            holdInSeconds: 1,
            exhaleSeconds: 4,
            holdOutSeconds: 1,
            cycles: 3,
            inhaleText: 'Breathe in',
            holdInText: 'Hold',
            exhaleText: 'Breathe out',
            holdOutText: 'Hold',
          ),
        ),
      );

      // Not the shared `pump()` helper (it calls `pumpApp`, which ends in an
      // unbounded `pumpAndSettle()`): this payload's section-complete
      // celebration shows immediately on mount rather than after a later
      // action, and its confetti burst never quiesces on its own — same
      // "bounded pumps instead" gotcha the other celebration tests in this
      // file already document, just triggered a step earlier here.
      await tester.pumpWidget(
        ProviderScope(
          overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
          child: MaterialApp(home: CourseItemPlayerScreen(trackId: 'track-1', item: _item())),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // This file's `pump()`/this manual pumpWidget both skip the
      // translations fix other test files use — real text falls back to
      // its raw key here (see `_ArticleView`'s own test for the same
      // convention), except server-provided content like `gameIntro`,
      // which bypasses `ref.t()` entirely and renders literally.
      expect(find.byType(GamePlayer), findsNothing);
      expect(find.text('courses.breathing.title'), findsOneWidget);
      expect(find.text('Settle in before we begin.'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'courses.breathing.start'), findsOneWidget);
      // The section-complete celebration fired from gameCompletion alone —
      // the real signal that completion was reported without the learner
      // ever starting the exercise.
      expect(find.byType(CelebrationModal), findsOneWidget);
    },
  );

  testWidgets('tapping Start on the breathing intro pushes the full-screen breathing exercise', (
    tester,
  ) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'GAME',
        gameKey: 'BREATHING_EXERCISE',
        breathingExercise: BreathingExerciseContent(
          inhaleSeconds: 4,
          holdInSeconds: 1,
          exhaleSeconds: 4,
          holdOutSeconds: 1,
          cycles: 3,
          inhaleText: 'Breathe in',
          holdInText: 'Hold',
          exhaleText: 'Breathe out',
          holdOutText: 'Hold',
        ),
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/courses/item/item1',
      routes: [
        GoRoute(
          path: '/courses/item/item1',
          builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item()),
        ),
        GoRoute(
          path: '/breathing-exercise',
          builder: (context, state) => const Text('BREATHING SCREEN'),
        ),
      ],
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('Start'));
    await tester.pumpAndSettle();

    expect(find.text('BREATHING SCREEN'), findsOneWidget);
  });

  testWidgets(
    'a section-complete article shows the celebration modal with confetti',
    (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer(
        (_) async => StartItemPayload(
          trackItemProgressId: 'p1',
          type: 'ARTICLE',
          html: '<p>Hello world</p>',
          articleQuestions: const [],
        ),
      );
      when(() => repository.markArticleRead('item1')).thenAnswer(
        (_) async => TrackItemCompletionResult(
          completed: true,
          sectionCompleted: true,
          trackCompleted: false,
        ),
      );

      final router = await pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: [
          GoRoute(
            path: '/courses/item/item1',
            builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item()),
          ),
          GoRoute(
            path: '/home',
            builder: (context, state) => const Text('HOME'),
          ),
        ],
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      // Bounded pumps rather than `pumpAndSettle()`: the confetti burst's
      // particle-simulation ticker doesn't quiesce on its own within a test's
      // patience, the same class of issue as `AppButton`'s own spinner
      // elsewhere in this codebase.
      await tester.tap(find.text('Mark as read'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(CelebrationModal), findsOneWidget);
      expect(find.text('Section complete!'), findsOneWidget);
      expect(find.text('Course complete!'), findsNothing);

      // Dismissing a section-complete celebration stays on this screen.
      await tester.tap(find.text('Continue'));
      await tester.pump();

      expect(find.byType(CelebrationModal), findsNothing);
      expect(
        router.routerDelegate.currentConfiguration.uri.path,
        '/courses/item/item1',
      );
    },
  );

  testWidgets(
    'a track-complete article shows the bigger celebration and Back to Learn navigates home',
    (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer(
        (_) async => StartItemPayload(
          trackItemProgressId: 'p1',
          type: 'ARTICLE',
          html: '<p>Hello world</p>',
          articleQuestions: const [],
        ),
      );
      when(() => repository.markArticleRead('item1')).thenAnswer(
        (_) async => TrackItemCompletionResult(
          completed: true,
          sectionCompleted: true,
          trackCompleted: true,
        ),
      );

      await pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: [
          GoRoute(
            path: '/courses/item/item1',
            builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item()),
          ),
          GoRoute(
            path: '/home',
            builder: (context, state) => const Text('HOME'),
          ),
        ],
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

      await tester.tap(find.text('Mark as read'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Track-complete wins over section-complete (RN's own handleCompletion
      // ordering), and there's no track-wide item list in this scoped screen
      // to compute the stats pill from, so it's simply never shown.
      expect(find.text('Course complete!'), findsOneWidget);
      expect(find.text('Section complete!'), findsNothing);
      expect(
        find.textContaining('items completed'),
        findsNothing,
        reason: 'no completedCount supplied',
      );

      await tester.tap(find.text('Back to Learn'));
      await tester.pumpAndSettle();

      expect(find.text('HOME'), findsOneWidget);
    },
  );

  testWidgets(
    'no celebration appears when the article completes without finishing a section',
    (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer(
        (_) async => StartItemPayload(
          trackItemProgressId: 'p1',
          type: 'ARTICLE',
          html: '<p>Hello world</p>',
          articleQuestions: const [],
        ),
      );
      when(() => repository.markArticleRead('item1')).thenAnswer(
        (_) async => TrackItemCompletionResult(
          completed: true,
          sectionCompleted: false,
          trackCompleted: false,
        ),
      );

      await pump(tester);

      await tester.tap(find.text('courses.article.markRead'));
      await tester.pumpAndSettle();

      expect(find.byType(CelebrationModal), findsNothing);
    },
  );

  testWidgets('an unsupported payload type shows the not-available message', (
    tester,
  ) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async =>
          StartItemPayload(trackItemProgressId: 'p1', type: 'ROLEPLAY'),
    );

    await pump(tester);

    expect(find.text('courses.player.unsupportedTitle'), findsOneWidget);
  });
}
