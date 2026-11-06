import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_transcript_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late SimulationTranscriptRepository repository;

  setUp(() {
    dio = MockDio();
    repository = SimulationTranscriptRepository(dio);
  });

  group('getMessages', () {
    test('requests the expected pagination params and parses the page', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/sess-1/messages',
          queryParameters: {
            'limit': SimulationTranscriptRepository.pageSize,
            'offset': 20,
            'sortBy': 'startSeconds',
            'sortOrder': 'ASC',
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'messages': [
            {'id': 1, 'content': 'Hi', 'startSeconds': 0, 'senderId': -1},
            {'id': 2, 'content': 'Hello', 'startSeconds': 5, 'senderId': 100},
          ],
          'count': 22,
        }),
      );

      final result = await repository.getMessages(
        scenarioSessionId: 'sess-1',
        offset: 20,
      );

      expect(result.messages, hasLength(2));
      expect(result.count, 22);
      verify(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/sess-1/messages',
          queryParameters: {
            'limit': SimulationTranscriptRepository.pageSize,
            'offset': 20,
            'sortBy': 'startSeconds',
            'sortOrder': 'ASC',
          },
        ),
      ).called(1);
    });

    test('defaults to an empty page when messages/count are absent', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/sess-1/messages',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getMessages(
        scenarioSessionId: 'sess-1',
        offset: 0,
      );

      expect(result.messages, isEmpty);
      expect(result.count, 0);
    });
  });

  group('SimulationTranscriptMessage.fromJson', () {
    test('parses all fields, defaulting missing content/startSeconds', () {
      final message = SimulationTranscriptMessage.fromJson({
        'id': 9,
        'senderId': 5,
      });

      expect(message.id, 9);
      expect(message.content, '');
      expect(message.startSeconds, 0);
      expect(message.senderId, 5);
    });
  });

  group('SimulationTranscriptMessage.isLearner', () {
    test('senderId == -1 is the AI speaker, not the learner', () {
      final message = SimulationTranscriptMessage.fromJson({
        'id': 1,
        'senderId': -1,
        'content': 'AI line',
        'startSeconds': 0,
      });

      expect(message.isLearner, isFalse);
    });

    test('any other senderId is the learner', () {
      for (final senderId in [0, 1, 42, -2]) {
        final message = SimulationTranscriptMessage.fromJson({
          'id': 1,
          'senderId': senderId,
          'content': 'Learner line',
          'startSeconds': 0,
        });

        expect(message.isLearner, isTrue, reason: 'senderId=$senderId');
      }
    });
  });

  group('SimulationTranscriptMessage.formattedTime', () {
    String formattedTimeFor(num startSeconds) {
      final message = SimulationTranscriptMessage.fromJson({
        'id': 1,
        'senderId': -1,
        'content': '',
        'startSeconds': startSeconds,
      });
      return message.formattedTime;
    }

    test('0 seconds formats as 00:00 (RN formatTimeToMMSS)', () {
      expect(formattedTimeFor(0), '00:00');
    });

    test('59 seconds formats as 00:59', () {
      expect(formattedTimeFor(59), '00:59');
    });

    test('60 seconds rolls over to 01:00', () {
      expect(formattedTimeFor(60), '01:00');
    });

    test('125 seconds formats as 02:05', () {
      expect(formattedTimeFor(125), '02:05');
    });

    test('fractional seconds are floored, as RN does', () {
      expect(formattedTimeFor(59.6), '00:59');
    });
  });
}
