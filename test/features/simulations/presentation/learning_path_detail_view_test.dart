import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/learning_path_detail_view.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/start_simulation/start_simulation_controller.dart';

import '../../../support/fake_translations.dart';
import '../../../support/pump_app.dart';
import '../../../support/fake_permission_platform.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

PathScenario _scenario({
  required String id,
  required int scenarioId,
  required int order,
  SessionItemStatus status = SessionItemStatus.unlocked,
  String? sessionId,
  String? title,
  List<Map<String, Object?>>? availableLanguages,
}) => PathScenario.fromJson({
  'id': id,
  'scenarioId': scenarioId,
  'order': order,
  'title': title ?? 'Scenario $scenarioId',
  'status': status.name.toUpperCase(),
  'sessionId': sessionId,
  'availableLanguages': availableLanguages,
});

SimulationPathDetails _details({
  required List<PathScenario> scenarios,
  int completedScenarios = 0,
}) => SimulationPathDetails(
  id: 'path-1',
  title: 'My Path',
  description: 'Path description',
  coverImageUrl: null,
  completedScenarios: completedScenarios,
  completedAt: null,
  scenarioPathSessionId: null,
  caseSessionId: null,
  scenarios: scenarios,
);

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

late MockSimulationsRepository repository;

StartSimulationParams _params(PathScenario scenario, int? languageId) =>
    StartSimulationParams(scenarioId: scenario.scenarioId, languageId: languageId);

Future<void> _pump(WidgetTester tester, Widget child, {SimulationCredits? credits}) => pumpApp(
  tester,
  child,
  overrides: [
    fixedTranslationsOverride(),
    simulationsRepositoryProvider.overrideWithValue(repository),
    simulationCreditsProvider.overrideWith(
      (ref) async => credits ?? SimulationCredits(creditLimit: 100, consumedCredits: 0, secondsAllowedPerCredit: 60),
    ),
  ],
);

