import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/leaderboard/data/leaderboard_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late LeaderboardRepository repository;

  setUp(() {
    dio = MockDio();
    repository = LeaderboardRepository(dio);
  });

  group('getLeaderboard', () {
    for (final window in LeaderboardWindow.values) {
      test('sends window=${window.apiValue} with the default page size for ${window.name}', () async {
        when(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard',
            queryParameters: {'window': window.apiValue, 'limit': kLeaderboardPageSize, 'offset': 0},
          ),
        ).thenAnswer(
          (_) async => _response({
            'data': [
              {'userId': 1, 'name': 'Alice', 'rank': 1},
            ],
            'totalCount': 1,
          }),
        );

        final result = await repository.getLeaderboard(window);

        verify(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard',
            queryParameters: {'window': window.apiValue, 'limit': kLeaderboardPageSize, 'offset': 0},
          ),
        ).called(1);
        expect(result.items.single.name, 'Alice');
        expect(result.totalCount, 1);
      });
    }

    test('passes custom limit/offset through', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard',
          queryParameters: {'window': LeaderboardWindow.lastWeek.apiValue, 'limit': 10, 'offset': 20},
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[], 'totalCount': 0}));

      final result = await repository.getLeaderboard(LeaderboardWindow.lastWeek, limit: 10, offset: 20);

      expect(result.items, isEmpty);
      verify(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard',
          queryParameters: {'window': LeaderboardWindow.lastWeek.apiValue, 'limit': 10, 'offset': 20},
        ),
      ).called(1);
    });

    test('maps minutesPlayed/badgeCount defaults when absent', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {'userId': 2, 'name': 'Bob', 'rank': 2},
          ],
        }),
      );

      final result = await repository.getLeaderboard(LeaderboardWindow.lastWeek);

      expect(result.items.single.minutesPlayed, 0);
      expect(result.items.single.badgeCount, 0);
      expect(result.items.single.profileImageUrl, '');
      expect(result.totalCount, 1, reason: 'falls back to the page length when totalCount is absent');
    });

    test('returns an empty page when data/totalCount are missing', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      final result = await repository.getLeaderboard(LeaderboardWindow.allTime);

      expect(result.items, isEmpty);
      expect(result.totalCount, 0);
    });
  });

  group('getMyRank', () {
    for (final window in LeaderboardWindow.values) {
      test('sends window=${window.apiValue} for ${window.name}', () async {
        when(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard/my-rank',
            queryParameters: {'window': window.apiValue},
          ),
        ).thenAnswer(
          (_) async => _response({'userId': 9, 'name': 'Me', 'rank': 5}),
        );

        final myRank = await repository.getMyRank(window);

        verify(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard/my-rank',
            queryParameters: {'window': window.apiValue},
          ),
        ).called(1);
        expect(myRank?.rank, 5);
        expect(myRank?.hideRankInCommunity, isFalse);
      });
    }

    test('parses hideRankInCommunity when true', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard/my-rank',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => _response({'userId': 9, 'name': 'Me', 'rank': 5, 'hideRankInCommunity': true}),
      );

      final myRank = await repository.getMyRank(LeaderboardWindow.lastWeek);

      expect(myRank?.hideRankInCommunity, isTrue);
    });

    test('returns null when the response data is null', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard/my-rank',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response(null));

      final myRank = await repository.getMyRank(LeaderboardWindow.lastMonth);

      expect(myRank, isNull);
    });
  });

  group('LeaderboardWindowController', () {
    test('defaults to lastWeek', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(leaderboardWindowProvider), LeaderboardWindow.lastWeek);
    });

    test('select() changes the state', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.read(leaderboardWindowProvider.notifier).select(LeaderboardWindow.allTime);

      expect(container.read(leaderboardWindowProvider), LeaderboardWindow.allTime);
    });
  });
}
