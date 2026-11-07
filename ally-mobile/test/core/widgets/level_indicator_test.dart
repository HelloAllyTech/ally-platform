import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/level_indicator.dart';

void main() {
  testWidgets('shows the level number inside the ring', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: LevelIndicator(level: 7, progress: 0.6, semanticLabel: 'Level 7'),
      ),
    );

    expect(find.text('7'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('is not tappable when onTap is omitted', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: LevelIndicator(level: 1, progress: 0.0, semanticLabel: 'Level 1'),
      ),
    );

    final gesture = tester.widget<GestureDetector>(find.byType(GestureDetector));
    expect(gesture.onTap, isNull);
  });

  testWidgets('calls onTap when tapped', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: LevelIndicator(
          level: 1,
          progress: 0.0,
          semanticLabel: 'Level 1',
          onTap: () => tapped = true,
        ),
      ),
    );

    await tester.tap(find.byKey(const ValueKey('level-indicator')));
    expect(tapped, isTrue);
  });

  testWidgets('clamps an out-of-range or non-finite progress value instead of crashing', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: LevelIndicator(level: 1, progress: double.nan, semanticLabel: 'Level 1'),
      ),
    );

    final indicator = tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator));
    expect(indicator.value, 0.0);
  });
}
