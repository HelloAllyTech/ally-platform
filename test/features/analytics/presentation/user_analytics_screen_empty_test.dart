import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/widgets/app_empty_state.dart';
import 'package:ally_mobile_flutter/features/analytics/data/analytics_repository.dart';
import 'package:ally_mobile_flutter/features/analytics/presentation/user_analytics_screen.dart';

import '../../../support/pump_app.dart';

class MockAnalyticsRepository extends Mock implements AnalyticsRepository {}

void main() {
  testWidgets('shows the shared empty-state primitive when no dashboards exist', (tester) async {
    final repository = MockAnalyticsRepository();
    when(() => repository.getDashboards()).thenAnswer((_) async => []);

    await pumpApp(
      tester,
      const UserAnalyticsScreen(),
      overrides: [analyticsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.byType(AppEmptyState), findsOneWidget);
    expect(find.text('No data'), findsOneWidget);
  });
}
