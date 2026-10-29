import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/presentation/course_button.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/journal/journal_player.dart';

import '../../../../support/pump_app.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

StartItemPayload _payload({
  required List<JournalPrompt> prompts,
  List<JournalSavedResponse> saved = const [],
}) => StartItemPayload(
  trackItemProgressId: 'p1',
  type: 'JOURNAL',
  journalPrompts: prompts,
  journalSavedResponses: saved,
);

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    when(
      () => repository.saveJournalDraft(
        itemId: any(named: 'itemId'),
        responses: any(named: 'responses'),
      ),
    ).thenAnswer((_) async {});
    when(() => repository.submitJournal(any())).thenAnswer(
      (_) async => TrackItemCompletionResult(
        completed: true,
        sectionCompleted: false,
        trackCompleted: false,
      ),
    );
  });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await pumpApp(
      tester,
      Scaffold(body: child),
      overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
    );
  }

  final prompts = [
    JournalPrompt(
      id: 'p1',
      prompt: 'What went well today?',
      required: true,
      placeholder: null,
    ),
    JournalPrompt(
      id: 'p2',
      prompt: 'Anything optional?',
      required: false,
      placeholder: null,
    ),
  ];

  testWidgets('renders one card per prompt', (tester) async {
    await pump(
      tester,
      JournalPlayer(
        payload: _payload(prompts: prompts),
        itemId: 'item1',
        alreadyCompleted: false,
        onCompleted: (_) {},
      ),
    );

    // Prompt text renders via a bare `RichText` (not `Text`/`Text.rich`), so
    // `find.text()` needs `findRichText: true` to see it at all. The
    // required prompt also appends a "(Required)" marker as a second
    // `TextSpan` in the same run, so its plain text is the prompt plus that
    // suffix rather than an exact match.
    expect(
      find.textContaining('What went well today?', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Anything optional?', findRichText: true), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(2));
  });

  testWidgets('submit is disabled until every required prompt has text', (
    tester,
  ) async {
    await pump(
      tester,
      JournalPlayer(
        payload: _payload(prompts: prompts),
        itemId: 'item1',
        alreadyCompleted: false,
        onCompleted: (_) {},
      ),
    );

    CourseButton submitButton() =>
        tester.widget<CourseButton>(find.byType(CourseButton));

    // Only the required prompt is missing text — Submit stays disabled.
    expect(submitButton().isDisabled, isTrue);

    await tester.enterText(find.byType(TextField).first, 'Learned a lot');
    await tester.pump();

    expect(submitButton().isDisabled, isFalse);
  });

  testWidgets('debounced autosave persists the draft after the delay', (
    tester,
  ) async {
    await pump(
      tester,
      JournalPlayer(
        payload: _payload(prompts: prompts),
        itemId: 'item1',
        alreadyCompleted: false,
        onCompleted: (_) {},
      ),
    );

    await tester.enterText(find.byType(TextField).first, 'Learned a lot');
    await tester.pump();

    verifyNever(
      () => repository.saveJournalDraft(
        itemId: any(named: 'itemId'),
        responses: any(named: 'responses'),
      ),
    );

    // The debounce delay is 1 second (`_autosaveDelay` in journal_player.dart).
    await tester.pump(const Duration(seconds: 1));

    verify(
      () => repository.saveJournalDraft(
        itemId: 'item1',
        responses: any(named: 'responses'),
      ),
    ).called(1);
  });

  testWidgets(
    'submit persists the draft, submits, and shows the submitted state',
    (tester) async {
      var completedCalled = false;
      await pump(
        tester,
        JournalPlayer(
          payload: _payload(prompts: prompts),
          itemId: 'item1',
          alreadyCompleted: false,
          onCompleted: (_) => completedCalled = true,
        ),
      );

      await tester.enterText(find.byType(TextField).first, 'Learned a lot');
      await tester.pump();

      await tester.tap(find.byType(CourseButton));
      await tester.pumpAndSettle();

      verify(() => repository.submitJournal('item1')).called(1);
      expect(completedCalled, isTrue);
      // Submitted state: no Submit button, fields disabled.
      expect(find.byType(CourseButton), findsNothing);
      final field = tester.widget<TextField>(find.byType(TextField).first);
      expect(field.enabled, isFalse);
    },
  );

  testWidgets(
    'already-completed initial state disables fields and hides Submit',
    (tester) async {
      await pump(
        tester,
        JournalPlayer(
          payload: _payload(
            prompts: prompts,
            saved: [
              JournalSavedResponse(
                promptId: 'p1',
                response: 'Already answered',
              ),
            ],
          ),
          itemId: 'item1',
          alreadyCompleted: true,
          onCompleted: (_) {},
        ),
      );

      expect(find.byType(CourseButton), findsNothing);
      final field = tester.widget<TextField>(find.byType(TextField).first);
      expect(field.enabled, isFalse);
      expect(field.controller?.text, 'Already answered');
    },
  );
}
