import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/presentation/widgets/description_narration_button.dart';

import '../../../support/fake_simulation_audio_playback_controller.dart';

void main() {
  late FakeSimulationAudioPlaybackController controller;

  setUp(() => controller = FakeSimulationAudioPlaybackController());

  Future<void> pump(WidgetTester tester, String? url) => tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: Scaffold(
          body: DescriptionNarrationButton(audioUrl: url, controller: controller),
        ),
      ),
    ),
  );

  const button = Key('description-narration-button');

  testWidgets('renders nothing without an audio URL', (tester) async {
    await pump(tester, null);
    expect(find.byKey(button), findsNothing);
  });

  testWidgets('shows the button when a URL exists', (tester) async {
    await pump(tester, 'https://cdn.example.com/a.mp3');
    expect(find.byKey(button), findsOneWidget);
    expect(find.byIcon(Icons.play_arrow), findsOneWidget);
  });

  testWidgets('tap plays, second tap pauses, third resumes without reloading', (
    tester,
  ) async {
    await pump(tester, 'https://cdn.example.com/a.mp3');

    await tester.tap(find.byKey(button));
    await tester.pumpAndSettle();
    expect(controller.sourceUrl, 'https://cdn.example.com/a.mp3');
    expect(controller.resumeCalls, 1);
    expect(find.byIcon(Icons.pause), findsOneWidget);

    await tester.tap(find.byKey(button));
    await tester.pumpAndSettle();
    expect(controller.pauseCalls, 1);
    expect(find.byIcon(Icons.play_arrow), findsOneWidget);

    await tester.tap(find.byKey(button));
    await tester.pumpAndSettle();
    expect(controller.resumeCalls, 2);
    expect(find.byIcon(Icons.pause), findsOneWidget);
  });
}
