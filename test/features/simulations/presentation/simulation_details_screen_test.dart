import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';
import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';
import 'package:ally_mobile_flutter/features/simulations/presentation/simulation_details_screen.dart';

import '../../../support/fake_network_image.dart';
import '../../../support/pump_router_app.dart';

class MockSimulationsRepository extends Mock implements SimulationsRepository {}

/// `HtmlRichText` renders via bare `RichText` widgets, which `find.text`
/// doesn't match — same helper `html_rich_text_test.dart` uses.
String _allText(WidgetTester tester) => tester
    .widgetList<RichText>(find.byType(RichText))
    .map((w) => w.text.toPlainText())
    .join('\n');

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
    expect(_allText(tester), contains('Practice de-escalation'));
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

    // "Start" + "Role play" (RN's own literal translations) concatenated —
    // not the separately-curated, differently-cased `common.startSimulation`
    // key, which isn't what the real screen's header/button actually render.
    await tester.tap(find.widgetWithText(AppButton, 'Start Role play'));
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

    await tester.tap(find.widgetWithText(AppButton, 'Start Role play'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Failed to start simulation'), findsOneWidget);
  });

  testWidgets('shows a completed chip with the right pluralization once attempted', (tester) async {
    when(() => repository.getScenarioById(6)).thenAnswer(
      (_) async => Scenario.fromJson({
        'id': 6,
        'title': 'Repeat scenario',
        'description': 'desc',
        'completion': {'attemptCount': 3, 'lastCompletedAt': null},
      }),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/6',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Completed 3 times'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Practise again'), findsOneWidget);
  });

  testWidgets('renders trigger warning chips when present', (tester) async {
    when(() => repository.getScenarioById(7)).thenAnswer(
      (_) async => Scenario.fromJson({
        'id': 7,
        'title': 'Sensitive scenario',
        'description': 'desc',
        'triggerWarnings': [
          {'id': 'tw1', 'name': 'Self-harm'},
          {'id': 'tw2', 'name': 'Violence'},
        ],
      }),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/7',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('Self-harm'), findsOneWidget);
    expect(find.text('Violence'), findsOneWidget);
  });

  testWidgets('tapping share copies the scenario link and shows a confirmation', (tester) async {
    // `Clipboard.setData`/`getData` have no default handler under plain
    // `flutter test` — without this, the call never completes and the test
    // hangs instead of failing outright.
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String?;
      }
      return null;
    });
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/5',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byType(IconButton));
    await tester.pump();

    expect(copied, 'https://app.helloally.ai/scenario/5');
    expect(find.text('Link copied to clipboard'), findsOneWidget);
  });

  testWidgets('selecting a language passes its languageId to startScenarioSession', (tester) async {
    when(() => repository.getScenarioById(8)).thenAnswer(
      (_) async => Scenario.fromJson({
        'id': 8,
        'title': 'Multilingual scenario',
        'description': 'desc',
        'availableLanguages': [
          {'language_id': 1, 'label': 'English', 'active': true},
          {'language_id': 2, 'label': 'Hindi', 'active': true},
        ],
      }),
    );
    when(() => repository.startScenarioSession(scenarioId: 8, languageId: 2)).thenAnswer(
      (_) async => SessionData(
        id: 'session-1',
        accessToken: 'tok',
        liveKitServerUrl: 'wss://livekit.example.com',
      ),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/simulations/8',
      routes: _routes(),
      overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('English'), findsOneWidget, reason: 'defaults to the first available language');

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hindi').last);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(AppButton, 'Start Role play'));
    await tester.pumpAndSettle();

    verify(() => repository.startScenarioSession(scenarioId: 8, languageId: 2)).called(1);
  });

  testWidgets('renders an HTML description with headings via HtmlRichText', (tester) async {
    await withFakeNetworkImages(() async {
      when(() => repository.getScenarioById(9)).thenAnswer(
        (_) async => Scenario.fromJson({
          'id': 9,
          'title': 'Rich scenario',
          'description': '<h2>What makes this hard</h2><p>Some context.</p>',
          'coverImageUrl': 'https://cdn.example.com/cover.png',
        }),
      );

      await pumpRouterApp(
        tester,
        initialLocation: '/simulations/9',
        routes: _routes(),
        overrides: [simulationsRepositoryProvider.overrideWithValue(repository)],
      );

      expect(_allText(tester), contains('What makes this hard'));
      expect(_allText(tester), contains('Some context.'));
      expect(find.byType(Image), findsOneWidget);
    });
  });
}
