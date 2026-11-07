import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/quiz_answer_state.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_question_widget.dart';

import '../../../../support/pump_app.dart';

/// Holds the answer state like the quiz player does, so each widget is
/// driven as a controlled component (RN `state` / `onChange`).
class _Harness extends StatefulWidget {
  const _Harness({super.key, required this.question, required this.onState});

  final SanitizedQuizQuestion question;
  final ValueChanged<QuizAnswerState> onState;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  late QuizAnswerState _state = initialAnswerState(widget.question);

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SingleChildScrollView(
      child: QuizQuestionWidget(
        question: widget.question,
        state: _state,
        onChanged: (next) {
          setState(() => _state = next);
          widget.onState(next);
        },
      ),
    ),
  );
}

/// One `testWidgets` (see `pump_app.dart`: translations only resolve in the
/// first pump of a file), every RN widget type in turn.
void main() {
  testWidgets('QuizQuestionWidget answers every question type like the RN widgets', (tester) async {
    QuizAnswerState? state;
    Future<void> pumpQ(Map<String, dynamic> json) async {
      state = null;
      final q = SanitizedQuizQuestion.fromJson(json);
      await pumpApp(tester, _Harness(key: UniqueKey(), question: q, onState: (s) => state = s));
    }

    // mcq_single: "SELECT ONE" hint, tap selects one.
    final mcq = {
      'id': 'q1',
      'type': 'mcq_single',
      'prompt': 'Pick',
      'options': [
        {'id': 'a', 'text': 'Option A'},
        {'id': 'b', 'text': 'Option B'},
      ],
    };
    await pumpQ(mcq);
    expect(find.text('SELECT ONE'), findsOneWidget);
    await tester.tap(find.byKey(const Key('mcq-option-b')));
    await tester.pump();
    expect(state?.selectedOptionIds, ['b']);
    expect(toAnswerInput(SanitizedQuizQuestion.fromJson(mcq), state!).toJson(), {
      'questionId': 'q1',
      'selectedOptionIds': ['b'],
    });

    // mcq_multi: toggles.
    await pumpQ({...mcq, 'type': 'mcq_multi'});
    expect(find.text('SELECT ALL THAT APPLY'), findsOneWidget);
    await tester.tap(find.byKey(const Key('mcq-option-a')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('mcq-option-b')));
    await tester.pump();
    expect(state?.selectedOptionIds, ['a', 'b']);
    await tester.tap(find.byKey(const Key('mcq-option-a')));
    await tester.pump();
    expect(state?.selectedOptionIds, ['b']);

    // true_false: two cards.
    await pumpQ({'id': 'q2', 'type': 'true_false', 'prompt': 'T?'});
    await tester.tap(find.byKey(const Key('true-false-false')));
    await tester.pump();
    expect(state?.booleanAnswer, false);

    // ordering: up/down buttons; the first row's Up is a no-op.
    await pumpQ({
      'id': 'q3',
      'type': 'ordering',
      'prompt': 'Order',
      'items': [
        {'id': 'x', 'text': 'First'},
        {'id': 'y', 'text': 'Second'},
      ],
    });
    expect(find.text('PUT THESE IN ORDER'), findsOneWidget);
    await tester.tap(find.byKey(const Key('ordering-up-x')));
    await tester.pump();
    expect(state, isNull);
    await tester.tap(find.byKey(const Key('ordering-down-x')));
    await tester.pump();
    expect(state?.orderedItemIds, ['y', 'x']);

    // matching: tap left then right pairs them; tapping the pair breaks it.
    await pumpQ({
      'id': 'q4',
      'type': 'matching',
      'prompt': 'Match',
      'left': [
        {'id': 'l1', 'text': 'Left 1'},
      ],
      'right': [
        {'id': 'r1', 'text': 'Right 1'},
        {'id': 'r2', 'text': 'Right 2'},
      ],
    });
    await tester.tap(find.byKey(const Key('matching-left-l1')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('matching-right-r2')));
    await tester.pump();
    expect(state?.pairs, [(leftId: 'l1', rightId: 'r2')]);
    await tester.tap(find.byKey(const Key('matching-right-r2')));
    await tester.pump();
    expect(state?.pairs, isEmpty);

    // fill_blank: template text plus one numbered input per blank.
    final fill = {
      'id': 'q5',
      'type': 'fill_blank',
      'prompt': 'Fill',
      'template': 'The sky is {{b1}} today',
      'blankIds': ['b1'],
    };
    await pumpQ(fill);
    expect(find.text('1.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('fill-blank-input-b1')), 'blue');
    await tester.pump();
    expect(state?.blanks, {'b1': 'blue'});
    expect(isQuizQuestionAnswered(SanitizedQuizQuestion.fromJson(fill), state!), isTrue);

    // open_ended: AI-graded hint and live word count against the minimum.
    await pumpQ({'id': 'q6', 'type': 'open_ended', 'prompt': 'Explain', 'minWords': 3});
    expect(find.text('This answer is graded by AI'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('open-ended-input')), 'one two');
    await tester.pump();
    expect(state?.text, 'one two');
    expect(find.text('2/3 words'), findsOneWidget);

    // likert: one pill row per statement; answered once every row is rated.
    final likert = {
      'id': 'q7',
      'type': 'likert_scale',
      'prompt': 'Rate',
      'graded': false,
      'statements': [
        {'id': 's1', 'text': 'I listen'},
        {'id': 's2', 'text': 'I reflect'},
      ],
      'scale': [
        {'id': 'p1', 'text': 'Never'},
        {'id': 'p2', 'text': 'Always'},
      ],
    };
    await pumpQ(likert);
    await tester.tap(find.byKey(const Key('likert-option-s1-p2')));
    await tester.pump();
    expect(isQuizQuestionAnswered(SanitizedQuizQuestion.fromJson(likert), state!), isFalse);
    await tester.tap(find.byKey(const Key('likert-option-s2-p1')));
    await tester.pump();
    expect(state?.ratings, {'s1': 'p2', 's2': 'p1'});
    expect(isQuizQuestionAnswered(SanitizedQuizQuestion.fromJson(likert), state!), isTrue);
  });

  test('splitFillBlankTemplate and the matching reducer mirror RN quizHelpers', () {
    final segments = splitFillBlankTemplate('A {{ one }} B {{two}}');
    expect(segments.map((s) => s.blankId), [null, 'one', null, 'two', null]);
    var pairs = applyMatchSelection(const [], 'l1', 'r1');
    pairs = applyMatchSelection(pairs, 'l2', 'r1');
    expect(pairs, [(leftId: 'l2', rightId: 'r1')]);
    expect(breakMatch(pairs, leftId: 'l2'), isEmpty);
    expect(quizWordCount('  a  b c '), 3);
  });
}
