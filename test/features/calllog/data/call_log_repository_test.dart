import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/calllog/data/call_log_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late CallLogRepository repository;

  setUp(() {
    dio = MockDio();
    repository = CallLogRepository(dio);
  });

  group('getCallLogs', () {
    test('passes limit/offset as query params and maps each entry', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 10, 'offset': 20, 'archive': false},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 1,
              'startedAt': '2026-01-01T00:00:00Z',
              'endedAt': '2026-01-01T00:10:00Z',
              'status': 'generated',
              'metadata': {'sessionName': 'Walk-in #1'},
              'score': 87.5,
            },
          ],
        }),
      );

      final logs = await repository.getCallLogs(limit: 10, offset: 20);

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 10, 'offset': 20, 'archive': false},
        ),
      ).called(1);
      expect(logs, hasLength(1));
      expect(logs.first.id, 1);
      expect(logs.first.sessionName, 'Walk-in #1');
      expect(logs.first.score, 87.5);
    });

    test('defaults to limit 25 / offset 0 / archive false', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 25, 'offset': 0, 'archive': false},
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getCallLogs();

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 25, 'offset': 0, 'archive': false},
        ),
      ).called(1);
    });

    test('passes archive: true through to the query params', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 25, 'offset': 0, 'archive': true},
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getCallLogs(archive: true);

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {'limit': 25, 'offset': 0, 'archive': true},
        ),
      ).called(1);
    });

    test('returns an empty list when data is missing', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      final logs = await repository.getCallLogs();

      expect(logs, isEmpty);
    });

    test('a log with no sessionName/score parses those as null', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 2,
              'startedAt': '2026-01-01T00:00:00Z',
              'status': 'processing',
            },
          ],
        }),
      );

      final logs = await repository.getCallLogs();

      expect(logs.single.sessionName, isNull);
      expect(logs.single.score, isNull);
      expect(logs.single.endedAt, '');
    });

    test('parses details.summary.tags into CallTag, clamping out-of-range ratings', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 3,
              'startedAt': '2026-01-01T00:00:00Z',
              'status': 'generated',
              'details': {
                'summary': {
                  'tags': [
                    {'tag': 'anxious', 'positivity_rating': 1},
                    // AI sometimes emits fractional/out-of-range values —
                    // round-then-clamp to the nearest valid 1-5 key.
                    {'tag': 'hopeful', 'positivity_rating': 0.3},
                    {'tag': 'resolved', 'positivity_rating': 9},
                  ],
                },
              },
            },
          ],
        }),
      );

      final logs = await repository.getCallLogs();

      final tags = logs.single.tags;
      expect(tags, hasLength(3));
      expect(tags[0].tag, 'anxious');
      expect(tags[0].positivityRating, 1);
      expect(tags[1].tag, 'hopeful');
      expect(tags[1].positivityRating, 1);
      expect(tags[2].tag, 'resolved');
      expect(tags[2].positivityRating, 5);
    });

    test('a log with no details/summary/tags at all parses tags as empty', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 4, 'startedAt': '2026-01-01T00:00:00Z', 'status': 'generated'},
          ],
        }),
      );

      final logs = await repository.getCallLogs();

      expect(logs.single.tags, isEmpty);
    });

    test('forwards a non-empty CallLogFilterState as comma-joined query params', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {
            'limit': 25,
            'offset': 0,
            'archive': false,
            'startDate': '2026-01-01',
            'endDate': '2026-01-31',
            'minDuration': 5.0,
            'maxDuration': 30.0,
            'tags': 'anxious,hopeful',
            'mode': 'SCRIBE,DICTATION',
            'status': 'SUCCESS,FAILED',
            'source': 'LIVE',
          },
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getCallLogs(
        filter: const CallLogFilterState(
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          minDuration: 5,
          maxDuration: 30,
          tags: ['anxious', 'hopeful'],
          modes: ['SCRIBE', 'DICTATION'],
          statuses: ['SUCCESS', 'FAILED'],
          sources: ['LIVE'],
        ),
      );

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/chats/call-logs',
          queryParameters: {
            'limit': 25,
            'offset': 0,
            'archive': false,
            'startDate': '2026-01-01',
            'endDate': '2026-01-31',
            'minDuration': 5.0,
            'maxDuration': 30.0,
            'tags': 'anxious,hopeful',
            'mode': 'SCRIBE,DICTATION',
            'status': 'SUCCESS,FAILED',
            'source': 'LIVE',
          },
        ),
      ).called(1);
    });
  });

  group('getAllTags', () {
    test('hits /chats/tags and returns the tag-name list', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/tags',
          queryParameters: <String, dynamic>{},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': ['anxious', 'hopeful', 'resolved'],
        }),
      );

      final tags = await repository.getAllTags();

      expect(tags, ['anxious', 'hopeful', 'resolved']);
    });

    test('forwards a search term', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/tags',
          queryParameters: {'search': 'anx'},
        ),
      ).thenAnswer((_) async => _response({'data': <dynamic>[]}));

      await repository.getAllTags(search: 'anx');

      verify(
        () => dio.get<Map<String, dynamic>>(
          '/chats/tags',
          queryParameters: {'search': 'anx'},
        ),
      ).called(1);
    });

    test('returns an empty list when data is missing', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/chats/tags',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      expect(await repository.getAllTags(), isEmpty);
    });
  });

  group('CallLogFilterState', () {
    test('isEmpty / activeCount reflect which fields are set', () {
      const empty = CallLogFilterState();
      expect(empty.isEmpty, isTrue);
      expect(empty.activeCount, 0);

      const partial = CallLogFilterState(minDuration: 5, tags: ['anxious']);
      expect(partial.isEmpty, isFalse);
      expect(partial.activeCount, 2);
    });

    test('copyWith overrides only the given fields', () {
      const original = CallLogFilterState(startDate: '2026-01-01', tags: ['anxious']);

      final updated = original.copyWith(endDate: '2026-01-31');

      expect(updated.startDate, '2026-01-01');
      expect(updated.endDate, '2026-01-31');
      expect(updated.tags, ['anxious']);
    });

    test('toQueryParameters omits every field left unset', () {
      const empty = CallLogFilterState();
      expect(empty.toQueryParameters(), isEmpty);
    });
  });

  group('getSimulationLogs', () {
    test('hits /learn/scenario-sessions and maps each entry', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-sessions',
          queryParameters: {'limit': 25, 'offset': 0},
        ),
      ).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'id': 3,
              'startedAt': '2026-01-01T00:00:00Z',
              'status': 'SUCCESS',
              'scenario': {'title': 'Difficult client'},
              'score': 80.0,
            },
          ],
        }),
      );

      final logs = await repository.getSimulationLogs();

      expect(logs, hasLength(1));
      expect(logs.first.id, 3);
      expect(logs.first.scenarioTitle, 'Difficult client');
      expect(logs.first.status, 'SUCCESS');
      expect(logs.first.score, 80.0);
    });

    test('returns an empty list when data is missing', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-sessions',
          queryParameters: any(named: 'queryParameters'),
        ),
      ).thenAnswer((_) async => _response({}));

      final logs = await repository.getSimulationLogs();

      expect(logs, isEmpty);
    });
  });

  group('archiveCallLog', () {
    test('PATCHes {archive: true} by default', () async {
      when(
        () => dio.patch<void>('/chats/call-logs/5/archive', data: {'archive': true}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.archiveCallLog(5);

      verify(
        () => dio.patch<void>('/chats/call-logs/5/archive', data: {'archive': true}),
      ).called(1);
    });

    test('PATCHes {archive: false} to unarchive', () async {
      when(
        () => dio.patch<void>('/chats/call-logs/5/archive', data: {'archive': false}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.archiveCallLog(5, archive: false);

      verify(
        () => dio.patch<void>('/chats/call-logs/5/archive', data: {'archive': false}),
      ).called(1);
    });
  });

  group('getCallSummary / CallSummaryDetails.fromJson merge logic', () {
    test('merges summary + computed callDetails/callInfo fields, and joins tags', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'clientId': 1234,
          'counselorId': 55,
          'details': {
            'summary': {
              'sessionSummary': 'Client discussed exam stress.',
              'keyConcerns': 'Academic pressure',
              'tags': [
                {'tag': 'anxiety'},
                {'tag': 'exams'},
              ],
            },
            'callDuration': '12:34',
            'startTime': '2026-01-01T10:00:00Z',
            'endTime': '2026-01-01T10:12:34Z',
            'callInfo': {'mode': 'Scribe', 'notes': 'Follow up next week'},
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.counselorId, 55);
      expect(summary.sessionSummary, 'Client discussed exam stress.');
      expect(summary.keyConcerns, 'Academic pressure');
      // tags: list of {tag: ...} maps collapsed to a comma-joined string.
      expect(summary.fields['tags'], 'anxiety, exams');
      // Read-only fields computed from callDetails/callInfo/top-level json,
      // not from summary itself.
      expect(summary.fields['callId'], 9);
      expect(summary.fields['callDuration'], '12:34');
      expect(summary.fields['callDate'], '2026-01-01T10:00:00Z');
      expect(summary.fields['callTime'], '2026-01-01T10:00:00Z - 2026-01-01T10:12:34Z');
      expect(summary.fields['clientId'], 1234);
      expect(summary.fields['mode'], 'Scribe');
      expect(summary.fields['additionalNotes'], 'Follow up next week');
    });

    test('a field already present on summary wins over the computed fallback (??=)', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'clientId': 1234,
          'details': {
            'summary': {
              // summary already carries its own 'mode' value.
              'mode': 'custom-override',
            },
            'callInfo': {'mode': 'Scribe'},
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.fields['mode'], 'custom-override');
    });

    test('callTime is null when either startTime or endTime is missing', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'details': {
            'summary': <String, dynamic>{},
            'startTime': '2026-01-01T10:00:00Z',
            // no endTime
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.fields['callTime'], isNull);
    });

    test('missing details/summary entirely still parses without crashing', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({'id': 9}),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.counselorId, isNull);
      expect(summary.sessionSummary, isNull);
      expect(summary.fields['callId'], 9);
    });
  });

  group('updateCallSummary', () {
    test('PUTs only the changed fields nested under "summary"', () async {
      when(
        () => dio.put<Map<String, dynamic>>(
          '/chats/9/call-details',
          data: {
            'summary': {'sessionSummary': 'Updated text', 'tags': null},
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 9,
          'details': {
            'summary': {'sessionSummary': 'Updated text'},
          },
        }),
      );

      final result = await repository.updateCallSummary(9, {
        'sessionSummary': 'Updated text',
        'tags': null,
      });

      verify(
        () => dio.put<Map<String, dynamic>>(
          '/chats/9/call-details',
          data: {
            'summary': {'sessionSummary': 'Updated text', 'tags': null},
          },
        ),
      ).called(1);
      expect(result.sessionSummary, 'Updated text');
    });
  });

  group('getChatMessages', () {
    test('maps each entry in the response list', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9/messages')).thenAnswer(
        (_) async => _response({
          'data': [
            {
              'messageId': 1,
              'content': 'Hello',
              'createdAt': '2026-01-01T10:00:00Z',
              'senderId': 55,
            },
            {
              'messageId': 2,
              'content': 'Hi there',
              'createdAt': '2026-01-01T10:00:05Z',
              'senderId': 1234,
            },
          ],
        }),
      );

      final messages = await repository.getChatMessages(9);

      expect(messages, hasLength(2));
      expect(messages[0].content, 'Hello');
      expect(messages[1].senderId, 1234);
    });

    test('returns an empty list when data is missing', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9/messages')).thenAnswer(
        (_) async => _response({}),
      );

      final messages = await repository.getChatMessages(9);

      expect(messages, isEmpty);
    });
  });
}
