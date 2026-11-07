import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_api.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/review_card.dart';

import '../../../support/fake_simulation_audio_playback_controller.dart';
import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

ReviewItem _simulationReview({
  String note = 'Great session overall.',
  String description = 'A tough case.',
  int commentsCount = 2,
  ReviewScenarioSession? scenarioSession,
}) => ReviewItem(
  id: 'rev-1',
  createdAt: DateTime.now().toUtc().subtract(const Duration(days: 2)).toIso8601String(),
  note: note,
  createdBy: ReviewAuthor(id: 1, name: 'Dr. Patel', profileImage: ''),
  commentsCount: commentsCount,
  summaryName: null,
  scenario: ReviewScenario(title: 'Help Sandeep balance work and life', description: description),
  scenarioSession: scenarioSession ?? ReviewScenarioSession(duration: '277', createdAt: '2026-06-02T21:10:00'),
  reactions: {'1f44d': 2, '2764-fe0f': 1},
);

ReviewItem _scribeReview() => ReviewItem(
  id: 'rev-2',
  createdAt: DateTime.now().toUtc().subtract(const Duration(days: 2)).toIso8601String(),
  note: 'Please review this call.',
  createdBy: ReviewAuthor(id: 2, name: 'Shubham Bhoite', profileImage: ''),
  commentsCount: 0,
  summaryName: null,
  scribeSession: ReviewScribeSession(
    summaryName: 'CALL-1408-2026-06-23',
    duration: '242',
    createdAt: '2026-06-23T13:37:00',
  ),
);

