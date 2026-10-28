import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/course_item_player_screen.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

import '../../../support/pump_router_app.dart';
import '../../../support/fake_permission_platform.dart';
import 'package:permission_handler_platform_interface/permission_handler_platform_interface.dart';

class MockCoursesRepository extends Mock implements CoursesRepository {}

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

TrackDetailItem _item(
  String id,
  TrackItemType type, {
  TrackItemStatus status = TrackItemStatus.unlocked,
  String? completedAt,
}) => TrackDetailItem(
  completedAt: completedAt,
  id: id,
  type: type,
  order: id == 'rp' ? 0 : 1,
  title: id == 'rp' ? 'Role play item' : 'Case item',
  description: null,
  status: status,
  score: null,
  maxWatchedPct: null,
);

TrackDetail _track({TrackItemStatus rpStatus = TrackItemStatus.unlocked, String? rpCompletedAt}) => TrackDetail(
  id: 'track-1',
  title: 'Track',
  description: null,
  coverImageUrl: null,
  status: 'IN_PROGRESS',
  totalItems: 2,
  completedItems: 0,
  enrolled: true,
  trackEnrollmentId: 'enr-1',
  sections: [
    TrackSection(
      id: 'a',
      title: 'Section A',
      order: 0,
      items: [
        _item('rp', TrackItemType.roleplay, status: rpStatus, completedAt: rpCompletedAt),
        _item('case', TrackItemType.caseItem),
      ],
    ),
  ],
);

