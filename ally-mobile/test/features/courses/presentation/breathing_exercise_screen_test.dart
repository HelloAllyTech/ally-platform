import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/breathing_exercise_screen.dart';

import '../../../support/fake_translations.dart';

BreathingExerciseContent _config({
  double inhaleSeconds = 4,
  double holdInSeconds = 1,
  double exhaleSeconds = 4,
  double holdOutSeconds = 1,
  int cycles = 2,
}) => BreathingExerciseContent(
  inhaleSeconds: inhaleSeconds,
  holdInSeconds: holdInSeconds,
  exhaleSeconds: exhaleSeconds,
  holdOutSeconds: holdOutSeconds,
  cycles: cycles,
  inhaleText: 'Breathe in',
  holdInText: 'Hold',
  exhaleText: 'Breathe out',
  holdOutText: 'Hold',
);

// Not `pumpRouterApp`/`pumpApp` for most of these: both end in an unbounded
// `pumpAndSettle()`, and this screen's `AnimationController` keeps ticking
// across every phase of every cycle (up to ~10s of simulated time for the
// default config here) — `pumpAndSettle` either times out or, worse,
// silently runs the whole sequence to its end before a test ever gets
// control back, defeating any assertion about an early phase. Bounded
// `tester.pump(duration)` calls instead, same class of gotcha as
// RoleplayVoiceScreen's session timer and BoxBreathingScreen's countdown
// elsewhere in this codebase.
Future<GoRouter> _pump(
  WidgetTester tester, {
  required BreathingExerciseContent config,
  bool pushedFromBack = false,
}) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(
    initialLocation: pushedFromBack ? '/back' : '/breathing',
    routes: [
      GoRoute(
        path: '/breathing',
        builder: (context, state) => BreathingExerciseScreen(config: config),
      ),
      GoRoute(path: '/back', builder: (context, state) => const Text('BACK')),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [fixedTranslationsOverride()],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  if (pushedFromBack) {
    router.push('/breathing');
    // Bounded, not `pumpAndSettle()` — same reasoning as this file's own
    // doc comment: lets the push transition finish without also running
    // the breathing animation (already ticking by now) to its end.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  } else {
    await tester.pump();
  }
  return router;
}

void main() {
  testWidgets('starts on the inhale phase showing its text and cycle 1', (tester) async {
    await _pump(tester, config: _config());

    expect(find.text('Breathe in'), findsOneWidget);
    expect(find.text('Cycle 1 of 2'), findsOneWidget);
    expect(find.byKey(const ValueKey('breathing-square')), findsOneWidget);
    expect(find.byKey(const ValueKey('breathing-dot')), findsOneWidget);
  });

  testWidgets('advances inhale -> holdIn -> exhale -> holdOut as each phase\'s timer elapses', (
    tester,
  ) async {
    await _pump(
      tester,
      config: _config(inhaleSeconds: 1, holdInSeconds: 1, exhaleSeconds: 1, holdOutSeconds: 1),
    );

    expect(find.text('Breathe in'), findsOneWidget);

    // Pumping *exactly* the phase duration doesn't reliably cross
    // `AnimationController`'s own completion boundary (confirmed by
    // instrumenting the real status listener while writing this test: a
    // dead-on 1000ms pump left the controller's dot at its fully-travelled
    // end position but never fired `AnimationStatus.completed` at all,
    // where 1010ms fired completed -> dismissed -> forward immediately, as
    // expected for a controller restarting itself from its own listener).
    // A small buffer past each boundary avoids relying on exact
    // floating-point timing.
    const pastBoundary = Duration(milliseconds: 1010);
    await tester.pump(pastBoundary);
    expect(find.text('Hold'), findsOneWidget, reason: 'holdIn');

    await tester.pump(pastBoundary);
    expect(find.text('Breathe out'), findsOneWidget, reason: 'exhale');

    await tester.pump(pastBoundary);
    expect(find.text('Hold'), findsOneWidget, reason: 'holdOut');

    await tester.pump(pastBoundary);
    expect(find.text('Breathe in'), findsOneWidget, reason: 'back to inhale, cycle 2');
    expect(find.text('Cycle 2 of 2'), findsOneWidget);
  });

  testWidgets('stops advancing once every cycle is complete, rather than looping or crashing', (
    tester,
  ) async {
    await _pump(
      tester,
      config: _config(inhaleSeconds: 1, holdInSeconds: 1, exhaleSeconds: 1, holdOutSeconds: 1, cycles: 1),
    );

    // One full cycle (4 phases x 1s) finishes exactly at the end of
    // holdOut — the screen should simply stay put on that last frame, not
    // attempt a phase 5.
    await tester.pump(const Duration(seconds: 4));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('Hold'), findsOneWidget, reason: 'still on the finished holdOut phase');
    expect(find.text('Cycle 1 of 1'), findsOneWidget);
  });

  testWidgets('the exit button pops back to the course item player', (tester) async {
    await _pump(tester, config: _config(), pushedFromBack: true);

    await tester.tap(find.text('Exit'));
    await tester.pump();

    expect(find.text('BACK'), findsOneWidget);
  });
}
