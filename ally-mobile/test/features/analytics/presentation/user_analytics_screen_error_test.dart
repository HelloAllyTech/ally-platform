import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/analytics/data/analytics_repository.dart';
import 'package:ally_mobile_flutter/features/analytics/presentation/user_analytics_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/signed_in_auth.dart';

class MockAnalyticsRepository extends Mock implements AnalyticsRepository {}

class MockAccountRepository extends Mock implements AccountRepository {}

void main() {
  testWidgets('shows the empty-state description text when the dashboard fetch fails', (tester) async {
    final repository = MockAnalyticsRepository();
    when(() => repository.getDashboards()).thenAnswer((_) async => throw Exception('network down'));
    // Mocked so this test actually exercises getDashboards failing, not an
    // incidental failure from the unrelated currentUserProvider dependency
    // dashboardsProvider now also awaits.
    final accountRepository = MockAccountRepository();
    when(() => accountRepository.getUser()).thenAnswer(
      (_) async => UserProfile(
        id: 1,
        email: 'a@b.com',
        name: 'A',
        phone: '',
        profileImageUrl: null,
        profileCompleted: true,
      ),
    );

    await pumpApp(
      tester,
      const UserAnalyticsScreen(),
      overrides: [
        analyticsRepositoryProvider.overrideWithValue(repository),
        accountRepositoryProvider.overrideWithValue(accountRepository),
        signedInAuthOverride(),
      ],
    );
    // The screen's first frame is RN's bare loading spinner, which reads no
    // translations, so the locale only starts loading once the dashboards
    // resolve — give that real async I/O a second window.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pumpAndSettle();

    expect(
      find.text('No dashboards are available yet. Please contact your administrator.'),
      findsOneWidget,
    );
  });
}
