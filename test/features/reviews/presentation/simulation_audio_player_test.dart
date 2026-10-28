import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_audio_player.dart';

import '../../../support/fake_simulation_audio_playback_controller.dart';

void main() {
  late FakeSimulationAudioPlaybackController controller;

  setUp(() {
    controller = FakeSimulationAudioPlaybackController();
  });

  Future<void> pump(WidgetTester tester) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SimulationAudioPlayer(
          audioUrl: 'https://cdn.example.com/session.ogg',
          controller: controller,
        ),
      ),
    ),
  );

  testWidgets('tapping play loads the source, sets the initial rate, and starts playback', (
    tester,
  ) async {
    await pump(tester);

    expect(find.byKey(const ValueKey('simulation-audio-player-play')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-toggle')));
    await tester.pumpAndSettle();

    expect(controller.sourceUrl, 'https://cdn.example.com/session.ogg');
    expect(controller.lastPlaybackRate, 1.0);
    expect(controller.resumeCalls, 1);
    expect(find.byKey(const ValueKey('simulation-audio-player-pause')), findsOneWidget);
  });

  testWidgets('tapping pause while playing calls pause and does not reload the source', (
    tester,
  ) async {
    await pump(tester);

    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-toggle')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-toggle')));
    await tester.pumpAndSettle();

    expect(controller.pauseCalls, 1);
    expect(controller.resumeCalls, 1, reason: 'pausing never calls resume again');
    expect(find.byKey(const ValueKey('simulation-audio-player-play')), findsOneWidget);
  });

  testWidgets('cycling the playback rate goes 1x -> 1.5x -> 2x -> 2.5x -> back to 1x', (
    tester,
  ) async {
    await pump(tester);

    expect(find.text('1x'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-rate')));
    await tester.pump();
    expect(find.text('1.5x'), findsOneWidget);
    expect(controller.lastPlaybackRate, 1.5);

    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-rate')));
    await tester.pump();
    expect(find.text('2x'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-rate')));
    await tester.pump();
    expect(find.text('2.5x'), findsOneWidget);
    expect(controller.lastPlaybackRate, 2.5);

    await tester.tap(find.byKey(const ValueKey('simulation-audio-player-rate')));
    await tester.pump();
    expect(find.text('1x'), findsOneWidget);
    expect(controller.lastPlaybackRate, 1.0);
  });

  testWidgets('tapping partway along the progress bar seeks proportionally into the duration', (
    tester,
  ) async {
    await pump(tester);
    controller.emitDuration(const Duration(seconds: 100));
    await tester.pump();

    final progressBar = find.byKey(const ValueKey('simulation-audio-player-progress'));
    final topLeft = tester.getTopLeft(progressBar);
    final size = tester.getSize(progressBar);
    // Tap at the halfway point along the bar's width.
    await tester.tapAt(Offset(topLeft.dx + size.width / 2, topLeft.dy + size.height / 2));
    await tester.pump();

    expect(controller.lastSeek, isNotNull);
    expect(controller.lastSeek!.inSeconds, closeTo(50, 2));
  });

  testWidgets('position and duration updates render as formatted MM:SS labels', (tester) async {
    await pump(tester);

    controller.emitDuration(const Duration(minutes: 1, seconds: 5));
    controller.emitPosition(const Duration(seconds: 30));
    await tester.pump();

    expect(find.text('00:30'), findsOneWidget);
    expect(find.text('01:05'), findsOneWidget);
  });

  testWidgets('disposing the widget disposes the controller', (tester) async {
    await pump(tester);
    await tester.pumpWidget(const SizedBox());

    expect(controller.disposed, isTrue);
  });
}
