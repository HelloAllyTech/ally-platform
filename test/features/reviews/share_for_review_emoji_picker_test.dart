import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/reviews/presentation/emoji_keyboard/emoji_keyboard_data.dart';
import 'package:ally_mobile_flutter/features/reviews/presentation/share_for_review_screen.dart';

// One test per file — see share_for_review_success_test.dart's doc comment.
void main() {
  testWidgets(
    'the add-reaction icon opens RN\'s rn-emoji-keyboard port; picks append to the note and it stays open '
    '(allowMultipleSelections)',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      RecentEmojis.clear();
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(home: ShareForReviewScreen(scenarioSessionId: 'sess-1')),
        ),
      );
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'Great session');
      await tester.pump();

      // The bundled emojis.json loads on a real async gap.
      await tester.runAsync(() => loadEmojiCategories());
      await tester.tap(find.byKey(const ValueKey('add-emoji-button')));
      await tester.pump();
      // That future completes in the real zone; let its listeners run.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('emoji-keyboard')), findsOneWidget);
      expect(find.byKey(const Key('emoji-keyboard-search')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('emoji-smileys_emotion-grinning face')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('emoji-smileys_emotion-grinning face')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('emoji-keyboard')), findsOneWidget);
      expect(find.text('Great session😀😀'), findsOneWidget);
      // enableRecentlyUsed: the clock category appears once something is picked.
      expect(find.byKey(const ValueKey('emoji-category-recently_used')), findsOneWidget);
    },
  );
}
