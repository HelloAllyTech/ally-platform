import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';

import '../data/learner_debrief_repository_test.dart' show readyDebriefJson;
import 'feedback_test_harness.dart';

/// The Debrief agent's "Your debrief" on the post-roleplay Debrief tab
/// (web helpline `DebriefCards.tsx` / `DebriefCardFeedback.tsx`).
const _note = 'Hi there, good effort today.\n\n## [what_worked]\nYou named the feeling.';

void main() {
  setUpAll(() {
    registerFeedbackFallbacks();
    registerFallbackValue(DebriefFlagReason.didntSay);
  });

  late FeedbackHarness h;
  setUp(() {
    h = FeedbackHarness();
    // Rated already, so the rating popup doesn't cover the tab.
    h.stubSummary(summaryJson(note: _note, hasFeedback: true, rating: 4));
  });

  void stubDebrief(Map<String, dynamic> json) {
    when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer((_) async => LearnerDebriefView.fromJson(json));
  }

  Future<void> tapVisible(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  group('today\'s debrief stays unchanged', () {
    testWidgets('when the organisation isn\'t switched on (not_available)', (tester) async {
      await h.pump(tester);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.text('Written by Ally (AI)'), findsNothing);
      verify(() => h.learnerDebrief.getDebrief('session-1')).called(1);
    });

    testWidgets('when the request fails', (tester) async {
      when(() => h.learnerDebrief.getDebrief(any())).thenThrow(Exception('500'));
      await h.pump(tester);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.byKey(const Key('debrief-cards')), findsNothing);
    });

    testWidgets('from Logs it asks too, and a 403 keeps the note, as RN', (tester) async {
      when(() => h.learnerDebrief.getDebrief(any())).thenThrow(Exception('403'));
      await h.pump(tester, fromLogs: true);
      expect(find.text('from Ally'), findsOneWidget);
      verify(() => h.learnerDebrief.getDebrief(any())).called(1);
    });

    testWidgets('when ready has no cards', (tester) async {
      stubDebrief({'state': 'ready'});
      await h.pump(tester);
      expect(find.text('from Ally'), findsOneWidget);
    });
  });

  testWidgets('ready: every card, in the web\'s order and copy, with no score', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);

    expect(find.text('from Ally'), findsNothing);
    expect(find.text('Your debrief'), findsOneWidget);
    expect(find.text('Written by Ally (AI)'), findsOneWidget);
    expect(find.byKey(const Key('debrief-card-important-moment')), findsOneWidget);
    expect(find.text('An important moment'), findsOneWidget);
    expect(
      find.text(
        'Moments like this are hard. If this session brought something up for you, you can talk to your supervisor.',
      ),
      findsOneWidget,
    );
    expect(find.text('Other moments like this'), findsOneWidget);
    expect(find.text('You stayed with her when it got hard.'), findsOneWidget);
    expect(find.text('What worked'), findsOneWidget);
    expect(find.text('You named the feeling.'), findsOneWidget);
    expect(find.text('Work on this'), findsOneWidget);
    expect(find.byKey(const Key('debrief-try-saying')), findsOneWidget);
    expect(find.textContaining('Try saying:', findRichText: true), findsOneWidget);
    expect(find.text('Practise this next'), findsOneWidget);
    expect(find.text('A strength today'), findsOneWidget);
    expect(find.text('Keep practising'), findsOneWidget);
    expect(find.text("Didn't come up today"), findsOneWidget);
    expect(find.text('Your progress'), findsOneWidget);
    expect(find.text('One question to think about'), findsOneWidget);
    expect(find.text('Was this helpful?'), findsOneWidget);
    // One "This isn't right" per flaggable point: moment + 2 worked + 1 work-on + practise.
    expect(find.byKey(const Key('debrief-flag-open')), findsNWidgets(5));
    expect(find.textContaining('%'), findsNothing);
    // The old reply composer belongs to today's debrief only.
    expect(find.byKey(const Key('ask-ai-input')), findsNothing);
  });

  testWidgets('a removed point is hidden by its stored index; a kept one says why', (tester) async {
    stubDebrief({
      ...readyDebriefJson(),
      'corrections': [
        {'section': 'what_worked[0]', 'outcome': 'removed', 'note': null, 'at': '2026-10-30T10:00:00Z'},
        {'section': 'what_worked[1]', 'outcome': 'kept', 'note': 'It matches the transcript.', 'at': '2026-10-30T10:00:00Z'},
      ],
    });
    await h.pump(tester);

    expect(find.text('You named the feeling.'), findsNothing);
    expect(find.text('You slowed down.'), findsOneWidget);
    expect(find.text('Reviewed: the Ally team kept this point. It matches the transcript.'), findsOneWidget);
    expect(find.text('A point was removed after a review by the Ally team.'), findsOneWidget);
    // The kept point's flag control is replaced by the review note.
    expect(find.byKey(const ValueKey('debrief-flag-what_worked[1]')), findsOneWidget);
    expect(find.byKey(const Key('debrief-flag-open')), findsNWidgets(3));
  });

  testWidgets('flag: pick a reason, send, then Undo while the window is open', (tester) async {
    final flags = <Map<String, dynamic>>[];
    when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
      (_) async => LearnerDebriefView.fromJson({
        ...readyDebriefJson(),
        'feedback': {'helpful': null, 'flags': List.of(flags)},
      }),
    );
    final until = DateTime.now().add(const Duration(minutes: 10));
    when(
      () => h.learnerDebrief.flagCard(
        'session-1',
        section: any(named: 'section'),
        reason: any(named: 'reason'),
        note: any(named: 'note'),
      ),
    ).thenAnswer((invocation) async {
      flags.add({
        'id': 'f1',
        'section': invocation.namedArguments[#section],
        'status': 'open',
        'canUndoUntil': until.toUtc().toIso8601String(),
      });
      return (id: 'f1', undoUntil: until);
    });
    when(() => h.learnerDebrief.undoFlag('session-1', 'f1')).thenAnswer((_) async => flags.clear());
    await h.pump(tester);

    final practiseFlag = find.byKey(const ValueKey('debrief-flag-practise_next'));
    await tapVisible(tester, find.descendant(of: practiseFlag, matching: find.byKey(const Key('debrief-flag-open'))));
    expect(find.text("What's not right?"), findsOneWidget);
    for (final reason in [
      "I didn't say this",
      'This moment is described wrongly',
      "This advice doesn't fit",
      'Something else',
    ]) {
      expect(find.text(reason), findsOneWidget);
    }
    expect(find.text('Anything else to add? (optional)'), findsOneWidget);
    // Send waits for a reason.
    final send = find.byKey(const Key('debrief-flag-send'));
    expect(tester.widget<FilledButton>(send).onPressed, isNull);

    await tapVisible(tester, find.byKey(const ValueKey('debrief-flag-reason-advice_doesnt_fit')));
    await tester.enterText(find.byKey(const Key('debrief-flag-note')), '  Not my setting  ');
    await tapVisible(tester, send);

    verify(
      () => h.learnerDebrief.flagCard(
        'session-1',
        section: 'practise_next',
        reason: DebriefFlagReason.adviceDoesntFit,
        note: 'Not my setting',
      ),
    ).called(1);
    expect(find.text('Thanks. Someone from the Ally team will look at this.'), findsOneWidget);
    expect(find.byKey(const Key('debrief-flag-form')), findsNothing);

    await tapVisible(tester, find.byKey(const Key('debrief-flag-undo')));
    verify(() => h.learnerDebrief.undoFlag('session-1', 'f1')).called(1);
    expect(find.text('Thanks. Someone from the Ally team will look at this.'), findsNothing);
    expect(find.byKey(const Key('debrief-flag-open')), findsNWidgets(5));
  });

  testWidgets('a flag past its undo window reads "Sent to the Ally team", no Undo', (tester) async {
    stubDebrief({
      ...readyDebriefJson(),
      'feedback': {
        'helpful': null,
        'flags': [
          {'id': 'f1', 'section': 'important_moment', 'status': 'open', 'canUndoUntil': null},
        ],
      },
    });
    await h.pump(tester);
    expect(find.text('Sent to the Ally team'), findsOneWidget);
    expect(find.byKey(const Key('debrief-flag-undo')), findsNothing);
  });

  testWidgets('a failed flag keeps the form open and says so', (tester) async {
    stubDebrief(readyDebriefJson());
    when(
      () => h.learnerDebrief.flagCard(
        any(),
        section: any(named: 'section'),
        reason: any(named: 'reason'),
        note: any(named: 'note'),
      ),
    ).thenThrow(Exception('409'));
    await h.pump(tester);

    await tapVisible(tester, find.byKey(const Key('debrief-flag-open')).first);
    await tapVisible(tester, find.byKey(const ValueKey('debrief-flag-reason-didnt_say')));
    await tapVisible(tester, find.byKey(const Key('debrief-flag-send')));
    expect(find.byKey(const Key('debrief-flag-failed')), findsOneWidget);
    expect(find.byKey(const Key('debrief-flag-form')), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('debrief-flag-cancel')));
    expect(find.byKey(const Key('debrief-flag-form')), findsNothing);
  });

  testWidgets('Was this helpful? Yes is sent and shows pressed', (tester) async {
    var helpful = false;
    when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
      (_) async => LearnerDebriefView.fromJson({
        ...readyDebriefJson(),
        'feedback': {'helpful': helpful ? true : null, 'flags': <Object>[]},
      }),
    );
    when(() => h.learnerDebrief.setHelpful('session-1', helpful: true)).thenAnswer((_) async => helpful = true);
    await h.pump(tester);

    expect(find.text('Thanks for telling us.'), findsNothing);
    await tapVisible(tester, find.byKey(const Key('debrief-helpful-yes')));
    verify(() => h.learnerDebrief.setHelpful('session-1', helpful: true)).called(1);
    expect(find.text('Thanks for telling us.'), findsOneWidget);
    bool? toggled(String key) => tester
        .widget<Semantics>(find.ancestor(of: find.byKey(Key(key)), matching: find.byType(Semantics)).first)
        .properties
        .toggled;
    expect(toggled('debrief-helpful-yes'), isTrue);
    expect(toggled('debrief-helpful-no'), isFalse);
  });

  testWidgets('touch targets are at least 44pt', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);
    for (final key in ['debrief-helpful-yes', 'debrief-helpful-no']) {
      expect(tester.getSize(find.byKey(Key(key))).height, greaterThanOrEqualTo(44));
    }
    expect(tester.getSize(find.byKey(const Key('debrief-flag-open')).first).height, greaterThanOrEqualTo(44));
  });

  group('states before the cards', () {
    testWidgets('working: calm copy with the latest step, static under reduce-motion', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      stubDebrief({
        'state': 'working',
        'steps': ['Reading your session…', 'Looking at the hard moments…'],
      });
      await h.pump(tester);

      expect(find.text('Ally is writing your debrief'), findsOneWidget);
      expect(find.text('Looking at the hard moments…'), findsOneWidget);
      expect(find.byKey(const Key('debrief-working-static')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.textContaining('%'), findsNothing);
    });

    testWidgets('working without steps reads "Reading your session…"; polls until ready', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
        (_) async => LearnerDebriefView.fromJson(calls++ == 0 ? {'state': 'working'} : readyDebriefJson()),
      );
      await h.pump(tester);
      expect(find.text('Reading your session…'), findsOneWidget);

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('Ally is writing your debrief'), findsNothing);
      expect(find.text('What worked'), findsOneWidget);
    });

    testWidgets('on_its_way', (tester) async {
      stubDebrief({'state': 'on_its_way'});
      await h.pump(tester);
      expect(
        find.text(
          'Your debrief needs a little more care. Someone from the Ally team will finish it, usually within a day.',
        ),
        findsOneWidget,
      );
      expect(find.text('from Ally'), findsNothing);
    });

    testWidgets('too_short', (tester) async {
      stubDebrief({'state': 'too_short'});
      await h.pump(tester);
      expect(
        find.text(
          'This session was too short for a debrief. Try a longer conversation next time and Ally will write you one.',
        ),
        findsOneWidget,
      );
    });
  });
}
