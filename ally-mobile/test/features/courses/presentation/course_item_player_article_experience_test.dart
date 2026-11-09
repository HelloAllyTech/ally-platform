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

TrackDetailItem _item(String id) => TrackDetailItem(
  id: id,
  type: TrackItemType.article,
  order: id == 'item1' ? 0 : 1,
  title: id == 'item1' ? 'Being with someone in pain' : 'Second item',
  description: null,
  status: TrackItemStatus.unlocked,
  score: null,
  maxWatchedPct: null,
);

TrackDetail _track() => TrackDetail(
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
    TrackSection(id: 'section-a', title: 'Listening skills', order: 0, items: [_item('item1'), _item('item2')]),
  ],
);

ArticleQuestion _question() => ArticleQuestion.fromJson({
  'id': 'aq1',
  'prompt': 'What helps?',
  'options': [
    {'id': 'o1', 'text': 'Listening'},
    {'id': 'o2', 'text': 'Advising'},
  ],
});

const _cover = ArticleCover(url: 'https://cdn.test/cover.jpg', alt: 'Two people talking');

StartItemPayload _article(
  ArticleExperience experience, {
  ArticleCover? cover = _cover,
  List<ArticleQuestion>? questions,
  List<String> takeaways = const ['Listen first'],
}) => StartItemPayload(
  trackItemProgressId: 'p1',
  type: 'ARTICLE',
  html:
      '<h2>Part one</h2><p>Hello there.</p><div data-ally-callout="say"><p>I hear you.</p></div>'
      '<div data-ally-question="aq1"></div><blockquote><p>Quiet helps.</p></blockquote><p>After.</p>',
  articleQuestions: questions ?? [_question()],
  articleResources: const [],
  articleExperience: experience,
  articleCover: cover,
  articleTakeaways: takeaways,
);

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    when(() => repository.getLearnTrackDetail('track-1')).thenAnswer((_) async => _track());
    when(() => repository.startTrackItem('item2')).thenAnswer(
      (_) async => StartItemPayload(trackItemProgressId: 'p2', type: 'ARTICLE', html: '<p>Second</p>'),
    );
  });

  Future<void> pump(WidgetTester tester) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/courses/item/item1',
      routes: [
        GoRoute(
          path: '/courses/item/item1',
          builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item('item1')),
        ),
        GoRoute(path: '/courses/track-1', builder: (context, state) => const Text('OVERVIEW')),
      ],
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  void stubAnswer() {
    when(
      () => repository.submitArticleQuestionAnswer(itemId: 'item1', questionId: 'aq1', selectedOptionId: 'o1'),
    ).thenAnswer(
      (_) async => ArticleQuestionAnswerResult.fromJson({
        'correct': true,
        'selectedOptionId': 'o1',
        'correctOptionId': 'o1',
      }),
    );
  }

  Future<void> answer(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('article-question-option-o1')));
    await tester.pump();
    final submit = find.byKey(const Key('article-question-submit-aq1'));
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
  }

  String counter(WidgetTester tester) =>
      tester.widget<Text>(find.byKey(const Key('article-cards-counter'))).data!;

  group('classic', () {
    testWidgets('cover above the text, callouts, takeaways; the usual chrome', (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article(ArticleExperience.classic));
      await pump(tester);

      expect(find.byKey(const Key('article-cover')), findsOneWidget);
      expect(find.text('TRY SAYING'), findsOneWidget);
      expect(find.text('Key takeaways'), findsOneWidget);
      expect(find.byKey(const Key('article-magazine-title')), findsNothing);
      expect(find.byKey(const ValueKey('player-top-bar-overlay')), findsNothing);
      expect(find.byKey(const Key('player-next-button')), findsOneWidget);
    });
  });

  group('magazine', () {
    testWidgets('cover photo under the overlay top bar, headline block, bottom nav kept', (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article(ArticleExperience.magazine));
      await pump(tester);

      expect(find.byKey(const Key('article-magazine-photo')), findsOneWidget);
      expect(find.byKey(const ValueKey('player-top-bar-overlay')), findsOneWidget);
      expect(find.byKey(const Key('player-exit-button')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('article-magazine-kicker'))).data, 'LISTENING SKILLS');
      expect(
        tester.widget<Text>(find.byKey(const Key('article-magazine-title'))).data,
        'Being with someone in pain',
      );
      expect(tester.widget<Text>(find.byKey(const Key('article-magazine-meta'))).data, '1 min read · 1 quick check');
      expect(find.text('TRY SAYING'), findsOneWidget);
      expect(find.text('Key takeaways'), findsOneWidget);
      // The photo's own top bar replaces the article's scroll-progress track.
      expect(find.byKey(const Key('article-progress-track')), findsNothing);
      expect(find.byKey(const Key('player-next-button')), findsOneWidget);
      expect(find.byKey(const Key('player-prev-button')), findsOneWidget);
      expect(find.byKey(const Key('article-mark-read')), findsOneWidget);
    });

    testWidgets('no cover: normal top bar, headline still shown, no quick checks without questions', (
      tester,
    ) async {
      when(
        () => repository.startTrackItem('item1'),
      ).thenAnswer((_) async => _article(ArticleExperience.magazine, cover: null, questions: const []));
      await pump(tester);

      expect(find.byKey(const Key('article-magazine-photo')), findsNothing);
      expect(find.byKey(const ValueKey('player-top-bar-overlay')), findsNothing);
      expect(find.byKey(const Key('player-exit-button')), findsOneWidget);
      expect(find.byKey(const Key('article-magazine-title')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('article-magazine-meta'))).data, '1 min read');
      expect(find.byKey(const Key('article-progress-track')), findsOneWidget);
    });
  });

  group('cards', () {
    testWidgets('replaces the top bar and bottom nav with its own header; close exits', (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article(ArticleExperience.cards));
      await pump(tester);

      expect(find.byKey(const Key('article-cards')), findsOneWidget);
      expect(find.byKey(const Key('player-next-button')), findsNothing);
      expect(find.byKey(const Key('player-prev-button')), findsNothing);
      expect(find.byKey(const Key('player-exit-button')), findsNothing);
      // Cover, "Part one", question, the rest of "Part one", takeaways.
      expect(counter(tester), '1 / 5');
      expect(find.byKey(const Key('article-cards-back')), findsNothing);
      expect(find.widgetWithText(CourseButton, 'Start reading'), findsOneWidget);
      expect(find.byKey(const Key('article-card-photo')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('article-cards-meta'))).data, '1 min read · 1 quick check');

      await tester.tap(find.byKey(const Key('article-cards-close')));
      await tester.pumpAndSettle();
      expect(find.text('OVERVIEW'), findsOneWidget);
    });

    testWidgets('Next / back / swipe, gated on the question; mark as read on the final card, then Next', (
      tester,
    ) async {
      when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article(ArticleExperience.cards));
      when(() => repository.markArticleRead('item1')).thenAnswer(
        (_) async => TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
      );
      stubAnswer();
      await pump(tester);

      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '2 / 5');
      expect(find.text('Part one'), findsWidgets);
      expect(find.text('TRY SAYING'), findsOneWidget);

      // Back, then forward again by swiping.
      await tester.tap(find.byKey(const Key('article-cards-back')));
      await tester.pumpAndSettle();
      expect(counter(tester), '1 / 5');
      await tester.fling(find.byKey(const Key('article-cards-pager')), const Offset(-400, 0), 1000);
      await tester.pumpAndSettle();
      expect(counter(tester), '2 / 5');

      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '3 / 5');
      expect(find.text('QUICK CHECK'), findsOneWidget);

      // Unanswered: Next is disabled and a swipe can't get past it.
      expect(tester.widget<CourseButton>(find.byKey(const Key('article-cards-next'))).isDisabled, isTrue);
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      await tester.fling(find.byKey(const Key('article-cards-pager')), const Offset(-400, 0), 1000);
      await tester.pumpAndSettle();
      expect(counter(tester), '3 / 5');

      await answer(tester);
      expect(tester.widget<CourseButton>(find.byKey(const Key('article-cards-next'))).isDisabled, isFalse);
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '4 / 5');
      expect(find.byKey(const Key('article-mark-read')), findsNothing);

      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '5 / 5');
      expect(find.text('KEY TAKEAWAYS'), findsOneWidget);
      expect(find.text('Listen first'), findsOneWidget);

      // Reaching the final card is reaching the end.
      final markRead = find.byKey(const Key('article-mark-read'));
      expect(tester.widget<CourseButton>(markRead).label, 'Mark as read');
      expect(tester.widget<CourseButton>(markRead).isDisabled, isFalse);
      await tester.tap(markRead);
      await tester.pumpAndSettle();
      verify(() => repository.markArticleRead('item1')).called(1);
      expect(find.byKey(const Key('article-read-chip')), findsOneWidget);

      // Cards has no bottom nav, so the final card carries Next.
      await tester.tap(find.byKey(const Key('article-cards-continue')));
      await tester.pumpAndSettle();
      verify(() => repository.startTrackItem('item2')).called(1);
      expect(find.byKey(const Key('player-next-button')), findsOneWidget);
    });

    testWidgets('an answered question stays answered after swiping away and back', (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer((_) async => _article(ArticleExperience.cards));
      stubAnswer();
      await pump(tester);

      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      await answer(tester);
      expect(find.text('Correct'), findsOneWidget);

      await tester.tap(find.byKey(const Key('article-cards-back')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('article-cards-back')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '3 / 5');
      expect(find.text('Correct'), findsOneWidget);
      expect(find.byKey(const Key('article-question-submit-aq1')), findsNothing);
    });

    testWidgets('with no takeaways or resources the last content card is final', (tester) async {
      when(() => repository.startTrackItem('item1')).thenAnswer(
        (_) async => _article(ArticleExperience.cards, questions: const [], takeaways: const []),
      );
      when(() => repository.markArticleRead('item1')).thenAnswer(
        (_) async => TrackItemCompletionResult(completed: true, sectionCompleted: false, trackCompleted: false),
      );
      await pump(tester);

      // Cover, then the one "Part one" card (no question: its placeholder is dropped).
      expect(counter(tester), '1 / 2');
      expect(find.byKey(const Key('article-mark-read')), findsNothing);
      await tester.tap(find.byKey(const Key('article-cards-next')));
      await tester.pumpAndSettle();
      expect(counter(tester), '2 / 2');
      expect(find.byKey(const Key('article-mark-read')), findsOneWidget);
      expect(tester.widget<CourseButton>(find.byKey(const Key('article-mark-read'))).isDisabled, isFalse);
    });
  });
}
