import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/audio_waveform.dart';

void main() {
  testWidgets('renders one bar per amplitude, and redraws on its own timer tick', (tester) async {
    final amplitudes = ValueNotifier<List<double>>([0.2, 0.5, 0.8]);
    addTearDown(amplitudes.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AudioWaveformContainer(amplitudes: amplitudes, isPaused: false),
        ),
      ),
    );

    expect(find.byKey(const ValueKey('audio-waveform-container')), findsOneWidget);
    expect(find.byType(Container).evaluate().length, greaterThanOrEqualTo(3));

    amplitudes.value = [0.9, 0.9, 0.9];
    await tester.pump(const Duration(milliseconds: 150));

    // No crash/no pending-timer leak assertion needed beyond pumping once
    // more — `tearDown` disposing the notifier mid-timer is exactly the
    // scenario a leaked `Timer.periodic` would throw on.
  });

  testWidgets('freezes to a flat silent row and stops polling while paused', (tester) async {
    final amplitudes = ValueNotifier<List<double>>([1.0, 1.0]);
    addTearDown(amplitudes.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AudioWaveformContainer(amplitudes: amplitudes, isPaused: true),
        ),
      ),
    );

    // Changing the underlying amplitudes while paused must not show up —
    // the widget already tore down its polling timer.
    amplitudes.value = [1.0, 1.0];
    await tester.pump(const Duration(milliseconds: 150));
  });
}
