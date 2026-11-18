import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/courses/data/quiz_answer_state.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_question_widget.dart';

import '../../../../support/pump_app.dart';

/// A true/false question's two answers follow the language the *course* is
/// read in, not the app's UI language: the prompt arrives translated, so an
/// English app showing a Marathi quiz must still offer "खरे / खोटे" rather
/// than "True / False" under a prompt that ends in "…बरोबर?".
void main() {
  testWidgets('true/false labels follow the course language, not the UI language', (tester) async {
    final question = SanitizedQuizQuestion.fromJson({
      'id': 'q1',
      'type': 'true_false',
      'prompt': 'बहुतेक फक्त विकेंडलाच पिता, बरोबर?',
    });

    // UI language is the default (English) — pumpApp seeds empty prefs.
    await pumpApp(
      tester,
      Scaffold(
        body: QuizQuestionWidget(
          question: question,
          state: initialAnswerState(question),
          onChanged: (_) {},
          languageCode: 'mr',
        ),
      ),
    );

    // The course bundle loads through `rootBundle` after the UI bundle;
    // `pumpApp`'s default drain is tuned for the UI bundle alone.
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
    await tester.pumpAndSettle();

    expect(find.text('खरे'), findsOneWidget);
    expect(find.text('खोटे'), findsOneWidget);
    expect(find.text('True'), findsNothing);
  });
}
