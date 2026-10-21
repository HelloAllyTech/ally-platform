import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/boxbreathing/presentation/box_breathing_screen.dart';

import '../../../support/prewarm_translations.dart';

/// `BoxBreathingScreen` drives its own `AnimationController` in an endless
/// loop (it `forward()`s again every time a phase completes, forever) —
/// `pumpAndSettle` (what the shared `pumpApp` helper uses) would never see
/// "no more scheduled frames" and time out, so this pumps explicitly
/// instead, replicating `pumpApp`'s translation-loading sequence without
/// the final settle.
Future<void> _pumpBoxBreathing(WidgetTester tester) async {
  await preWarmTranslations(tester);
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    const ProviderScope(child: MaterialApp(home: BoxBreathingScreen())),
  );
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pump();
}

void main() {
  testWidgets('starts on the Inhale phase', (tester) async {
    await _pumpBoxBreathing(tester);

    expect(find.text('Box breathing'), findsOneWidget);
    expect(find.text('Inhale'), findsOneWidget);
  });

  // The controller's own 4-second-per-phase timing (box_breathing_screen.dart's
  // `_phaseDuration`) is exercised directly via `tester.pump(duration)` — this
  // is what's "reasonably testable" here without fighting the animation
  // controller itself; verifying the exact scale/transform curve isn't
  // attempted.
  testWidgets('advances inhale -> hold -> exhale -> hold -> inhale every 4s', (tester) async {
    await _pumpBoxBreathing(tester);
    expect(find.text('Inhale'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Hold'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Exhale'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Hold'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Inhale'), findsOneWidget);
  });

  testWidgets('counts 1 to 4 once per second within a phase, resetting on the next one', (tester) async {
    await _pumpBoxBreathing(tester);
    expect(find.text('1'), findsOneWidget);

    await tester.pump(const Duration(seconds: 1));
    expect(find.text('2'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('3'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('4'), findsOneWidget);

    // Phase changes at 4s total — the countdown resets to 1 for the new phase.
    await tester.pump(const Duration(milliseconds: 1050));
    expect(find.text('Hold'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('pausing stops both the phase animation and the countdown, resuming restarts them', (
    tester,
  ) async {
    await _pumpBoxBreathing(tester);

    await tester.tap(find.byIcon(Icons.pause));
    await tester.pump();
    expect(find.byIcon(Icons.play_arrow), findsOneWidget, reason: 'icon flips to show the resume action');

    // Neither the phase nor the countdown advance while paused.
    await tester.pump(const Duration(seconds: 4, milliseconds: 50));
    expect(find.text('Inhale'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.play_arrow));
    await tester.pump();
    expect(find.byIcon(Icons.pause), findsOneWidget);

    await tester.pump(const Duration(seconds: 1));
    expect(find.text('2'), findsOneWidget, reason: 'countdown resumes ticking');
  });

  testWidgets('tapping the volume button toggles its own icon', (tester) async {
    await _pumpBoxBreathing(tester);

    expect(find.byIcon(Icons.volume_up), findsOneWidget);
    expect(find.byIcon(Icons.volume_off), findsNothing);

    await tester.tap(find.byIcon(Icons.volume_up));
    await tester.pump();

    expect(find.byIcon(Icons.volume_off), findsOneWidget);
    expect(find.byIcon(Icons.volume_up), findsNothing);
  });
}
