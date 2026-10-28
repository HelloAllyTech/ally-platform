import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/theme/app_theme.dart';

void main() {
  testWidgets('a Scaffold\'s default text style carries no line height or letter spacing, like RN\'s unstyled Text',
      (tester) async {
    // Material uses bodyMedium as every Scaffold's DefaultTextStyle, after
    // merging it over the typography geometry (twice, the second time per
    // locale in Theme). RN text without lineHeight/letterSpacing uses the
    // font's own metrics and 0 spacing.
    late TextStyle inherited;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: Builder(builder: (context) {
            inherited = DefaultTextStyle.of(context).style;
            return const SizedBox();
          }),
        ),
      ),
    );
    expect(inherited.height, isNull);
    expect(inherited.letterSpacing, isNull);
  });

  test('RN typography.body.medium stays available by name', () {
    expect(AppTheme.rnBodyMedium.fontSize, 14);
    expect(AppTheme.rnBodyMedium.height, 22 / 14);
    expect(AppTheme.rnBodyMedium.letterSpacing, 0.2);
  });
}
