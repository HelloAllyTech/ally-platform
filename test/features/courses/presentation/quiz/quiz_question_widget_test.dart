// Asserting `radio.onChanged == null` below (to confirm input is locked once
// a result is shown) touches the same deprecated RadioListTile API the
// widget under test itself ignores at its own file level (see its header
// comment) — same reasoning applies here.
// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_question_widget.dart';

import '../../../../support/pump_app.dart';

/// All scenarios live inside a single `testWidgets` body (instead of one
/// `testWidgets` per scenario) quite deliberately: `pumpApp` resolves
/// bundled translations via a real asset read (see its doc comment), and
/// that real read only reliably completes within the `testWidgets` call
/// that first triggers it — a *second* `testWidgets` in the same test
/// file never observes its `localizationControllerProvider` resolve
/// (silently falls back to raw translation keys), even though re-pumping
/// fresh widgets repeatedly *within* one `testWidgets` works fine. This
/// is a property of the shared `test/support/pump_app.dart` harness
/// (out of scope to change here), not of these widgets — so every
/// scenario below pumps its own fresh widget via `pumpApp`, but all
/// share one `testWidgets` call to stay on the side of that boundary
/// that actually resolves translated text.
///
/// Covers mcq_single, mcq_multi, true_false, fill_blank, ordering and
/// open_ended — driven via realistic taps/text entry per
/// `_buildControl`'s branch for each type. `matching` (dropdown-per-row)
/// and `likert_scale` (a Radio group per statement, re-keyed per row) are
/// skipped: both are reachable the same way as the others structurally,
/// but their controls are built with no stable keys across repeated rows,
/// which makes them comparatively awkward/brittle to target reliably via
/// `WidgetTester` versus the coverage already proven on the other 6 types.
void main() {
  testWidgets('QuizQuestionWidget renders and answers every covered question type', (tester) async {
    // --- mcq_single ---
    final mcqSingle = SanitizedQuizQuestion.fromJson({
      'id': 'q-1',
      'type': 'mcq_single',
      'prompt': 'Pick one',
      'options': [
        {'id': 'a', 'text': 'Option A'},
        {'id': 'b', 'text': 'Option B'},
      ],
    });

    QuizAnswerInput? received;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('mcqSingle'), question: mcqSingle, onChanged: (a) => received = a),
    );
    await tester.tap(find.text('Option B'));
    await tester.pumpAndSettle();
    expect(received?.toJson(), {
      'questionId': 'q-1',
      'selectedOptionIds': ['b'],
    });

    // Tapping a second option replaces the selection (single-select).
    await tester.tap(find.text('Option A'));
    await tester.pumpAndSettle();
    expect(received?.toJson(), {
      'questionId': 'q-1',
      'selectedOptionIds': ['a'],
    });

    // --- mcq_multi ---
    final mcqMulti = SanitizedQuizQuestion.fromJson({
      'id': 'q-2',
      'type': 'mcq_multi',
      'prompt': 'Pick all that apply',
      'options': [
        {'id': 'a', 'text': 'Option A'},
        {'id': 'b', 'text': 'Option B'},
      ],
    });

    received = null;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('mcqMulti'), question: mcqMulti, onChanged: (a) => received = a),
    );
    await tester.tap(find.text('Option A'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Option B'));
    await tester.pumpAndSettle();
    expect(received!.selectedOptionIds, unorderedEquals(['a', 'b']));

    // Unchecking removes it again.
    await tester.tap(find.text('Option A'));
    await tester.pumpAndSettle();
    expect(received!.selectedOptionIds, ['b']);

    // --- true_false ---
    final trueFalse = SanitizedQuizQuestion.fromJson({
      'id': 'q-3',
      'type': 'true_false',
      'prompt': 'Is this true?',
    });

    received = null;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('trueFalse'), question: trueFalse, onChanged: (a) => received = a),
    );
    await tester.tap(find.text('True'));
    await tester.pumpAndSettle();
    expect(received?.toJson(), {'questionId': 'q-3', 'booleanAnswer': true});

    await tester.tap(find.text('False'));
    await tester.pumpAndSettle();
    expect(received?.toJson(), {'questionId': 'q-3', 'booleanAnswer': false});

    // --- fill_blank ---
    final fillBlank = SanitizedQuizQuestion.fromJson({
      'id': 'q-4',
      'type': 'fill_blank',
      'prompt': 'Fill it in',
      'template': 'The sky is {{b1}} today.',
      'blankIds': ['b1'],
    });

    received = null;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('fillBlank'), question: fillBlank, onChanged: (a) => received = a),
    );
    await tester.enterText(find.byType(TextField), 'blue');
    await tester.pumpAndSettle();
    expect(received?.toJson(), {
      'questionId': 'q-4',
      'blanks': [
        {'blankId': 'b1', 'answer': 'blue'},
      ],
    });

    // --- ordering ---
    final ordering = SanitizedQuizQuestion.fromJson({
      'id': 'q-5',
      'type': 'ordering',
      'prompt': 'Put these in order',
      'items': [
        {'id': 'i1', 'text': 'First'},
        {'id': 'i2', 'text': 'Second'},
        {'id': 'i3', 'text': 'Third'},
      ],
    });

    received = null;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('ordering'), question: ordering, onChanged: (a) => received = a),
    );
    // Move the first item down: new order is i2, i1, i3.
    await tester.tap(find.byIcon(Icons.keyboard_arrow_down).first);
    await tester.pumpAndSettle();
    expect(received?.toJson(), {
      'questionId': 'q-5',
      'orderedItemIds': ['i2', 'i1', 'i3'],
    });
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);

    // Move it back up: order returns to i1, i2, i3.
    await tester.tap(find.byIcon(Icons.keyboard_arrow_up).at(1));
    await tester.pumpAndSettle();
    expect(received?.toJson(), {
      'questionId': 'q-5',
      'orderedItemIds': ['i1', 'i2', 'i3'],
    });

    // --- open_ended ---
    final openEnded = SanitizedQuizQuestion.fromJson({
      'id': 'q-6',
      'type': 'open_ended',
      'prompt': 'Describe your feelings',
      'minWords': 10,
    });

    received = null;
    await pumpApp(
      tester,
      QuizQuestionWidget(key: const ValueKey('openEnded'), question: openEnded, onChanged: (a) => received = a),
    );
    await tester.enterText(find.byType(TextField), 'I feel calm today');
    await tester.pumpAndSettle();
    expect(received?.toJson(), {'questionId': 'q-6', 'text': 'I feel calm today'});

    // --- showResult banner: correct / incorrect / pending grading ---
    final resultQuestion = SanitizedQuizQuestion.fromJson({
      'id': 'q-7',
      'type': 'mcq_single',
      'prompt': 'Pick one',
      'options': [
        {'id': 'a', 'text': 'Option A'},
      ],
    });

    await pumpApp(
      tester,
      QuizQuestionWidget(
        key: const ValueKey('resultQuestion'),
        question: resultQuestion,
        onChanged: (_) {},
        showResult: QuizQuestionResult.fromJson({
          'questionId': 'q-7',
          'correct': true,
          'pointsAwarded': 5,
          'pointsPossible': 5,
          'explanation': 'Great job',
        }),
      ),
    );
    expect(find.text('Great job'), findsOneWidget);
    expect(find.text('Correct — 5/5 pts'), findsOneWidget);
    var radio = tester.widget<RadioListTile<String>>(find.byType(RadioListTile<String>));
    expect(radio.onChanged, isNull, reason: 'input must be locked once a result is shown');

    await pumpApp(
      tester,
      QuizQuestionWidget(
        key: const ValueKey('resultQuestion'),
        question: resultQuestion,
        onChanged: (_) {},
        showResult: QuizQuestionResult.fromJson({
          'questionId': 'q-7',
          'correct': false,
          'pointsAwarded': 0,
          'pointsPossible': 5,
        }),
      ),
    );
    expect(find.text('Incorrect — 0/5 pts'), findsOneWidget);
    radio = tester.widget<RadioListTile<String>>(find.byType(RadioListTile<String>));
    expect(radio.onChanged, isNull);

    await pumpApp(
      tester,
      QuizQuestionWidget(
        key: const ValueKey('resultQuestion'),
        question: resultQuestion,
        onChanged: (_) {},
        showResult: QuizQuestionResult.fromJson({
          'questionId': 'q-7',
          'pointsAwarded': 0,
          'pointsPossible': 5,
        }),
      ),
    );
    expect(find.text('Grading in progress — 0/5 pts'), findsOneWidget);
    radio = tester.widget<RadioListTile<String>>(find.byType(RadioListTile<String>));
    expect(radio.onChanged, isNull);
  });
}
