import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/quiz/quiz_question_widget.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/video/video_interjection_dialog.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

SanitizedQuizQuestion _trueFalseQuestion() => SanitizedQuizQuestion(
      id: 'q1',
      type: QuizQuestionType.trueFalse,
      prompt: 'The sky is blue?',
      points: 1,
      graded: true,
      options: null,
      items: null,
      left: null,
      right: null,
      template: null,
      blankIds: null,
      minWords: null,
      statements: null,
      scale: null,
    );

void main() {
  late MockCoursesRepository repository;

  setUpAll(() {
    registerFallbackValue(QuizAnswerInput(questionId: 'fallback'));
  });

  setUp(() {
    repository = MockCoursesRepository();
  });

  Future<void> pump(WidgetTester tester, VideoInterjection interjection) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: ElevatedButton(
                  onPressed: () => showDialog<bool>(
                    context: context,
                    builder: (_) => VideoInterjectionDialog(itemId: 'item1', interjection: interjection),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  VideoInterjection interjection() => VideoInterjection(
        id: 'i1',
        timestampSeconds: 5,
        question: _trueFalseQuestion(),
        answeredPassed: null,
      );

  testWidgets('renders the question via QuizQuestionWidget', (tester) async {
    await pump(tester, interjection());

    expect(find.byType(QuizQuestionWidget), findsOneWidget);
    expect(find.text('The sky is blue?'), findsOneWidget);
  });

  testWidgets('submit is disabled until an answer is chosen', (tester) async {
    await pump(tester, interjection());

    FilledButton submitButton() => tester.widget<FilledButton>(find.byType(FilledButton));
    expect(submitButton().onPressed, isNull);

    await tester.tap(find.text('courses.quiz.question.true'));
    await tester.pump();

    expect(submitButton().onPressed, isNotNull);
  });

  testWidgets('submitting shows pass/fail feedback and a Continue button', (tester) async {
    when(() => repository.submitInterjectionAnswer(
          itemId: 'item1',
          interjectionId: 'i1',
          answer: any(named: 'answer'),
        )).thenAnswer((_) async => (correct: true, pointsAwarded: 1, pointsPossible: 1));

    await pump(tester, interjection());

    await tester.tap(find.text('courses.quiz.question.true'));
    await tester.pump();
    await tester.tap(find.text('courses.video.interjection.submit'));
    await tester.pumpAndSettle();

    verify(() => repository.submitInterjectionAnswer(
          itemId: 'item1',
          interjectionId: 'i1',
          answer: any(named: 'answer'),
        )).called(1);

    // `_ResultBanner` interpolates status/points into one translated string
    // (`courses.quiz.question.resultBanner`); without a loaded translation
    // table, `ref.t()` falls back to that raw key as a whole rather than
    // substituting — so the raw key itself is the right signal that the
    // result banner rendered.
    expect(find.text('courses.quiz.question.resultBanner'), findsOneWidget);
    expect(find.text('courses.video.interjection.continue'), findsOneWidget);
    // Submit is replaced by Continue once a result is shown.
    expect(find.text('courses.video.interjection.submit'), findsNothing);
  });

  testWidgets('Continue closes the dialog', (tester) async {
    when(() => repository.submitInterjectionAnswer(
          itemId: 'item1',
          interjectionId: 'i1',
          answer: any(named: 'answer'),
        )).thenAnswer((_) async => (correct: false, pointsAwarded: 0, pointsPossible: 1));

    await pump(tester, interjection());

    await tester.tap(find.text('courses.quiz.question.false'));
    await tester.pump();
    await tester.tap(find.text('courses.video.interjection.submit'));
    await tester.pumpAndSettle();

    expect(find.byType(VideoInterjectionDialog), findsOneWidget);

    await tester.tap(find.text('courses.video.interjection.continue'));
    await tester.pumpAndSettle();

    expect(find.byType(VideoInterjectionDialog), findsNothing);
  });
}
