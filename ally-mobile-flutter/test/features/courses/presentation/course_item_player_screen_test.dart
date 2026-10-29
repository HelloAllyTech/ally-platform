import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/html_rich_text.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/article/article_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/celebration_modal.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_button.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/game/game_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/journal/journal_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_player.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_item_player.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_router_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

TrackDetailItem _item({
  String id = 'item1',
  TrackItemStatus status = TrackItemStatus.unlocked,
  String? description,
}) => TrackDetailItem(
  id: id,
  type: TrackItemType.article,
  order: id == 'item1' ? 0 : 1,
  title: id == 'item1' ? 'Item title' : 'Second item',
  description: description,
  status: status,
  score: null,
  maxWatchedPct: null,
);

TrackDetail _track({TrackItemStatus status = TrackItemStatus.unlocked, String? description}) => TrackDetail(
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'IN_PROGRESS',
  totalItems: 2,
  completedItems: 0,
  enrolled: true,
  trackEnrollmentId: 'enr-1',
  sections: [
    TrackSection(
      id: 'section-a',
      title: 'Section A',
      order: 0,
      items: [
        _item(status: status, description: description),
        _item(id: 'item2'),
      ],
    ),
  ],
);

StartItemPayload _article({List<ArticleQuestion> questions = const [], List<ArticleResource>? resources}) =>
    StartItemPayload(
      trackItemProgressId: 'p1',
      type: 'ARTICLE',
      html: '<p>Hello world</p><div data-ally-question="aq1"></div><p>After</p>',
      articleQuestions: questions,
      articleResources: resources,
    );

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    when(() => repository.getLearnTrackDetail('track-1')).thenAnswer((_) async => _track());
  });

  Future<GoRouter> pump(WidgetTester tester, {TrackItemStatus status = TrackItemStatus.unlocked}) =>
      pumpRouterApp(
        tester,
        initialLocation: '/courses/item/item1',
        routes: [
          GoRoute(
            path: '/courses/item/item1',
            builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item(status: status)),
          ),
          GoRoute(path: '/home', builder: (context, state) => const Text('HOME')),
          GoRoute(path: '/courses/track-1', builder: (context, state) => const Text('OVERVIEW')),
          GoRoute(path: '/breathing-exercise', builder: (context, state) => const Text('BREATHING SCREEN')),
        ],
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
      );

  Future<void> markRead(WidgetTester tester) async {
    await tester.pump(articleNoScrollReadyDelay);
    await tester.pump();
    await tester.tap(find.text('Mark as read'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('RN chrome: top bar titles, description, overall %, rail and bottom nav', (tester) async {
    when(() => repository.getLearnTrackDetail('track-1'))
        .thenAnswer((_) async => _track(description: '<p>About <b>this</b></p>'));
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article());
    await pump(tester);

    expect(find.text('Section A'), findsOneWidget);
    expect(find.text('Item title'), findsOneWidget);
    expect(find.text('About this'), findsOneWidget);
    expect(find.text('0% complete'), findsOneWidget);
    expect(find.byKey(const ValueKey('progress-segment-item1')), findsOneWidget);
    expect(find.byKey(const ValueKey('progress-segment-item2')), findsOneWidget);
    expect(find.byKey(const Key('player-exit-button')), findsOneWidget);
    expect(find.widgetWithText(CourseButton, 'Prev'), findsOneWidget);
    expect(find.widgetWithText(CourseButton, 'Next'), findsOneWidget);
  });

  testWidgets('shows a spinner while startTrackItem is in flight', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer((_) => Completer<StartItemPayload>().future);
    // Not pumpRouterApp: its pumpAndSettle never settles on a spinner.
    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride(), coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(home: CourseItemPlayerScreen(trackId: 'track-1', item: _item())),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('player-loading')), findsOneWidget);
  });

  testWidgets('an item load failure shows RN loadFailed + Retry, which reloads', (tester) async {
    var calls = 0;
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async {
      calls++;
      if (calls == 1) throw Exception('boom');
      return _article();
    });
    await pump(tester);
    expect(find.text("Couldn't load this item."), findsOneWidget);
    expect(find.textContaining('boom'), findsNothing);
    await tester.tap(find.byKey(const Key('player-item-retry')));
    await tester.pumpAndSettle();
    expect(find.byType(ArticlePlayer), findsOneWidget);
  });

  testWidgets('a track load failure shows trackLoadFailed + Retry', (tester) async {
    when(() => repository.getLearnTrackDetail('track-1')).thenThrow(Exception('down'));
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article());
    await pump(tester);
    expect(find.text("Couldn't load this course."), findsOneWidget);
    expect(find.byKey(const Key('player-track-retry')), findsOneWidget);
  });

  testWidgets('payload types dispatch to their players', (tester) async {
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

  testWidgets('VIDEO and JOURNAL reopen as completed when the server says so (RN alreadyCompleted)', (
    tester,
  ) async {
    when(() => repository.getLearnTrackDetail('track-1'))
        .thenAnswer((_) async => _track(status: TrackItemStatus.completed));
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'VIDEO',
        videoSource: 'youtube',
        videoUrl: 'https://youtube.com/watch?v=abc',
        durationSeconds: 60,
        interjections: const [],
      ),
    );
    await pump(tester, status: TrackItemStatus.completed);
    expect(tester.widget<VideoItemPlayer>(find.byType(VideoItemPlayer)).alreadyCompleted, isTrue);
    expect(find.text('Watched'), findsOneWidget);
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

  testWidgets('a completed article shows Read and no Mark as read', (tester) async {
    when(() => repository.getLearnTrackDetail('track-1'))
        .thenAnswer((_) async => _track(status: TrackItemStatus.completed));
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article());
    await pump(tester, status: TrackItemStatus.completed);
    expect(find.byKey(const Key('article-read-chip')), findsOneWidget);
    expect(find.text('Mark as read'), findsNothing);
  });

  testWidgets('GAME payload with an unknown key renders GamePlayer\'s unsupported state', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(trackItemProgressId: 'p1', type: 'GAME', gameKey: 'NOT_A_REAL_GAME'),
    );
    await pump(tester);
    expect(find.byType(GamePlayer), findsOneWidget);
    expect(find.byKey(const Key('game-unsupported')), findsOneWidget);
    expect(find.text('Not available in the app yet'), findsOneWidget);
  });

  testWidgets('the breathing intro completes on mount and Start opens the exercise', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(
        trackItemProgressId: 'p1',
        type: 'GAME',
        gameKey: 'BREATHING_EXERCISE',
        gameIntro: 'Settle in before we begin.',
        gameCompletion: TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
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
    await pump(tester);
    expect(find.byType(GamePlayer), findsNothing);
    expect(find.text('Settle in before we begin.'), findsOneWidget);
    expect(tester.widget<CourseButton>(find.byKey(const Key('player-next-button'))).isDisabled, isFalse);
    await tester.tap(find.text('Start'));
    await tester.pumpAndSettle();
    expect(find.text('BREATHING SCREEN'), findsOneWidget);
  });

  testWidgets('a breathing exercise with no config shows the unsupported card', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => StartItemPayload(trackItemProgressId: 'p1', type: 'GAME', gameKey: 'BREATHING_EXERCISE'),
    );
    await pump(tester);
    expect(find.byKey(const Key('unsupported-item-card')), findsOneWidget);
  });

  testWidgets('an unsupported type shows RN UnsupportedItemCard and Back to course exits', (tester) async {
    when(() => repository.startTrackItem('item1'))
        .thenAnswer((_) async => StartItemPayload(trackItemProgressId: 'p1', type: 'SOMETHING_NEW'));
    await pump(tester);
    expect(find.text('Not available in the app yet'), findsOneWidget);
    expect(find.textContaining('needs the web version'), findsOneWidget);
    await tester.tap(find.text('Back to course'));
    await tester.pumpAndSettle();
    expect(find.text('OVERVIEW'), findsOneWidget);
  });

  testWidgets('section complete: celebration Continue advances to the next item', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article());
    when(() => repository.startTrackItem('item2')).thenAnswer((_) async => _article());
    when(() => repository.markArticleRead('item1')).thenAnswer(
      (_) async => TrackItemCompletionResult(completed: true, sectionCompleted: true, trackCompleted: false),
    );
    await pump(tester);
    await markRead(tester);
    expect(find.byType(CelebrationModal), findsOneWidget);
    expect(find.text('Section complete!'), findsOneWidget);
    await tester.tap(find.byKey(const Key('celebration-cta')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(CelebrationModal), findsNothing);
    verify(() => repository.startTrackItem('item2')).called(1);
  });

  testWidgets('track complete: stats pill shows the completed count and Back to Learn goes home', (tester) async {
    when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article());
    when(() => repository.markArticleRead('item1')).thenAnswer(
      (_) async => TrackItemCompletionResult(completed: true, sectionCompleted: true, trackCompleted: true),
    );
    await pump(tester);
    await markRead(tester);
    expect(find.text('Course complete!'), findsOneWidget);
    expect(find.byKey(const Key('celebration-stats')), findsOneWidget);
    expect(find.textContaining('1 item'), findsOneWidget);
    await tester.tap(find.text('Back to Learn'));
    await tester.pumpAndSettle();
    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('article: inline question interleaved, Submit after selecting, verdict and explanation', (
    tester,
  ) async {
    final question = ArticleQuestion.fromJson({
      'id': 'aq1',
      'prompt': 'What helps?',
      'options': [
        {'id': 'o1', 'text': 'Listening'},
        {'id': 'o2', 'text': 'Advising'},
      ],
      'answered': null,
      'correctOptionId': null,
      'explanation': null,
    });
    when(() => repository.startTrackItem('item1')).thenAnswer(
      (_) async => _article(
        questions: [question],
        resources: [ArticleResource(id: 'r1', title: 'Further reading', url: 'https://example.com/a')],
      ),
    );
    when(
      () => repository.submitArticleQuestionAnswer(itemId: 'item1', questionId: 'aq1', selectedOptionId: 'o2'),
    ).thenAnswer(
      (_) async => ArticleQuestionAnswerResult.fromJson({
        'correct': false,
        'selectedOptionId': 'o2',
        'correctOptionId': 'o1',
        'explanation': 'Listening comes first.',
        'completion': {'completed': true, 'sectionCompleted': false, 'trackCompleted': false},
      }),
    );
    await pump(tester);

    expect(find.byType(HtmlRichText), findsNWidgets(2), reason: 'body split around the question');
    expect(find.text('Further reading'), findsOneWidget);
    // The footer asks for the question to be answered first.
    expect(find.text('Answer the question to continue'), findsOneWidget);
    final submit = find.byKey(const Key('article-question-submit-aq1'));
    expect(tester.widget<CourseButton>(submit).isDisabled, isTrue);
    await tester.tap(find.byKey(const Key('article-question-option-o2')));
    await tester.pump();
    expect(tester.widget<CourseButton>(submit).isDisabled, isFalse);
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(find.textContaining('Incorrect — '), findsOneWidget);
    expect(find.text('Listening comes first.'), findsOneWidget);
    // The last answer completed the article: Read chip, Next unlocked.
    expect(find.byKey(const Key('article-read-chip')), findsOneWidget);
    expect(tester.widget<CourseButton>(find.byKey(const Key('player-next-button'))).isDisabled, isFalse);
  });

  test('splitArticleHtml mirrors RN: drops unknown and repeated placeholders', () {
    final q = ArticleQuestion.fromJson({'id': 'a', 'prompt': 'p', 'options': []});
    final segments = splitArticleHtml(
      '<p>One</p><div data-ally-question="a"></div><div data-ally-question=\'zzz\'></div>'
      '<p>Two</p><div class="x" data-ally-question="a"></div>',
      [q],
    );
    expect(segments.length, 3);
    expect(segments[1], isA<ArticleQuestionSegment>());
    expect(isArticleDocumentUrl('https://x.com/file.PDF?x=1'), isTrue);
    expect(isArticleDocumentUrl('https://x.com/page'), isFalse);
  });
}
