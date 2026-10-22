import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_tab_view.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';
import 'package:ally_mobile_flutter/features/analytics/data/analytics_repository.dart';
import 'package:ally_mobile_flutter/features/analytics/presentation/user_analytics_screen.dart';

import '../../../support/pump_app.dart';

class MockAnalyticsRepository extends Mock implements AnalyticsRepository {}

class MockAccountRepository extends Mock implements AccountRepository {}

void main() {
  testWidgets('hides the tab switcher when only one dashboard type is present', (tester) async {
    final repository = MockAnalyticsRepository();
    when(() => repository.getDashboards()).thenAnswer(
      (_) async => [
        Dashboard(
          externalId: 'call-1',
          name: 'call-1',
          analyticsType: AnalyticsType.callLogAnalytics,
        ),
      ],
    );
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
      ],
    );

    expect(find.byType(AppTabView<AnalyticsType>), findsNothing);
    expect(find.byType(ClipRRect), findsOneWidget);
  });
}
