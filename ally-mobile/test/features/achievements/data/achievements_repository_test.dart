import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/achievements/data/achievements_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late AchievementsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = AchievementsRepository(dio);
  });

  group('BadgeLockStatus parsing (via AchievementBadge.fromJson)', () {
    test("'UNLOCKED' parses to BadgeLockStatus.unlocked", () {
      final badge = AchievementBadge.fromJson({
        'id': 'b1',
        'name': 'First Steps',
        'lockStatus': 'UNLOCKED',
      });

      expect(badge.lockStatus, BadgeLockStatus.unlocked);
    });

    test("'LOCKED' parses to BadgeLockStatus.locked", () {
      final badge = AchievementBadge.fromJson({
        'id': 'b2',
        'name': 'Marathoner',
        'lockStatus': 'LOCKED',
      });

      expect(badge.lockStatus, BadgeLockStatus.locked);
    });

    test('a missing/unrecognized lockStatus defaults to locked', () {
      final badge = AchievementBadge.fromJson({'id': 'b3', 'name': 'Mystery'});

      expect(badge.lockStatus, BadgeLockStatus.locked);
    });

    test('defaults description/imageUrl to empty string when absent', () {
      final badge = AchievementBadge.fromJson({
        'id': 'b4',
        'name': 'No Art Yet',
        'lockStatus': 'UNLOCKED',
      });

      expect(badge.description, '');
      expect(badge.imageUrl, '');
    });
  });

  group('getBadges', () {
    test(
      'hits /badges/me/available — NOT /badges/me (regression: this used '
      'to hit the wrong, flat endpoint meant for the global unlock-popup '
      'poller, not the grouped grid this screen renders)',
      () async {
        when(() => dio.get<List<dynamic>>('/badges/me/available')).thenAnswer(
          (_) async => _response([
            {
              'category': 'Momentum',
              'badges': [
                {'id': 'b1', 'name': 'Streak', 'lockStatus': 'UNLOCKED'},
              ],
            },
          ]),
        );

        final groups = await repository.getBadges();

        verify(() => dio.get<List<dynamic>>('/badges/me/available')).called(1);
        verifyNever(() => dio.get<List<dynamic>>('/badges/me'));
        expect(groups, hasLength(1));
        expect(groups.first.category, 'Momentum');
        expect(groups.first.badges, hasLength(1));
        expect(groups.first.badges.first.lockStatus, BadgeLockStatus.unlocked);
      },
    );

    test('maps multiple categories, each with multiple badges', () async {
      when(() => dio.get<List<dynamic>>('/badges/me/available')).thenAnswer(
        (_) async => _response([
          {
            'category': 'Momentum',
            'badges': [
              {'id': 'b1', 'name': 'Streak 7', 'lockStatus': 'UNLOCKED'},
              {'id': 'b2', 'name': 'Streak 30', 'lockStatus': 'LOCKED'},
            ],
          },
          {
            'category': 'Contribution',
            'badges': [
              {'id': 'b3', 'name': 'Helper', 'lockStatus': 'LOCKED'},
            ],
          },
        ]),
      );

      final groups = await repository.getBadges();

      expect(groups, hasLength(2));
      expect(groups[0].badges, hasLength(2));
      expect(groups[1].category, 'Contribution');
      expect(groups[1].badges.single.id, 'b3');
    });

    test('returns an empty list when the response data is null', () async {
      when(() => dio.get<List<dynamic>>('/badges/me/available')).thenAnswer(
        (_) async => _response(null),
      );

      final groups = await repository.getBadges();

      expect(groups, isEmpty);
    });

    test('a category with a missing badges list parses as empty, not a crash', () async {
      when(() => dio.get<List<dynamic>>('/badges/me/available')).thenAnswer(
        (_) async => _response([
          {'category': 'Resonance'},
        ]),
      );

      final groups = await repository.getBadges();

      expect(groups.single.category, 'Resonance');
      expect(groups.single.badges, isEmpty);
    });
  });

  group('markBadgeAsViewed', () {
    test('PATCHes /badges/me/{id}/viewed', () async {
      when(() => dio.patch<void>('/badges/me/b1/viewed')).thenAnswer(
        (_) async => _response<void>(null),
      );

      await repository.markBadgeAsViewed('b1');

      verify(() => dio.patch<void>('/badges/me/b1/viewed')).called(1);
    });
  });
}