void main() {
  Future<void> pump(WidgetTester tester, ReviewItem review, ReviewType reviewType, {VoidCallback? onOpen}) {
    return pumpApp(
      tester,
      Scaffold(
        body: SingleChildScrollView(child: ReviewCard(
          review: review,
          reviewType: reviewType,
          onOpenReview: onOpen ?? () {},
        )),
      ),
      overrides: [fixedTranslationsOverride()],
    );
  }

  testWidgets('a simulation review shows author, relative time, full note, scenario details and duration', (
    tester,
  ) async {
    await pump(tester, _simulationReview(), ReviewType.simulation);

    expect(find.text('Dr. Patel'), findsOneWidget);
    expect(find.text('2 Days'), findsOneWidget);
    expect(find.text('Great session overall.'), findsOneWidget);
    expect(find.text('Help Sandeep balance work and life'), findsOneWidget);
    expect(find.text('A tough case.'), findsOneWidget);
    expect(find.textContaining('4:37 min'), findsOneWidget);
    expect(find.text('Simulation'), findsOneWidget);
    expect(find.text('Review Conversation'), findsOneWidget);
  });

  testWidgets('a scribe review shows the call summary name instead of a scenario', (tester) async {
    await pump(tester, _scribeReview(), ReviewType.scribe);

    expect(find.text('Shubham Bhoite'), findsOneWidget);
    expect(find.text('CALL-1408-2026-06-23'), findsOneWidget);
    expect(find.text('Scribe'), findsOneWidget);
    expect(find.textContaining('4:02 min'), findsOneWidget);
  });

  testWidgets('tapping Review Conversation fires onOpenReview', (tester) async {
    var opened = false;
    await pump(tester, _simulationReview(), ReviewType.simulation, onOpen: () => opened = true);

    await tester.ensureVisible(find.text('Review Conversation'));
    await tester.tap(find.text('Review Conversation'));
    await tester.pump();

    expect(opened, isTrue);
  });

  testWidgets('tapping the author name does nothing — only Review Conversation/comments open the review', (
    tester,
  ) async {
    var opened = false;
    await pump(tester, _simulationReview(), ReviewType.simulation, onOpen: () => opened = true);

    await tester.tap(find.text('Dr. Patel'));
    await tester.pump();

    expect(opened, isFalse);
  });

  testWidgets('no audio player when the simulation review has no audioUrl', (tester) async {
    await pump(
      tester,
      _simulationReview(scenarioSession: ReviewScenarioSession(duration: '277')),
      ReviewType.simulation,
    );

    expect(find.byKey(const ValueKey('simulation-audio-player-toggle')), findsNothing);
  });

  testWidgets('the audio player shows when a simulation review has an audioUrl', (tester) async {
    await pumpApp(
      tester,
      Scaffold(
        body: SingleChildScrollView(child: ReviewCard(
          review: _simulationReview(
            scenarioSession: ReviewScenarioSession(
              duration: '277',
              audioUrl: 'https://cdn.example.com/a.ogg',
            ),
          ),
          reviewType: ReviewType.simulation,
          onOpenReview: () {},
          audioPlayerController: FakeSimulationAudioPlaybackController(),
        )),
      ),
      overrides: [fixedTranslationsOverride()],
    );

    expect(find.byKey(const ValueKey('simulation-audio-player-toggle')), findsOneWidget);
  });

  testWidgets('a short description shows no "View more" toggle (RN only shows it once text overflows)', (
    tester,
  ) async {
    await pump(tester, _simulationReview(), ReviewType.simulation);
    expect(find.text('A tough case.'), findsOneWidget);
    expect(find.text('View more'), findsNothing);
  });

  testWidgets('tapping "View more" expands the description, and toggles back on "View less"', (
    tester,
  ) async {
    await pump(tester, _simulationReview(description: 'A long scenario description. ' * 20), ReviewType.simulation);

    expect(find.text('View more'), findsOneWidget);
    expect(find.text('View less'), findsNothing);

    await tester.ensureVisible(find.text('View more'));
    await tester.tap(find.text('View more'));
    await tester.pump();

    expect(find.text('View less'), findsOneWidget);
    expect(find.text('View more'), findsNothing);

    await tester.ensureVisible(find.text('View less'));
    await tester.tap(find.text('View less'));
    await tester.pump();

    expect(find.text('View more'), findsOneWidget);
  });

  testWidgets('a simulation review with a scenario cover image renders it', (tester) async {
    await pump(
      tester,
      ReviewItem(
        id: 'rev-4',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        note: 'n',
        createdBy: ReviewAuthor(id: 4, name: 'A', profileImage: ''),
        commentsCount: 0,
        summaryName: null,
        scenario: ReviewScenario(title: 'T', coverImageUrl: 'https://cdn.example.com/cover.jpg'),
      ),
      ReviewType.simulation,
    );
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('a scribe review renders the scribe illustration, not a network Image', (tester) async {
    await pump(tester, _scribeReview(), ReviewType.scribe);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('the simulation Date & time / Duration rows render plain, outside the bordered details card', (
    tester,
  ) async {
    await pump(tester, _simulationReview(), ReviewType.simulation);
    expect(find.textContaining('Date & time'), findsOneWidget);
    expect(find.textContaining('Duration'), findsOneWidget);
  });

  testWidgets(
    'the scribe Date & time / Duration rows render inside the details card instead of a description',
    (tester) async {
      await pump(tester, _scribeReview(), ReviewType.scribe);
      expect(find.textContaining('Date & time'), findsOneWidget);
      expect(find.textContaining('Duration'), findsOneWidget);
      // The scribe card has no scenario, so no "View more" toggle — the
      // date/duration rows take that slot instead, without truncation.
      expect(find.text('View more'), findsNothing);
    },
  );

  testWidgets('reactions and comment counts use singular/plural wording correctly', (tester) async {
    await pump(
      tester,
      ReviewItem(
        id: 'rev-3',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        note: 'n',
        createdBy: ReviewAuthor(id: 3, name: 'A', profileImage: ''),
        commentsCount: 1,
        summaryName: null,
        scenario: ReviewScenario(title: 'T'),
        reactions: {'1f44d': 1},
      ),
      ReviewType.simulation,
    );

    expect(find.text('1 reaction'), findsOneWidget);
    expect(find.text('1 Comment'), findsOneWidget);
  });

  testWidgets('without view permission (no onOpenReview) the Review Conversation link is hidden', (tester) async {
    await pumpApp(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          child: ReviewCard(review: _simulationReview(), reviewType: ReviewType.simulation, onOpenReview: null),
        ),
      ),
      overrides: [fixedTranslationsOverride()],
    );
    expect(find.text('Review Conversation'), findsNothing);
  });

  group('inline expanded comments (RN ExpandedComments)', () {
    late _MockReviewApi api;

    ThreadComment comment(String id, String content) => ThreadComment(
      id: id,
      content: content,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      authorName: 'Reviewer $id',
      reactions: const {},
      myReaction: null,
      replyCount: 0,
    );

    Future<void> pumpWithApi(WidgetTester tester, ReviewItem review, {VoidCallback? onOpen}) => pumpApp(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          child: ReviewCard(review: review, reviewType: ReviewType.simulation, onOpenReview: onOpen ?? () {}),
        ),
      ),
      overrides: [
        fixedTranslationsOverride(),
        reviewApiProvider(ReviewType.simulation).overrideWithValue(api),
      ],
    );

    setUp(() => api = _MockReviewApi());

    testWidgets('tapping the comment count loads the overview once and expands; Collapse hides it', (tester) async {
      when(() => api.getCommentsOverview('rev-1')).thenAnswer(
        (_) async => (comments: [comment('c1', 'First thought'), comment('c2', 'Second thought')], count: 5),
      );
      var opened = 0;
      await pumpWithApi(tester, _simulationReview(commentsCount: 5), onOpen: () => opened++);

      await tester.ensureVisible(find.byKey(const Key('review-card-comments')));
      await tester.tap(find.byKey(const Key('review-card-comments')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('expanded-comments')), findsOneWidget);
      expect(find.text('First thought'), findsOneWidget);
      expect(find.text('Second thought'), findsOneWidget);
      expect(find.text('Show more'), findsOneWidget, reason: 'count 5 > 2');

      await tester.ensureVisible(find.text('Show more'));
      await tester.tap(find.text('Show more'));
      expect(opened, 1);

      await tester.ensureVisible(find.text('Collapse'));
      await tester.tap(find.text('Collapse'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('expanded-comments')), findsNothing);

      // Re-expanding reuses the loaded page (RN checks generalCommentsData).
      await tester.ensureVisible(find.byKey(const Key('review-card-comments')));
      await tester.tap(find.byKey(const Key('review-card-comments')));
      await tester.pumpAndSettle();
      expect(find.text('First thought'), findsOneWidget);
      verify(() => api.getCommentsOverview('rev-1')).called(1);
    });

    testWidgets('a review with no comments does not expand or fetch', (tester) async {
      await pumpWithApi(tester, _simulationReview(commentsCount: 0));

      await tester.ensureVisible(find.byKey(const Key('review-card-comments')));
      await tester.tap(find.byKey(const Key('review-card-comments')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('expanded-comments')), findsNothing);
      verifyNever(() => api.getCommentsOverview(any()));
    });
  });
}

class _MockReviewApi extends Mock implements ReviewApi {}
