import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/analytics/data/analytics_repository.dart';
import 'package:ally_mobile_flutter/features/analytics/presentation/user_analytics_screen.dart';

import '../../../support/pump_app.dart';

class MockAnalyticsRepository extends Mock implements AnalyticsRepository {}

void main() {
  testWidgets('shows the empty-state description text when the dashboard fetch fails', (tester) async {
    final repository = MockAnalyticsRepository();
    when(() => repository.getDashboards()).thenAnswer((_) async => throw Exception('network down'));

    await pumpApp(
      tester,
      const UserAnalyticsScreen(),
      overrides: [analyticsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(
      find.text('No dashboards are available yet. Please contact your administrator.'),
      findsOneWidget,
    );
  });
}
