import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/core/widgets/app_text_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('typed text reaches onChanged', (tester) async {
    String? value;
    await tester.pumpWidget(_wrap(AppTextField(onChanged: (v) => value = v)));

    await tester.enterText(find.byType(TextField), 'hello');
    expect(value, 'hello');
  });

  testWidgets('isError swaps the border color to the red error tone', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: AppTextField(isError: true))));

    final field = tester.widget<TextField>(find.byType(TextField));
    final border = field.decoration!.enabledBorder as OutlineInputBorder;
    expect(border.borderSide.color, AppColors.red400);
  });

  testWidgets('line shape uses an underline border, not an outline box', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: AppTextField(shape: AppTextFieldShape.line))),
    );

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.decoration!.enabledBorder, isA<UnderlineInputBorder>());
  });
}
