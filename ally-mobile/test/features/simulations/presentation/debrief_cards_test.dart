import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:ally_mobile_flutter/core/widgets/ask_ai_chat/ask_ai_chat.dart';
import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/feedback/debrief_read_aloud.dart';

import '../data/learner_debrief_repository_test.dart' show readyDebriefJson;
import 'feedback_test_harness.dart';

/// The Debrief agent's "Your debrief" on the post-roleplay Debrief tab
/// (web helpline `DebriefCards.tsx` / `DebriefCardFeedback.tsx`).
const _note = 'Hi there, good effort today.\n\n## [what_worked]\nYou named the feeling.';

class _FakeUrlLauncherPlatform extends UrlLauncherPlatform {
  final List<String> launchedUrls = [];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launchedUrls.add(url);
    return true;
  }
}

/// Stands in for `audioplayers`: records what was played, and lets a test
/// end the current clip.
class _FakeDebriefAudioPlayer implements DebriefAudioPlayer {
  final played = <String>[];
  double? rate;
  final _complete = StreamController<void>.broadcast();
  final _errors = StreamController<Object>.broadcast();

  void finishClip() => _complete.add(null);

  @override
  Stream<void> get onComplete => _complete.stream;

  @override
  Stream<Object> get onError => _errors.stream;

  @override
  Future<void> play(String url, {required double rate}) async {
    played.add(url);
    this.rate = rate;
  }

  @override
  Future<void> pause() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<void> setPlaybackRate(double rate) async => this.rate = rate;

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {}
}

