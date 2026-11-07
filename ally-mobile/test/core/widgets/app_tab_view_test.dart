import 'package:ally_mobile_flutter/core/widgets/app_tab_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders every tab label and calls onTabChange with the tapped key', (tester) async {
    String? selected;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppTabView<String>(
            tabs: const [
              AppTabViewItem(key: 'calls', label: 'Real call logs'),
              AppTabViewItem(key: 'sims', label: 'Simulations'),
            ],
            activeTab: 'calls',
            onTabChange: (key) => selected = key,
          ),
        ),
      ),
    );

    expect(find.text('Real call logs'), findsOneWidget);
    expect(find.text('Simulations'), findsOneWidget);

    await tester.tap(find.text('Simulations'));
    expect(selected, 'sims');
  });
}
