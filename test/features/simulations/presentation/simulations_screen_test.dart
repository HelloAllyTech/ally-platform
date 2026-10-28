import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulations_screen.dart';

import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

class MockCoursesRepository extends Mock implements CoursesRepository {}

Scenario _scenario({required int id, required String title}) =>
    Scenario.fromJson({'id': id, 'title': title});

List<GoRoute> _routes() => [
  GoRoute(
    path: '/simulations',
    builder: (context, state) => const SimulationsScreen(),
  ),
  GoRoute(
    path: '/simulations/:scenarioId',
    builder: (context, state) => Text(
      'SCENARIO_DETAILS:${state.pathParameters['scenarioId']}:'
      'extraTitle=${(state.extra as Scenario?)?.title}',
    ),
  ),
  GoRoute(
    path: '/courses/:trackId',
    builder: (context, state) => Text('COURSE_DETAILS:${state.pathParameters['trackId']}'),
  ),
  GoRoute(
    path: '/cases/:caseId',
    builder: (context, state) => Text('CASE_DETAILS:${state.pathParameters['caseId']}'),
  ),
  GoRoute(
    path: '/simulation-paths/:pathId',
    builder: (context, state) => Text('PATH_DETAILS:${state.pathParameters['pathId']}'),
  ),
];

void main() {
  late MockSimulationsRepository repository;
  late MockCoursesRepository coursesRepository;

  setUp(() {
    repository = MockSimulationsRepository();
    coursesRepository = MockCoursesRepository();
    when(
      () => repository.getSimulationCredits(),
    ).thenAnswer((_) async => SimulationCredits(creditLimit: 10, consumedCredits: 4));
    // The screen also watches the Courses/Cases/Paths tabs (hidden until
    // their own query resolves with data, same as RN's real show/hide-tab
    // logic) — stubbed empty by default so individual tests only need to
    // override what they're actually testing, and so nothing here falls
    // through to a real, unmocked `coursesRepositoryProvider` network call.
    when(() => repository.getCases()).thenAnswer((_) async => []);
    when(() => repository.getScenarioPaths()).thenAnswer((_) async => []);
    when(() => coursesRepository.getLearnTracks()).thenAnswer((_) async => []);
  });

  List<Override> overrides() => [
    simulationsRepositoryProvider.overrideWithValue(repository),
    coursesRepositoryProvider.overrideWithValue(coursesRepository),
  ];

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
      overrides: overrides(),
    );

    expect(find.text('First scenario'), findsOneWidget);
    expect(find.text('Second scenario'), findsOneWidget);
    // RN's renderCreditsDisplay shows "consumed/limit" (e.g. "4/10"), not a
    // "remaining" count — matches `creditLimit: 10, consumedCredits: 4` above.
    expect(find.text('4/10'), findsOneWidget);
  });

  testWidgets('shows an empty state when there are no scenarios', (tester) async {
    when(() => repository.getScenarios()).thenAnswer((_) async => []);

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: overrides(),
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
      overrides: overrides(),
    );

    expect(find.textContaining('Failed to load scenarios'), findsOneWidget);
  });

  testWidgets(
    'tapping a scenario navigates to its details route, passing the already-fetched '
    'Scenario as extra (RN never fetches this screen separately — reusing it is what '
    'actually fixed the language dropdown never appearing)',
    (tester) async {
      when(() => repository.getScenarios()).thenAnswer(
        (_) async => [_scenario(id: 7, title: 'First scenario')],
      );

      await pumpRouterApp(
        tester,
        initialLocation: '/simulations',
        routes: _routes(),
        overrides: overrides(),
      );

      await tester.tap(find.text('First scenario'));
      await tester.pumpAndSettle();

      expect(find.text('SCENARIO_DETAILS:7:extraTitle=First scenario'), findsOneWidget);
    },
  );

  testWidgets('renders the intro copy with its two blue-highlighted spans', (tester) async {
    when(() => repository.getScenarios()).thenAnswer((_) async => []);

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: overrides(),
    );

    final richText = tester.widget<RichText>(
      find.textContaining('real-world practice', findRichText: true),
    );
    final plain = richText.text.toPlainText();
    expect(plain, contains('AI-voice based'));
    expect(plain, contains('situation'));
    expect(plain, isNot(contains('<blue>')));
  });

  testWidgets('hides the tab bar but still shows the heading when only one tab has data', (
    tester,
  ) async {
    when(() => repository.getScenarios()).thenAnswer(
      (_) async => [_scenario(id: 1, title: 'Only scenario')],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: overrides(),
    );

    expect(find.text('Courses'), findsNothing);
    expect(find.text('Cases'), findsNothing);
    expect(find.textContaining('Role-play'), findsWidgets);
  });

  testWidgets('shows Courses/Cases/Paths tabs once their data resolves, and switches between them', (
    tester,
  ) async {
    when(() => repository.getScenarios()).thenAnswer(
      (_) async => [_scenario(id: 1, title: 'A scenario')],
    );
    when(() => coursesRepository.getLearnTracks()).thenAnswer(
      (_) async => [
        TrackListItem(
          id: 't1',
          title: 'A course',
          description: null,
          coverImageUrl: null,
          totalItems: 4,
          completedItems: 2,
          enrolled: true,
          trackEnrollmentId: 'e1',
        ),
      ],
    );
    when(() => repository.getCases()).thenAnswer(
      (_) async => [
        SimulationPath(id: 'c1', title: 'A case', description: null, totalScenarios: 3, completedScenarios: 0),
      ],
    );
    when(() => repository.getScenarioPaths()).thenAnswer(
      (_) async => [
        SimulationPath(id: 'p1', title: 'A path', description: null, totalScenarios: 5, completedScenarios: 5),
      ],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: overrides(),
    );

    // Defaults to the Simulations tab.
    expect(find.text('A scenario'), findsOneWidget);
    expect(find.text('A course'), findsNothing);

    await tester.tap(find.text('Courses'));
    await tester.pumpAndSettle();
    expect(find.text('A course'), findsOneWidget);
    expect(find.text('2/4'), findsOneWidget, reason: 'progress badge for a partially-completed course');

    await tester.tap(find.text('Cases'));
    await tester.pumpAndSettle();
    expect(find.text('A case'), findsOneWidget);
    expect(find.text('3 Role Play'), findsOneWidget, reason: 'cases show a scenario count, not their own description');

    await tester.tap(find.text('Learning Pathways'));
    await tester.pumpAndSettle();
    expect(find.text('A path'), findsOneWidget);
  });

  testWidgets('tapping a course/case/path card navigates to its detail route', (tester) async {
    when(() => repository.getScenarios()).thenAnswer((_) async => []);
    when(() => coursesRepository.getLearnTracks()).thenAnswer(
      (_) async => [
        TrackListItem(
          id: 't9',
          title: 'Navigable course',
          description: null,
          coverImageUrl: null,
          totalItems: 0,
          completedItems: 0,
          enrolled: false,
          trackEnrollmentId: null,
        ),
      ],
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations',
      routes: _routes(),
      overrides: overrides(),
    );

    await tester.tap(find.text('Navigable course'));
    await tester.pumpAndSettle();

    expect(find.text('COURSE_DETAILS:t9'), findsOneWidget);
  });
}
