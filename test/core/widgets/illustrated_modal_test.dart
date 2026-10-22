import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/illustrated_modal.dart';

void main() {
  Future<void> pumpShow(
    WidgetTester tester, {
    String titleMain = 'Safeguard your',
    String? titleItalic = 'account',
    String description = 'Are you sure?',
    String? actionButtonText = 'Logout',
    VoidCallback? onActionPressed,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => IllustratedModal.show(
              context,
              titleMain: titleMain,
              titleItalic: titleItalic,
              description: description,
              actionButtonText: actionButtonText,
              onActionPressed: onActionPressed,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('renders the two-part title, description, and action button', (tester) async {
    await pumpShow(tester, onActionPressed: () {});

    expect(find.textContaining('Safeguard your'), findsOneWidget);
    expect(find.textContaining('account'), findsOneWidget);
    expect(find.text('Are you sure?'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Logout'), findsOneWidget);
  });

  testWidgets('tapping the X dismisses without ever calling onActionPressed', (tester) async {
    var pressed = false;
    await pumpShow(tester, onActionPressed: () => pressed = true);

    await tester.tap(find.byKey(const ValueKey('illustrated-modal-close')));
    await tester.pumpAndSettle();

    expect(pressed, isFalse);
    expect(find.text('Are you sure?'), findsNothing, reason: 'the modal closed');
  });

  testWidgets('tapping the action button calls onActionPressed and closes', (tester) async {
    var pressed = false;
    await pumpShow(tester, onActionPressed: () => pressed = true);

    await tester.tap(find.widgetWithText(AppButton, 'Logout'));
    await tester.pumpAndSettle();

    expect(pressed, isTrue);
    expect(find.text('Are you sure?'), findsNothing);
  });

  testWidgets('tapping the barrier does not dismiss it (X-only close, matching RN)', (tester) async {
    await pumpShow(tester);
    expect(find.text('Are you sure?'), findsOneWidget);

    // Tap far outside the dialog card, where only the modal barrier is.
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();

    expect(find.text('Are you sure?'), findsOneWidget, reason: 'still showing');
  });
}
