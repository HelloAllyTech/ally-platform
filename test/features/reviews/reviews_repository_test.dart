import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reviews/data/reviews_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late ReviewsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = ReviewsRepository(dio);
  });

  Map<String, dynamic> reviewJson({String id = 'rev-1'}) => {
        'id': id,
        'createdAt': '2026-01-01T00:00:00Z',
        'note': 'a note',
        'createdBy': {'id': 1, 'name': 'Alex', 'profileImage': 'img.png'},
        'commentsCount': 2,
        'summaryName': 'Session summary',
      };

  group('getReviews', () {
    test('sends the default LATEST sort/pagination query and omits readFilter entirely', () async {
      // `'readFilter': ?readFilter` is a null-aware map entry: when
      // readFilter is null the key is left out of the map altogether,
      // not sent with a null value — verified against a map literal with
      // no 'readFilter' key at all. No 'order' param either — the real
      // backend (per useReviews.ts) never sends one; this repository used
      // to send 'sortBy': 'createdAt'/'order': 'DESC', a shape the real
      // app never actually uses.
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews',
            queryParameters: {
              'sortBy': 'LATEST',
              'limit': 25,
              'offset': 0,
            },
          )).thenAnswer(
        (_) async => _response({
          'data': [reviewJson()],
        }),
      );

      final result = await repository.getReviews();

      expect(result, hasLength(1));
      expect(result.first.id, 'rev-1');
      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews',
            queryParameters: {
              'sortBy': 'LATEST',
              'limit': 25,
              'offset': 0,
            },
          )).called(1);
    });

    test('forwards the readFilter query parameter and a non-default sortBy when provided', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews',
            queryParameters: {
              'sortBy': 'MOST_COMMENTED',
              'limit': 25,
              'offset': 0,
              'readFilter': 'UNREAD',
            },
          )).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      final result = await repository.getReviews(readFilter: 'UNREAD', sortBy: 'MOST_COMMENTED');

      expect(result, isEmpty);
      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews',
            queryParameters: {
              'sortBy': 'MOST_COMMENTED',
              'limit': 25,
              'offset': 0,
              'readFilter': 'UNREAD',
            },
          )).called(1);
    });

    test('returns an empty list when data is absent', () async {
      when(() => dio.get<Map<String, dynamic>>(
            any(),
            queryParameters: any(named: 'queryParameters'),
          )).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getReviews();

      expect(result, isEmpty);
    });
  });

  group('getReview', () {
    test('fetches a single review by id', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/rev-1'))
          .thenAnswer((_) async => _response(reviewJson()));

      final result = await repository.getReview('rev-1');

      expect(result.id, 'rev-1');
      expect(result.summaryName, 'Session summary');
      verify(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/rev-1')).called(1);
    });
  });

  group('getUnreadCount', () {
    test('returns the unread review count for the bottom-bar badge', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/unread-count'))
          .thenAnswer((_) async => _response({'count': 3}));

      expect(await repository.getUnreadCount(), 3);
    });

    test('defaults to 0 when count is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/unread-count'))
          .thenAnswer((_) async => _response(const {}));

      expect(await repository.getUnreadCount(), 0);
    });
  });

  group('markAsRead', () {
    test('patches the mark-read endpoint', () async {
      when(() => dio.patch<void>('/scenario-session-reviews/rev-1/mark-read'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.markAsRead('rev-1');

      verify(() => dio.patch<void>('/scenario-session-reviews/rev-1/mark-read')).called(1);
    });
  });

  group('createReview', () {
    test('posts scenarioSessionId and note', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews',
            data: {'scenarioSessionId': 'sess-1', 'note': 'please check'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.createReview(scenarioSessionId: 'sess-1', note: 'please check');

      verify(() => dio.post<void>(
            '/scenario-session-reviews',
            data: {'scenarioSessionId': 'sess-1', 'note': 'please check'},
          )).called(1);
    });
  });

  group('updateReviewStatus', () {
    test('patches status and note to the review\'s own route', () async {
      when(() => dio.patch<void>(
            '/scenario-session-reviews/rev-1',
            data: {'status': 'IN_REVIEW', 'note': 'updated'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.updateReviewStatus(reviewId: 'rev-1', status: 'IN_REVIEW', note: 'updated');

      verify(() => dio.patch<void>(
            '/scenario-session-reviews/rev-1',
            data: {'status': 'IN_REVIEW', 'note': 'updated'},
          )).called(1);
    });

    test('omits note entirely when not supplied', () async {
      when(() => dio.patch<void>(
            '/scenario-session-reviews/rev-1',
            data: {'status': 'HIDDEN'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.updateReviewStatus(reviewId: 'rev-1', status: 'HIDDEN');

      verify(() => dio.patch<void>(
            '/scenario-session-reviews/rev-1',
            data: {'status': 'HIDDEN'},
          )).called(1);
    });
  });

  group('getGeneralComments', () {
    test('fetches and parses the flat comment list', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/rev-1/comments'))
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
      when(() => dio.get<Map<String, dynamic>>(any()))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getGeneralComments('rev-1');

      expect(result, isEmpty);
    });
  });

  group('addGeneralComment', () {
    test('posts the content body (no threadId) to the comments endpoint', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/comments',
            data: {'content': 'nice job'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addGeneralComment(reviewId: 'rev-1', content: 'nice job');

      verify(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/comments',
            data: {'content': 'nice job'},
          )).called(1);
    });
  });

  group('getThreads', () {
    test('always sends includeMessage: true along with offset/limit', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/threads',
            queryParameters: {'offset': 0, 'limit': 20, 'includeMessage': true},
          )).thenAnswer(
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
      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/threads',
            queryParameters: {'offset': 0, 'limit': 20, 'includeMessage': true},
          )).called(1);
    });

    test('forwards custom offset/limit while still sending includeMessage: true', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/threads',
            queryParameters: {'offset': 40, 'limit': 10, 'includeMessage': true},
          )).thenAnswer((_) async => _response({'data': <dynamic>[], 'count': 0}));

      await repository.getThreads('rev-1', offset: 40, limit: 10);

      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/threads',
            queryParameters: {'offset': 40, 'limit': 10, 'includeMessage': true},
          )).called(1);
    });
  });

  group('getCommentReplies', () {
    test('fetches paginated replies for a comment', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/comments/c-1/replies',
            queryParameters: {'offset': 0, 'limit': 20},
          )).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 'r-1', 'content': 'reply', 'createdBy': {'name': 'B'}, 'reactions': <String, dynamic>{}},
          ],
          'count': 3,
        }),
      );

      final result = await repository.getCommentReplies('c-1');

      expect(result.replies, hasLength(1));
      expect(result.replies.first.content, 'reply');
      expect(result.count, 3);
    });

    test('forwards custom offset/limit', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/comments/c-1/replies',
            queryParameters: {'offset': 10, 'limit': 50},
          )).thenAnswer((_) async => _response({'data': <dynamic>[], 'count': 0}));

      await repository.getCommentReplies('c-1', offset: 10, limit: 50);

      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/comments/c-1/replies',
            queryParameters: {'offset': 10, 'limit': 50},
          )).called(1);
    });
  });

  group('addThreadReply', () {
    test('posts threadId and content to the comments endpoint', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/comments',
            data: {'threadId': 'th-1', 'content': 'me too'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addThreadReply(reviewId: 'rev-1', threadId: 'th-1', content: 'me too');

      verify(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/comments',
            data: {'threadId': 'th-1', 'content': 'me too'},
          )).called(1);
    });
  });
}