void main() {
  // The start flow asks for the microphone before creating the session
  // (RN useStartSimulation); granted unless a test says otherwise.
  setUp(() => PermissionHandlerPlatform.instance = FakePermissionHandlerPlatform({}));

  late MockCoursesRepository courses;
  late MockSimulationsRepository sims;
  late int trackFetches;

  setUp(() {
    courses = MockCoursesRepository();
    sims = MockSimulationsRepository();
    trackFetches = 0;
    when(() => courses.getLearnTrackDetail('track-1')).thenAnswer((_) async {
      trackFetches++;
      return _track();
    });
    when(() => courses.startTrackItem('rp')).thenAnswer(
      (_) async => StartItemPayload.fromJson({
        'trackItemProgressId': 'tip-1',
        'type': 'ROLEPLAY',
        'scenarioId': 7,
        'completionCriteria': null,
        'lastScenarioSessionId': null,
      }),
    );
    when(() => courses.startTrackItem('case')).thenAnswer(
      (_) async => StartItemPayload.fromJson({
        'trackItemProgressId': 'tip-2',
        'type': 'CASE',
        'caseId': 'case-9',
        'caseSessionId': 'cs',
        'caseCompleted': false,
      }),
    );
    when(() => sims.getScenarioById(7))
        .thenAnswer((_) async => Scenario.fromJson({'id': 7, 'title': 'Scenario seven', 'description': 'Practice'}));
  });

  List<GoRoute> routes(String itemId, TrackItemType type) => [
    GoRoute(
      path: '/player',
      builder: (context, state) => CourseItemPlayerScreen(trackId: 'track-1', item: _item(itemId, type)),
    ),
    GoRoute(
      path: '/roleplay',
      builder: (context, state) {
        final extra = state.extra as Map<String, Object?>;
        return Scaffold(
          body: TextButton(onPressed: () => context.pop(), child: Text('ROLEPLAY:${extra['scenarioSessionId']}')),
        );
      },
    ),
    GoRoute(
      path: '/cases/:caseId',
      builder: (context, state) => Scaffold(
        body: TextButton(onPressed: () => context.pop(), child: Text('CASE:${state.pathParameters['caseId']}')),
      ),
    ),
  ];

  testWidgets('ROLEPLAY: Start launches the session with trackItemProgressId, and returning refetches the track', (
    tester,
  ) async {
    when(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1'))
        .thenAnswer((_) async => SessionData(id: 'sess-7', accessToken: 'tok', liveKitServerUrl: 'wss://lk'));

    await pumpRouterApp(
      tester,
      initialLocation: '/player',
      routes: routes('rp', TrackItemType.roleplay),
      overrides: [
        coursesRepositoryProvider.overrideWithValue(courses),
        simulationsRepositoryProvider.overrideWithValue(sims),
      ],
    );

    expect(find.text('Tap below to start this role play.'), findsOneWidget);
    expect(find.text('Scenario seven'), findsNothing, reason: 'card shows the item title');
    expect(find.text('Role play item'), findsWidgets);
    final fetchesBefore = trackFetches;

    await tester.tap(find.byKey(const Key('roleplay-case-launch')));
    await tester.pumpAndSettle();

    verify(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1')).called(1);
    expect(find.text('ROLEPLAY:sess-7'), findsOneWidget);

    await tester.tap(find.text('ROLEPLAY:sess-7'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('roleplay-case-launch')), findsOneWidget);
    expect(trackFetches, greaterThan(fetchesBefore), reason: 'RN refetches the track on return');
  });

  testWidgets('ROLEPLAY: a 429 start shows the retry modal here too', (tester) async {
    when(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/x'),
        response: Response(requestOptions: RequestOptions(path: '/x'), statusCode: 429),
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/player',
      routes: routes('rp', TrackItemType.roleplay),
      overrides: [
        coursesRepositoryProvider.overrideWithValue(courses),
        simulationsRepositoryProvider.overrideWithValue(sims),
      ],
    );

    await tester.tap(find.byKey(const Key('roleplay-case-launch')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('retry-session-modal')), findsOneWidget);
  });

  testWidgets('CASE: Open case opens the case screen without starting a session', (tester) async {
    when(() => sims.getCaseDetails('case-9')).thenAnswer(
      (_) async => SimulationPathDetails(
        id: 'case-9',
        title: 'Case',
        description: 'Case blurb',
        coverImageUrl: null,
        completedScenarios: 0,
        completedAt: null,
        scenarioPathSessionId: null,
        caseSessionId: 'cs',
        scenarios: const [],
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/player',
      routes: routes('case', TrackItemType.caseItem),
      overrides: [
        coursesRepositoryProvider.overrideWithValue(courses),
        simulationsRepositoryProvider.overrideWithValue(sims),
      ],
    );

    expect(find.widgetWithText(AppButton, 'Open case'), findsOneWidget);
    await tester.tap(find.byKey(const Key('roleplay-case-launch')));
    await tester.pumpAndSettle();

    expect(find.text('CASE:case-9'), findsOneWidget);
    verifyNever(
      () => sims.startScenarioSession(
        scenarioId: any(named: 'scenarioId'),
        trackItemProgressId: any(named: 'trackItemProgressId'),
      ),
    );
  });

  StartItemPayload assessmentPayload(String? submittedAt) => StartItemPayload.fromJson({
    'trackItemProgressId': 'tip-1',
    'type': 'ROLEPLAY',
    'scenarioId': 7,
    'completionCriteria': {'assessmentMode': true},
    'assessmentSubmittedAt': submittedAt,
  });

  Future<void> pumpPlayer(WidgetTester tester) => pumpRouterApp(
    tester,
    initialLocation: '/player',
    routes: routes('rp', TrackItemType.roleplay),
    overrides: [
      coursesRepositoryProvider.overrideWithValue(courses),
      simulationsRepositoryProvider.overrideWithValue(sims),
    ],
  );

  // RN RoleplayCasePlayer.test.tsx — "assessment mode".
  testWidgets('assessment, attempt open: warns about the single attempt and still lets the learner start', (
    tester,
  ) async {
    when(() => courses.startTrackItem('rp')).thenAnswer((_) async => assessmentPayload(null));
    when(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1'))
        .thenAnswer((_) async => SessionData(id: 'sess-a', accessToken: 'tok', liveKitServerUrl: 'wss://lk'));

    await pumpPlayer(tester);

    expect(find.text('This role play is an assessment.'), findsOneWidget);
    expect(find.byKey(const Key('roleplay-assessment-notice')), findsOneWidget);
    await tester.tap(find.byKey(const Key('roleplay-case-launch')));
    await tester.pumpAndSettle();
    verify(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1')).called(1);
  });

  testWidgets('assessment: the backend refusing a second attempt surfaces its message', (tester) async {
    when(() => courses.startTrackItem('rp')).thenAnswer((_) async => assessmentPayload(null));
    when(() => sims.startScenarioSession(scenarioId: 7, trackItemProgressId: 'tip-1')).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/x'),
        response: Response(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 400,
          data: {'message': 'Your assessment attempt for this roleplay is already in progress.'},
        ),
      ),
    );

    await pumpPlayer(tester);
    await tester.tap(find.byKey(const Key('roleplay-case-launch')));
    await tester.pumpAndSettle();

    expect(
      find.text('Failed to start simulation: Your assessment attempt for this roleplay is already in progress.'),
      findsOneWidget,
    );
  });

  testWidgets('assessment passed: shown as completed and locked, no submitted line, no replay', (tester) async {
    when(
      () => courses.getLearnTrackDetail('track-1'),
    ).thenAnswer((_) async => _track(rpStatus: TrackItemStatus.completed, rpCompletedAt: '2026-10-26T09:00:00.000Z'));
    when(() => courses.startTrackItem('rp')).thenAnswer((_) async => assessmentPayload('2026-10-26T09:00:00.000Z'));

    await pumpPlayer(tester);

    expect(find.byKey(const Key('roleplay-assessment-locked')), findsOneWidget);
    expect(find.byKey(const Key('roleplay-assessment-submitted')), findsNothing);
    expect(find.byKey(const Key('roleplay-case-launch')), findsNothing);
    expect(find.byKey(const Key('roleplay-completed-chip')), findsOneWidget);
    expect(find.text('Completed on Oct 26'), findsOneWidget);
  });

  testWidgets('ROLEPLAY assessment already submitted: locked, no launch button', (tester) async {
    when(() => courses.startTrackItem('rp')).thenAnswer(
      (_) async => StartItemPayload.fromJson({
        'trackItemProgressId': 'tip-1',
        'type': 'ROLEPLAY',
        'scenarioId': 7,
        'completionCriteria': {'assessmentMode': true},
        'assessmentSubmittedAt': '2026-10-05T10:00:00Z',
      }),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/player',
      routes: routes('rp', TrackItemType.roleplay),
      overrides: [
        coursesRepositoryProvider.overrideWithValue(courses),
        simulationsRepositoryProvider.overrideWithValue(sims),
      ],
    );

    expect(find.text('This role play is an assessment.'), findsOneWidget);
    expect(find.byKey(const Key('roleplay-assessment-locked')), findsOneWidget);
    expect(find.byKey(const Key('roleplay-assessment-submitted')), findsOneWidget);
    expect(find.byKey(const Key('roleplay-case-launch')), findsNothing);
    expect(find.text('Submitted on Oct 05\nThis attempt didn\'t meet the passing requirements.'), findsOneWidget);

    // The card doesn't launch either.
    await tester.tap(find.text('Role play item').last);
    await tester.pumpAndSettle();
    verifyNever(
      () => sims.startScenarioSession(
        scenarioId: any(named: 'scenarioId'),
        trackItemProgressId: any(named: 'trackItemProgressId'),
      ),
    );
  });
}
