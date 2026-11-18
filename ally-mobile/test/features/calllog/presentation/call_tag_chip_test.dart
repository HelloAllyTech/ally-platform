import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';
import 'package:ally_mobile_flutter/features/calllog/presentation/call_tag_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders the tag label', (tester) async {
    await tester.pumpWidget(
      _wrap(CallTagChip(tag: CallTag(tag: 'anxious', positivityRating: 1))),
    );

    expect(find.text('anxious'), findsOneWidget);
  });

  testWidgets('falls back to the neutral (3) color for a rating outside 1-5', (tester) async {
    await tester.pumpWidget(
      _wrap(CallTagChip(tag: CallTag(tag: 'unknown', positivityRating: 7))),
    );

    final container = tester.widget<Container>(find.byType(Container));
    final decoration = container.decoration as BoxDecoration;
    expect(decoration.color, const Color(0x80EBEBEB));
  });

  testWidgets('a rating of 5 uses the dark-green positive color', (tester) async {
    await tester.pumpWidget(
      _wrap(CallTagChip(tag: CallTag(tag: 'resolved', positivityRating: 5))),
    );

    final container = tester.widget<Container>(find.byType(Container));
    final decoration = container.decoration as BoxDecoration;
    expect(decoration.color, const Color(0x80B9EFC8));
  });
}
