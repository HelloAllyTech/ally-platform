import 'package:ally_mobile_flutter/features/reviews/presentation/review_note_callout.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/pump_app.dart';

void main() {
  testWidgets('renders the NOTE label and the note content', (tester) async {
    await pumpApp(
      tester,
      const ReviewNoteCallout(note: 'Flagged for follow-up'),
    );

    expect(find.text('NOTE'), findsOneWidget);
    expect(find.text('Flagged for follow-up'), findsOneWidget);
  });

  testWidgets('shows no edit affordance when onEditNote is omitted', (
    tester,
  ) async {
    await pumpApp(
      tester,
      const ReviewNoteCallout(note: 'Flagged for follow-up'),
    );

    expect(find.byIcon(Icons.edit), findsNothing);
  });

  testWidgets('shows a pencil icon that calls onEditNote when supplied', (
    tester,
  ) async {
    var tapped = false;
    await pumpApp(
      tester,
      ReviewNoteCallout(
        note: 'Flagged for follow-up',
        onEditNote: () => tapped = true,
      ),
    );

    expect(find.byIcon(Icons.edit), findsOneWidget);
    await tester.tap(find.byIcon(Icons.edit));
    expect(tapped, isTrue);
  });
}
