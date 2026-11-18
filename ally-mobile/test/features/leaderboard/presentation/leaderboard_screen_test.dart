import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/leaderboard/data/leaderboard_repository.dart';
import 'package:ally_mobile_flutter/core/widgets/info_tooltip_icon.dart';
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

      await tester.tap(find.byKey(const Key('leaderboard-period-dropdown')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('All time').last);
      await tester.pumpAndSettle();

      verify(() => repository.getLeaderboard(LeaderboardWindow.allTime)).called(1);
      verify(() => repository.getMyRank(LeaderboardWindow.allTime)).called(1);
      expect(find.text('Carol'), findsOneWidget);
      expect(find.text('Alice'), findsNothing, reason: 'old window data is replaced, not appended');
    },
  );

  testWidgets('on a 402pt phone the row keeps RN\'s 160pt user column and runs past the edge', (tester) async {
    // RN's userColumn minWidth 160@ms: header and rows overflow to the right
    // instead of squeezing the user column, which places duration/badges.
    // A 402pt iPhone is 402 / 1.0743 = 374 logical once RnScale applies ms().
    tester.view.physicalSize = const Size(374 * 3, 814 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final repository = MockLeaderboardRepository();
    when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
      (_) async => (
        items: [LeaderboardEntry(userId: 1, name: 'Alice', profileImageUrl: '', rank: 1, minutesPlayed: 90, badgeCount: 4)],
        totalCount: 1,
      ),
    );
    when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

    await _pumpLeaderboard(tester, repository: repository);

    expect(tester.takeException(), isNull);
    // rank 21+38, user 160+10, duration 95 -> badges column starts at 324.
    expect(tester.getTopLeft(find.text('4')).dx, closeTo(324, 0.5));
    expect(tester.getSize(find.text('1 h 30 min')).height, lessThan(30));
  });

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

    expect(find.text('Rank'), findsNothing, reason: 'no rank column header');
    expect(find.byKey(const Key('leaderboard-avatar-placeholder')), findsOneWidget);
  });

  testWidgets(
    'shows the table column headers (Rank/User/Total duration/Badges), matching RN\'s renderTableHeader',
    (tester) async {
      final repository = MockLeaderboardRepository();
      when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => (items: [_entry(userId: 1, name: 'Alice', rank: 1)], totalCount: 1),
      );
      when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

      await _pumpLeaderboard(tester, repository: repository);

      expect(find.text('Rank'), findsOneWidget);
      expect(find.text('User'), findsOneWidget);
      expect(find.text('Total duration'), findsOneWidget);
      expect(find.text('Badges'), findsOneWidget);

      // Regression check: a real RenderFlex overflow was found here via a
      // direct screenshot render with the app's real fonts loaded (an
      // ordinary widget test's fallback font measures narrower and hides
      // it) — "Total duration"/"Badges" were bare, unbounded `Text`
      // widgets with no wrap/shrink behavior, so real font metrics could
      // legitimately demand more width than the row had. Fixed by bounding
      // each in a `SizedBox` with `overflow: TextOverflow.ellipsis`;
      // asserted here directly since the overflow itself isn't
      // reproducible without loading real fonts (tried — too fragile, see
      // tab_screen_header_test.dart's equivalent regression test).
      final totalDurationText = tester.widget<Text>(find.text('Total duration'));
      expect(totalDurationText.overflow, TextOverflow.ellipsis);
      expect(totalDurationText.maxLines, 1);
      final badgesText = tester.widget<Text>(find.text('Badges'));
      expect(badgesText.overflow, TextOverflow.ellipsis);
      expect(badgesText.maxLines, 1);
    },
  );

  testWidgets(
    'tapping the info icon shows RN\'s badge-earning tooltip (isTooltipRequired/tooltipContent)',
    (tester) async {
      final repository = MockLeaderboardRepository();
      when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => (items: [_entry(userId: 1, name: 'Alice', rank: 1)], totalCount: 1),
      );
      when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

      await _pumpLeaderboard(tester, repository: repository);

      await tester.tap(find.byType(InfoTooltipIcon));
      await tester.pump();

      expect(
        find.textContaining('This view reflects overall activity in the selected time period'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'matches RN: outlined initial avatars, plain badge counts (no badge icon per row), RN-style period dropdown',
    (tester) async {
      final repository = MockLeaderboardRepository();
      when(() => repository.getLeaderboard(LeaderboardWindow.lastWeek)).thenAnswer(
        (_) async => (
          items: [_entry(userId: 1, name: 'alice', rank: 1), _entry(userId: 2, name: 'Bob', rank: 2)],
          totalCount: 2,
        ),
      );
      when(() => repository.getMyRank(LeaderboardWindow.lastWeek)).thenAnswer((_) async => null);

      await _pumpLeaderboard(tester, repository: repository);

      expect(find.byKey(const Key('leaderboard-avatar-placeholder')), findsNWidgets(2));
      expect(find.text('A'), findsOneWidget, reason: 'upper-cased first letter');
      expect(find.byType(CircleAvatar), findsNothing);
      // Only the header's "N Badges" button carries the badge icon.
      expect(
        find.byWidgetPredicate(
          (w) => w is SvgPicture && w.bytesLoader.toString().contains('badgeIcon'),
        ),
        findsOneWidget,
      );
      expect(find.byType(DropdownMenu<String>), findsNothing);
      expect(find.text('Last 7 days'), findsOneWidget);

      await tester.tap(find.byKey(const Key('leaderboard-period-dropdown')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('leaderboard-period-menu')), findsOneWidget);
      expect(find.text('Last 28 days'), findsOneWidget);
    },
  );
}
