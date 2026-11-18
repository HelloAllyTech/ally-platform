import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_details_card.dart';

// One test per file — see share_for_review_success_test.dart's doc comment.
void main() {
  testWidgets('shows the Date & time / Duration context rows when the caller supplies them', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: ShareForReviewScreen(
            scenarioSessionId: 'sess-1',
            contextDateTime: '2026-06-02T21:10:00',
            contextDuration: '277',
          ),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    expect(find.textContaining('Date & time'), findsOneWidget);
    expect(find.textContaining('Duration'), findsOneWidget);
    expect(find.textContaining('4:37 min'), findsOneWidget);
    // No title was supplied, so the bordered details card still renders
    // (the rows above it aren't enough on their own) with its "-" fallback.
    expect(find.byType(SimulationDetailsCard), findsOneWidget);
  });
}
