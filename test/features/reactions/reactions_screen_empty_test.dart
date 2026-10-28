import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file (translation-load timing; see pump_app.dart).
void main() {
  testWidgets('shows the empty state under the always-present "All 0" filter tab',
      (tester) async {
    final repository = MockReactionsRepository();
    when(() => repository.getReactions('rev-1', offset: 0, reaction: null)).thenAnswer((_) async => const ReactionsPage(items: [], total: 0));
    when(() => repository.getReactionsCount('rev-1')).thenAnswer((_) async => {});

    await pumpApp(
      tester,
      const ReactionsScreen(reviewId: 'rev-1'),
      overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('No reactions yet'), findsOneWidget);
    expect(find.text('All 0'), findsOneWidget);
    expect(find.text('Reactions'), findsOneWidget);
  });
}
