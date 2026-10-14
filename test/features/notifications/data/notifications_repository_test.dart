import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/notifications/data/notifications_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late NotificationsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = NotificationsRepository(dio);
  });

  group('list', () {
    test('defaults to limit=25/offset=0 and maps every entry', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/notifications',
            queryParameters: {'limit': 25, 'offset': 0},
          )).thenAnswer((_) async => _response({
            'data': [
              {
                'id': 'n1',
                'type': 'SYSTEM',
                'title': 'Title 1',
                'body': 'Body 1',
                'readAt': null,
                'createdAt': '2026-10-01T10:00:00.000Z',
              },
              {
                'id': 'n2',
                'type': 'REMINDER',
                'title': 'Title 2',
                'body': 'Body 2',
                'readAt': '2026-10-02T09:00:00.000Z',
                'createdAt': '2026-10-02T08:00:00.000Z',
              },
            ],
          }));

      final result = await repository.list();

      expect(result, hasLength(2));
      expect(result[0].id, 'n1');
      expect(result[0].isRead, isFalse);
      expect(result[1].id, 'n2');
      expect(result[1].isRead, isTrue);
    });

    test('passes custom limit/offset through', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/notifications',
            queryParameters: {'limit': 10, 'offset': 20},
          )).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      final result = await repository.list(limit: 10, offset: 20);

      expect(result, isEmpty);
      verify(() => dio.get<Map<String, dynamic>>(
            '/notifications',
            queryParameters: {'limit': 10, 'offset': 20},
          )).called(1);
    });

    test('returns an empty list when the response has no data field', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/notifications',
            queryParameters: {'limit': 25, 'offset': 0},
          )).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.list();

      expect(result, isEmpty);
    });
  });

  group('unreadCount', () {
    test('returns the count from the response', () async {
      when(() => dio.get<Map<String, dynamic>>('/notifications/unread-count'))
          .thenAnswer((_) async => _response({'count': 7}));

      final result = await repository.unreadCount();

      expect(result, 7);
    });

    test('returns 0 when the field is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/notifications/unread-count'))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.unreadCount();

      expect(result, 0);
    });
  });

  group('markRead', () {
    test('patches the notification-specific read route', () async {
      when(() => dio.patch<void>('/notifications/n1/read'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.markRead('n1');

      verify(() => dio.patch<void>('/notifications/n1/read')).called(1);
    });
  });

  group('markAllRead', () {
    test('patches the read-all route', () async {
      when(() => dio.patch<void>('/notifications/read-all'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.markAllRead();

      verify(() => dio.patch<void>('/notifications/read-all')).called(1);
    });
  });

  group('registerDeviceToken', () {
    test('puts the token/platform body shape', () async {
      when(() => dio.put<void>(
            '/notifications/device-tokens',
            data: {'token': 'tok-123', 'platform': 'ANDROID'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.registerDeviceToken(token: 'tok-123', platform: 'ANDROID');

      verify(() => dio.put<void>(
            '/notifications/device-tokens',
            data: {'token': 'tok-123', 'platform': 'ANDROID'},
          )).called(1);
    });
  });

  group('deleteDeviceToken', () {
    test('deletes with the URI-encoded token in the path', () async {
      when(() => dio.delete<void>('/notifications/device-tokens/tok%2Fwith%2Fslashes'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.deleteDeviceToken('tok/with/slashes');

      verify(() => dio.delete<void>('/notifications/device-tokens/tok%2Fwith%2Fslashes'))
          .called(1);
    });
  });
}
