import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/html_rich_text.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/game/game_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/journal/journal_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_item_player.dart';

import '../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackDetailItem _item({TrackItemType type = TrackItemType.article}) => TrackDetailItem(
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
      CourseItemPlayerScreen(item: _item()),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  testWidgets('shows a loading indicator while startTrackItem is in flight', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) => Completer<StartItemPayload>().future,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(home: CourseItemPlayerScreen(item: _item())),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows an error message when startTrackItem fails', (tester) async {
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
        quiz: SanitizedQuiz(passScore: 70, maxAttempts: 3, questions: const [], totalPoints: 0),
        attemptsUsed: 0,
        maxAttempts: 3,
      ),
    );

    await pump(tester);

    expect(find.byType(QuizPlayer), findsOneWidget);
  });

  testWidgets('ARTICLE payload renders the article view (HtmlRichText)', (tester) async {
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

  testWidgets('an unsupported payload type shows the not-available message', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(trackItemProgressId: 'p1', type: 'ROLEPLAY'),
    );

    await pump(tester);

    expect(find.text('courses.player.unsupportedTitle'), findsOneWidget);
  });
}
