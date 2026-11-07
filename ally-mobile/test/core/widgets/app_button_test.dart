import 'package:ally_mobile_flutter/core/theme/app_fonts.dart';
import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets(
    'renders the label in Roboto, not the inherited bodyMedium serif '
    '(RN\'s Button.tsx has no fontFamily override, so it renders in the '
    'platform default — Roboto on Android)',
    (tester) async {
      await tester.pumpWidget(_wrap(AppButton(label: 'Save', onPressed: () {})));

      final text = tester.widget<Text>(find.text('Save'));
      expect(text.style?.fontFamily, AppFonts.robotoRegular);
    },
  );

  testWidgets('renders the label and calls onPressed when tapped', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      _wrap(AppButton(label: 'Save', onPressed: () => tapped = true)),
    );

    expect(find.text('Save'), findsOneWidget);
    await tester.tap(find.text('Save'));
    expect(tapped, isTrue);
  });

  testWidgets('shows a spinner instead of the label while loading', (tester) async {
    await tester.pumpWidget(
      _wrap(AppButton(label: 'Save', onPressed: () {}, isLoading: true)),
    );

    expect(find.text('Save'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('does not call onPressed when disabled', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      _wrap(AppButton(label: 'Save', onPressed: () => tapped = true, isDisabled: true)),
    );

    await tester.tap(find.text('Save'));
    expect(tapped, isFalse);
  });

  testWidgets('does not call onPressed while loading', (tester) async {
    var tapped = false;
    await tester.pumpWidget(
      _wrap(AppButton(label: 'Save', onPressed: () => tapped = true, isLoading: true)),
    );

    // Nothing tappable shows the label while loading; tap the spinner's area instead.
    await tester.tap(find.byType(CircularProgressIndicator));
    expect(tapped, isFalse);
  });

  testWidgets('secondary variant renders with a visible border', (tester) async {
    await tester.pumpWidget(
      _wrap(AppButton(label: 'Cancel', onPressed: () {}, variant: AppButtonVariant.secondary)),
    );

    final container = tester.widget<Container>(find.byType(Container).first);
    final decoration = container.decoration as BoxDecoration?;
    expect(decoration?.border, isNotNull);
  });

  testWidgets('ellipsizes rather than overflows when the label is too long to fit', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SizedBox(
          width: 100,
          child: AppButton(
            label: 'A label far too long to fit in a 100px wide button',
            onPressed: () {},
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
  });

  testWidgets('renders left and right icons alongside the label', (tester) async {
    await tester.pumpWidget(
      _wrap(
        AppButton(
          label: 'Next',
          onPressed: () {},
          iconLeft: const Icon(Icons.arrow_back, key: Key('left')),
          iconRight: const Icon(Icons.arrow_forward, key: Key('right')),
        ),
      ),
    );

    expect(find.byKey(const Key('left')), findsOneWidget);
    expect(find.byKey(const Key('right')), findsOneWidget);
  });
}
