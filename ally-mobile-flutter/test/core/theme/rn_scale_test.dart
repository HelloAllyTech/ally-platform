import 'package:ally_mobile_flutter/core/theme/rn_scale.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('matches react-native-size-matters ms() for a 402pt-wide phone', () {
    // ms(16) on RN = 16 + (402 / 350 * 16 - 16) * 0.5
    const rnMs16 = 16 + (402 / 350 * 16 - 16) * 0.5;
    expect(16 * rnScaleFactor(402), closeTo(rnMs16, 1e-9));
    expect(rnScaleFactor(350), 1.0);
  });

  testWidgets('lays the child out in the scaled-down viewport with scaled insets', (tester) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 62, bottom: 34);
    addTearDown(tester.view.reset);

    late MediaQueryData seen;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => RnScale(child: child!),
        home: Builder(builder: (context) {
          seen = MediaQuery.of(context);
          return const SizedBox.shrink();
        }),
      ),
    );

    final factor = rnScaleFactor(402);
    expect(seen.size.width, closeTo(402 / factor, 1e-6));
    expect(seen.padding.top, closeTo(62 / factor, 1e-6));
    expect(seen.padding.bottom, closeTo(34 / factor, 1e-6));
  });

  testWidgets('taps land on the widget drawn under the finger after scaling', (tester) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    var tapped = '';
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => RnScale(child: child!),
        home: Scaffold(
          body: Column(
            children: [
              for (final label in ['a', 'b', 'c'])
                SizedBox(
                  height: 100,
                  width: double.infinity,
                  child: GestureDetector(onTap: () => tapped = label, child: Text(label)),
                ),
            ],
          ),
        ),
      ),
    );

    // Row "c" is laid out at y=200..300 and painted at 200..300 * factor.
    await tester.tapAt(Offset(50, 250 * rnScaleFactor(402)));
    expect(tapped, 'c');
    // The painted rect, not the layout rect, is what the screen shows.
    expect(tester.getRect(find.text('c')).top, closeTo(200 * rnScaleFactor(402), 0.5));
  });

  testWidgets('RnSize renders @s/@vs/@mvs and raw values at RN\'s physical size', (tester) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    late RnSize rn;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => RnScale(child: child!),
        home: Builder(builder: (context) {
          rn = RnSize.of(context);
          return const SizedBox.shrink();
        }),
      ),
    );

    // What the screen shows is the logical value times RnScale's factor;
    // that must equal react-native-size-matters' own result for 402x874.
    final f = rnScaleFactor(402);
    expect(rn.s(10) * f, closeTo(10 * 402 / 350, 1e-6));
    expect(rn.vs(10) * f, closeTo(10 * 874 / 680, 1e-6));
    expect(rn.mvs(10) * f, closeTo(10 + (10 * 874 / 680 - 10) * 0.5, 1e-6));
    expect(rn.raw(16) * f, closeTo(16, 1e-6));
  });
}
