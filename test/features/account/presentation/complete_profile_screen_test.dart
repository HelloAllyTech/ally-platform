import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/presentation/complete_profile_screen.dart';

import '../../../support/pump_app.dart';

class MockAccountRepository extends Mock implements AccountRepository {}

void main() {
  // All four scenarios below are driven from a single `testWidgets` body,
  // each with its own fresh pump — see pumpApp/pumpRoutedApp's doc comments
  // in test/support/pump_app.dart: a *second, separate* `testWidgets` that
  // pumps a translated screen in this file reliably leaves the localization
  // provider stuck in `AsyncLoading` (an empirically-confirmed test-harness
  // gotcha, not specific to this screen or to go_router — sequential pumps
  // within one test body are unaffected).
  testWidgets('CompleteProfileScreen: validation, submit, error, and navigation', (tester) async {
    // --- Scenario 1: empty name fails validation, nothing is submitted. ---
    final repository1 = MockAccountRepository();
    await pumpApp(
      tester,
      const CompleteProfileScreen(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository1)],
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('Required'), findsOneWidget);
    verifyNever(
      () => repository1.completeProfile(name: any(named: 'name'), phone: any(named: 'phone')),
    );

    // --- Scenario 2: a thrown repository error surfaces as an inline message. ---
    final repository2 = MockAccountRepository();
    when(() => repository2.completeProfile(name: any(named: 'name'), phone: any(named: 'phone')))
        .thenThrow(Exception('network down'));

    await pumpApp(
      tester,
      const CompleteProfileScreen(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository2)],
    );

    await tester.enterText(find.byType(TextFormField).first, 'Jane Doe');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.textContaining("We couldn't save your profile"), findsOneWidget);

    // --- Scenario 3: name only (phone left blank) submits phone as null, ---
    // --- then navigates to /home.                                       ---
    List<RouteBase> routes() => [
      GoRoute(
        path: '/complete-profile',
        builder: (context, state) => const CompleteProfileScreen(),
      ),
      GoRoute(path: '/home', builder: (context, state) => const Text('Home Screen')),
    ];

    final repository3 = MockAccountRepository();
    when(() => repository3.completeProfile(name: 'Jane Doe', phone: null)).thenAnswer((_) async {});

    await pumpRoutedApp(
      tester,
      initialLocation: '/complete-profile',
      routes: routes(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository3)],
    );

    await tester.enterText(find.byType(TextFormField).first, '  Jane Doe  ');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    verify(() => repository3.completeProfile(name: 'Jane Doe', phone: null)).called(1);
    expect(find.text('Home Screen'), findsOneWidget, reason: 'should navigate to /home on success');

    // --- Scenario 4: name + phone together submits both, trimmed. ---
    final repository4 = MockAccountRepository();
    when(() => repository4.completeProfile(name: 'Jane Doe', phone: '555-0100')).thenAnswer((_) async {});

    await pumpRoutedApp(
      tester,
      initialLocation: '/complete-profile',
      routes: routes(),
      overrides: [accountRepositoryProvider.overrideWithValue(repository4)],
    );

    await tester.enterText(find.byType(TextFormField).at(0), 'Jane Doe');
    await tester.enterText(find.byType(TextFormField).at(1), '  555-0100  ');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    verify(() => repository4.completeProfile(name: 'Jane Doe', phone: '555-0100')).called(1);
    expect(find.text('Home Screen'), findsOneWidget);
  });
}