const _supportLine = {'name': 'Tele-MANAS', 'phone': '+91 14416', 'hours': 'Open 24 hours', 'isCrisis': true};

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

  /// Design A5: scroll "One question to think about" into view, which docks
  /// the composer.
  Future<void> showQuestion(WidgetTester tester) async {
    await tester.scrollUntilVisible(
      find.byKey(const Key('debrief-card-reflective-question')),
      200,
      scrollable: find.descendant(of: find.byKey(const Key('debrief-cards')), matching: find.byType(Scrollable)),
    );
    await tester.pumpAndSettle();
  }

  group('today\'s debrief stays unchanged', () {
    testWidgets('when the organisation isn\'t switched on (not_available)', (tester) async {
      await h.pump(tester);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.text('Written by Ally (AI)'), findsNothing);
      verify(() => h.learnerDebrief.getDebrief('session-1')).called(1);
    });

    testWidgets('when the server refuses (403)', (tester) async {
      when(() => h.learnerDebrief.getDebrief(any())).thenThrow(_dioError(403));
      await h.pump(tester);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.byKey(const Key('debrief-cards')), findsNothing);
    });

    testWidgets('from Logs a 403 on the supervisor view keeps the note', (tester) async {
      when(() => h.learnerDebrief.getSupervisorDebrief(any())).thenThrow(Exception('403'));
      await h.pump(tester, fromLogs: true);
      expect(find.text('from Ally'), findsOneWidget);
      verify(() => h.learnerDebrief.getSupervisorDebrief('session-1')).called(1);
      verifyNever(() => h.learnerDebrief.getDebrief(any()));
    });

    testWidgets('from Logs not_available keeps the note', (tester) async {
      await h.pump(tester, fromLogs: true);
      expect(find.text('from Ally'), findsOneWidget);
      expect(find.byKey(const Key('debrief-cards')), findsNothing);
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
    // The fixture's learner asked directly and stayed (handled_well).
    expect(find.text('You noticed an important moment'), findsOneWidget);
    expect(find.text('An important moment'), findsNothing);
    expect(
      find.text(
        'Moments like this are hard. If this session brought something up for you, you can talk to:',
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
    // No support lines, no distress panel, no roleplay to link to.
    expect(find.byKey(const Key('debrief-support-lines')), findsNothing);
    expect(find.byKey(const Key('debrief-distress')), findsNothing);
    expect(find.byKey(const Key('debrief-practise-next')), findsNothing);
    // Ask Ally replaces the old composer, inside the reflective question.
    expect(
      find.descendant(
        of: find.byKey(const Key('debrief-card-reflective-question')),
        matching: find.byKey(const Key('ask-ally')),
      ),
      findsOneWidget,
    );
    expect(find.text('Answer here, or ask Ally anything about this session…'), findsOneWidget);
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

  testWidgets('a corrected point says when and why, in place of its flag control', (tester) async {
    stubDebrief({
      ...readyDebriefJson(),
      'corrections': [
        {'section': 'work_on_this[0]', 'outcome': 'corrected', 'note': 'We reworded the advice.', 'at': '2026-10-30T12:00:00Z'},
      ],
      'feedback': {
        'helpful': null,
        'flags': [
          {'id': 'f1', 'section': 'work_on_this[0]', 'status': 'corrected', 'canUndoUntil': null},
        ],
      },
    });
    await h.pump(tester);

    expect(
      find.text('Updated on Oct 30, 2026 after a review by the Ally team: We reworded the advice.'),
      findsOneWidget,
    );
    // Still on screen (it was rewritten, not removed); no "Sent to the Ally team".
    expect(find.text('A closed question shut the door.'), findsOneWidget);
    expect(find.text('A point was removed after a review by the Ally team.'), findsNothing);
    expect(find.text('Sent to the Ally team'), findsNothing);
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

  group('a debrief that didn\'t load (PRD §6.12)', () {
    testWidgets('a 5xx shows "didn\'t load" with Try again, not the old note; Try again loads it', (tester) async {
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer((_) async {
        if (calls++ == 0) throw _dioError(500);
        return LearnerDebriefView.fromJson(readyDebriefJson());
      });
      await h.pump(tester);
      expect(find.byKey(const Key('debrief-failed')), findsOneWidget);
      expect(find.text("Your debrief didn't load"), findsOneWidget);
      expect(find.text('from Ally'), findsNothing);
      expect(tester.getSize(find.byKey(const Key('debrief-retry'))).height, greaterThanOrEqualTo(44));

      await tapVisible(tester, find.byKey(const Key('debrief-retry')));
      expect(find.byKey(const Key('debrief-failed')), findsNothing);
      expect(find.text('What worked'), findsOneWidget);
    });

    testWidgets('no connection shows "You\'re offline" with Try again', (tester) async {
      when(() => h.learnerDebrief.getDebrief('session-1')).thenThrow(
        DioException(requestOptions: RequestOptions(path: '/x'), type: DioExceptionType.connectionError),
      );
      await h.pump(tester);
      expect(find.byKey(const Key('debrief-offline')), findsOneWidget);
      expect(find.text("You're offline"), findsOneWidget);
      expect(find.byKey(const Key('debrief-retry')), findsOneWidget);
    });
  });

  testWidgets('"How Ally writes your debrief" opens the explainer sheet', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);
    await tapVisible(tester, find.byKey(const Key('debrief-explainer-link')));
    expect(find.byKey(const Key('debrief-explainer')), findsOneWidget);
    expect(find.textContaining('reviews and improves its own draft'), findsOneWidget);
    expect(find.textContaining('Your supervisor can read your debriefs'), findsOneWidget);
    await tester.tap(find.byKey(const Key('debrief-explainer-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('debrief-explainer')), findsNothing);
  });

  testWidgets('the pulse shows only when picked, and sends an answer', (tester) async {
    stubDebrief({...readyDebriefJson(), 'pulse': {'knew_next': null, 'fair': null}});
    when(
      () => h.learnerDebrief.answerPulse('session-1', DebriefPulseQuestion.fair, answer: false),
    ).thenAnswer((_) async {});
    await h.pump(tester);
    expect(find.text('Did you know what to practise next?'), findsOneWidget);
    await tapVisible(tester, find.byKey(const Key('debrief-pulse-fair-no')));
    verify(() => h.learnerDebrief.answerPulse('session-1', DebriefPulseQuestion.fair, answer: false)).called(1);
  });

  testWidgets('no pulse on a debrief that wasn\'t picked', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);
    expect(find.byKey(const Key('debrief-pulse')), findsNothing);
  });

  testWidgets('touch targets are at least 44pt', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);
    for (final key in ['debrief-helpful-yes', 'debrief-helpful-no']) {
      expect(tester.getSize(find.byKey(Key(key))).height, greaterThanOrEqualTo(44));
    }
    expect(tester.getSize(find.byKey(const Key('debrief-flag-open')).first).height, greaterThanOrEqualTo(44));
  });

  group('distress first', () {
    testWidgets('care and support lines first; the cards collapsed until opened', (tester) async {
      stubDebrief({
        ...readyDebriefJson(),
        'distress': true,
        'supportLines': [_supportLine],
      });
      await h.pump(tester);

      expect(find.text('Before your debrief'), findsOneWidget);
      expect(find.text("If you'd like to talk to someone now:"), findsOneWidget);
      expect(find.text('Tele-MANAS · +91 14416'), findsOneWidget);
      expect(find.text('Open 24 hours'), findsOneWidget);
      expect(find.byKey(const Key('debrief-card-important-moment')), findsNothing);
      expect(find.text('What worked'), findsNothing);
      bool? expanded() => tester
          .widget<Semantics>(
            find.ancestor(of: find.byKey(const Key('debrief-when-ready')), matching: find.byType(Semantics)).first,
          )
          .properties
          .expanded;
      expect(find.text("Your debrief, when you're ready"), findsOneWidget);
      expect(expanded(), isFalse);

      await tapVisible(tester, find.byKey(const Key('debrief-when-ready')));
      expect(expanded(), isTrue);
      expect(find.byKey(const Key('debrief-card-important-moment')), findsOneWidget);
      expect(find.text('What worked'), findsOneWidget);
      // The important moment ends with the same support lines.
      expect(find.byKey(const Key('debrief-support-lines')), findsNWidgets(2));
    });

    testWidgets('a support line is a tel: link', (tester) async {
      final launcher = _FakeUrlLauncherPlatform();
      final previous = UrlLauncherPlatform.instance;
      UrlLauncherPlatform.instance = launcher;
      addTearDown(() => UrlLauncherPlatform.instance = previous);
      stubDebrief({...readyDebriefJson(), 'supportLines': [_supportLine]});
      await h.pump(tester);

      // Not in distress: the lines close the important moment only.
      expect(find.byKey(const Key('debrief-distress')), findsNothing);
      await tapVisible(tester, find.text('Tele-MANAS · +91 14416'));
      expect(launcher.launchedUrls, ['tel:+9114416']);
    });
  });

  testWidgets('"Practise this next" only for a roleplay the learner can open, and opens its details', (tester) async {
    final json = readyDebriefJson();
    final cards = json['cards'] as Map<String, dynamic>;
    stubDebrief({
      ...json,
      'cards': {
        ...cards,
        'practise_next': {...cards['practise_next'] as Map<String, dynamic>, 'scenario_id': 42},
        'work_on_this': [
          // 99 isn't in `practice`: no button.
          {...(cards['work_on_this'] as List).first as Map<String, dynamic>, 'scenario_id': 99},
        ],
      },
      'practice': [
        {'id': 42, 'title': 'Supporting a grieving parent'},
      ],
    });
    await h.pump(tester);

    expect(find.byKey(const Key('debrief-practise-this')), findsNothing);
    final next = find.byKey(const Key('debrief-practise-next'));
    expect(next, findsOneWidget);
    expect(find.text('Practise this next'), findsNWidgets(2)); // card title + button
    expect(find.bySemanticsLabel('Practise this in the roleplay "Supporting a grieving parent"'), findsOneWidget);
    await tapVisible(tester, next);
    expect(find.text('SIMULATION_DETAILS:42'), findsOneWidget);
  });

  testWidgets('"Practise this" on a Work-on-this point with an available roleplay', (tester) async {
    final json = readyDebriefJson();
    final cards = json['cards'] as Map<String, dynamic>;
    stubDebrief({
      ...json,
      'cards': {
        ...cards,
        'work_on_this': [
          {...(cards['work_on_this'] as List).first as Map<String, dynamic>, 'scenario_id': 7},
        ],
      },
      'practice': [
        {'id': 7, 'title': 'Open questions'},
      ],
    });
    await h.pump(tester);
    expect(find.byKey(const Key('debrief-practise-next')), findsNothing);
    await tapVisible(tester, find.byKey(const Key('debrief-practise-this')));
    expect(find.text('SIMULATION_DETAILS:7'), findsOneWidget);
  });

  testWidgets('Ask Ally posts to the Debrief agent on the shared thread', (tester) async {
    stubDebrief(readyDebriefJson());
    when(
      () => h.chatApi.streamChatAt(
        '/debriefs/sessions/session-1/reply/stream',
        'Why?',
        cancelToken: any(named: 'cancelToken'),
      ),
    ).thenAnswer(
      (_) => Stream.fromIterable(const [AskAiSseStart(), AskAiSseToken('Because it '), AskAiSseToken('opened her up.'), AskAiSseDone()]),
    );
    await h.pump(tester);
    verify(() => h.chatApi.getHistory('session-1')).called(1);

    await showQuestion(tester);
    await tester.enterText(find.byKey(const Key('ask-ai-input')), 'Why?');
    await tester.pump();
    await tester.tap(find.byKey(const Key('ask-ai-send')));
    await tester.pumpAndSettle();

    expect(find.text('Why?'), findsOneWidget);
    expect(find.textContaining('opened her up', findRichText: true), findsOneWidget);
    verifyNever(() => h.chatApi.streamChat(any(), any(), cancelToken: any(named: 'cancelToken')));
  });

  testWidgets('Ask Ally tells the learner their supervisor can read it, under the question', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester);
    final note = find.text('Your supervisor can read this conversation.');
    expect(find.descendant(of: find.byKey(const Key('ask-ally')), matching: note), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('debrief-card-reflective-question')), matching: note),
      findsOneWidget,
    );
  });

  group('Ask Ally composer (design A5)', () {
    bool docked(WidgetTester tester) => !tester
        .widget<IgnorePointer>(
          find.ancestor(of: find.byKey(const Key('ask-ally-composer')), matching: find.byType(IgnorePointer)).first,
        )
        .ignoring;

    testWidgets('hidden while reading the cards, docked once the question is in view, hidden again above',
        (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      expect(find.byKey(const Key('ask-ally-composer')), findsOneWidget);
      expect(docked(tester), isFalse);
      // No per-card ask icon and no floating button: one composer.
      expect(find.byKey(const Key('ask-ai-input')), findsOneWidget);
      // The composer is not inside any card.
      expect(
        find.descendant(of: find.byKey(const Key('debrief-card-reflective-question')), matching: find.byKey(const Key('ask-ai-input'))),
        findsNothing,
      );

      await showQuestion(tester);
      expect(docked(tester), isTrue);
      // Docked at the bottom of the debrief, below the question's heading.
      expect(
        tester.getTopLeft(find.byKey(const Key('ask-ally-composer'))).dy,
        greaterThan(tester.getTopLeft(find.text('One question to think about')).dy),
      );

      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, 3000));
      await tester.pumpAndSettle();
      expect(docked(tester), isFalse);
    });

    testWidgets('the header scrolls away with the cards', (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      expect(
        find.descendant(of: find.byKey(const Key('debrief-cards')), matching: find.byKey(const Key('debrief-header'))),
        findsOneWidget,
      );
      final top = tester.getTopLeft(find.text('Your debrief')).dy;
      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, -150));
      await tester.pumpAndSettle();
      expect(tester.getTopLeft(find.text('Your debrief')).dy, lessThan(top));
      // ⓘ beside "Written by Ally (AI)", not its own line.
      expect(
        (tester.getCenter(find.byKey(const Key('debrief-explainer-link'))).dy -
                tester.getCenter(find.text('Written by Ally (AI)')).dy)
            .abs(),
        lessThan(4),
      );
    });

    testWidgets('distress first: no composer until the learner opens the debrief', (tester) async {
      stubDebrief({...readyDebriefJson(), 'distress': true, 'supportLines': [_supportLine]});
      await h.pump(tester);
      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(docked(tester), isFalse);

      await tapVisible(tester, find.byKey(const Key('debrief-when-ready')));
      await showQuestion(tester);
      expect(docked(tester), isTrue);
    });
  });

  testWidgets('every quote has See this moment, which opens the transcript at those words', (tester) async {
    stubDebrief(readyDebriefJson());
    when(
      () => h.transcript.getMessages(scenarioSessionId: 'session-1', offset: 0, languageCode: any(named: 'languageCode')),
    ).thenAnswer(
      (_) async => (
        messages: [
          SimulationTranscriptMessage.fromJson({'id': 41, 'senderId': -1, 'content': 'Hello', 'startSeconds': 3}),
          SimulationTranscriptMessage.fromJson(
            {'id': 42, 'senderId': -1, 'content': 'Honestly, I sometimes think it would be  easier not to be here.', 'startSeconds': 65},
          ),
        ],
        count: 2,
      ),
    );
    await h.pump(tester);
    expect(
      find.descendant(
        of: find.byKey(const Key('debrief-card-important-moment')),
        matching: find.byKey(const Key('debrief-see-moment')),
      ),
      findsNWidgets(2),
    );
    await tapVisible(tester, find.byKey(const Key('debrief-see-moment')).first);

    // The Transcript tab, that turn outlined (found by its words, spacing aside).
    final row = find.textContaining('easier not to be here');
    expect(row, findsOneWidget);
    final focused = tester.widget<Container>(find.ancestor(of: row, matching: find.byType(Container)).first);
    expect((focused.decoration! as BoxDecoration).border!.top.width, 2);
  });

  void stubSupervisor(Map<String, dynamic> json) {
    when(() => h.learnerDebrief.getSupervisorDebrief('session-1'))
        .thenAnswer((_) async => LearnerDebriefView.fromSupervisorJson(json));
  }

  Map<String, dynamic> supervisorJson({Object? flags, Object? helpful, Object? thread, Object? corrections}) {
    final ready = readyDebriefJson();
    return {
      'state': 'ready',
      'readOnly': true,
      'cards': ready['cards'],
      'language': 'en',
      'corrections': corrections ?? <Object>[],
      'flags': flags ?? <Object>[],
      'helpful': helpful,
      'thread': thread ?? <Object>[],
    };
  }

  testWidgets('the learner\'s own session from Session Logs is the full learner view, Ask Ally included', (tester) async {
    stubDebrief(readyDebriefJson());
    await h.pump(tester, fromLogs: true, ownSession: true);

    verify(() => h.learnerDebrief.getDebrief('session-1')).called(1);
    verifyNever(() => h.learnerDebrief.getSupervisorDebrief(any()));
    verify(() => h.chatApi.getHistory('session-1')).called(1);
    expect(find.byKey(const Key('debrief-flag-open')), findsWidgets);
    expect(find.byKey(const Key('ask-ally')), findsOneWidget);
    await showQuestion(tester);
    expect(find.byKey(const Key('ask-ai-input')), findsOneWidget);
  });

  group('supervisor view from Roleplay Logs (v9 FR-26)', () {
    testWidgets('the same cards, read-only: no controls and no learner-only calls', (tester) async {
      stubSupervisor(supervisorJson());
      await h.pump(tester, fromLogs: true);
      await tester.pump(const Duration(seconds: 35));

      expect(find.text('from Ally'), findsNothing);
      expect(find.byKey(const Key('debrief-card-reflective-question')), findsOneWidget);
      expect(find.text('You named the feeling.'), findsOneWidget);
      expect(find.byKey(const Key('debrief-flag-open')), findsNothing);
      expect(find.byKey(const Key('debrief-listen-all-play')), findsNothing);
      expect(find.byKey(const Key('debrief-helpful-yes')), findsNothing);
      expect(find.byKey(const Key('ask-ally')), findsNothing);
      expect(find.byKey(const Key('ask-ai-input')), findsNothing);
      expect(find.text('Your supervisor can read this conversation.'), findsNothing);

      await tester.ensureVisible(find.byKey(const Key('debrief-try-saying')));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 35));
      verify(() => h.learnerDebrief.getSupervisorDebrief('session-1')).called(1);
      verifyNever(() => h.learnerDebrief.getDebrief(any()));
      verifyNever(() => h.learnerDebrief.markRead(any()));
      verifyNever(() => h.learnerDebrief.markOpened(any()));
      verifyNever(() => h.learnerDebrief.getCardAudioUrl(any(), any()));
      verifyNever(() => h.chatApi.getHistory(any()));
    });

    testWidgets('each flagged card shows the learner\'s reason, note and the outcome', (tester) async {
      stubSupervisor(
        supervisorJson(
          flags: [
            {'section': 'important_moment', 'reason': 'didnt_say', 'note': 'Not my words.', 'status': 'open', 'resolutionNote': null},
            {'section': 'what_worked[0]', 'reason': 'described_wrongly', 'note': null, 'status': 'escalated', 'resolutionNote': null},
            {'section': 'what_worked[1]', 'reason': 'advice_doesnt_fit', 'note': null, 'status': 'kept', 'resolutionNote': 'It fits.'},
            {'section': 'work_on_this[0]', 'reason': 'something_else', 'note': null, 'status': 'corrected', 'resolutionNote': 'Reworded.'},
            {'section': 'practise_next', 'reason': null, 'note': null, 'status': 'removed', 'resolutionNote': null},
          ],
        ),
      );
      await h.pump(tester, fromLogs: true);

      expect(find.byKey(const Key('debrief-supervisor-flag')), findsNWidgets(5));
      expect(find.text('The learner flagged this: I didn\'t say this'), findsOneWidget);
      expect(find.text('Their note: Not my words.'), findsOneWidget);
      expect(find.text('The learner flagged this: This moment is described wrongly'), findsOneWidget);
      expect(find.text('Waiting for the Ally team\'s review'), findsNWidgets(2));
      expect(find.text('Kept after review: It fits.'), findsOneWidget);
      expect(find.text('Corrected after review: Reworded.'), findsOneWidget);
      expect(find.text('Removed after review'), findsOneWidget);
      // A flag with no reason still says it was flagged.
      expect(find.text('The learner flagged this:'), findsOneWidget);
    });

    testWidgets('a removed card is hidden, as on the web, with the removed note', (tester) async {
      stubSupervisor(
        supervisorJson(
          corrections: [
            {'section': 'what_worked[0]', 'outcome': 'removed', 'note': null, 'at': '2026-10-30T12:00:00Z'},
          ],
          flags: [
            {'section': 'what_worked[0]', 'reason': 'didnt_say', 'note': null, 'status': 'removed', 'resolutionNote': null},
          ],
        ),
      );
      await h.pump(tester, fromLogs: true);
      expect(find.text('You named the feeling.'), findsNothing);
      expect(find.text('You slowed down.'), findsOneWidget);
      expect(find.text('A point was removed after a review by the Ally team.'), findsOneWidget);
    });

    testWidgets('the learner\'s helpful answer and their thread with Ally', (tester) async {
      stubSupervisor(
        supervisorJson(
          helpful: true,
          thread: [
            {'role': 'learner', 'content': 'Why was that closed?', 'at': '2026-10-30T12:00:00Z'},
            {'role': 'ally', 'content': 'Because it asked for a yes or no.', 'at': '2026-10-30T12:00:05Z'},
          ],
        ),
      );
      await h.pump(tester, fromLogs: true);

      expect(find.text('The learner found this debrief helpful.'), findsOneWidget);
      final thread = find.byKey(const Key('supervisor-thread'));
      expect(
        find.descendant(of: find.byKey(const Key('debrief-card-reflective-question')), matching: thread),
        findsOneWidget,
      );
      expect(find.text('The learner\'s conversation with Ally'), findsOneWidget);
      expect(find.text('Why was that closed?'), findsOneWidget);
      expect(find.textContaining('yes or no', findRichText: true), findsOneWidget);
    });

    testWidgets('helpful no / unanswered, and no thread', (tester) async {
      stubSupervisor(supervisorJson(helpful: false));
      await h.pump(tester, fromLogs: true);
      expect(find.text('The learner found this debrief not helpful.'), findsOneWidget);
      expect(find.text('The learner didn\'t reply to Ally.'), findsOneWidget);
    });

    testWidgets('helpful unanswered', (tester) async {
      stubSupervisor(supervisorJson());
      await h.pump(tester, fromLogs: true);
      expect(find.text('The learner didn\'t say whether this debrief helped.'), findsOneWidget);
    });
  });

  testWidgets('read-only (Logs): no Ask Ally', (tester) async {
    stubSupervisor(supervisorJson());
    await h.pump(tester, fromLogs: true);
    expect(find.byKey(const Key('debrief-card-reflective-question')), findsOneWidget);
    expect(find.byKey(const Key('ask-ally')), findsNothing);
    expect(find.text('Your supervisor can read this conversation.'), findsNothing);
  });

  group('read-aloud', () {
    testWidgets('a failed audio request says so; the cards stay', (tester) async {
      stubDebrief(readyDebriefJson());
      when(() => h.learnerDebrief.getCardAudioUrl(any(), any())).thenThrow(Exception('502'));
      await h.pump(tester);

      await tapVisible(tester, find.byKey(const ValueKey('debrief-listen-reflective_question')));
      verify(() => h.learnerDebrief.getCardAudioUrl('session-1', 'reflective_question')).called(1);
      expect(find.text("Couldn't play the audio. You can still read it below."), findsOneWidget);
      expect(find.byKey(const Key('debrief-reading')), findsNothing);
      expect(find.text('What worked'), findsOneWidget);
    });

    testWidgets('Listen all reads every card in order, skips removed ones, highlights, and keeps the speed',
        (tester) async {
      final player = _FakeDebriefAudioPlayer();
      stubDebrief({
        ...readyDebriefJson(),
        'corrections': [
          {'section': 'what_worked[0]', 'outcome': 'removed', 'note': null, 'at': '2026-10-30T10:00:00Z'},
        ],
      });
      when(() => h.learnerDebrief.getCardAudioUrl('session-1', any()))
          .thenAnswer((invocation) async => 'https://audio/${invocation.positionalArguments[1]}');
      await h.pump(tester, overrides: [debriefAudioPlayerFactoryProvider.overrideWithValue(() => player)]);

      await tapVisible(tester, find.byKey(const ValueKey('debrief-listen-speed-1.25')));
      await tapVisible(tester, find.byKey(const Key('debrief-listen-all-play')));
      expect(player.played, ['https://audio/important_moment']);
      expect(player.rate, 1.25);
      expect(
        find.descendant(
          of: find.byKey(const Key('debrief-card-important-moment')),
          matching: find.byKey(const Key('debrief-reading')),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('debrief-listen-all-pause')), findsOneWidget);
      expect(find.byKey(const Key('debrief-listen-all-stop')), findsOneWidget);

      for (var i = 0; i < 6; i++) {
        player.finishClip();
        await tester.pumpAndSettle();
      }
      expect(player.played, [
        'https://audio/important_moment',
        'https://audio/opening',
        'https://audio/what_worked[1]',
        'https://audio/work_on_this[0]',
        'https://audio/practise_next',
        'https://audio/reflective_question',
      ]);
      // Done: back to "Listen all", nothing highlighted.
      expect(find.byKey(const Key('debrief-listen-all-play')), findsOneWidget);
      expect(find.byKey(const Key('debrief-reading')), findsNothing);
    });
  });

  group('opened (v9 FR-31)', () {
    testWidgets('sent once the ready cards have been on screen 2 s, not before, and once only', (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      await tester.pump(const Duration(milliseconds: 1500));
      verifyNever(() => h.learnerDebrief.markOpened(any()));

      await tester.pump(const Duration(milliseconds: 600));
      verify(() => h.learnerDebrief.markOpened('session-1')).called(1);

      // Rebuilds and a trip to the background and back never send it again.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, -300));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 5));
      verifyNever(() => h.learnerDebrief.markOpened(any()));
    });

    testWidgets('leaving the foreground restarts the 2 s', (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      await tester.pump(const Duration(milliseconds: 1500));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump(const Duration(seconds: 5));
      verifyNever(() => h.learnerDebrief.markOpened(any()));

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump(const Duration(milliseconds: 1500));
      verifyNever(() => h.learnerDebrief.markOpened(any()));
      await tester.pump(const Duration(milliseconds: 600));
      verify(() => h.learnerDebrief.markOpened('session-1')).called(1);
    });

    testWidgets('not sent while the debrief is still being written', (tester) async {
      stubDebrief({'state': 'working'});
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await h.pump(tester);
      await tester.pump(const Duration(seconds: 2));
      verifyNever(() => h.learnerDebrief.markOpened(any()));
    });

    testWidgets('not sent from Logs (read-only)', (tester) async {
      stubSupervisor(supervisorJson());
      await h.pump(tester, fromLogs: true);
      await tester.pump(const Duration(seconds: 5));
      verifyNever(() => h.learnerDebrief.markOpened(any()));
    });
  });

  group('DEBRIEF_READ XP', () {
    testWidgets('sent once the end of Work on this was on screen and 30 s have passed', (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      await tester.pump(const Duration(seconds: 10));

      // Scroll the last Work-on-this point into view.
      await tester.ensureVisible(find.byKey(const Key('debrief-try-saying')));
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.markRead(any()));

      await tester.pump(const Duration(seconds: 20));
      verify(() => h.learnerDebrief.markRead('session-1')).called(1);

      // Once only.
      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, 300));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('debrief-try-saying')));
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.markRead(any()));
    });

    testWidgets('not sent when the end was never on screen', (tester) async {
      stubDebrief(readyDebriefJson());
      await h.pump(tester);
      await tester.pump(const Duration(seconds: 31));
      verifyNever(() => h.learnerDebrief.markRead(any()));
    });
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

    group('working: the progress line', () {
      Future<void> expectLine(WidgetTester tester, Object? progress, String line) async {
        tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
        addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
        stubDebrief({
          'state': 'working',
          'steps': ['Looking at the hard moments…'],
          'progress': progress,
        });
        await h.pump(tester);
        expect(find.text('Ally is writing your debrief'), findsOneWidget);
        expect(find.text(line), findsOneWidget);
      }

      testWidgets('guidance with a topic', (tester) async {
        await expectLine(tester, {'key': 'guidance', 'topic': 'safety planning'}, 'Looking up guidance on safety planning…');
      });

      testWidgets('guidance without a topic', (tester) async {
        await expectLine(tester, {'key': 'guidance'}, 'Looking up guidance…');
      });

      testWidgets('revising, with its round', (tester) async {
        await expectLine(tester, {'key': 'revising', 'round': 2}, 'Making it clearer (round 2)…');
      });

      testWidgets('a plain key', (tester) async {
        await expectLine(tester, {'key': 'past_sessions'}, 'Looking at your past sessions…');
        expect(find.text('Looking at the hard moments…'), findsNothing);
      });

      testWidgets('an unknown key falls back to the latest step', (tester) async {
        await expectLine(tester, {'key': 'something_new'}, 'Looking at the hard moments…');
      });
    });

    testWidgets('ready while open is announced to screen readers; ready on arrival is not', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      final announcements = <String>[];
      tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, (
        message,
      ) async {
        final event = message as Map<Object?, Object?>;
        if (event['type'] == 'announce') announcements.add((event['data']! as Map<Object?, Object?>)['message']! as String);
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(SystemChannels.accessibility, null),
      );
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
        (_) async => LearnerDebriefView.fromJson(calls++ == 0 ? {'state': 'working'} : readyDebriefJson()),
      );
      await h.pump(tester);
      expect(announcements, isEmpty);

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('What worked'), findsOneWidget);
      expect(announcements, ['Your debrief is ready.']);

      // A re-read after "Was this helpful?" is ready → ready: said once only.
      when(() => h.learnerDebrief.setHelpful(any(), helpful: any(named: 'helpful'))).thenAnswer((_) async {});
      await tapVisible(tester, find.byKey(const Key('debrief-helpful-yes')));
      expect(announcements, ['Your debrief is ready.']);
    });

    testWidgets('on_its_way', (tester) async {
      stubDebrief({'state': 'on_its_way'});
      await h.pump(tester);
      expect(
        find.text(
          "Your debrief needs a little more care. Someone from the Ally team will finish it, usually within a day. We'll let you know.",
        ),
        findsOneWidget,
      );
      expect(find.text('from Ally'), findsNothing);
    });

    testWidgets('taking_longer shows Check again, which asks now (plan §7.5)', (tester) async {
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
        (_) async => LearnerDebriefView.fromJson(calls++ == 0 ? {'state': 'taking_longer'} : readyDebriefJson()),
      );
      await h.pump(tester);
      expect(find.byKey(const Key('debrief-taking-longer')), findsOneWidget);
      expect(find.text("This is taking longer than usual. I'll let you know when it's ready."), findsOneWidget);
      expect(tester.getSize(find.byKey(const Key('debrief-check-again'))).height, greaterThanOrEqualTo(44));

      await tapVisible(tester, find.byKey(const Key('debrief-check-again')));
      expect(calls, 2);
      expect(find.byKey(const Key('debrief-taking-longer')), findsNothing);
      expect(find.text('What worked'), findsOneWidget);
    });

    testWidgets('not_available after an emergency stop says so, not today\'s debrief (FR-46)', (tester) async {
      stubDebrief({'state': 'not_available', 'stopped': true});
      await h.pump(tester);
      expect(find.byKey(const Key('debrief-not-available')), findsOneWidget);
      expect(find.text("A debrief isn't available for this session."), findsOneWidget);
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

  group('learner events (experience metrics)', () {
    void stubPractiseNext() {
      final json = readyDebriefJson();
      final cards = json['cards'] as Map<String, dynamic>;
      stubDebrief({
        ...json,
        'cards': {
          ...cards,
          'practise_next': {...cards['practise_next'] as Map<String, dynamic>, 'scenario_id': 42},
        },
        'practice': [
          {'id': 42, 'title': 'Supporting a grieving parent'},
        ],
      });
    }

    void reduceMotion(WidgetTester tester) {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    }

    testWidgets('"Practise this next" sends practise_next_click once, however often it is tapped', (tester) async {
      stubPractiseNext();
      final router = await h.pump(tester);
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.practiseNextClick));

      await tapVisible(tester, find.byKey(const Key('debrief-practise-next')));
      expect(find.text('SIMULATION_DETAILS:42'), findsOneWidget);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.practiseNextClick)).called(1);

      router.pop();
      await tester.pumpAndSettle();
      await tapVisible(tester, find.byKey(const Key('debrief-practise-next')));
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.practiseNextClick));
    });

    testWidgets('"Practise this" on a Work-on-this point is not practise_next_click', (tester) async {
      final json = readyDebriefJson();
      final cards = json['cards'] as Map<String, dynamic>;
      stubDebrief({
        ...json,
        'cards': {
          ...cards,
          'work_on_this': [
            {...(cards['work_on_this'] as List).first as Map<String, dynamic>, 'scenario_id': 7},
          ],
        },
        'practice': [
          {'id': 7, 'title': 'Open questions'},
        ],
      });
      await h.pump(tester);
      await tapVisible(tester, find.byKey(const Key('debrief-practise-this')));
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.practiseNextClick));
    });

    testWidgets('working shows send waited once; leaving before ready sends left_before_ready', (tester) async {
      reduceMotion(tester);
      stubDebrief({'state': 'working'});
      final router = await h.pump(tester);
      expect(find.byKey(const Key('debrief-working')), findsOneWidget);
      // Polls rebuild the working state; waited still goes once.
      await tester.pump(const Duration(seconds: 7));
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.waited)).called(1);
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.leftBeforeReady));

      router.go('/home');
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.leftBeforeReady)).called(1);
    });

    testWidgets('the app going to the background while working sends left_before_ready once', (tester) async {
      reduceMotion(tester);
      stubDebrief({'state': 'working'});
      final router = await h.pump(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.leftBeforeReady));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.leftBeforeReady)).called(1);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      router.go('/home');
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.leftBeforeReady));
    });

    testWidgets('leaving once the debrief is ready is not left_before_ready', (tester) async {
      reduceMotion(tester);
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer(
        (_) async => LearnerDebriefView.fromJson(calls++ == 0 ? {'state': 'working'} : readyDebriefJson()),
      );
      final router = await h.pump(tester);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('What worked'), findsOneWidget);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.waited)).called(1);

      router.go('/home');
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.leftBeforeReady));
    });

    testWidgets('a ready debrief never sends waited or left_before_ready', (tester) async {
      stubDebrief(readyDebriefJson());
      final router = await h.pump(tester);
      router.go('/home');
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.waited));
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.leftBeforeReady));
    });

    testWidgets('read_through once the end of the FIRST Work-on-this point is on screen', (tester) async {
      final json = readyDebriefJson();
      final cards = json['cards'] as Map<String, dynamic>;
      final first = (cards['work_on_this'] as List).first as Map<String, dynamic>;
      stubDebrief({
        ...json,
        'cards': {
          ...cards,
          'work_on_this': [
            first,
            // Long, so its end (the read-XP marker) stays below the screen.
            {...first, 'lead': 'A second point.', 'why': 'Why it matters. ' * 120, 'try_saying': 'Something else to try.'},
          ],
        },
      });
      await h.pump(tester);
      await tester.pump(const Duration(seconds: 2));
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.readThrough));

      // The first point's last line in view; no minimum time, unlike read XP.
      await tester.ensureVisible(find.byKey(const Key('debrief-flag-work_on_this[0]')));
      await tester.pumpAndSettle();
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.readThrough)).called(1);
      verifyNever(() => h.learnerDebrief.markRead(any()));

      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, 400));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('debrief-flag-work_on_this[0]')));
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.recordEvent(any(), DebriefLearnerEvent.readThrough));
    });

    testWidgets('failing event calls never throw or show anything', (tester) async {
      reduceMotion(tester);
      when(() => h.learnerDebrief.recordEvent(any(), any())).thenThrow(Exception('404'));
      var calls = 0;
      when(() => h.learnerDebrief.getDebrief('session-1')).thenAnswer((_) async {
        final json = readyDebriefJson();
        final cards = json['cards'] as Map<String, dynamic>;
        return LearnerDebriefView.fromJson(
          calls++ == 0
              ? {'state': 'working'}
              : {
                  ...json,
                  'cards': {
                    ...cards,
                    'practise_next': {...cards['practise_next'] as Map<String, dynamic>, 'scenario_id': 42},
                  },
                  'practice': [
                    {'id': 42, 'title': 'Supporting a grieving parent'},
                  ],
                },
        );
      });
      await h.pump(tester);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('What worked'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('debrief-flag-work_on_this[0]')));
      await tester.pumpAndSettle();
      await tapVisible(tester, find.byKey(const Key('debrief-practise-next')));
      expect(tester.takeException(), isNull);
      expect(find.text('SIMULATION_DETAILS:42'), findsOneWidget);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.waited)).called(1);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.readThrough)).called(1);
      verify(() => h.learnerDebrief.recordEvent('session-1', DebriefLearnerEvent.practiseNextClick)).called(1);
    });

    testWidgets('from Logs (supervisor) nothing is sent', (tester) async {
      stubSupervisor(supervisorJson());
      final router = await h.pump(tester, fromLogs: true);
      await tester.drag(find.byKey(const Key('debrief-cards')), const Offset(0, -2000));
      await tester.pumpAndSettle();
      router.go('/home');
      await tester.pumpAndSettle();
      verifyNever(() => h.learnerDebrief.recordEvent(any(), any()));
    });
  });
}

DioException _dioError(int status) => DioException(
  requestOptions: RequestOptions(path: '/debriefs/sessions/session-1'),
  type: DioExceptionType.badResponse,
  response: Response(requestOptions: RequestOptions(path: '/debriefs/sessions/session-1'), statusCode: status),
);
