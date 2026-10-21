import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/leaderboard/data/leaderboard_repository.dart';
import 'package:ally_mobile_flutter/features/leaderboard/presentation/leaderboard_screen.dart';

import '../../../support/pump_app.dart';
import '../../../support/pump_router_app.dart';

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

      await tester.tap(find.byType(DropdownMenu<String>));
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

  testWidgets('shows each row\'s badge count and formatted duration', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => [
        LeaderboardEntry(userId: 1, name: 'Alice', profileImageUrl: '', rank: 1, minutesPlayed: 90, badgeCount: 4),
      ],
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await pumpApp(
      tester,
      const LeaderboardScreen(),
      overrides: [leaderboardRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('1 h 30 min'), findsOneWidget, reason: 'RN\'s formatMinutesToDuration format');
    expect(find.text('4'), findsOneWidget, reason: 'the badge count column');
  });

  testWidgets('tapping the Badges header button navigates to Achievements', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer((_) async => []);
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async =>
          LeaderboardEntry(userId: 9, name: 'Me', profileImageUrl: '', rank: 5, minutesPlayed: 10, badgeCount: 7),
    );

    await pumpRouterApp(
      tester,
      initialLocation: '/leaderboard',
      routes: [
        GoRoute(path: '/leaderboard', builder: (context, state) => const LeaderboardScreen()),
        GoRoute(path: '/achievements', builder: (context, state) => const Text('ACHIEVEMENTS')),
      ],
      overrides: [leaderboardRepositoryProvider.overrideWithValue(repository)],
    );

    expect(find.text('7 Badges'), findsOneWidget, reason: 'the header button shows my own badge count');

    await tester.tap(find.text('7 Badges'));
    await tester.pumpAndSettle();

    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
  });
}
