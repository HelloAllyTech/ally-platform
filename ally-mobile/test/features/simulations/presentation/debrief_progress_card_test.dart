import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/data/learner_debrief_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/feedback/debrief_cards.dart';

import '../../../support/fake_translations.dart';

/// Progress contract §4: the learner's "Your last {n} sessions" card (web
/// `DebriefProgressCard`).
const _card = {
  'sessions': 5,
  'skills': [
    {'skill': 'empathy', 'trend': 'more_consistent', 'line': 'You named the feeling in 4 of 5 sessions.'},
    {'skill': 'open_questions', 'trend': 'about_the_same', 'line': 'About half your questions were open.'},
    {'skill': 'harm', 'trend': 'too_early', 'line': 'It came up in only 2 sessions.'},
  ],
  'focus': {'skill': 'harm', 'line': 'Ask about safety directly.'},
};

Future<void> _pump(WidgetTester tester, Object? raw) async {
  final cards = DebriefCardsData.fromJson({'opening': 'Hi', 'reflective_question': '', 'progress_card': raw});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [fixedTranslationsOverride()],
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: cards.progressCard == null
                ? const SizedBox.shrink()
                : DebriefProgressCardView(card: cards.progressCard!),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final _toggle = find.byKey(const Key('debrief-progress-toggle'));

void main() {
  testWidgets('renders nothing when the debrief has no progress card', (tester) async {
    await _pump(tester, null);
    expect(find.byKey(const Key('debrief-card-progress')), findsNothing);
  });

  testWidgets('collapsed by default: the title and the focus line', (tester) async {
    await _pump(tester, _card);
    expect(find.text('Your last 5 sessions'), findsOneWidget);
    expect(find.text('One focus for your next sessions: Ask about safety'), findsOneWidget);
    expect(find.text('Ask about safety directly.'), findsOneWidget);
    expect(find.text('Show more'), findsOneWidget);
    expect(find.text('Getting more consistent'), findsNothing);
    expect(tester.getSemantics(_toggle), isSemantics(isButton: true, hasExpandedState: true, isExpanded: false));
  });

  testWidgets('expands to every skill with its trend word, and collapses again', (tester) async {
    await _pump(tester, _card);
    await tester.tap(_toggle);
    await tester.pumpAndSettle();

    expect(find.text('Show less'), findsOneWidget);
    expect(tester.getSemantics(_toggle), isSemantics(isButton: true, hasExpandedState: true, isExpanded: true));
    // Known skills use the app's own names; unknown keys are made readable.
    expect(find.text('Show empathy'), findsOneWidget);
    expect(find.text('Getting more consistent'), findsOneWidget);
    expect(find.text('You named the feeling in 4 of 5 sessions.'), findsOneWidget);
    expect(find.text('Open questions'), findsOneWidget);
    expect(find.text('About the same'), findsOneWidget);
    expect(find.text('Too early to tell'), findsOneWidget);

    await tester.tap(_toggle);
    await tester.pumpAndSettle();
    expect(find.text('Show more'), findsOneWidget);
    expect(find.text('Getting more consistent'), findsNothing);
  });

  testWidgets('with no focus, the first skill line is the preview', (tester) async {
    await _pump(tester, {..._card, 'focus': null});
    expect(find.byKey(const Key('debrief-progress-focus')), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const Key('debrief-progress-preview')),
        matching: find.text('You named the feeling in 4 of 5 sessions.'),
      ),
      findsOneWidget,
    );
  });

  test('a malformed card parses to nothing; malformed skills are dropped', () {
    for (final raw in <Object?>[
      'card',
      const <Object>[],
      {'skills': _card['skills'], 'focus': _card['focus']},
      {'sessions': '5', 'skills': _card['skills']},
      {'sessions': 5, 'skills': 'lots', 'focus': 'harm'},
      {
        'sessions': 5,
        'skills': [
          {'skill': 'empathy', 'trend': 'better', 'line': 'x'},
        ],
      },
      {
        'sessions': 5,
        'skills': [
          {'skill': 'empathy', 'trend': 'about_the_same', 'line': ' '},
        ],
        'focus': <String, Object>{},
      },
    ]) {
      expect(DebriefProgressCard.parse(raw), isNull, reason: '$raw');
    }

    final card = DebriefProgressCard.parse({
      'sessions': 6,
      'skills': [
        null,
        {'skill': 'empathy', 'trend': 'worth_another_look', 'line': 'Try naming it.'},
        {'skill': 'hope', 'trend': 'nope', 'line': 'x'},
      ],
      'focus': {'skill': 'hope'},
    })!;
    expect(card.sessions, 6);
    expect(card.skills.single.skill, 'empathy');
    expect(card.skills.single.trend, DebriefProgressTrend.worthAnotherLook);
    expect(card.focus, isNull);
  });
}
