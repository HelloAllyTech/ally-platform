import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/scribe/presentation/elapsed_timer.dart';

void main() {
  testWidgets('formats elapsed time as HH:MM:SS and ticks every second', (tester) async {
    var now = DateTime(2026, 1, 1, 10, 0, 0);
    final startTime = DateTime(2026, 1, 1, 8, 5, 3);

    await tester.pumpWidget(
      MaterialApp(home: ElapsedTimer(startTime: startTime, now: () => now)),
    );

    expect(find.text('01:54:57'), findsOneWidget);

    now = now.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('01:54:58'), findsOneWidget);
  });

  testWidgets('never shows negative elapsed time if now is somehow before startTime', (
    tester,
  ) async {
    final now = DateTime(2026, 1, 1, 8, 0, 0);
    final startTime = DateTime(2026, 1, 1, 9, 0, 0);

    await tester.pumpWidget(
      MaterialApp(home: ElapsedTimer(startTime: startTime, now: () => now)),
    );

    expect(find.text('00:00:00'), findsOneWidget);
  });
}
