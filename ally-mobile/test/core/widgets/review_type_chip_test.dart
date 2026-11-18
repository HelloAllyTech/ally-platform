import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/core/widgets/review_type_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('simulation chip uses deep purple, scribe uses orange', (tester) async {
    await tester.pumpWidget(
      _wrap(const ReviewTypeChip(reviewType: ReviewType.simulation, label: 'Simulation')),
    );
    var container = tester.widget<Container>(find.byType(Container).first);
    var decoration = container.decoration as BoxDecoration;
    expect(decoration.color, AppColors.deepPurple50);

    await tester.pumpWidget(_wrap(const ReviewTypeChip(reviewType: ReviewType.scribe, label: 'Scribe')));
    container = tester.widget<Container>(find.byType(Container).first);
    decoration = container.decoration as BoxDecoration;
    expect(decoration.color, AppColors.orange50);
  });

  testWidgets('renders the caller-supplied label text', (tester) async {
    await tester.pumpWidget(
      _wrap(const ReviewTypeChip(reviewType: ReviewType.simulation, label: 'Simulation')),
    );
    expect(find.text('Simulation'), findsOneWidget);
  });
}
