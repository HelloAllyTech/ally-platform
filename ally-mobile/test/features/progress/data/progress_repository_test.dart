import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';
import 'package:ally_mobile_flutter/core/permissions/user_permissions.dart';
import 'package:ally_mobile_flutter/features/progress/data/progress_repository.dart';

class MockDio extends Mock implements Dio {}

class MockPermissionsRepository extends Mock implements PermissionsRepository {}

Response<T> _response<T>(T? data, {int statusCode = 200}) =>
    Response<T>(data: data, statusCode: statusCode, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late ProgressRepository repository;

  setUp(() {
    dio = MockDio();
    repository = ProgressRepository(dio);
  });

  group('ProgressSummary.fromJson', () {
    test('parses all fields', () {
      final summary = ProgressSummary.fromJson({
        'level': 4,
        'totalXp': 640,
        'xpIntoLevel': 124,
        'xpToNextLevel': 286,
        'nextLevelXp': 926,
        'progress': 0.3,
        'isMaxLevel': false,
      });

      expect(summary.level, 4);
      expect(summary.totalXp, 640);
      expect(summary.xpIntoLevel, 124);
      expect(summary.xpToNextLevel, 286);
      expect(summary.nextLevelXp, 926);
      expect(summary.progress, 0.3);
      expect(summary.isMaxLevel, isFalse);
    });

    test('xpToNextLevel/nextLevelXp parse as null at max level', () {
      final summary = ProgressSummary.fromJson({
        'level': 10,
        'totalXp': 10000,
        'xpIntoLevel': 0,
        'xpToNextLevel': null,
        'nextLevelXp': null,
        'progress': 1.0,
        'isMaxLevel': true,
      });

      expect(summary.xpToNextLevel, isNull);
      expect(summary.nextLevelXp, isNull);
      expect(summary.isMaxLevel, isTrue);
    });
  });

  group('ProgressDashboard.fromJson', () {
    test('parses the full dashboard payload including the ladder', () {
      final dashboard = ProgressDashboard.fromJson({
        'level': 4,
        'totalXp': 640,
        'xpIntoLevel': 124,
        'xpToNextLevel': 286,
        'nextLevelXp': 926,
        'progress': 0.3,
        'isMaxLevel': false,
        'lifetimePracticeMinutes': 412,
        'sessionsCompleted': 37,
        'trackItemsCompleted': 12,
        'ladder': [
          {'level': 1, 'requiredXp': 0},
          {'level': 2, 'requiredXp': 100},
        ],
      });

      expect(dashboard.lifetimePracticeMinutes, 412);
      expect(dashboard.sessionsCompleted, 37);
      expect(dashboard.trackItemsCompleted, 12);
      expect(dashboard.ladder, hasLength(2));
      expect(dashboard.ladder[1].level, 2);
      expect(dashboard.ladder[1].requiredXp, 100);
    });

    test('defaults missing lifetime stats/ladder to 0/empty rather than crashing', () {
      final dashboard = ProgressDashboard.fromJson({
        'level': 1,
        'totalXp': 0,
        'xpIntoLevel': 0,
        'xpToNextLevel': 100,
        'nextLevelXp': 100,
        'progress': 0.0,
      });

      expect(dashboard.lifetimePracticeMinutes, 0);
      expect(dashboard.sessionsCompleted, 0);
      expect(dashboard.trackItemsCompleted, 0);
      expect(dashboard.ladder, isEmpty);
    });
  });

  group('ProgressRepository', () {
    test('getProgressSummary hits /progress/me/summary', () async {
      when(() => dio.get<Map<String, dynamic>>('/progress/me/summary')).thenAnswer(
        (_) async => _response({
          'level': 2,
          'totalXp': 50,
          'xpIntoLevel': 10,
          'xpToNextLevel': 40,
          'nextLevelXp': 90,
          'progress': 0.2,
          'isMaxLevel': false,
        }),
      );

      final summary = await repository.getProgressSummary();

      expect(summary.level, 2);
    });

    test('getProgress hits /progress/me', () async {
      when(() => dio.get<Map<String, dynamic>>('/progress/me')).thenAnswer(
        (_) async => _response({
          'level': 2,
          'totalXp': 50,
          'xpIntoLevel': 10,
          'xpToNextLevel': 40,
          'nextLevelXp': 90,
          'progress': 0.2,
          'isMaxLevel': false,
          'lifetimePracticeMinutes': 10,
          'sessionsCompleted': 1,
          'trackItemsCompleted': 1,
        }),
      );

      final dashboard = await repository.getProgress();

      expect(dashboard.level, 2);
      expect(dashboard.sessionsCompleted, 1);
    });

    test('getProgressEnabled hits /progress/me/enabled and returns the bare boolean body', () async {
      when(() => dio.get<bool>('/progress/me/enabled')).thenAnswer((_) async => _response(true));

      expect(await repository.getProgressEnabled(), isTrue);
    });

    test('getProgressEnabled defaults to false when the body is absent', () async {
      when(() => dio.get<bool>('/progress/me/enabled')).thenAnswer((_) async => _response(null));

      expect(await repository.getProgressEnabled(), isFalse);
    });
  });

  group('canViewProgressProvider', () {
    test('false without the view:user:rank permission, never calling getProgressEnabled', () async {
      final permissionsRepository = MockPermissionsRepository();
      when(() => permissionsRepository.getPermissions()).thenAnswer((_) async => <String>[]);
      when(() => dio.get<bool>('/progress/me/enabled')).thenAnswer((_) async => _response(true));

      final container = ProviderContainer(
        overrides: [
          permissionsRepositoryProvider.overrideWithValue(permissionsRepository),
          progressRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);

      expect(await container.read(canViewProgressProvider.future), isFalse);
      verifyNever(() => dio.get<bool>('/progress/me/enabled'));
    });

    test('true only when both the permission and the org toggle are present', () async {
      final permissionsRepository = MockPermissionsRepository();
      when(
        () => permissionsRepository.getPermissions(),
      ).thenAnswer((_) async => [UserPermissions.viewUserRank]);
      when(() => dio.get<bool>('/progress/me/enabled')).thenAnswer((_) async => _response(true));

      final container = ProviderContainer(
        overrides: [
          permissionsRepositoryProvider.overrideWithValue(permissionsRepository),
          progressRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);

      expect(await container.read(canViewProgressProvider.future), isTrue);
    });
  });

  group('progressSummaryProvider', () {
    test('resolves to null without calling getProgressSummary when canViewProgress is false', () async {
      final permissionsRepository = MockPermissionsRepository();
      when(() => permissionsRepository.getPermissions()).thenAnswer((_) async => <String>[]);

      final container = ProviderContainer(
        overrides: [
          permissionsRepositoryProvider.overrideWithValue(permissionsRepository),
          progressRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);

      expect(await container.read(progressSummaryProvider.future), isNull);
      verifyNever(() => dio.get<Map<String, dynamic>>('/progress/me/summary'));
    });
  });
}
