import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';
import 'package:ally_mobile_flutter/features/reactions/presentation/reactions_screen.dart';

import '../../support/pump_app.dart';

class MockReactionsRepository extends Mock implements ReactionsRepository {}

// One test per file, same as the review-feature widget tests in this
// directory — see `_review_details_test_fixtures.dart` for why.
void main() {
  testWidgets(
    'renders the who-reacted list with avatars, filter tabs, and re-fetches filtered when a tab is tapped',
    (tester) async {
      final repository = MockReactionsRepository();
      when(() => repository.getReactions('rev-1', offset: 0, reaction: null)).thenAnswer(
        (_) async => ReactionsPage(
          items: [
          // Backend data is keyed by the unicode-codepoint reaction id —
          // same contract as the thread-comment reaction picker.
          Reaction(reaction: '1f44d', createdBy: ReactionUser(id: '1', name: 'Alex', profileImage: null)),
          Reaction(reaction: '2764-fe0f', createdBy: ReactionUser(id: '2', name: 'Sam', profileImage: null)),
        ],
          total: 2,
        ),
      );
      when(() => repository.getReactions('rev-1', offset: 0, reaction: '1f44d')).thenAnswer(
        (_) async => ReactionsPage(
          items: [
          Reaction(reaction: '1f44d', createdBy: ReactionUser(id: '1', name: 'Alex', profileImage: null)),
        ],
          total: 1,
        ),
      );
      when(() => repository.getReactionsCount('rev-1')).thenAnswer((_) async => {'1f44d': 1, '2764-fe0f': 1});

      await pumpApp(
        tester,
        const ReactionsScreen(reviewId: 'rev-1'),
        overrides: [reactionsRepositoryProvider.overrideWithValue(repository)],
      );

      // The "All" tab plus one tab per reaction, each showing its real
      // glyph (mapped from the id) and count — not the invented
      // add-reaction row a prior version of this screen had.
      expect(find.text('All 2'), findsOneWidget);
      expect(find.textContaining('👍'), findsWidgets);
      expect(find.textContaining('❤️'), findsWidgets);
      expect(find.text('Alex'), findsOneWidget);
      expect(find.text('Sam'), findsOneWidget);

      // Tapping the 👍 filter tab re-fetches the list scoped to that
      // reaction id.
      await tester.tap(find.text('1').first);
      await tester.pumpAndSettle();

      verify(() => repository.getReactions('rev-1', offset: 0, reaction: '1f44d')).called(1);
      expect(find.text('Alex'), findsOneWidget);
      expect(find.text('Sam'), findsNothing);
    },
  );
}
