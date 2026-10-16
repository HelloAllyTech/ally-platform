import 'package:ally_mobile_flutter/core/widgets/app_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('elevated variant renders a drop shadow', (tester) async {
    await tester.pumpWidget(_wrap(const AppCard(child: Text('content'))));

    final container = tester.widget<Container>(find.byType(Container).first);
    final decoration = container.decoration as BoxDecoration;
    expect(decoration.boxShadow, isNotEmpty);
  });

  testWidgets('flat variant renders no drop shadow', (tester) async {
    await tester.pumpWidget(
      _wrap(const AppCard(variant: AppCardVariant.flat, child: Text('content'))),
    );

    final container = tester.widget<Container>(find.byType(Container).first);
    final decoration = container.decoration as BoxDecoration;
    expect(decoration.boxShadow, isNull);
  });

  testWidgets('renders the child content', (tester) async {
    await tester.pumpWidget(_wrap(const AppCard(child: Text('Scenario title'))));

    expect(find.text('Scenario title'), findsOneWidget);
  });
}
