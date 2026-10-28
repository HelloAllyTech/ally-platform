import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';
import 'package:ally_mobile_flutter/features/reviews/data/review_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';

import 'feedback_test_harness.dart';

const _note = '''Hi there, good effort today.

## [what_worked]
You **named the feeling** early [[msg:42]].

## [try_next]
Slow down before advising.

## [closing]
Reply and we'll talk it through.''';

void main() {
  setUpAll(registerFeedbackFallbacks);

  late FeedbackHarness h;
  setUp(() => h = FeedbackHarness());

  Future<void> closePopup(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('feedback-popup-backdrop')), warnIfMissed: false);
    await tester.pumpAndSettle();
  }

  group('header', () {
    testWidgets('a fresh session reads "Simulation End" with a Share switch and rating stars', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, rating: 3));
      await h.pump(tester);

      final title = tester.widget<Text>(find.byKey(const Key('simulation-feedback-title')));
      expect(title.textSpan!.toPlainText(), 'Simulation End');
      expect(find.text('Share'), findsOneWidget);
      expect(find.byKey(const Key('simulation-feedback-share-switch')), findsOneWidget);
      expect(find.byKey(const Key('session-rating-star-5')), findsOneWidget);
    });

    testWidgets('from Logs it reads "Simulation Summary"', (tester) async {
      h.stubSummary(summaryJson(note: _note));
      await h.pump(tester, fromLogs: true);

      final title = tester.widget<Text>(find.byKey(const Key('simulation-feedback-title')));
      expect(title.textSpan!.toPlainText(), 'Simulation Summary');
    });

    testWidgets('without the scenario-messages permission: no title and no tabs', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester, permissions: const []);

      expect(find.byKey(const Key('simulation-feedback-title')), findsNothing);
      expect(find.text('Debrief'), findsNothing);
    });
  });

  group('tabs', () {
    testWidgets('Debrief and Transcript by default, opening on Debrief', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      expect(find.text('Debrief'), findsOneWidget);
      expect(find.text('Transcript'), findsOneWidget);
      expect(find.byKey(const Key('supervisor-note')), findsOneWidget);
    });

    testWidgets('a short session only gets Session Review with the ended-too-soon notice', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, callDuration: 20));
      await h.pump(tester);

      expect(find.text('Session Review'), findsOneWidget);
      expect(find.text('Debrief'), findsNothing);
      expect(find.text('Session ended too soon'), findsOneWidget);
      // RN hides the share switch for short sessions.
      expect(find.byKey(const Key('simulation-feedback-share-switch')), findsNothing);
    });

    testWidgets('feedbackTabs.transcript off: only Debrief, and moment anchors become plain prose', (tester) async {
      h.stubSummary(
        summaryJson(note: _note, hasFeedback: true, feedbackTabs: {'debrief': true, 'transcript': false}),
      );
      await h.pump(tester);

      expect(find.text('Debrief'), findsOneWidget);
      expect(find.text('Transcript'), findsNothing);
      expect(find.byKey(const ValueKey('debrief-moment-42')), findsNothing);
    });

    testWidgets('both feedback tabs off: no tabs at all', (tester) async {
      h.stubSummary(
        summaryJson(note: _note, hasFeedback: true, feedbackTabs: {'debrief': false, 'transcript': false}),
      );
      await h.pump(tester);

      expect(find.text('Debrief'), findsNothing);
      expect(find.text('Transcript'), findsNothing);
    });
  });

  group('debrief', () {
    testWidgets('renders the note by section, with headings and the reply composer', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      expect(find.text('WHAT WORKED'), findsOneWidget);
      expect(find.text('TRY THIS NEXT'), findsOneWidget);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.text('AI-GENERATED'), findsOneWidget);
      expect(find.byKey(const ValueKey('debrief-moment-42')), findsOneWidget);
      expect(find.text('Have a question about any of this? Reply below.'), findsOneWidget);
      expect(find.byKey(const Key('ask-ai-input')), findsOneWidget);
      verify(() => h.chatApi.getHistory('session-1')).called(1);
    });

    testWidgets('while the note is still being written: skeleton and "writing" copy', (tester) async {
      h.stubSummary(summaryJson(hasFeedback: true));
      await h.pump(tester);

      expect(find.byKey(const Key('debrief-note-skeleton')), findsOneWidget);
      expect(find.textContaining('Ally is writing your debrief'), findsOneWidget);
      expect(find.byKey(const Key('ask-ai-input')), findsNothing);
    });

    testWidgets('a failed generation shows its error message', (tester) async {
      h.stubSummary(summaryJson(hasFeedback: true, errorMessage: 'Generation failed'));
      await h.pump(tester);

      expect(find.text('Generation failed'), findsOneWidget);
    });

    testWidgets('from Logs it is read-only: no composer, no closing, no history load', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester, fromLogs: true);

      expect(find.byKey(const Key('ask-ai-input')), findsNothing);
      expect(find.textContaining("Reply and we'll talk"), findsNothing);
      verifyNever(() => h.chatApi.getHistory(any()));
    });

    testWidgets('a "See this moment" chip switches to the Transcript tab and outlines that row', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      when(
        () => h.transcript.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: any(named: 'languageCode')),
      ).thenAnswer(
        (_) async => (
          messages: [
            SimulationTranscriptMessage.fromJson({'id': 41, 'senderId': -1, 'content': 'Hello', 'startSeconds': 3}),
            SimulationTranscriptMessage.fromJson({'id': 42, 'senderId': 7, 'content': 'That sounds hard', 'startSeconds': 65}),
          ],
          count: 2,
        ),
      );
      await h.pump(tester);

      await tester.tap(find.byKey(const ValueKey('debrief-moment-42')));
      await tester.pumpAndSettle();

      expect(find.text('That sounds hard'), findsOneWidget);
      expect(find.text('Asha (AI client)'), findsOneWidget);
      expect(find.text('01:05 '), findsOneWidget);
      final focused = tester.widget<Container>(
        find.ancestor(of: find.text('That sounds hard'), matching: find.byType(Container)).first,
      );
      expect((focused.decoration! as BoxDecoration).border!.top.width, 2);

      // The highlight expires after 2.5s.
      await tester.pump(const Duration(milliseconds: 2600));
      final after = tester.widget<Container>(
        find.ancestor(of: find.text('That sounds hard'), matching: find.byType(Container)).first,
      );
      expect((after.decoration! as BoxDecoration).border!.top.width, 0.5);
    });

    testWidgets('replying streams Ally\'s answer into the thread', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      when(() => h.chatApi.streamChat('session-1', 'Why?', cancelToken: any(named: 'cancelToken'))).thenAnswer(
        (_) => Stream.fromIterable(const [
          AskAiSseStart(),
          AskAiSseToken('Because '),
          AskAiSseToken('**pacing** matters.'),
          AskAiSseDone(),
        ]),
      );
      await h.pump(tester);

      await tester.enterText(find.byKey(const Key('ask-ai-input')), 'Why?');
      await tester.pump();
      await tester.tap(find.byKey(const Key('ask-ai-send')));
      await tester.pumpAndSettle();

      expect(find.text('Why?'), findsOneWidget);
      expect(find.textContaining('Because', findRichText: true), findsOneWidget);
      expect(find.textContaining('pacing', findRichText: true), findsOneWidget);
    });

    testWidgets('a stream error shows the banner, and Retry re-sends', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      var calls = 0;
      when(() => h.chatApi.streamChat('session-1', 'Why?', cancelToken: any(named: 'cancelToken'))).thenAnswer((_) {
        calls++;
        return calls == 1
            ? Stream.fromIterable(const [AskAiSseError('Something broke')])
            : Stream.fromIterable(const [AskAiSseToken('Fine now'), AskAiSseDone()]);
      });
      await h.pump(tester);

      await tester.enterText(find.byKey(const Key('ask-ai-input')), 'Why?');
      await tester.pump();
      await tester.tap(find.byKey(const Key('ask-ai-send')));
      await tester.pumpAndSettle();
      expect(find.text('Something broke'), findsOneWidget);

      await tester.tap(find.byKey(const Key('ask-ai-retry')));
      await tester.pumpAndSettle();
      expect(find.text('Something broke'), findsNothing);
      expect(find.textContaining('Fine now', findRichText: true), findsOneWidget);
    });
  });

  group('rating', () {
    testWidgets('a fresh unrated session opens the rating popup straight away', (tester) async {
      h.stubSummary(summaryJson(note: _note));
      await h.pump(tester);

      expect(find.byKey(const Key('feedback-popup')), findsOneWidget);
      expect(find.text('How was your experience?'), findsOneWidget);
    });

    testWidgets('never auto-opens from Logs', (tester) async {
      h.stubSummary(summaryJson(note: _note));
      await h.pump(tester, fromLogs: true);

      expect(find.byKey(const Key('feedback-popup')), findsNothing);
    });

    testWidgets('submitting sends rating, tags and comment, then toasts', (tester) async {
      h.stubSummary(summaryJson(note: _note));
      await h.pump(tester);

      await tester.tap(find.byKey(const ValueKey('feedback-popup-star-4')));
      await tester.pumpAndSettle();
      expect(find.text('Good quality - Above expectations'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('feedback-popup-comment')), 'Useful');
      await tester.tap(find.byKey(const Key('feedback-popup-submit')));
      await tester.pumpAndSettle();

      verify(
        () => h.simulations.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: 'Useful',
          tags: <String>[],
        ),
      ).called(1);
      expect(find.byKey(const Key('feedback-popup')), findsNothing);
      expect(find.text('Feedback submitted successfully'), findsOneWidget);
    });

    testWidgets('tapping a header star opens the popup at that rating', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      await tester.tap(find.byKey(const ValueKey('session-rating-star-2')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('feedback-popup')), findsOneWidget);
      expect(find.text('Below expectations - Could be much better'), findsOneWidget);
    });

    testWidgets('leaving unrated asks again; dismissing that leaves to Learn', (tester) async {
      h.stubSummary(summaryJson(note: _note));
      await h.pump(tester);
      await closePopup(tester);
      expect(find.byKey(const Key('feedback-popup')), findsNothing);

      await tester.tap(find.byKey(const Key('simulation-feedback-back')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('feedback-popup')), findsOneWidget);

      await closePopup(tester);
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('a path session goes back to the path details (RN reset)', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, rating: 5));
      final router = await h.pump(tester, pathId: 'p1');

      await tester.tap(find.byKey(const Key('simulation-feedback-back')));
      await tester.pumpAndSettle();
      expect(find.text('PATH_DETAILS:p1'), findsOneWidget);
      // The shell sits underneath, as RN's details back goes to Learn.
      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('a case session reviewed from its details goes back to the case', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, rating: 5));
      await h.pump(tester, fromLogs: true, caseId: 'c1');

      await tester.tap(find.byKey(const Key('simulation-feedback-back')));
      await tester.pumpAndSettle();
      expect(find.text('CASE_DETAILS:c1'), findsOneWidget);
    });

    testWidgets('an already-rated session leaves without asking', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, rating: 5));
      await h.pump(tester);

      await tester.tap(find.byKey(const Key('simulation-feedback-back')));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });
  });

  group('share switch', () {
    testWidgets('on with no review yet opens Share for review with the session context', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      await tester.tap(find.byKey(const Key('simulation-feedback-share-switch')));
      await tester.pumpAndSettle();

      expect(find.text('SHARE:null:300:Supporting a grieving parent'), findsOneWidget);
    });

    testWidgets('off on an older shared review makes it private', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));
      h.stubReview();
      when(
        () => h.reviews.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN'),
      ).thenAnswer((_) async {});
      await h.pump(tester);

      await tester.tap(find.byKey(const Key('simulation-feedback-share-switch')));
      await tester.pumpAndSettle();

      verify(() => h.reviews.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN')).called(1);
      expect(find.text('Privacy setting updated'), findsOneWidget);
    });
  });

  group('event checklist', () {
    testWidgets('CHECKLIST roleplays show which events happened', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, experienceMode: 'CHECKLIST'));
      when(() => h.simulations.getEventChecklist('session-1')).thenAnswer(
        (_) async => [
          EventChecklistItem(id: 'a', name: 'Introduced self', hasOccurred: true),
          EventChecklistItem(id: 'b', name: 'Asked about safety', hasOccurred: false),
        ],
      );
      await h.pump(tester);

      expect(find.text('Evaluation Checklist'), findsOneWidget);
      expect(find.text('Introduced self'), findsOneWidget);
      expect(find.text('Asked about safety'), findsOneWidget);
    });

    testWidgets('other modes never fetch it', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      verifyNever(() => h.simulations.getEventChecklist(any()));
    });
  });

  group('floating buttons (off the Debrief tab)', () {
    Future<void> toTranscript(WidgetTester tester) async {
      await tester.tap(find.text('Transcript'));
      await tester.pumpAndSettle();
    }

    testWidgets('a shared review: the review button shows on Transcript but not Debrief', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, reviewId: 'rev-1', reviewStatus: 'IN_REVIEW'));
      h.stubReview();
      await h.pump(tester);

      expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
      verifyNever(() => h.reviews.getThreads(any(), limit: any(named: 'limit')));
      await toTranscript(tester);
      expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);

      await tester.tap(find.byKey(const Key('simulation-feedback-view-review')));
      await tester.pumpAndSettle();
      expect(find.text('REVIEW_DETAILS:rev-1:ReviewType.simulation'), findsOneWidget);
    });

    testWidgets('a private review with nothing on it stays hidden', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
      h.stubReview(status: 'HIDDEN');
      await h.pump(tester);
      await toTranscript(tester);

      expect(find.byKey(const Key('simulation-feedback-view-review')), findsNothing);
      verify(() => h.reviews.getThreads('rev-1', limit: 1)).called(1);
    });

    testWidgets('a private review with a thread or reaction shows it', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
      h.stubReview(status: 'HIDDEN');
      when(() => h.reviews.getThreads('rev-1', limit: 1)).thenAnswer(
        (_) async => (
          threads: [
            ReviewThread.fromJson({
              'id': 'thread-1',
              'commentCount': 1,
              'createdBy': {'id': 1, 'name': 'A'},
            }),
          ],
          count: 1,
        ),
      );
      await h.pump(tester);
      await toTranscript(tester);

      expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);
      verifyNever(() => h.reactions.getReactionsCount(any()));
    });

    testWidgets('a private review with only a reaction shows it', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true, reviewId: 'rev-1', reviewStatus: 'HIDDEN'));
      h.stubReview(status: 'HIDDEN');
      when(() => h.reactions.getReactionsCount('rev-1')).thenAnswer((_) async => {'👍': 1});
      await h.pump(tester);
      await toTranscript(tester);

      expect(find.byKey(const Key('simulation-feedback-view-review')), findsOneWidget);
    });

    testWidgets('Try another simulation shows off Debrief and opens the catalog; never from Logs', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester);

      expect(find.byKey(const Key('simulation-feedback-try-another')), findsNothing);
      await toTranscript(tester);
      expect(find.text('Try another simulation'), findsOneWidget);
      await tester.tap(find.byKey(const Key('simulation-feedback-try-another')));
      await tester.pumpAndSettle();
      expect(find.text('SIMULATIONS_LIST'), findsOneWidget);
    });

    testWidgets('no Try another for a path or case session', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester, pathId: 'p1');
      await toTranscript(tester);

      expect(find.byKey(const Key('simulation-feedback-try-another')), findsNothing);
    });

    testWidgets('no Try another from Logs', (tester) async {
      h.stubSummary(summaryJson(note: _note, hasFeedback: true));
      await h.pump(tester, fromLogs: true);
      await toTranscript(tester);

      expect(find.byKey(const Key('simulation-feedback-try-another')), findsNothing);
    });
  });

  group('polling', () {
    testWidgets('re-fetches every 3.5s until Ally\'s note lands, then stops', (tester) async {
      var calls = 0;
      when(() => h.simulations.getSimulationDetails('session-1')).thenAnswer((_) async {
        calls++;
        return SimulationSummary.fromJson(summaryJson(hasFeedback: true, note: calls >= 2 ? _note : null));
      });
      await h.pump(tester);
      expect(calls, 1);
      expect(find.byKey(const Key('debrief-note-skeleton')), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 3600));
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(find.byKey(const Key('supervisor-note')), findsOneWidget);

      await tester.pump(const Duration(seconds: 10));
      expect(calls, 2);
    });
  });
}
