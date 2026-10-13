import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/leaderboard/data/leaderboard_repository.dart';
import 'package:ally_mobile_flutter/features/leaderboard/presentation/leaderboard_screen.dart';

import '../../../support/pump_app.dart';

class MockLeaderboardRepository extends Mock implements LeaderboardRepository {}

LeaderboardEntry _entry({required int userId, required String name, required int rank}) =>
    LeaderboardEntry(
      userId: userId,
      name: name,
      profileImageUrl: '',
      rank: rank,
      minutesPlayed: rank * 10,
      badgeCount: rank,
    );

void main() {
  testWidgets(
    'LeaderboardScreen: renders ranked list + your rank, and refetches on window change',
    (tester) async {
      final repository = MockLeaderboardRepository();
      when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => [
          _entry(userId: 1, name: 'Alice', rank: 1),
          _entry(userId: 2, name: 'Bob', rank: 2),
        ],
      );
      when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => _entry(userId: 9, name: 'Me', rank: 5),
      );

      await pumpApp(
        tester,
        const LeaderboardScreen(),
        overrides: [leaderboardRepositoryProvider.overrideWithValue(repository)],
      );

      // Default window is "Last 7 days" (lastWeek).
      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('Bob'), findsOneWidget);
      expect(find.text('Your rank'), findsOneWidget);
      verify(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).called(1);
      verify(() => repository.getMyRank(LeaderboardWindow.lastWeek)).called(1);

      // Switching the window dropdown re-fetches both the list and "my
      // rank" with the newly selected window.
      when(() => repository.getLeaderboard(LeaderboardWindow.allTime)).thenAnswer(
        (_) async => [_entry(userId: 3, name: 'Carol', rank: 1)],
      );
      when(() => repository.getMyRank(LeaderboardWindow.allTime)).thenAnswer(
        (_) async => null,
      );

      await tester.tap(find.byType(DropdownButton<LeaderboardWindow>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('All time').last);
      await tester.pumpAndSettle();

      verify(() => repository.getLeaderboard(LeaderboardWindow.allTime)).called(1);
      verify(() => repository.getMyRank(LeaderboardWindow.allTime)).called(1);
      expect(find.text('Carol'), findsOneWidget);
      expect(find.text('Alice'), findsNothing, reason: 'old window data is replaced, not appended');
      // myRank resolved to null for this window — no rank card shown.
      expect(find.text('Your rank'), findsNothing);
    },
  );
}
