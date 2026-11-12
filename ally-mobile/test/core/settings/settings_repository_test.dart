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
    test('GETs the bare-boolean endpoint as plain text and parses it', () async {
      when(() => dio.get<String>('/settings/scribe-note-creation-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response('true'));

      final result = await repository.getScribeNoteCreationEnabled();

      expect(result, isTrue);
      final captured = verify(
        () => dio.get<String>('/settings/scribe-note-creation-enabled', options: captureAny(named: 'options')),
      ).captured.single as Options;
      // Fetched as plain text, not Dio's default JSON decode — the backend
      // sends this bare boolean with a `text/html` content type (a NestJS/
      // Express quirk for non-object return values), which Dio can't
      // reliably decode straight to `<bool>` against.
      expect(captured.responseType, ResponseType.plain);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<String>('/settings/scribe-note-creation-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response(null));

      final result = await repository.getScribeNoteCreationEnabled();

      expect(result, isFalse);
    });
  });

  group('getScribeVoiceNoteEnabled', () {
    test('GETs the bare-boolean endpoint as plain text and parses it', () async {
      when(() => dio.get<String>('/settings/scribe-voice-note-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response('true'));

      final result = await repository.getScribeVoiceNoteEnabled();

      expect(result, isTrue);
      verify(() => dio.get<String>('/settings/scribe-voice-note-enabled', options: any(named: 'options'))).called(1);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<String>('/settings/scribe-voice-note-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response(null));

      final result = await repository.getScribeVoiceNoteEnabled();

      expect(result, isFalse);
    });
  });

  group('getCustomFieldsEnabled', () {
    test('GETs the bare-boolean endpoint as plain text and parses it', () async {
      when(() => dio.get<String>('/settings/custom-fields-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response('false'));

      final result = await repository.getCustomFieldsEnabled();

      expect(result, isFalse);
      verify(() => dio.get<String>('/settings/custom-fields-enabled', options: any(named: 'options'))).called(1);
    });

    test('defaults to true (active) when the body is absent, unlike the other toggles', () async {
      when(() => dio.get<String>('/settings/custom-fields-enabled', options: any(named: 'options')))
          .thenAnswer((_) async => _response(null));

      final result = await repository.getCustomFieldsEnabled();

      expect(result, isTrue);
    });
  });

  group('getNudgeStatus', () {
    test('GETs the bare-boolean endpoint as plain text and parses it', () async {
      when(() => dio.get<String>('/settings/nudge-status', options: any(named: 'options')))
          .thenAnswer((_) async => _response('true'));

      final result = await repository.getNudgeStatus();

      expect(result, isTrue);
      verify(() => dio.get<String>('/settings/nudge-status', options: any(named: 'options'))).called(1);
    });

    test('defaults to false when the body is absent', () async {
      when(() => dio.get<String>('/settings/nudge-status', options: any(named: 'options')))
          .thenAnswer((_) async => _response(null));

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
