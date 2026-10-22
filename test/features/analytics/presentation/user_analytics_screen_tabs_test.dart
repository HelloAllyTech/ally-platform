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

Dashboard _dashboard(String id, AnalyticsType type) =>
    Dashboard(externalId: id, name: id, analyticsType: type);

void main() {
  // Single testWidgets/pumpApp call per file — see pump_app.dart's own doc
  // comment: a second pumpApp call from a different testWidgets in the same
  // file can leave localizationControllerProvider stuck in AsyncLoading
  // (every translated string this screen renders depends on it).
  testWidgets(
    'shows the AppTabView switcher only when both dashboard types are present, and '
    'switches which dashboards render when tapped',
    (tester) async {
      // Each dashboard panel is (screen width - 50) square — on the
      // default test surface that's taller than the viewport, so
      // `ListView`'s lazy Sliver building only materializes the first
      // panel as an Element regardless of which tab is active. A tall
      // surface puts every panel this test expects within the build
      // cache extent, so `find.byType(ClipRRect)` actually reflects the
      // filtered dashboard count rather than what happens to be
      // on-screen.
      tester.view.physicalSize = const Size(800, 2200);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final repository = MockAnalyticsRepository();
      when(() => repository.getDashboards()).thenAnswer(
        (_) async => [
          _dashboard('call-1', AnalyticsType.callLogAnalytics),
          _dashboard('sim-1', AnalyticsType.simulationAnalytics),
          _dashboard('sim-2', AnalyticsType.simulationAnalytics),
        ],
      );
      // Deliberately left unstubbed: `getDashboardUrl` throwing
      // MissingStubError inside the FutureProvider becomes a real
      // AsyncError, which `_DashboardWebView`'s `error` branch renders as
      // plain text — never constructing a real `WebViewController`, which
      // has no platform implementation under `flutter test` (see
      // game_player_test.dart's doc comment for the same gotcha).
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

      expect(find.byType(AppTabView<AnalyticsType>), findsOneWidget);
      expect(find.text('Real call logs'), findsOneWidget);
      expect(find.text('Simulations'), findsOneWidget);

      // Default active tab is call-log analytics: 1 dashboard panel.
      expect(find.byType(ClipRRect), findsOneWidget);

      await tester.tap(find.text('Simulations'));
      await tester.pumpAndSettle();

      // Switched to simulation analytics: 2 dashboard panels.
      expect(find.byType(ClipRRect), findsNWidgets(2));
    },
  );
}
