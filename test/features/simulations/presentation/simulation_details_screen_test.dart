import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_details_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

List<GoRoute> _routes() => [
  GoRoute(
    path: '/simulations/:scenarioId',
    builder: (context, state) => SimulationDetailsScreen(
      scenarioId: int.parse(state.pathParameters['scenarioId']!),
    ),
  ),
  GoRoute(
    path: '/roleplay',
    builder: (context, state) {
      final extra = state.extra as Map<String, Object?>;
      return Text(
        'ROLEPLAY:${extra['liveKitServerUrl']}:${extra['accessToken']}:${extra['scenarioSessionId']}',
      );
    },
  ),
];

void main() {
  late MockSimulationsRepository repository;

  setUp(() {
    repository = MockSimulationsRepository();
    when(() => repository.getScenarioById(5)).thenAnswer(
      (_) async => Scenario.fromJson({
        'id': 5,
        'title': 'Difficult conversation',
        'description': 'Practice de-escalation',
      }),
    );
  });

  testWidgets('renders the scenario title/description once loaded', (
    tester,
  ) async {
    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/5',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Difficult conversation'), findsOneWidget);
    expect(find.text('Practice de-escalation'), findsOneWidget);
  });

  testWidgets('tapping start calls startScenarioSession and navigates to /roleplay with the session extras', (
    tester,
  ) async {
    when(
      () => repository.startScenarioSession(scenarioId: 5),
    ).thenAnswer(
      (_) async => SessionData(
        id: 'session-99',
        accessToken: 'access-tok',
        liveKitServerUrl: 'wss://livekit.example.com',
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/5',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Start role play'));
    await tester.pumpAndSettle();

    verify(() => repository.startScenarioSession(scenarioId: 5)).called(1);
    expect(
      find.text('ROLEPLAY:wss://livekit.example.com:access-tok:session-99'),
      findsOneWidget,
    );
  });

  testWidgets('shows an error message when starting the simulation fails', (
    tester,
  ) async {
    when(
      () => repository.startScenarioSession(scenarioId: 5),
    ).thenThrow(Exception('rate limited'));

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/5',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Start role play'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Failed to start simulation'), findsOneWidget);
  });
}
