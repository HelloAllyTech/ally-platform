import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/case_details_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/learning_path_detail_view.dart';

import '../../../support/pump_router_app.dart';
import '../../../support/fake_permission_platform.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

SimulationPathDetails _caseDetails({
  String? caseSessionId,
  List<PathScenario> scenarios = const [],
}) => SimulationPathDetails(
  id: 'case-1',
  title: 'My Case',
  description: 'Case description',
  coverImageUrl: null,
  completedScenarios: 0,
  completedAt: null,
  scenarioPathSessionId: null,
  caseSessionId: caseSessionId,
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
    path: '/cases/:caseId',
    builder: (context, state) =>
        CaseDetailsScreen(caseId: state.pathParameters['caseId']!),
  ),
  GoRoute(
    path: '/roleplay',
    builder: (context, state) {
      final extra = state.extra as Map<String, Object?>;
      return Text('ROLEPLAY:${extra['scenarioSessionId']} caseId=${extra['caseId']}');
    },
  ),
  GoRoute(
    path: '/simulations/feedback/:sessionId',
    builder: (context, state) => Text(
      'FEEDBACK:${state.pathParameters['sessionId']}'
      ' fromLogs=${state.uri.queryParameters['fromLogs']}'
      ' caseId=${state.uri.queryParameters['caseId']}',
    ),
  ),
];

void main() {
  // The start flow asks for the microphone before creating the session
  // (RN useStartSimulation); granted unless a test says otherwise.
  setUp(() => PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({}));

  late MockSimulationsRepository repository;

  setUp(() {
    repository = MockSimulationsRepository();
  });

  testWidgets('fetches case details and renders them via LearningPathDetailView', (
    tester,
  ) async {
    when(() => repository.getCaseDetails('case-1')).thenAnswer(
      (_) async => _caseDetails(
        caseSessionId: 'case-session-1',
        scenarios: [_scenario(id: 's1', scenarioId: 1)],
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/cases/case-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.byType(LearningPathDetailView), findsOneWidget);
    expect(find.text('My Case'), findsOneWidget);
    verify(() => repository.getCaseDetails('case-1')).called(1);
  });

  testWidgets('Start starts a session with caseSessionItemId and navigates to roleplay', (
    tester,
  ) async {
    when(() => repository.getCaseDetails('case-1')).thenAnswer(
      (_) async => _caseDetails(
        caseSessionId: 'case-session-1',
        scenarios: [_scenario(id: 's1', scenarioId: 1, sessionId: 'item-1')],
      ),
    );
    when(
      () => repository.startScenarioSession(
        scenarioId: 1,
        caseSessionItemId: 'item-1',
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
      initialLocation: '/cases/case-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(AppButton, 'Start'));
    await tester.pumpAndSettle();
    // Tapping Start opens the preview modal first; its own Start Simulation
    // button is what actually starts the session.
    await tester.tap(find.byKey(const Key('simulation-details-modal-start')));
    await tester.pumpAndSettle();
    // RN's NotificationModal ("Before you get started") comes next.
    await tester.tap(find.text('Start Session'));
    await tester.pumpAndSettle();

    verify(
      () => repository.startScenarioSession(
        scenarioId: 1,
        caseSessionItemId: 'item-1',
      ),
    ).called(1);
    expect(find.text('ROLEPLAY:new-session-1 caseId=case-1'), findsOneWidget);
  });

  testWidgets('onEnsureSession creates a case session when none exists yet', (
    tester,
  ) async {
    when(() => repository.getCaseDetails('case-1')).thenAnswer(
      (_) async => _caseDetails(
        caseSessionId: null,
        scenarios: [_scenario(id: 's1', scenarioId: 1, sessionId: 'item-1')],
      ),
    );
    when(() => repository.createCaseSession('case-1')).thenAnswer((_) async {});
    when(
      () => repository.startScenarioSession(
        scenarioId: 1,
        caseSessionItemId: 'item-1',
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
      initialLocation: '/cases/case-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.widgetWithText(AppButton, 'Start'));
    await tester.pumpAndSettle();

    verify(() => repository.createCaseSession('case-1')).called(1);
  });

  testWidgets('onViewFeedback resolves the session id via getScenarioSessionByCaseItem and navigates', (
    tester,
  ) async {
    when(() => repository.getCaseDetails('case-1')).thenAnswer(
      (_) async => _caseDetails(
        caseSessionId: 'case-session-1',
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
      () => repository.getScenarioSessionByCaseItem('item-1'),
    ).thenAnswer((_) async => 'resolved-session-1');

    await pumpRouterApp(
      tester,
      initialLocation: '/cases/case-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byKey(const Key('path-item-feedback')));
    await tester.pumpAndSettle();

    verify(() => repository.getScenarioSessionByCaseItem('item-1')).called(1);
    // Viewing an already-completed session — must not force a rating
    // prompt on exit, mirroring RN's own fromLogs: true here.
    expect(find.text('FEEDBACK:resolved-session-1 fromLogs=true caseId=case-1'), findsOneWidget);
  });

  testWidgets('shows an error message when loading case details fails', (
    tester,
  ) async {
    when(
      () => repository.getCaseDetails('case-1'),
    ).thenThrow(Exception('network down'));

    await pumpRouterApp(
      tester,
      initialLocation: '/cases/case-1',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.textContaining('Failed to load case details'), findsOneWidget);
  });
}
