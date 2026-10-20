import 'package:ally_mobile_flutter/features/reviews/presentation/review_note_callout.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/pump_app.dart';

void main() {
  testWidgets('renders the NOTE label and the note content', (tester) async {
    await pumpApp(tester, const ReviewNoteCallout(note: 'Flagged for follow-up'));

    expect(find.text('NOTE'), findsOneWidget);
    expect(find.text('Flagged for follow-up'), findsOneWidget);
  });
}
