import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/auth/presentation/terms_and_agreement_modal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_translations.dart';

/// `fixedTranslationsOverride()`, not `pumpApp`'s real async translation
/// load — the modal only mounts (and only then starts watching
/// `localizationControllerProvider`) *after* the "open" button is tapped,
/// a frame after this page's own `pumpWidget`, so `pumpApp`'s
/// before-the-tap `runAsync` delay doesn't cover it; confirmed empirically
/// (real translations never resolved in time, showing zero widgets with
/// the expected text at all rather than falling back to a raw key).
Future<void> _pumpTermsPage(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(
    ProviderScope(
      overrides: [fixedTranslationsOverride()],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) =>
                TextButton(onPressed: () => TermsAndAgreementModal.show(context), child: const Text('open')),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('cannot be dismissed without agreeing: no close/back affordance pops it', (tester) async {
    await _pumpTermsPage(tester);

    expect(find.text('Terms and agreement'), findsOneWidget);

    // Android back button / route pop attempt does nothing (PopScope
    // canPop: false).
    final dynamic widgetsAppState = tester.state(find.byType(WidgetsApp));
    await widgetsAppState.didPopRoute();
    await tester.pump();

    expect(find.text('Terms and agreement'), findsOneWidget);
  });

  testWidgets('shows "scroll to bottom" until scrolled, then the checkbox + Agree button', (tester) async {
    await _pumpTermsPage(tester);

    expect(find.byKey(const Key('scroll-to-bottom-button')), findsOneWidget);
    expect(find.byKey(const Key('agree-checkbox-container')), findsNothing);

    await tester.fling(find.byKey(const Key('terms-scroll-view')), const Offset(0, -5000), 8000);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.byKey(const Key('scroll-to-bottom-button')), findsNothing);
    expect(find.byKey(const Key('agree-checkbox-container')), findsOneWidget);
  });

  testWidgets('Agree button stays disabled until the checkbox is checked', (tester) async {
    await _pumpTermsPage(tester);

    await tester.fling(find.byKey(const Key('terms-scroll-view')), const Offset(0, -5000), 8000);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    var agreeButton = tester.widget<AppButton>(find.byType(AppButton));
    expect(agreeButton.isDisabled, isTrue);

    await tester.tap(find.byKey(const Key('agree-checkbox-container')));
    await tester.pump();

    agreeButton = tester.widget<AppButton>(find.byType(AppButton));
    expect(agreeButton.isDisabled, isFalse);
  });

  testWidgets('tapping Agree closes the modal', (tester) async {
    await _pumpTermsPage(tester);

    await tester.fling(find.byKey(const Key('terms-scroll-view')), const Offset(0, -5000), 8000);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    await tester.tap(find.byKey(const Key('agree-checkbox-container')));
    await tester.pump();
    await tester.tap(find.byType(AppButton));
    await tester.pumpAndSettle();

    expect(find.text('Terms and agreement'), findsNothing);
  });

  testWidgets('one tap on "Scroll to bottom" reveals the checkbox and Agree (RN sets the '
      'flag on tap; the footer swap used to shrink the viewport and flip it back)', (tester) async {
    await _pumpTermsPage(tester);

    expect(find.byKey(const Key('scroll-to-bottom-button')), findsOneWidget);

    await tester.tap(find.byKey(const Key('scroll-to-bottom-button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('scroll-to-bottom-button')), findsNothing);
    expect(find.byKey(const Key('agree-checkbox')), findsOneWidget);
    expect(find.byKey(const Key('agree-checkbox-container')), findsOneWidget);
    expect(find.widgetWithText(AppButton, 'Agree'), findsOneWidget);

    // Still there after any trailing scroll notifications/re-layout.
    await tester.pump(const Duration(seconds: 1));
    expect(find.byKey(const Key('scroll-to-bottom-button')), findsNothing);
    expect(find.widgetWithText(AppButton, 'Agree'), findsOneWidget);
  });

  testWidgets('scrolling back up after reaching the bottom keeps Agree visible (one-way latch)', (tester) async {
    await _pumpTermsPage(tester);

    await tester.tap(find.byKey(const Key('scroll-to-bottom-button')));
    await tester.pumpAndSettle();
    await tester.fling(find.byKey(const Key('terms-scroll-view')), const Offset(0, 5000), 8000);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('scroll-to-bottom-button')), findsNothing);
    expect(find.widgetWithText(AppButton, 'Agree'), findsOneWidget);
  });

  testWidgets('renders RN\'s TermsAndAgreement copy: serif bullets, Medium bold run, crisis link', (tester) async {
    await _pumpTermsPage(tester);

    expect(find.text('General Terms (All Users)'), findsOneWidget);
    expect(find.text('•'), findsWidgets);
    final bullet = tester.widget<Text>(find.text('•').first);
    expect(bullet.style?.fontFamily, 'IBMPlexSerif-Regular');

    final emergency = find.textContaining('https://findahelpline.com/', findRichText: true);
    expect(emergency, findsOneWidget);
  });
}
