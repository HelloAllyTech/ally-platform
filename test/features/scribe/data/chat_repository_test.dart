import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/scribe/data/chat_models.dart';
import 'package:ally_mobile_flutter/features/scribe/data/chat_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late ChatRepository repository;

  setUp(() {
    dio = MockDio();
    repository = ChatRepository(dio);
  });

  group('getCounsellorChat', () {
    test('parses an active conference-call chat from /chats/counsellor-chat', () async {
      when(() => dio.get<dynamic>('/chats/counsellor-chat')).thenAnswer(
        (_) async => _response({
          'chatId': 42,
          'status': 'ACTIVE',
          'provider': 'EXOTEL_CONFERENCE_CALL',
          'startedAt': '2026-01-01T00:00:00Z',
          'endedAt': null,
        }),
      );

      final chat = await repository.getCounsellorChat();

      expect(chat, isNotNull);
      expect(chat!.chatId, 42);
      expect(chat.status, ChatStatus.active);
      expect(chat.isConferenceCall, isTrue);
    });

    test('a microphone chat is not a conference call', () async {
      when(() => dio.get<dynamic>('/chats/counsellor-chat')).thenAnswer(
        (_) async => _response({
          'chatId': 7,
          'status': 'ACTIVE',
          'provider': 'MICROPHONE',
          'startedAt': '2026-01-01T00:00:00Z',
        }),
      );

      final chat = await repository.getCounsellorChat();

      expect(chat!.isConferenceCall, isFalse);
    });

    test('returns null when the API responds with an empty array (no active chat)', () async {
      when(
        () => dio.get<dynamic>('/chats/counsellor-chat'),
      ).thenAnswer((_) async => _response(<dynamic>[]));

      final chat = await repository.getCounsellorChat();

      expect(chat, isNull);
    });
  });

  group('endCall', () {
    test('POSTs to /chats/:chatId/end', () async {
      when(() => dio.post<void>('/chats/42/end')).thenAnswer((_) async => _response(null));

      await repository.endCall(42);

      verify(() => dio.post<void>('/chats/42/end')).called(1);
    });
  });

  group('addFeedback', () {
    test('POSTs the rating to /chats/messages/:messageId/feedback', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/chats/messages/7/feedback',
          data: {'rating': 1},
        ),
      ).thenAnswer((_) async => _response({'feedbackId': 99, 'rating': 1}));

      final feedback = await repository.addFeedback(7, 1);

      expect(feedback.feedbackId, 99);
      expect(feedback.rating, 1);
    });
  });

  group('updateFeedback', () {
    test('PATCHes the rating to /chats/messages/feedback/:feedbackId', () async {
      when(
        () => dio.patch<Map<String, dynamic>>(
          '/chats/messages/feedback/99',
          data: {'rating': 0},
        ),
      ).thenAnswer((_) async => _response({'feedbackId': 99, 'rating': 0}));

      final feedback = await repository.updateFeedback(99, 0);

      expect(feedback.rating, 0);
    });
  });
}
