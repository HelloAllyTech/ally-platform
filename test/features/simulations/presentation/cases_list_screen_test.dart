import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/cases_list_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

SimulationPath _case({
  required String id,
  required String title,
  int completed = 0,
  int total = 0,
}) => SimulationPath.fromJson({
  'id': id,
  'title': title,
  'totalScenarios': total,
  'completedScenarios': completed,
});

List<GoRoute> _routes() => [
  GoRoute(path: '/cases', builder: (context, state) => const CasesListScreen()),
  GoRoute(
    path: '/cases/:caseId',
    builder: (context, state) => Text('CASE_DETAILS:${state.pathParameters['caseId']}'),
  ),
];

void main() {
  late MockSimulationsRepository repository;

  setUp(() {
    repository = MockSimulationsRepository();
  });

  testWidgets('shows a loading indicator, then the list once cases resolve', (
    tester,
  ) async {
    when(() => repository.getCases()).thenAnswer(
      (_) async => [
        _case(id: 'c1', title: 'First case', completed: 1, total: 3),
        _case(id: 'c2', title: 'Second case', completed: 0, total: 2),
      ],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/cases',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('First case'), findsOneWidget);
    expect(find.text('Second case'), findsOneWidget);
    expect(find.text('1/3'), findsOneWidget);
    expect(find.text('0/2'), findsOneWidget);
  });

  testWidgets('shows an empty state when there are no cases', (tester) async {
    when(() => repository.getCases()).thenAnswer((_) async => []);

    await pumpRouterApp(
      tester,
      initialLocation: '/cases',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No cases available'), findsOneWidget);
  });

  testWidgets('shows an error message when loading fails', (tester) async {
    when(() => repository.getCases()).thenThrow(Exception('boom'));

    await pumpRouterApp(
      tester,
      initialLocation: '/cases',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('Failed to load cases'), findsOneWidget);
  });

  testWidgets('tapping a case navigates to its details route', (tester) async {
    when(() => repository.getCases()).thenAnswer(
      (_) async => [_case(id: 'c1', title: 'First case')],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/cases',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.text('First case'));
    await tester.pumpAndSettle();

    expect(find.text('CASE_DETAILS:c1'), findsOneWidget);
  });
}
