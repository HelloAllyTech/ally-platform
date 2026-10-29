import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_fallback_card.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_interjection_dialog.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_item_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_player_widget.dart';

import 'fake_video_player_platform.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

SanitizedQuizQuestion _question() => SanitizedQuizQuestion(
  id: 'q1',
  type: QuizQuestionType.trueFalse,
  prompt: 'Is this true?',
  points: 1,
  graded: true,
  options: null,
  items: null,
  left: null,
  right: null,
  template: null,
  blankIds: null,
  minWords: null,
  statements: null,
  scale: null,
);

VideoInterjection _interjection({double at = 5}) => VideoInterjection(
  id: 'i1',
  timestampSeconds: at,
  question: _question(),
  answeredPassed: null,
);

void main() {
  late MockCoursesRepository repository;
  late FakeVideoPlayerPlatform fakePlatform;

  setUp(() {
    repository = MockCoursesRepository();
    fakePlatform = FakeVideoPlayerPlatform();
    VideoPlayerPlatform.instance = fakePlatform;
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        // A bare `MaterialApp(home: child)` gives the player's outer Column
        // unbounded height (no Scaffold to size it against the viewport),
        // which throws off the Expanded video area's layout and cascades
        // into a bogus overflow report for the *other*, unrelated bottom
        // row — matches the real app, which always hosts this inside
        // `CourseItemPlayerScreen`'s `Scaffold`.
        child: MaterialApp(home: Scaffold(body: child)),
      ),
    );
  }

  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
  }

  group('source-type branching', () {
    testWidgets(
      'non-s3 source renders VideoFallbackCard, not the native player',
      (tester) async {
        final payload = StartItemPayload(
          trackItemProgressId: 'p1',
          type: 'VIDEO',
          videoSource: 'youtube',
          videoUrl: 'https://youtube.com/watch?v=abc',
          durationSeconds: 60,
          interjections: const [],
        );

        await pump(
          tester,
          VideoItemPlayer(
            payload: payload,
            itemId: 'item1',
            alreadyCompleted: false,
            onCompleted: (_) {},
          ),
        );

        expect(find.byType(VideoFallbackCard), findsOneWidget);
        expect(find.byType(VideoPlayerWidget), findsNothing);
      },
    );

    testWidgets('s3 source with a url renders the native VideoPlayerWidget', (
      tester,
    ) async {
      final payload = StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        videoSource: 's3',
        videoUrl: 'https://cdn.example.com/v.mp4',
        durationSeconds: 60,
        interjections: const [],
      );

      await pump(
        tester,
        VideoItemPlayer(
          payload: payload,
          itemId: 'item1',
          alreadyCompleted: false,
          onCompleted: (_) {},
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.byType(VideoPlayerWidget), findsOneWidget);
      expect(find.byType(VideoFallbackCard), findsNothing);

      await unmount(tester);
    });
  });

  testWidgets(
    'marking a fallback video watched reports 100% and completes on server confirmation',
    (tester) async {
      when(
        () => repository.reportVideoProgress(itemId: 'item1', watchedPct: 100),
      ).thenAnswer(
        (_) async => (
          completed: true,
          maxWatchedPct: 100.0,
          sectionCompleted: false,
          trackCompleted: false,
        ),
      );

      final payload = StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        videoSource: 'vimeo',
        videoUrl: 'https://vimeo.com/123',
        durationSeconds: 60,
        interjections: const [],
      );

      var completedCalled = false;
      await pump(
        tester,
        VideoItemPlayer(
          payload: payload,
          itemId: 'item1',
          alreadyCompleted: false,
          onCompleted: (_) => completedCalled = true,
        ),
      );

      await tester.tap(find.text('courses.video.markWatched'));
      await tester.pumpAndSettle();

      verify(
        () => repository.reportVideoProgress(itemId: 'item1', watchedPct: 100),
      ).called(1);
      expect(completedCalled, isTrue);
      expect(find.text('courses.video.watched'), findsOneWidget);
    },
  );

  testWidgets(
    'reports watch progress to the repository as the s3 video plays',
    (tester) async {
      when(
        () => repository.reportVideoProgress(
          itemId: any(named: 'itemId'),
          watchedPct: any(named: 'watchedPct'),
        ),
      ).thenAnswer(
        (_) async => (
          completed: false,
          maxWatchedPct: 0.0,
          sectionCompleted: false,
          trackCompleted: false,
        ),
      );

      final payload = StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        videoSource: 's3',
        videoUrl: 'https://cdn.example.com/v.mp4',
        durationSeconds: 60,
        interjections: const [],
      );

      await pump(
        tester,
        VideoItemPlayer(
          payload: payload,
          itemId: 'item1',
          alreadyCompleted: false,
          onCompleted: (_) {},
        ),
      );
      await tester.pump();
      await tester.pump();

      // Drive the widget's 500ms poll timer forward long enough to cross the
      // tracker's own 10s-or-10%-jump report threshold
      // (`video_watch_progress.dart`'s `reportIntervalMs`/`reportPctDelta`).
      for (var i = 0; i < 22; i++) {
        await tester.pump(const Duration(milliseconds: 500));
      }

      verify(
        () => repository.reportVideoProgress(
          itemId: 'item1',
          watchedPct: any(named: 'watchedPct'),
        ),
      ).called(greaterThan(0));

      await unmount(tester);
    },
  );

  testWidgets(
    'crossing an interjection timestamp pauses the video and shows the dialog',
    (tester) async {
      when(
        () => repository.reportVideoProgress(
          itemId: any(named: 'itemId'),
          watchedPct: any(named: 'watchedPct'),
        ),
      ).thenAnswer(
        (_) async => (
          completed: false,
          maxWatchedPct: 0.0,
          sectionCompleted: false,
          trackCompleted: false,
        ),
      );

      final payload = StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        videoSource: 's3',
        videoUrl: 'https://cdn.example.com/v.mp4',
        durationSeconds: 60,
        // Fake platform advances position by 500ms per poll starting at 0, so
        // this is crossed within the first couple of polls.
        interjections: [_interjection(at: 0.4)],
      );

      await pump(
        tester,
        VideoItemPlayer(
          payload: payload,
          itemId: 'item1',
          alreadyCompleted: false,
          onCompleted: (_) {},
        ),
      );
      await tester.pump();
      await tester.pump();

      fakePlatform.calls.clear();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump();

      expect(find.byType(VideoInterjectionDialog), findsOneWidget);
      expect(fakePlatform.calls, contains('pause'));

      await unmount(tester);
    },
  );
}
