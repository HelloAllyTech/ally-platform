import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_button.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/presentation/complete_profile_screen.dart';

import '../../../support/pump_app.dart';

class MockAccountRepository extends Mock implements AccountRepository {}

void main() {
  // All scenarios below are driven from a single `testWidgets` body, each
  // with its own fresh pump — see pumpApp/pumpRoutedApp's doc comments in
  // test/support/pump_app.dart: a *second, separate* `testWidgets` that
  // pumps a translated screen in this file reliably leaves the localization
  // provider stuck in `AsyncLoading` (an empirically-confirmed test-harness
  // gotcha, not specific to this screen or to go_router — sequential pumps
  // within one test body are unaffected).
  testWidgets('CompleteProfileScreen: no phone field, live-disabled submit, dialog error, navigation', (tester) async {
    // --- Scenario 1: no phone field at all (RN has none either), and ---
    // --- Continue stays disabled until there's a non-empty name.     ---
    final repository1 = MockAccountRepository();
    await pumpApp(
      tester,
      const CompleteProfileScreen(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository1)],
    );

    expect(find.text('Tell us your name to finish setting up your account.'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget, reason: 'name only, no phone field');

    var continueButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Continue'));
    expect(continueButton.isDisabled, isTrue);

    await tester.tap(find.widgetWithText(AppButton, 'Continue'));
    await tester.pumpAndSettle();
    verifyNever(() => repository1.completeProfile(name: any(named: 'name')));

    await tester.enterText(find.byType(TextField), 'Jane Doe');
    await tester.pump();
    continueButton = tester.widget<AppButton>(find.widgetWithText(AppButton, 'Continue'));
    expect(continueButton.isDisabled, isFalse);

    // --- Scenario 2: a thrown repository error surfaces as a dialog, ---
    // --- same as RN's native Alert.alert, not inline text.           ---
    final repository2 = MockAccountRepository();
    when(() => repository2.completeProfile(name: any(named: 'name'))).thenThrow(Exception('network down'));

    await pumpApp(
      tester,
      const CompleteProfileScreen(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository2)],
    );

    await tester.enterText(find.byType(TextField), 'Jane Doe');
    await tester.pump();
    await tester.tap(find.widgetWithText(AppButton, 'Continue'));
    // Not pumpAndSettle: the dialog's `await showDialog(...)` keeps the
    // Continue button's spinner animating indefinitely until it's
    // dismissed, which pumpAndSettle would time out on — same gotcha as
    // the login OTP/terms-modal flow documents.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.textContaining("We couldn't save your profile"), findsOneWidget);

    expect(
      tester.widget<AppButton>(find.widgetWithText(AppButton, 'Continue')).isLoading,
      isFalse,
      reason: 'RN stops loading before its Alert shows',
    );

    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    // --- Scenario 2b: a backend message replaces the generic copy ---
    // --- (RN: `message || t('completeProfile.errorDescription')`).  ---
    final repository2b = MockAccountRepository();
    when(() => repository2b.completeProfile(name: any(named: 'name'))).thenThrow(
      DioException(
        requestOptions: RequestOptions(path: '/users/me/complete-profile'),
        response: Response(
          requestOptions: RequestOptions(path: '/users/me/complete-profile'),
          statusCode: 400,
          data: {'message': 'Name is too long'},
        ),
      ),
    );
    await pumpApp(
      tester,
      const CompleteProfileScreen(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository2b)],
    );
    await tester.enterText(find.byType(TextField), 'Jane Doe');
    await tester.pump();
    await tester.tap(find.widgetWithText(AppButton, 'Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Name is too long'), findsOneWidget);
    expect(find.textContaining("We couldn't save your profile"), findsNothing);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    // --- Scenario 3: a successful submit sends the trimmed name only ---
    // --- and navigates to /home.                                    ---
    List<RouteBase> routes() => [
      GoRoute(path: '/complete-profile', builder: (context, state) => const CompleteProfileScreen()),
      GoRoute(path: '/home', builder: (context, state) => const Text('Home Screen')),
    ];

    final repository3 = MockAccountRepository();
    when(() => repository3.completeProfile(name: 'Jane Doe')).thenAnswer((_) async {});

    await pumpRoutedApp(
      tester,
      initialLocation: '/complete-profile',
      routes: routes(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository3)],
    );

    await tester.enterText(find.byType(TextField), '  Jane Doe  ');
    await tester.pump();
    await tester.tap(find.widgetWithText(AppButton, 'Continue'));
    await tester.pumpAndSettle();

    verify(() => repository3.completeProfile(name: 'Jane Doe')).called(1);
    expect(find.text('Home Screen'), findsOneWidget, reason: 'should navigate to /home on success');
  });
}
