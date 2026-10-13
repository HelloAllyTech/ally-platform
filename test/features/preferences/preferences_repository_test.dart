import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/preferences/data/preferences_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late PreferencesRepository repository;

  setUp(() {
    dio = MockDio();
    repository = PreferencesRepository(dio);
  });

  group('LanguageOption.fromJson', () {
    test('parses language_id and label', () {
      final option = LanguageOption.fromJson({'language_id': 3, 'label': 'Hindi'});
      expect(option.languageId, 3);
      expect(option.label, 'Hindi');
    });
  });

  group('getDefaultLanguageId', () {
    test('returns the nested default_language_id when present', () async {
      when(() => dio.get<Map<String, dynamic>>('/users/me/preferences')).thenAnswer(
        (_) async => _response({
          'data': {'default_language_id': 5},
        }),
      );

      final result = await repository.getDefaultLanguageId();

      expect(result, 5);
    });

    test('returns null when the field is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/users/me/preferences')).thenAnswer(
        (_) async => _response({'data': <String, dynamic>{}}),
      );

      final result = await repository.getDefaultLanguageId();

      expect(result, isNull);
    });
  });

  group('setDefaultLanguageId', () {
    test('posts the language id in the expected body shape', () async {
      when(() => dio.post<void>(
            '/users/preferences',
            data: {'default_language_id': 7},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.setDefaultLanguageId(7);

      verify(() => dio.post<void>(
            '/users/preferences',
            data: {'default_language_id': 7},
          )).called(1);
    });
  });

  group('getAvailableLanguages', () {
    test('maps every entry in the response list', () async {
      when(() => dio.get<List<dynamic>>('/learn/scenario-languages')).thenAnswer(
        (_) async => _response([
          {'language_id': 1, 'label': 'English'},
          {'language_id': 2, 'label': 'Hindi'},
        ]),
      );

      final result = await repository.getAvailableLanguages();

      expect(result, hasLength(2));
      expect(result[0].label, 'English');
      expect(result[1].languageId, 2);
    });

    test('returns an empty list when the response data is null', () async {
      when(() => dio.get<List<dynamic>>('/learn/scenario-languages')).thenAnswer(
        (_) async => _response(null),
      );

      final result = await repository.getAvailableLanguages();

      expect(result, isEmpty);
    });
  });
}
