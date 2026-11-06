import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';
import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

List<Reaction> _rows(int from, int count) => [
      for (var i = from; i < from + count; i++)
        Reaction(reaction: '1f44d', createdBy: ReactionUser(id: '$i', name: 'Person $i', profileImage: null)),
    ];

void main() {
  testWidgets(
    "pages 20 at a time like RN's useReactions, and stops at the backend's total",
    (tester) async {
      final repository = MockReactionsRepository();
      when(() => repository.getReactions('rev-1', offset: 0, reaction: null))
          .thenAnswer((_) async => ReactionsPage(items: _rows(0, 20), total: 25));
      when(() => repository.getReactions('rev-1', offset: 20, reaction: null))
          .thenAnswer((_) async => ReactionsPage(items: _rows(20, 5), total: 25));
      when(() => repository.getReactionsCount('rev-1')).thenAnswer((_) async => {'1f44d': 25});

      await pumpApp(
        tester,
        const ReactionsScreen(reviewId: 'rev-1'),
        overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
      );
      await tester.pumpAndSettle();
      expect(find.text('Person 0'), findsOneWidget);
      verifyNever(() => repository.getReactions('rev-1', offset: 20, reaction: null));

      await tester.scrollUntilVisible(
        find.text('Person 24'),
        300,
        // The filter-tab row is a second (horizontal) scrollable.
        scrollable: find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Person 24'), findsOneWidget);
      verify(() => repository.getReactions('rev-1', offset: 20, reaction: null)).called(1);

      // 25 of 25 loaded: no third request, however far the list is dragged.
      await tester.drag(find.byType(ListView), const Offset(0, -2000));
      await tester.pumpAndSettle();
      verifyNever(() => repository.getReactions('rev-1', offset: 40, reaction: null));
      expect(find.byType(CircularProgressIndicator), findsNothing);
    },
  );
}
