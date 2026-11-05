import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/permissions/permissions_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late PermissionsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = PermissionsRepository(dio);
  });

  group('getPermissions', () {
    test('parses the flat permission-string array from /authorization/permissions', () async {
      when(() => dio.get<List<dynamic>>('/authorization/permissions')).thenAnswer(
        (_) async => _response(['view:community', 'view:call:logs']),
      );

      final permissions = await repository.getPermissions();

      expect(permissions, ['view:community', 'view:call:logs']);
    });

    test('returns an empty list when the response body is absent', () async {
      when(() => dio.get<List<dynamic>>('/authorization/permissions'))
          .thenAnswer((_) async => _response(null));

      final permissions = await repository.getPermissions();

      expect(permissions, isEmpty);
    });
  });
}
