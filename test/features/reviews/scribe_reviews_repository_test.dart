import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/scribe_reviews_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late ScribeReviewsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = ScribeReviewsRepository(dio);
  });

  group('getScribeReviews', () {
    test('hits /scribe-session-reviews with the default sort/pagination query', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {'sortBy': 'createdAt', 'order': 'DESC', 'limit': 25, 'offset': 0},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 'rev-1',
              'createdAt': '2026-01-01T00:00:00Z',
              'note': 'a note',
              'createdBy': {'id': 1, 'name': 'Alex', 'profileImage': ''},
              'commentsCount': 2,
            },
          ],
        }),
      );

      final reviews = await repository.getScribeReviews();

      expect(reviews, hasLength(1));
      expect(reviews.first.id, 'rev-1');
      expect(reviews.first.createdBy.name, 'Alex');
    });

    test('forwards the readFilter query parameter when provided', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {
            'sortBy': 'createdAt',
            'order': 'DESC',
            'limit': 25,
            'offset': 0,
            'readFilter': 'unread',
          },
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getScribeReviews(readFilter: 'unread');

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {
            'sortBy': 'createdAt',
            'order': 'DESC',
            'limit': 25,
            'offset': 0,
            'readFilter': 'unread',
          },
        ),
      ).called(1);
    });

    test('returns an empty list when data is absent', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      final reviews = await repository.getScribeReviews();

      expect(reviews, isEmpty);
    });
  });

  group('getScribeReview', () {
    test('fetches a single scribe review by id', () async {
      when(() => dio.get<Map<String, dynamic>>('/scribe-session-reviews/rev-1')).thenAnswer(
        (_) async => _response({
          'id': 'rev-1',
          'createdAt': '2026-01-01T00:00:00Z',
          'note': 'a note',
          'createdBy': {'id': 1, 'name': 'Alex', 'profileImage': ''},
          'commentsCount': 0,
        }),
      );

      final review = await repository.getScribeReview('rev-1');

      expect(review.id, 'rev-1');
    });
  });

  group('markAsRead', () {
    test('patches the scribe mark-read endpoint', () async {
      when(() => dio.patch<void>('/scribe-session-reviews/rev-1/mark-read'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.markAsRead('rev-1');

      verify(() => dio.patch<void>('/scribe-session-reviews/rev-1/mark-read')).called(1);
    });
  });
}
