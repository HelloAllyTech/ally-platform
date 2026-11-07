import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/core/settings/settings_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data) =>
    Response<T>(data: data, statusCode: 200, requestOptions: RequestOptions(path: ''));

void main() {
  late MockDio dio;
  late SettingsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = SettingsRepository(dio);
  });

  group('getScribeNoteCreationEnabled', () {
    test('GETs the bare-boolean endpoint and returns it', () async {
      when(() => dio.get<bool>('/settings/scribe-note-creation-enabled'))
          .thenAnswer((_) async => _response(true));

      final result = await repository.getScribeNoteCreationEnabled();

      expect(result, isTrue);
      verify(() => dio.get<bool>('/settings/scribe-note-creation-enabled')).called(1);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<bool>('/settings/scribe-note-creation-enabled'))
          .thenAnswer((_) async => _response(null));

      final result = await repository.getScribeNoteCreationEnabled();

      expect(result, isFalse);
    });
  });

  group('getScribeVoiceNoteEnabled', () {
    test('GETs the bare-boolean endpoint and returns it', () async {
      when(() => dio.get<bool>('/settings/scribe-voice-note-enabled')).thenAnswer((_) async => _response(true));

      final result = await repository.getScribeVoiceNoteEnabled();

      expect(result, isTrue);
      verify(() => dio.get<bool>('/settings/scribe-voice-note-enabled')).called(1);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<bool>('/settings/scribe-voice-note-enabled')).thenAnswer((_) async => _response(null));

      final result = await repository.getScribeVoiceNoteEnabled();

      expect(result, isFalse);
    });
  });

  group('getCustomFieldsEnabled', () {
    test('GETs the bare-boolean endpoint and returns it', () async {
      when(() => dio.get<bool>('/settings/custom-fields-enabled')).thenAnswer((_) async => _response(false));

      final result = await repository.getCustomFieldsEnabled();

      expect(result, isFalse);
      verify(() => dio.get<bool>('/settings/custom-fields-enabled')).called(1);
    });

    test('defaults to true (active) when the body is absent, unlike the other toggles', () async {
      when(() => dio.get<bool>('/settings/custom-fields-enabled')).thenAnswer((_) async => _response(null));

      final result = await repository.getCustomFieldsEnabled();

      expect(result, isTrue);
    });
  });

  group('getNudgeStatus', () {
    test('GETs the bare-boolean endpoint and returns it', () async {
      when(() => dio.get<bool>('/settings/nudge-status')).thenAnswer((_) async => _response(true));

      final result = await repository.getNudgeStatus();

      expect(result, isTrue);
      verify(() => dio.get<bool>('/settings/nudge-status')).called(1);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<bool>('/settings/nudge-status')).thenAnswer((_) async => _response(null));

      final result = await repository.getNudgeStatus();

      expect(result, isFalse);
    });
  });

  group('getVisibleChatTypes', () {
    test('GETs the list endpoint and returns the chat-type strings as-is', () async {
      when(() => dio.get<List<dynamic>>('/settings/chat-types'))
          .thenAnswer((_) async => _response(<dynamic>['MICROPHONE_CHAT', 'EXOTEL_CONFERENCE_CHAT']));

      final result = await repository.getVisibleChatTypes();

      expect(result, ['MICROPHONE_CHAT', 'EXOTEL_CONFERENCE_CHAT']);
      verify(() => dio.get<List<dynamic>>('/settings/chat-types')).called(1);
    });

    test('defaults to an empty list when the body is absent, unlike the bare-boolean toggles', () async {
      when(() => dio.get<List<dynamic>>('/settings/chat-types')).thenAnswer((_) async => _response(null));

      final result = await repository.getVisibleChatTypes();

      expect(result, isEmpty);
    });
  });
}
