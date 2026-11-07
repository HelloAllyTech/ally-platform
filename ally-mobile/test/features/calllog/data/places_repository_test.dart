import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/calllog/data/places_repository.dart';

class _MockDio extends Mock implements Dio {}

Response<T> _response<T>(T data) => Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions());

void main() {
  late _MockDio dio;
  late PlacesRepository repository;

  setUp(() {
    dio = _MockDio();
    repository = PlacesRepository(dio);
  });

  test('getPlaces pages /places with RN PLACES_PER_PAGE and reads {total, data}', () async {
    when(() => dio.get<Map<String, dynamic>>('/places', queryParameters: {'page': 2, 'limit': 50})).thenAnswer(
      (_) async => _response<Map<String, dynamic>>({
        'total': 120,
        'data': [
          {'id': 1, 'city': 'Pune', 'state': 'Maharashtra'},
        ],
      }),
    );

    final result = await repository.getPlaces(page: 2);

    expect(result.total, 120);
    expect(result.places.single.displayName, 'Pune, Maharashtra');
  });

  test('searchPlaces GETs /places/search {query}; a non-list body is no results', () async {
    when(() => dio.get<dynamic>('/places/search', queryParameters: {'query': 'pu'})).thenAnswer(
      (_) async => _response<dynamic>([
        {'id': 1, 'city': 'Pune', 'state': 'Maharashtra'},
      ]),
    );
    when(() => dio.get<dynamic>('/places/search', queryParameters: {'query': 'zz'}))
        .thenAnswer((_) async => _response<dynamic>({'message': 'none'}));

    expect((await repository.searchPlaces('pu')).single.city, 'Pune');
    expect(await repository.searchPlaces('zz'), isEmpty);
  });
}
