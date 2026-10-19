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

  group('getGeneralComments', () {
    test('fetches and parses the flat comment list from the comments endpoint', () async {
      when(() => dio.get<Map<String, dynamic>>('/scribe-session-reviews/rev-1/comments'))
          .thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 'c-1', 'content': 'hello', 'createdBy': {'name': 'A'}},
          ],
        }),
      );

      final result = await repository.getGeneralComments('rev-1');

      expect(result, hasLength(1));
      expect(result.first.content, 'hello');
    });

    test('returns an empty list when data is absent', () async {
      when(() => dio.get<Map<String, dynamic>>(any())).thenAnswer((_) async => _response({}));

      final result = await repository.getGeneralComments('rev-1');

      expect(result, isEmpty);
    });
  });

  group('addGeneralComment', () {
    test('posts the content body (no threadId) to the comments endpoint', () async {
      when(
        () => dio.post<void>(
          '/scribe-session-reviews/rev-1/comments',
          data: {'content': 'nice job'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.addGeneralComment(reviewId: 'rev-1', content: 'nice job');

      verify(
        () => dio.post<void>(
          '/scribe-session-reviews/rev-1/comments',
          data: {'content': 'nice job'},
        ),
      ).called(1);
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

  group('getCommentReplies', () {
    test('fetches paginated replies for a comment', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/scribe-session-reviews/comments/c-1/replies',
          queryParameters: {'offset': 0, 'limit': 20},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 'r-1', 'content': 'reply', 'createdBy': {'name': 'B'}, 'reactions': <String, dynamic>{}},
          ],
          'count': 3,
        }),
      );

      final result = await repository.getCommentReplies('c-1');

      expect(result.replies, hasLength(1));
      expect(result.count, 3);
    });
  });

  group('addThreadReply', () {
    test('posts threadId and content to the comments endpoint', () async {
      when(
        () => dio.post<void>(
          '/scribe-session-reviews/rev-1/comments',
          data: {'threadId': 'th-1', 'content': 'me too'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.addThreadReply(reviewId: 'rev-1', threadId: 'th-1', content: 'me too');

      verify(
        () => dio.post<void>(
          '/scribe-session-reviews/rev-1/comments',
          data: {'threadId': 'th-1', 'content': 'me too'},
        ),
      ).called(1);
    });
  });
}
