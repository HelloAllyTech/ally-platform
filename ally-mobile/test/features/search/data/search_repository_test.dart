import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/search/data/search_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late SearchRepository repository;

  setUp(() {
    dio = MockDio();
    repository = SearchRepository(dio);
  });

  group('SearchResult.fromJson', () {
    test('parses documents, categoryCounts and total', () {
      final result = SearchResult.fromJson({
        'documents': [
          {'id': 'd1', 'heading': 'Heading 1', 'content': 'Content 1', 'category': 'Anxiety'},
          {'id': 'd2', 'heading': 'Heading 2', 'content': 'Content 2'},
        ],
        'categories': {'Anxiety': 4, 'Stress': 2},
        'total': 12,
      });

      expect(result.documents, hasLength(2));
      expect(result.documents[0].id, 'd1');
      expect(result.documents[0].category, 'Anxiety');
      expect(result.documents[1].category, ''); // defaults when absent
      expect(result.categoryCounts, {'Anxiety': 4, 'Stress': 2});
      expect(result.total, 12);
    });

    test('defaults to empty/zero when fields are absent', () {
      final result = SearchResult.fromJson(<String, dynamic>{});

      expect(result.documents, isEmpty);
      expect(result.categoryCounts, isEmpty);
      expect(result.total, 0);
    });
  });

  group('search', () {
    test('omits filters when category is null', () async {
      when(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {'query': 'anxiety', 'limit': SearchRepository.pageSize},
          )).thenAnswer((_) async => _response({
            'documents': <dynamic>[],
            'categories': <String, dynamic>{},
            'total': 0,
          }));

      await repository.search('anxiety');

      verify(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {'query': 'anxiety', 'limit': SearchRepository.pageSize},
          )).called(1);
    });

    test("omits filters when category is 'All'", () async {
      when(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {'query': 'anxiety', 'limit': SearchRepository.pageSize},
          )).thenAnswer((_) async => _response({
            'documents': <dynamic>[],
            'categories': <String, dynamic>{},
            'total': 0,
          }));

      await repository.search('anxiety', category: 'All');

      verify(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {'query': 'anxiety', 'limit': SearchRepository.pageSize},
          )).called(1);
    });

    test('includes filters when a real category is given', () async {
      when(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {
              'query': 'anxiety',
              'limit': SearchRepository.pageSize,
              'filters': {'category': 'Anxiety'},
            },
          )).thenAnswer((_) async => _response({
            'documents': <dynamic>[],
            'categories': <String, dynamic>{},
            'total': 0,
          }));

      await repository.search('anxiety', category: 'Anxiety');

      verify(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {
              'query': 'anxiety',
              'limit': SearchRepository.pageSize,
              'filters': {'category': 'Anxiety'},
            },
          )).called(1);
    });

    test('omits excludedIds when empty, includes it when non-empty', () async {
      when(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {
              'query': 'anxiety',
              'limit': SearchRepository.pageSize,
              'excludedIds': ['d1', 'd2'],
            },
          )).thenAnswer((_) async => _response({
            'documents': <dynamic>[],
            'categories': <String, dynamic>{},
            'total': 0,
          }));

      await repository.search('anxiety', excludedIds: ['d1', 'd2']);

      verify(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {
              'query': 'anxiety',
              'limit': SearchRepository.pageSize,
              'excludedIds': ['d1', 'd2'],
            },
          )).called(1);
    });

    test('parses the response into a SearchResult', () async {
      when(() => dio.post<Map<String, dynamic>>(
            '/reference-document/search',
            data: {'query': 'anxiety', 'limit': SearchRepository.pageSize},
          )).thenAnswer((_) async => _response({
            'documents': [
              {'id': 'd1', 'heading': 'H', 'content': 'C', 'category': 'Anxiety'},
            ],
            'categories': {'Anxiety': 1},
            'total': 1,
          }));

      final result = await repository.search('anxiety');

      expect(result.documents, hasLength(1));
      expect(result.documents.single.heading, 'H');
      expect(result.categoryCounts, {'Anxiety': 1});
      expect(result.total, 1);
    });
  });
}
