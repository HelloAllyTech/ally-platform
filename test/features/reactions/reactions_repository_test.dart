import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/reactions/data/reactions_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late ReactionsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = ReactionsRepository(dio);
  });

  group('getReactions', () {
    test('fetches and parses the reaction list with default pagination', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/reactions',
            queryParameters: {'offset': 0, 'limit': 50},
          )).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'reaction': '👍',
              'createdBy': {'id': 1, 'name': 'Alex', 'profileImage': 'img.png'},
            },
          ],
        }),
      );

      final result = await repository.getReactions('rev-1');

      expect(result, hasLength(1));
      expect(result.first.reaction, '👍');
      expect(result.first.createdBy.name, 'Alex');
      expect(result.first.createdBy.id, '1');
      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/reactions',
            queryParameters: {'offset': 0, 'limit': 50},
          )).called(1);
    });

    test('forwards custom offset/limit', () async {
      when(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/reactions',
            queryParameters: {'offset': 20, 'limit': 5},
          )).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getReactions('rev-1', offset: 20, limit: 5);

      verify(() => dio.get<Map<String, dynamic>>(
            '/scenario-session-reviews/rev-1/reactions',
            queryParameters: {'offset': 20, 'limit': 5},
          )).called(1);
    });

    test('returns an empty list when data is absent', () async {
      when(() => dio.get<Map<String, dynamic>>(any(), queryParameters: any(named: 'queryParameters')))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getReactions('rev-1');

      expect(result, isEmpty);
    });
  });

  group('getReactionsCount', () {
    test('parses the reactions count map', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/rev-1/reactions/count'))
          .thenAnswer(
        (_) async => _response({
          'reactions': {'👍': 3, '❤️': 1},
        }),
      );

      final result = await repository.getReactionsCount('rev-1');

      expect(result, {'👍': 3, '❤️': 1});
    });

    test('returns an empty map when the reactions field is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/scenario-session-reviews/rev-1/reactions/count'))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getReactionsCount('rev-1');

      expect(result, isEmpty);
    });
  });

  group('addReactionToReview', () {
    test('posts reaction and action=ADD', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '👍', 'action': 'ADD'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addReactionToReview(
        reviewId: 'rev-1',
        reaction: '👍',
        action: ReactionAction.add,
      );

      verify(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '👍', 'action': 'ADD'},
          )).called(1);
    });

    test('posts action=REMOVE', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '👍', 'action': 'REMOVE'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addReactionToReview(
        reviewId: 'rev-1',
        reaction: '👍',
        action: ReactionAction.remove,
      );

      verify(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '👍', 'action': 'REMOVE'},
          )).called(1);
    });

    test('posts action=UPDATE', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '❤️', 'action': 'UPDATE'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addReactionToReview(
        reviewId: 'rev-1',
        reaction: '❤️',
        action: ReactionAction.update,
      );

      verify(() => dio.post<void>(
            '/scenario-session-reviews/rev-1/reactions',
            data: {'reaction': '❤️', 'action': 'UPDATE'},
          )).called(1);
    });
  });

  group('addReactionToComment', () {
    test('posts reaction and action to the comment reactions endpoint', () async {
      when(() => dio.post<void>(
            '/scenario-session-reviews/comments/c-1/reactions',
            data: {'reaction': '🎉', 'action': 'ADD'},
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addReactionToComment(
        commentId: 'c-1',
        reaction: '🎉',
        action: ReactionAction.add,
      );

      verify(() => dio.post<void>(
            '/scenario-session-reviews/comments/c-1/reactions',
            data: {'reaction': '🎉', 'action': 'ADD'},
          )).called(1);
    });
  });
}
