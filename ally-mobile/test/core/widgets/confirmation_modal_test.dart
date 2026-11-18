import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/core/widgets/confirmation_modal.dart';

void main() {
  Future<bool?> pumpShow(WidgetTester tester) async {
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ConfirmationModal.show(
                context,
                title: 'Archive this',
                subtitle: 'Session',
                description: 'Are you sure?',
                confirmLabel: 'Archive',
                cancelLabel: 'Cancel',
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('renders the title/subtitle, description, and both buttons', (tester) async {
    await pumpShow(tester);

    expect(find.textContaining('Archive this'), findsOneWidget);
    expect(find.textContaining('Session'), findsOneWidget);
    expect(find.text('Are you sure?'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Cancel'), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Archive'), findsOneWidget);
  });

  testWidgets('tapping Confirm resolves true and closes', (tester) async {
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ConfirmationModal.show(
                context,
                title: 'Archive this',
                description: 'Are you sure?',
                confirmLabel: 'Archive',
                cancelLabel: 'Cancel',
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(AppButton, 'Archive'));
    await tester.pumpAndSettle();

    expect(result, isTrue);
    expect(find.text('Are you sure?'), findsNothing);
  });

  testWidgets('tapping Cancel resolves false and closes', (tester) async {
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ConfirmationModal.show(
                context,
                title: 'Archive this',
                description: 'Are you sure?',
                confirmLabel: 'Archive',
                cancelLabel: 'Cancel',
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(AppButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(result, isFalse);
  });

  testWidgets('tapping the X resolves null', (tester) async {
    bool? result = true; // start non-null so we can tell it changed
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await ConfirmationModal.show(
                context,
                title: 'Archive this',
                description: 'Are you sure?',
                confirmLabel: 'Archive',
                cancelLabel: 'Cancel',
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('confirmation-modal-close')));
    await tester.pumpAndSettle();

    expect(result, isNull);
  });
}
