import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/simulation_details_card.dart';

// One test per file — see share_for_review_success_test.dart's doc comment.
void main() {
  testWidgets('shows no context card at all when the caller supplies none of its fields', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: ShareForReviewScreen(scenarioSessionId: 'sess-1'),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    expect(find.byType(SimulationDetailsCard), findsNothing);
  });
}
