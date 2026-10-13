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
      test('sends window=${window.apiValue} for ${window.name}', () async {
        when(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard',
            queryParameters: {'window': window.apiValue},
          ),
        ).thenAnswer(
          (_) async => _response({
            'data': [
              {'userId': 1, 'name': 'Alice', 'rank': 1},
            ],
          }),
        );

        final entries = await repository.getLeaderboard(window);

        verify(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard',
            queryParameters: {'window': window.apiValue},
          ),
        ).called(1);
        expect(entries.single.name, 'Alice');
      });
    }

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

      final entries = await repository.getLeaderboard(LeaderboardWindow.lastWeek);

      expect(entries.single.minutesPlayed, 0);
      expect(entries.single.badgeCount, 0);
      expect(entries.single.profileImageUrl, '');
    });

    test('returns an empty list when data is missing', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      final entries = await repository.getLeaderboard(LeaderboardWindow.allTime);

      expect(entries, isEmpty);
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

        final entry = await repository.getMyRank(window);

        verify(
          () => dio.get<Map<String, dynamic>>(
            '/community/leaderboard/my-rank',
            queryParameters: {'window': window.apiValue},
          ),
        ).called(1);
        expect(entry?.rank, 5);
      });
    }

    test('returns null when the response data is null', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/community/leaderboard/my-rank',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response(null));

      final entry = await repository.getMyRank(LeaderboardWindow.lastMonth);

      expect(entry, isNull);
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
