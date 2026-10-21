import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/leaderboard/data/leaderboard_repository.dart';
import 'package:ally_mobile_flutter/features/leaderboard/presentation/leaderboard_screen.dart';

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

LeaderboardMyRank _myRank({
  required int userId,
  required String name,
  required int rank,
  bool hideRankInCommunity = false,
}) =>
    LeaderboardMyRank(
      userId: userId,
      name: name,
      profileImageUrl: '',
      rank: rank,
      minutesPlayed: rank * 10,
      badgeCount: rank,
      hideRankInCommunity: hideRankInCommunity,
    );

/// This screen navigates via go_router (the Badges button pushes
/// `/achievements`), so every scenario uses `pumpRouterApp` — it also
/// sidesteps a documented `pumpApp` flakiness where a second call in the
/// same test file can leave `localizationControllerProvider` stuck loading
/// forever, which would otherwise show raw translation keys instead of
/// real text (see `pump_app.dart`'s doc comment).
Future<GoRouter> _pumpLeaderboard(
  WidgetTester tester, {
  required MockLeaderboardRepository repository,
}) {
  return pumpRouterApp(
    tester,
    initialLocation: '/leaderboard',
    routes: [
      GoRoute(path: '/leaderboard', builder: (context, state) => const LeaderboardScreen()),
      GoRoute(path: '/achievements', builder: (context, state) => const Text('ACHIEVEMENTS')),
    ],
    overrides: [leaderboardRepositoryProvider.overrideWithValue(repository)],
  );
}

void main() {
  testWidgets(
    'renders the ranked list and refetches (replacing, not appending) on window change',
    (tester) async {
      final repository = MockLeaderboardRepository();
      when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => (
          items: [
            _entry(userId: 1, name: 'Alice', rank: 1),
            _entry(userId: 2, name: 'Bob', rank: 2),
          ],
          totalCount: 2,
        ),
      );
      when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => _myRank(userId: 9, name: 'Me', rank: 5),
      );

      await _pumpLeaderboard(tester, repository: repository);

      // Default window is "Last 7 days" (lastWeek).
      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('Bob'), findsOneWidget);
      verify(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).called(1);
      verify(() => repository.getMyRank(LeaderboardWindow.lastWeek)).called(1);

      when(() => repository.getLeaderboard(LeaderboardWindow.allTime)).thenAnswer(
        (_) async => (items: [_entry(userId: 3, name: 'Carol', rank: 1)], totalCount: 1),
      );
      when(() => repository.getMyRank(LeaderboardWindow.allTime)).thenAnswer((_) async => null);

      await tester.tap(find.byType(DropdownMenu<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('All time').last);
      await tester.pumpAndSettle();

      verify(() => repository.getLeaderboard(LeaderboardWindow.allTime)).called(1);
      verify(() => repository.getMyRank(LeaderboardWindow.allTime)).called(1);
      expect(find.text('Carol'), findsOneWidget);
      expect(find.text('Alice'), findsNothing, reason: 'old window data is replaced, not appended');
    },
  );

  testWidgets('shows each row\'s badge count and formatted duration', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (
        items: [LeaderboardEntry(userId: 1, name: 'Alice', profileImageUrl: '', rank: 1, minutesPlayed: 90, badgeCount: 4)],
        totalCount: 1,
      ),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.text('1 h 30 min'), findsOneWidget, reason: 'RN\'s formatMinutesToDuration format');
    expect(find.text('4'), findsOneWidget, reason: 'the badge count column');
  });

  testWidgets('tapping the Badges header button navigates to Achievements', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (items: <LeaderboardEntry>[], totalCount: 0),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => LeaderboardMyRank(
        userId: 9,
        name: 'Me',
        profileImageUrl: '',
        rank: 5,
        minutesPlayed: 10,
        badgeCount: 7,
        hideRankInCommunity: false,
      ),
    );

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.text('7 Badges'), findsOneWidget, reason: 'the header button shows my own badge count');

    await tester.tap(find.text('7 Badges'));
    await tester.pumpAndSettle();

    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
  });

  testWidgets('shows the empty state when the window has no entries', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (items: <LeaderboardEntry>[], totalCount: 0),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.text('No leaderboard data available'), findsOneWidget);
    expect(find.text('Start practicing to see your progress and compete with others'), findsOneWidget);
  });

  testWidgets('pull-to-refresh re-fetches the current window', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (items: [_entry(userId: 1, name: 'Alice', rank: 1)], totalCount: 1),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await _pumpLeaderboard(tester, repository: repository);
    verify(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).called(1);

    // Don't await `show()` directly — its returned future only resolves once
    // the indicator's dismiss animation plays out, which needs pumped frames
    // to advance; awaiting it inline stalls forever under fake async.
    unawaited(tester.state<RefreshIndicatorState>(find.byType(RefreshIndicator)).show());
    await tester.pump();
    await tester.pumpAndSettle();

    verify(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).called(1);
  });

  testWidgets('scrolling near the bottom loads the next page and appends it (deduped)', (tester) async {
    final repository = MockLeaderboardRepository();
    final page1 = List.generate(20, (i) => _entry(userId: i, name: 'User $i', rank: i + 1));
    final page2 = [_entry(userId: 20, name: 'User 20', rank: 21)];
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek, limit: kLeaderboardPageSize, offset: 0))
        .thenAnswer((_) async => (items: page1, totalCount: 21));
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek, limit: kLeaderboardPageSize, offset: 20))
        .thenAnswer((_) async => (items: page2, totalCount: 21));
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.text('User 20'), findsNothing, reason: 'not loaded yet');

    await tester.drag(find.byType(ListView), const Offset(0, -20000));
    await tester.pumpAndSettle();

    verify(() => repository.getLeaderboard(LeaderboardWindow.lastWeek, limit: kLeaderboardPageSize, offset: 20))
        .called(1);
    expect(find.text('User 20'), findsOneWidget);
  });

  testWidgets('a current-user row near the top of a long list is highlighted, no sticky footer', (tester) async {
    final repository = MockLeaderboardRepository();
    final items = List.generate(20, (i) => _entry(userId: i, name: 'User $i', rank: i + 1));
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (items: items, totalCount: 20),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => _myRank(userId: 0, name: 'User 0', rank: 1),
    );

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.text('User 0'), findsOneWidget);
    expect(find.byKey(const Key('leaderboard-sticky-footer')), findsNothing);
  });

  testWidgets('a current-user row far below an unscrolled long list shows in a sticky footer', (tester) async {
    final repository = MockLeaderboardRepository();
    final items = List.generate(40, (i) => _entry(userId: i, name: 'User $i', rank: i + 1));
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (items: items, totalCount: 40),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => _myRank(userId: 35, name: 'User 35', rank: 36),
    );

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.byKey(const Key('leaderboard-sticky-footer')), findsOneWidget);
  });

  testWidgets('hides the rank column entirely when hideRankInCommunity is set', (tester) async {
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      // rank 5 is outside the top-3 SVG medals, so without hiding this would
      // render as a second CircleAvatar (the numbered rank badge).
      (_) async => (items: [_entry(userId: 1, name: 'Alice', rank: 5)], totalCount: 1),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => _myRank(userId: 9, name: 'Me', rank: 5, hideRankInCommunity: true),
    );

    await _pumpLeaderboard(tester, repository: repository);

    expect(find.byType(CircleAvatar), findsOneWidget, reason: 'only the user avatar, no rank badge/circle');
  });
}
