import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/learning_path_detail_view.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_path_details_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

SimulationPathDetails _pathDetails({
  String? scenarioPathSessionId,
  List<PathScenario> scenarios = const [],
}) => SimulationPathDetails(
  id: 'path-1',
  title: 'My Path',
  description: 'Path description',
  coverImageUrl: null,
  completedScenarios: 0,
  completedAt: null,
  scenarioPathSessionId: scenarioPathSessionId,
  caseSessionId: null,
  scenarios: scenarios,
);

PathScenario _scenario({
  required String id,
  required int scenarioId,
  SessionItemStatus status = SessionItemStatus.unlocked,
  String? sessionId,
}) => PathScenario.fromJson({
  'id': id,
  'scenarioId': scenarioId,
  'order': 1,
  'title': 'Scenario $scenarioId',
  'status': status.name.toUpperCase(),
  'sessionId': sessionId,
});

List<GoRoute> _routes() => [
  GoRoute(
    path: '/simulation-paths/:pathId',
    builder: (context, state) =>
        SimulationPathDetailsScreen(pathId: state.pathParameters['pathId']!),
  ),
  GoRoute(
    path: '/roleplay',
    builder: (context, state) {
      final extra = state.extra as Map<String, Object?>;
      return Text('ROLEPLAY:${extra['scenarioSessionId']}');
    },
  ),
  GoRoute(
    path: '/simulations/feedback/:sessionId',
    builder: (context, state) =>
        Text('FEEDBACK:${state.pathParameters['sessionId']}'),
  ),
];

void main() {
  late MockSimulationsRepository repository;

  setUp(() {
    repository = MockSimulationsRepository();
  });

  testWidgets('fetches path details and renders them via LearningPathDetailView', (
    tester,
  ) async {
    when(() => repository.getSimulationPathDetails('path-1')).thenAnswer(
      (_) async => _pathDetails(
        scenarioPathSessionId: 'path-session-1',
        scenarios: [_scenario(id: 's1', scenarioId: 1)],
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulation-paths/path-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.byType(LearningPathDetailView), findsOneWidget);
    expect(find.text('My Path'), findsOneWidget);
    verify(() => repository.getSimulationPathDetails('path-1')).called(1);
  });

  testWidgets('onStartScenario starts a session with scenarioPathSessionItemId and navigates to roleplay', (
    tester,
  ) async {
    when(() => repository.getSimulationPathDetails('path-1')).thenAnswer(
      (_) async => _pathDetails(
        scenarioPathSessionId: 'path-session-1',
        scenarios: [_scenario(id: 's1', scenarioId: 1, sessionId: 'item-1')],
      ),
    );
    when(
      () => repository.startScenarioSession(
        scenarioId: 1,
        scenarioPathSessionItemId: 'item-1',
      ),
    ).thenAnswer(
      (_) async => SessionData(
        id: 'new-session-1',
        accessToken: 'tok',
        liveKitServerUrl: 'wss://lk',
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulation-paths/path-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Start'));
    await tester.pumpAndSettle();

    verify(
      () => repository.startScenarioSession(
        scenarioId: 1,
        scenarioPathSessionItemId: 'item-1',
      ),
    ).called(1);
    expect(find.text('ROLEPLAY:new-session-1'), findsOneWidget);
  });

  testWidgets('onEnsureSession creates a path session when none exists yet', (
    tester,
  ) async {
    when(() => repository.getSimulationPathDetails('path-1')).thenAnswer(
      (_) async => _pathDetails(
        scenarioPathSessionId: null,
        scenarios: [_scenario(id: 's1', scenarioId: 1, sessionId: 'item-1')],
      ),
    );
    when(() => repository.createPathSession('path-1')).thenAnswer((_) async {});
    when(
      () => repository.startScenarioSession(
        scenarioId: 1,
        scenarioPathSessionItemId: 'item-1',
      ),
    ).thenAnswer(
      (_) async => SessionData(
        id: 'new-session-1',
        accessToken: 'tok',
        liveKitServerUrl: 'wss://lk',
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulation-paths/path-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Start'));
    await tester.pumpAndSettle();

    verify(() => repository.createPathSession('path-1')).called(1);
  });

  testWidgets('onViewFeedback resolves the session id via getScenarioSessionByPathItem and navigates', (
    tester,
  ) async {
    when(() => repository.getSimulationPathDetails('path-1')).thenAnswer(
      (_) async => _pathDetails(
        scenarioPathSessionId: 'path-session-1',
        scenarios: [
          _scenario(
            id: 's1',
            scenarioId: 1,
            status: SessionItemStatus.completed,
            sessionId: 'item-1',
          ),
        ],
      ),
    );
    when(
      () => repository.getScenarioSessionByPathItem('item-1'),
    ).thenAnswer((_) async => 'resolved-session-1');

    await pumpRouterApp(
      tester,
      initialLocation: '/simulation-paths/path-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byIcon(Icons.description_outlined));
    await tester.pumpAndSettle();

    verify(() => repository.getScenarioSessionByPathItem('item-1')).called(1);
    expect(find.text('FEEDBACK:resolved-session-1'), findsOneWidget);
  });

  testWidgets('shows an error message when loading path details fails', (
    tester,
  ) async {
    when(
      () => repository.getSimulationPathDetails('path-1'),
    ).thenThrow(Exception('network down'));

    await pumpRouterApp(
      tester,
      initialLocation: '/simulation-paths/path-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('Failed to load path details'), findsOneWidget);
  });
}
