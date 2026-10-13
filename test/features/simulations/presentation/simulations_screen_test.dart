import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulations_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

Scenario _scenario({required int id, required String title}) =>
    Scenario.fromJson({'id': id, 'title': title});

List<GoRoute> _routes() => [
  GoRoute(
    path: '/simulations',
    builder: (context, state) => const SimulationsScreen(),
  ),
  GoRoute(
    path: '/simulations/:scenarioId',
    builder: (context, state) =>
        Text('SCENARIO_DETAILS:${state.pathParameters['scenarioId']}'),
  ),
];

void main() {
  late MockSimulationsRepository repository;

  setUp(() {
    repository = MockSimulationsRepository();
    when(
      () => repository.getSimulationCredits(),
    ).thenAnswer((_) async => SimulationCredits(creditLimit: 10, consumedCredits: 4));
  });

  testWidgets('shows the scenario list and remaining credits once resolved', (
    tester,
  ) async {
    when(() => repository.getScenarios()).thenAnswer(
      (_) async => [
        _scenario(id: 1, title: 'First scenario'),
        _scenario(id: 2, title: 'Second scenario'),
      ],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('First scenario'), findsOneWidget);
    expect(find.text('Second scenario'), findsOneWidget);
    expect(find.text('6 credits'), findsOneWidget);
  });

  testWidgets('shows an empty state when there are no scenarios', (tester) async {
    when(() => repository.getScenarios()).thenAnswer((_) async => []);

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No simulations available'), findsOneWidget);
  });

  testWidgets('shows an error message when loading scenarios fails', (
    tester,
  ) async {
    when(() => repository.getScenarios()).thenThrow(Exception('boom'));

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('Failed to load scenarios'), findsOneWidget);
  });

  testWidgets('tapping a scenario navigates to its details route', (tester) async {
    when(() => repository.getScenarios()).thenAnswer(
      (_) async => [_scenario(id: 7, title: 'First scenario')],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('First scenario'));
    await tester.pumpAndSettle();

    expect(find.text('SCENARIO_DETAILS:7'), findsOneWidget);
  });
}
