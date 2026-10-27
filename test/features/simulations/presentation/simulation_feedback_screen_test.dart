import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/root_scaffold_messenger.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_feedback_screen.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockSimulationTranscriptRepository extends Mock
    implements SimulationTranscriptRepository {}

void main() {
  late MockSimulationsRepository repository;
  late MockSimulationTranscriptRepository transcriptRepository;

  setUp(() {
    repository = MockSimulationsRepository();
    transcriptRepository = MockSimulationTranscriptRepository();
    // The Transcript tab's content is built eagerly by `TabBarView` even
    // while the Debrief tab is the one showing, so it always needs a stub.
    when(
      () => transcriptRepository.getMessages(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        offset: any(named: 'offset'),
      ),
    ).thenAnswer(
      (_) async => (messages: <SimulationTranscriptMessage>[], count: 0),
    );
  });

  Future<void> pumpScreen(WidgetTester tester) => pumpApp(
    tester,
    const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
    overrides: [
      fixedTranslationsOverride(),
      simulationsRepositoryProvider.overrideWithValue(repository),
      simulationTranscriptRepositoryProvider.overrideWithValue(
        transcriptRepository,
      ),
    ],
  );

  /// `pumpApp`'s own `MaterialApp` doesn't wire `scaffoldMessengerKey:
  /// rootScaffoldMessengerKey` (nothing else needed it to), so
  /// `rootScaffoldMessengerKey.currentState` is null under it and the
  /// screen's `showSnackBar` calls silently no-op. Build the same shape
  /// locally with that key attached, for the two tests that actually need
  /// to observe a snackbar.
  Future<void> pumpScreenWithToasts(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          fixedTranslationsOverride(),
          simulationsRepositoryProvider.overrideWithValue(repository),
          simulationTranscriptRepositoryProvider.overrideWithValue(
            transcriptRepository,
          ),
        ],
        child: MaterialApp(
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows both the Debrief and Transcript tabs', (tester) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    await pumpScreen(tester);

    expect(find.text('Debrief'), findsOneWidget);
    expect(find.text('Transcript'), findsOneWidget);
  });

  testWidgets(
    'renders the AI debrief summary (score, duration, well/improve lists)',
    (tester) async {
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'score': 87,
          'startedAt': '2026-01-01T10:00:00.000Z',
          'endedAt': '2026-01-01T10:20:00.000Z',
          'whatWentWell': ['Good pacing'],
          'areasForImprovement': ['Ask more open questions'],
        }),
      );

      await pumpScreen(tester);

      expect(find.text('87'), findsOneWidget);
      expect(find.text('20 min session'), findsOneWidget);
      expect(find.text('Good pacing'), findsOneWidget);
      expect(find.text('Ask more open questions'), findsOneWidget);
    },
  );

  testWidgets('requires a rating before submitting', (tester) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(AppButton, 'Submit'));
    await tester.pumpAndSettle();

    expect(find.text('Please select a rating.'), findsOneWidget);
    verifyNever(
      () => repository.addSimulationFeedback(
        scenarioSessionId: any(named: 'scenarioSessionId'),
        rating: any(named: 'rating'),
        comment: any(named: 'comment'),
      ),
    );
  });

  testWidgets(
    'submitting a rating and comment calls addSimulationFeedback and shows the thanks state',
    (tester) async {
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'startedAt': '2026-01-01T10:00:00.000Z',
        }),
      );
      when(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: 'Really helpful session',
          tags: <String>[],
        ),
      ).thenAnswer((_) async {});

      await pumpScreen(tester);

      // 5 star IconButtons rendered left-to-right for ratings 1..5 — tap the
      // 4th to select a rating of 4.
      final starButtons = find.byIcon(Icons.star_border);
      await tester.tap(starButtons.at(3));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Really helpful session');
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      verify(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: 'Really helpful session',
          tags: <String>[],
        ),
      ).called(1);
      expect(find.text('Feedback submitted successfully'), findsOneWidget);
    },
  );

  testWidgets(
    'picking a rating shows that rating\'s tags, and selecting one submits it',
    (tester) async {
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'startedAt': '2026-01-01T10:00:00.000Z',
        }),
      );
      when(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: '',
          tags: ['Helpful'],
        ),
      ).thenAnswer((_) async {});

      await pumpScreen(tester);

      // Rating 4's real tag set (`postSim.feedback.dialog.rating.tags.4`).
      expect(
        find.text('Helpful'),
        findsNothing,
        reason: 'no rating picked yet',
      );

      final starButtons = find.byIcon(Icons.star_border);
      await tester.tap(starButtons.at(3));
      await tester.pumpAndSettle();

      expect(find.text('Good'), findsOneWidget);
      expect(find.text('Helpful'), findsOneWidget);

      await tester.tap(find.text('Helpful'));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      verify(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: '',
          tags: ['Helpful'],
        ),
      ).called(1);
    },
  );

  testWidgets('picking a new rating clears any tags already chosen', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    await pumpScreen(tester);

    final starButtons = find.byIcon(Icons.star_border);
    await tester.tap(starButtons.at(3)); // rating 4
    await tester.pumpAndSettle();
    await tester.tap(find.text('Helpful'));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.star).first); // re-tap rating 1
    await tester.pumpAndSettle();

    // Rating 1's own tag set is showing, and the previous rating-4 chip is gone.
    expect(find.text('Helpful'), findsNothing);
    expect(find.text('Poor'), findsOneWidget);
  });

  testWidgets('leaving before submitting feedback prompts a confirmation', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    final navigatorKey = GlobalKey<NavigatorState>();
    await pumpApp(
      tester,
      Navigator(
        key: navigatorKey,
        onGenerateRoute: (settings) => MaterialPageRoute(
          builder: (_) =>
              const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
        ),
      ),
      overrides: [
        fixedTranslationsOverride(),
        simulationsRepositoryProvider.overrideWithValue(repository),
        simulationTranscriptRepositoryProvider.overrideWithValue(
          transcriptRepository,
        ),
      ],
    );

    navigatorKey.currentState!.maybePop();
    await tester.pumpAndSettle();

    final dialog = find.byType(AlertDialog);
    expect(dialog, findsOneWidget);
    expect(
      find.descendant(
        of: dialog,
        matching: find.text('How did that session go?'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: dialog,
        matching: find.text('Please select a rating.'),
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    // Dialog dismissed, screen still showing (didn't actually leave).
    expect(find.text('Debrief'), findsOneWidget);
  });

  testWidgets(
    'submitting feedback shows a snackbar in addition to the inline thanks state',
    (tester) async {
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'startedAt': '2026-01-01T10:00:00.000Z',
        }),
      );
      when(
        () => repository.addSimulationFeedback(
          scenarioSessionId: 'session-1',
          rating: 4,
          comment: '',
          tags: <String>[],
        ),
      ).thenAnswer((_) async {});

      await pumpScreenWithToasts(tester);

      await tester.tap(find.byIcon(Icons.star_border).at(3));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(AppButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(SnackBar),
          matching: find.text('Feedback submitted successfully'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('a failed submission shows a failure snackbar alongside the inline error', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );
    when(
      () => repository.addSimulationFeedback(
        scenarioSessionId: 'session-1',
        rating: 4,
        comment: '',
        tags: <String>[],
      ),
    ).thenThrow(Exception('network down'));

    await pumpScreenWithToasts(tester);

    await tester.tap(find.byIcon(Icons.star_border).at(3));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(AppButton, 'Submit'));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(SnackBar),
        matching: find.text('Failed to submit feedback'),
      ),
      findsOneWidget,
    );
    // The inline form stays up (not a forced "thanks" state) with its own
    // error text too.
    expect(find.textContaining('Failed to submit feedback'), findsWidgets);
  });

  testWidgets(
    'a session that already has feedback starts in the thanks state with no leave prompt',
    (tester) async {
      when(() => repository.getSimulationDetails('session-1')).thenAnswer(
        (_) async => SimulationSummary.fromJson({
          'id': 'session-1',
          'startedAt': '2026-01-01T10:00:00.000Z',
          'hasFeedback': true,
          'feedbackRating': 5,
        }),
      );

      final navigatorKey = GlobalKey<NavigatorState>();
      await pumpApp(
        tester,
        Navigator(
          key: navigatorKey,
          onGenerateRoute: (settings) => MaterialPageRoute(
            builder: (_) =>
                const SimulationFeedbackScreen(scenarioSessionId: 'session-1'),
          ),
        ),
        overrides: [
          fixedTranslationsOverride(),
          simulationsRepositoryProvider.overrideWithValue(repository),
          simulationTranscriptRepositoryProvider.overrideWithValue(
            transcriptRepository,
          ),
        ],
      );

      // Already-submitted "thanks" state, not the blank rating form.
      expect(find.text('Feedback submitted successfully'), findsOneWidget);
      verifyNever(
        () => repository.addSimulationFeedback(
          scenarioSessionId: any(named: 'scenarioSessionId'),
          rating: any(named: 'rating'),
          comment: any(named: 'comment'),
        ),
      );

      navigatorKey.currentState!.maybePop();
      await tester.pumpAndSettle();

      // No forced confirmation dialog — already has feedback.
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets('fromLogs skips the forced leave-without-rating prompt even with no feedback yet', (
    tester,
  ) async {
    when(() => repository.getSimulationDetails('session-1')).thenAnswer(
      (_) async => SimulationSummary.fromJson({
        'id': 'session-1',
        'startedAt': '2026-01-01T10:00:00.000Z',
      }),
    );

    final navigatorKey = GlobalKey<NavigatorState>();
    await pumpApp(
      tester,
      Navigator(
        key: navigatorKey,
        onGenerateRoute: (settings) => MaterialPageRoute(
          builder: (_) => const SimulationFeedbackScreen(
            scenarioSessionId: 'session-1',
            fromLogs: true,
          ),
        ),
      ),
      overrides: [
        fixedTranslationsOverride(),
        simulationsRepositoryProvider.overrideWithValue(repository),
        simulationTranscriptRepositoryProvider.overrideWithValue(
          transcriptRepository,
        ),
      ],
    );

    navigatorKey.currentState!.maybePop();
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
  });
}
