import 'package:ally_mobile_flutter/core/widgets/app_dropdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows the placeholder when no value is selected', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppDropdown(
            value: null,
            options: const ['English', 'Hindi'],
            onSelect: (_) {},
            placeholder: 'Choose language',
          ),
        ),
      ),
    );

    expect(find.text('Choose language'), findsOneWidget);
  });

  testWidgets('selecting a menu option calls onSelect with its value', (tester) async {
    String? selected;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppDropdown(
            value: null,
            options: const ['English', 'Hindi'],
            onSelect: (value) => selected = value,
          ),
        ),
      ),
    );

    await tester.tap(find.byType(DropdownMenu<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hindi').last);
    await tester.pumpAndSettle();

    expect(selected, 'Hindi');
  });
}