void main() {
  // The start flow asks for the microphone before creating the session
  // (RN useStartSimulation); granted unless a test says otherwise.
  setUp(() => PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({}));

  setUp(() {
    repository = MockSimulationsRepository();
    when(
      () => repository.startScenarioSession(
        scenarioId: any(named: 'scenarioId'),
        languageId: any(named: 'languageId'),
      ),
    ).thenAnswer((_) async => SessionData(id: 'sess', accessToken: 'tok', liveKitServerUrl: 'wss://lk'));
  });

  group('Start/Continue button', () {
    testWidgets('shows Start when no scenario has been completed yet', (
      tester,
    ) async {
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      expect(find.widgetWithText(AppButton, 'Start'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Continue'), findsNothing);
    });

    testWidgets('flips to Continue once any scenario is completed', (
      tester,
    ) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      expect(find.widgetWithText(AppButton, 'Continue'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Start'), findsNothing);
    });

    testWidgets('is disabled when there is no next scenario', (tester) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
          _scenario(id: 's2', scenarioId: 2, order: 2, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      final button = tester.widget<AppButton>(find.byType(AppButton));
      expect(button.isDisabled, isTrue);
    });

    testWidgets(
      'tapping it calls onEnsureSession then opens the preview modal, which calls '
      'starts the next scenario once Start Simulation is tapped',
      (tester) async {
        final calls = <String>[];
        final details = _details(
          scenarios: [
            _scenario(id: 's1', scenarioId: 1, order: 1),
            _scenario(id: 's2', scenarioId: 2, order: 2),
          ],
        );

        await _pump(
          tester,
          LearningPathDetailView(
            details: details,
            onEnsureSession: () async {
              calls.add('ensure');
            },
            startParamsFor: (scenario, languageId) {
              calls.add('start:${scenario.id}');
              return _params(scenario, languageId);
            },
            onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
          ),
        );

        await tester.tap(find.widgetWithText(AppButton, 'Start'));
        await tester.pumpAndSettle();

        expect(calls, ['ensure'], reason: 'the preview modal is open; not started yet');
        expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget);

        await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
        await tester.pumpAndSettle();
        // RN's NotificationModal ("Before you get started") comes next.
        await tester.tap(find.text('Start Session'));
        await tester.pumpAndSettle();

        expect(calls, ['ensure', 'start:s1']);
        expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing, reason: 'modal closed');
      },
    );

    testWidgets(
      'when the next scenario has availableLanguages, the preview modal offers a picker '
      'defaulting to the first option, and passes the chosen languageId through',
      (tester) async {
        int? capturedLanguageId;
        final details = _details(
          scenarios: [
            _scenario(
              id: 's1',
              scenarioId: 1,
              order: 1,
              availableLanguages: [
                {'language_id': 1, 'label': 'English', 'active': true},
                {'language_id': 2, 'label': 'Hindi', 'active': true},
              ],
            ),
          ],
        );

        await _pump(
          tester,
          LearningPathDetailView(
            details: details,
            onEnsureSession: () async {},
            startParamsFor: (scenario, languageId) {
              capturedLanguageId = languageId;
              return _params(scenario, languageId);
            },
            onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
          ),
        );

        await tester.tap(find.widgetWithText(AppButton, 'Start'));
        await tester.pumpAndSettle();

        // Defaults to the first available language.
        expect(find.text('English'), findsOneWidget);

        await tester.tap(find.byKey(const Key('simulation-details-modal-language')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Hindi').last);
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
        await tester.pumpAndSettle();
        // RN's NotificationModal ("Before you get started") comes next.
        await tester.tap(find.text('Start Session'));
        await tester.pumpAndSettle();

        expect(capturedLanguageId, 2);
      },
    );

    testWidgets('closing the preview modal (the X button) does not start the scenario', (
      tester,
    ) async {
      var startCalls = 0;
      final details = _details(
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            availableLanguages: [
              {'language_id': 1, 'label': 'English', 'active': true},
            ],
          ),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: (scenario, languageId) {
            startCalls++;
            return _params(scenario, languageId);
          },
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      await tester.tap(find.widgetWithText(AppButton, 'Start'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('simulation-details-modal-start')), findsOneWidget);

      await tester.tap(find.byKey(const Key('simulation-details-modal-close')));
      await tester.pumpAndSettle();

      expect(startCalls, 0);
      expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
    });

    testWidgets('a start failure closes the modal (RN\'s finally) and shows the error toast', (
      tester,
    ) async {
      final details = _details(scenarios: [_scenario(id: 's1', scenarioId: 1, order: 1)]);
      when(() => repository.startScenarioSession(scenarioId: 1)).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: '/learn/scenario-session-start'),
          response: Response(
            requestOptions: RequestOptions(path: '/learn/scenario-session-start'),
            statusCode: 400,
            data: {'message': 'network down'},
          ),
        ),
      );

      await _pump(
        tester,
        Scaffold(
          body: LearningPathDetailView(
            details: details,
            onEnsureSession: () async {},
            startParamsFor: _params,
            onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
          ),
        ),
      );

      await tester.tap(find.widgetWithText(AppButton, 'Start'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Session'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);
      expect(find.textContaining('network down'), findsOneWidget);
    });

    testWidgets('a 429 opens the retry modal, an entityId the active-simulation modal', (tester) async {
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );
      DioException error(int status, Map<String, dynamic> body) => DioException(
        requestOptions: RequestOptions(path: '/x'),
        response: Response(requestOptions: RequestOptions(path: '/x'), statusCode: status, data: body),
      );
      when(() => repository.startScenarioSession(scenarioId: 1)).thenThrow(error(429, {}));
      when(() => repository.startScenarioSession(scenarioId: 2)).thenThrow(error(409, {'entityId': 'running-9'}));

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      await tester.tap(find.text('Scenario 1'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Session'));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('retry-session-modal')), findsOneWidget);
      await tester.tap(find.byKey(const Key('retry-session-modal-close')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('simulation-details-modal-start')), findsNothing);

      await tester.tap(find.text('Scenario 2'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start Session'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('active-simulation-modal')), findsOneWidget);
      await tester.tap(find.byKey(const Key('active-simulation-cancel')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('active-simulation-modal')), findsNothing);
      verifyNever(() => repository.endScenarioSession(any()));
    });

    testWidgets('low credits show the no-credits modal and disable Start', (tester) async {
      final details = _details(scenarios: [_scenario(id: 's1', scenarioId: 1, order: 1)]);
      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
        credits: SimulationCredits(creditLimit: 5, consumedCredits: 5, secondsAllowedPerCredit: 60),
      );

      expect(find.byKey(const Key('low-credits-modal')), findsOneWidget);
      expect(tester.widget<AppButton>(find.widgetWithText(AppButton, 'Start')).isDisabled, isTrue);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('low-credits-modal')), findsNothing);
    });
  });

  group('per-row status rendering', () {
    testWidgets('a locked row is disabled and not tappable', (tester) async {
      final calls = <String>[];
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: (scenario, languageId) {
            calls.add(scenario.id);
            return _params(scenario, languageId);
          },
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      // `find.byType(InkWell)` alone would also match AppButton's own
      // internal InkWell — disambiguate via the row's title text.
      final rowInkWell = tester.widget<InkWell>(
        find.ancestor(of: find.text('Scenario 1'), matching: find.byType(InkWell)),
      );
      expect(rowInkWell.onTap, isNull);

      await tester.tap(find.text('Scenario 1'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
    });

    testWidgets('a completed row with a sessionId shows a view-feedback action', (
      tester,
    ) async {
      final calls = <String>[];
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (scenario) async {
            calls.add(scenario.id);
            return true;
          },
          sessionNotFoundMessage: 'not found',
        ),
      );

      expect(find.byKey(const Key('path-item-feedback')), findsOneWidget);
      await tester.tap(find.byKey(const Key('path-item-feedback')));
      await tester.pumpAndSettle();

      expect(calls, ['s1']);
      expect(find.text('not found'), findsNothing);
    });

    testWidgets('a lookup with no session id shows RN\'s failedToLoad toast', (tester) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1, status: SessionItemStatus.completed, sessionId: 'sess-1'),
        ],
      );
      await _pump(
        tester,
        Scaffold(
          body: LearningPathDetailView(
            details: details,
            onEnsureSession: () async {},
            startParamsFor: _params,
            onViewFeedback: (_) async => false,
            sessionNotFoundMessage: 'Failed to load path details',
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('path-item-feedback')));
      await tester.pump();
      expect(find.text('Failed to load path details'), findsOneWidget);
    });

    testWidgets('a createSession failure toasts the API message, not the raw exception', (tester) async {
      final details = _details(scenarios: [_scenario(id: 's1', scenarioId: 1, order: 1)]);
      await _pump(
        tester,
        Scaffold(
          body: LearningPathDetailView(
            details: details,
            onEnsureSession: () async => throw DioException(
              requestOptions: RequestOptions(path: '/x'),
              response: Response(
                requestOptions: RequestOptions(path: '/x'),
                statusCode: 400,
                data: {'message': 'Path is archived'},
              ),
            ),
            startParamsFor: _params,
            onViewFeedback: (_) async => true,
            sessionNotFoundMessage: 'not found',
          ),
        ),
      );
      await tester.tap(find.text('Start'));
      await tester.pump();
      expect(find.text('Path is archived'), findsOneWidget);
      expect(find.textContaining('DioException'), findsNothing);
    });

    testWidgets('tapping a non-locked row starts that specific scenario', (
      tester,
    ) async {
      final calls = <String>[];
      final details = _details(
        scenarios: [
          _scenario(id: 's1', scenarioId: 1, order: 1),
          _scenario(id: 's2', scenarioId: 2, order: 2),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: (scenario, languageId) {
            calls.add(scenario.id);
            return _params(scenario, languageId);
          },
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      await tester.tap(find.text('Scenario 2'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty, reason: 'the preview modal is open; not started yet');

      await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
      await tester.pumpAndSettle();
      // RN's NotificationModal ("Before you get started") comes next.
      await tester.tap(find.text('Start Session'));
      await tester.pumpAndSettle();

      expect(calls, ['s2']);
    });

    testWidgets('shows a lock overlay on a locked thumbnail and a Next badge on the resumable row', (
      tester,
    ) async {
      final details = _details(
        completedScenarios: 1,
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            order: 1,
            status: SessionItemStatus.completed,
            sessionId: 'sess-1',
          ),
          _scenario(id: 's2', scenarioId: 2, order: 2),
          _scenario(id: 's3', scenarioId: 3, order: 3, status: SessionItemStatus.locked),
        ],
      );

      await _pump(
        tester,
        LearningPathDetailView(
          details: details,
          onEnsureSession: () async {},
          startParamsFor: _params,
          onViewFeedback: (_) async => true,
          sessionNotFoundMessage: 'not found',
        ),
      );

      // RN's real card: "Role play N" prefix, a Next badge only on the
      // first unlocked (resumable) scenario, and a dark lock overlay +
      // icon on a locked row's thumbnail — not a numbered circle avatar.
      expect(find.text('Role play 1'), findsOneWidget);
      expect(find.text('Role play 2'), findsOneWidget);
      expect(find.text('Next'), findsOneWidget, reason: 'only scenario 2 is the resumable one');
      expect(find.byKey(const Key('path-item-locked')), findsOneWidget, reason: 'only scenario 3 is locked');
    });
  });
}
