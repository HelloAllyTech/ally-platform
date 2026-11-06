import 'package:ally_mobile_flutter/core/widgets/app_empty_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders the title and description when both are given', (tester) async {
    await tester.pumpWidget(
      _wrap(const AppEmptyState(title: 'No data', description: 'Nothing to show yet.')),
    );

    expect(find.text('No data'), findsOneWidget);
    expect(find.text('Nothing to show yet.'), findsOneWidget);
  });

  testWidgets('omits the description text when none is given', (tester) async {
    await tester.pumpWidget(_wrap(const AppEmptyState(title: 'No data')));

    expect(find.text('No data'), findsOneWidget);
    // Only the title Text should exist - no stray empty description widget.
    expect(find.byType(Text), findsOneWidget);
  });

  testWidgets('renders the provided icon above the title', (tester) async {
    await tester.pumpWidget(
      _wrap(const AppEmptyState(title: 'No data', icon: Icon(Icons.inbox))),
    );

    expect(find.byIcon(Icons.inbox), findsOneWidget);
  });
}
