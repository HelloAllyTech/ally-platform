import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/roleplay/presentation/session_score_meter.dart';

import '../../../support/pump_app.dart';

// One `testWidgets` per file — see
// session_info_tabs_switching_test.dart for why.
void main() {
  testWidgets('renders the label and the pointer at the clamped position', (tester) async {
    await pumpApp(
      tester,
      const Scaffold(body: SizedBox(width: 300, child: SessionScoreMeter(score: 500))),
    );

    expect(find.text('Simulation Score'), findsOneWidget);

    final pointer = tester.widget<AnimatedPositioned>(
      find.byKey(const ValueKey('score-meter-pointer')),
    );
    // score=500 clamps to 100 (the max), so the pointer sits at the
    // rightmost allowed position, not off the edge of the 300px bar.
    expect(pointer.left, 300 - 16);
  });
}
