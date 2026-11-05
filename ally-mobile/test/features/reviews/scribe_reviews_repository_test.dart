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
    test('hits /scribe-session-reviews with the default LATEST sort/pagination query', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {'sortBy': 'LATEST', 'limit': 10, 'offset': 0, 'order': 'DESC'},
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

      expect(reviews.items, hasLength(1));
      expect(reviews.items.first.id, 'rev-1');
      expect(reviews.items.first.createdBy.name, 'Alex');
    });

    test('forwards the readFilter query parameter and a non-default sortBy when provided', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {
            'sortBy': 'MOST_VIEWED',
            'limit': 10,
            'offset': 0,
            'readFilter': 'UNREAD',
            'order': 'DESC',
          },
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getScribeReviews(readFilter: 'UNREAD', sortBy: 'MOST_VIEWED');

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews',
          queryParameters: {
            'sortBy': 'MOST_VIEWED',
            'limit': 10,
            'offset': 0,
            'readFilter': 'UNREAD',
            'order': 'DESC',
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

      expect(reviews.items, isEmpty);
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

  group('getThreads', () {
    test('always sends includeMessage: true along with offset/limit', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews/rev-1/threads',
          queryParameters: {'offset': 0, 'limit': 20, 'includeMessage': true},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 'th-1',
              'comments': <dynamic>[],
              'commentCount': 0,
              'createdBy': {'id': 1, 'name': 'A'},
              'message': null,
            },
          ],
          'count': 1,
        }),
      );

      final result = await repository.getThreads('rev-1');

      expect(result.threads, hasLength(1));
      expect(result.count, 1);
    });
  });

  group('createReview', () {
    test('POSTs /scribe-session-reviews (not /scenario-session-reviews) and returns the new id', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/scribe-session-reviews',
          data: {'scribeSessionId': 1001, 'note': 'Take a look'},
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'rev-9',
          'scribeSessionId': 1001,
          'status': 'HIDDEN',
          'createdAt': '2026-01-01T00:00:00Z',
        }),
      );

      final reviewId = await repository.createReview(scribeSessionId: 1001, note: 'Take a look');

      expect(reviewId, 'rev-9');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/scribe-session-reviews',
          data: {'scribeSessionId': 1001, 'note': 'Take a look'},
        ),
      ).called(1);
    });
  });

  group('updateReviewStatus', () {
    test('PATCHes the scribe review resource with status and an optional note', () async {
      when(
        () => dio.patch<void>(
          '/scribe-session-reviews/rev-9',
          data: {'status': 'IN_REVIEW', 'note': 'Updated note'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.updateReviewStatus(reviewId: 'rev-9', status: 'IN_REVIEW', note: 'Updated note');

      verify(
        () => dio.patch<void>(
          '/scribe-session-reviews/rev-9',
          data: {'status': 'IN_REVIEW', 'note': 'Updated note'},
        ),
      ).called(1);
    });

    test('omits note from the body when absent (a plain visibility toggle)', () async {
      when(
        () => dio.patch<void>('/scribe-session-reviews/rev-9', data: {'status': 'HIDDEN'}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.updateReviewStatus(reviewId: 'rev-9', status: 'HIDDEN');

      verify(
        () => dio.patch<void>('/scribe-session-reviews/rev-9', data: {'status': 'HIDDEN'}),
      ).called(1);
    });
  });
}
