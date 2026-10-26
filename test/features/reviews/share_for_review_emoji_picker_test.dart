import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

// One test per file — see share_for_review_success_test.dart's doc comment.
void main() {
  testWidgets('tapping an emoji in the picker appends it to the note, matching RN\'s append-only behavior', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: ShareForReviewScreen(scenarioSessionId: 'sess-1'),
        ),
      ),
    );
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'Great session');
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('add-emoji-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.text('🎉'));
    await tester.pumpAndSettle();

    expect(find.text('Great session🎉'), findsOneWidget);
  });
}
