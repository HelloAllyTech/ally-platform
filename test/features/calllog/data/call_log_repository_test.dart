import 'dart:convert';
import 'dart:io';

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

    test('CallLogItem.fromJson reads summaryStatus, details.chatId, provider and mode', () {
      final log = CallLogItem.fromJson({
        'id': 15,
        'startedAt': '2026-10-22T16:13:00Z',
        'endedAt': '2026-10-22T16:20:00Z',
        'status': 'ENDED',
        'summaryStatus': 'FAILED',
        'details': {
          'chatId': 15,
          'callInfo': {'provider': 'AUDIO_UPLOAD', 'mode': 'DICTATION'},
        },
      });
      expect(log.displayStatus, 'FAILED');
      expect(log.chatId, 15);
      expect(log.provider, 'AUDIO_UPLOAD');
      expect(log.mode, 'DICTATION');
      // RN's logTitle: summaryName || sessionName || chatId || `ID-${id}`.
      expect(log.logTitle, '15');

      final bare = CallLogItem.fromJson({
        'id': 16,
        'startedAt': '2026-10-23T12:07:00Z',
        'status': 'ENDED',
        'details': <String, dynamic>{},
      });
      expect(bare.chatId, isNull);
      expect(bare.displayStatus, 'ENDED');
      expect(bare.logTitle, 'ID-16');
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

    test('a custom-field value counts toward isEmpty/activeCount and serialises as fieldFilters', () {
      const withCustom = CallLogFilterState(customFieldValues: {'f1': 'anx', 'f2': <String>[]});
      expect(withCustom.isEmpty, isFalse);
      // Only 'f1' is non-empty ('f2' is an empty list) — activeCount counts
      // actual non-empty values, not just map entries.
      expect(withCustom.activeCount, 1);

      final params = withCustom.toQueryParameters();
      expect(jsonDecode(params['fieldFilters'] as String), [
        {'fieldDefinitionId': 'f1', 'value': 'anx'},
      ]);
    });

    test('copyWith overrides customFieldValues like every other field', () {
      const original = CallLogFilterState(customFieldValues: {'f1': 'anx'});
      final updated = original.copyWith(customFieldValues: {'f1': 'anx', 'f2': 'hopeful'});
      expect(updated.customFieldValues, {'f1': 'anx', 'f2': 'hopeful'});
    });

    test('equality compares customFieldValues structurally, including list values', () {
      const a = CallLogFilterState(customFieldValues: {'f1': 'anx', 'f2': ['x', 'y']});
      const b = CallLogFilterState(customFieldValues: {'f1': 'anx', 'f2': ['x', 'y']});
      const c = CallLogFilterState(customFieldValues: {'f1': 'anx', 'f2': ['x', 'z']});

      expect(a, b);
      expect(a, isNot(c));
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
              // A scenario session's real id is a UUID (ally-be's
              // `ScenarioSessions` entity: `@PrimaryGeneratedColumn('uuid')`)
              // — this mock used to say `3`, which is exactly how the
              // `(json['id'] as num)` bug this guards against slipped past
              // the test suite in the first place.
              'id': 'b1c9b7b0-7e2b-4b1a-9f0a-7b9f6a2e5c33',
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
      expect(logs.first.id, 'b1c9b7b0-7e2b-4b1a-9f0a-7b9f6a2e5c33');
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

  group('updateSummaryName', () {
    test('PATCHes the new summaryName to call-info', () async {
      when(
        () => dio.patch<void>('/chats/9/call-info', data: {'summaryName': 'Renamed session'}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.updateSummaryName(9, 'Renamed session');

      verify(
        () => dio.patch<void>('/chats/9/call-info', data: {'summaryName': 'Renamed session'}),
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
      expect(summary.isSummaryAvailable, isFalse, reason: 'no details.summary object');
      expect(summary.summaryStatus, isNull);
      expect(summary.isSummaryFeedbackAdded, isFalse);
    });

    test('parses summaryStatus (top-level) and isSummaryAvailable/isSummaryFeedbackAdded', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'summaryStatus': 'SUCCESS',
          'details': {
            'summary': {'sessionSummary': 'Done'},
            'callInfo': {'isSummaryFeedbackAdded': true},
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.summaryStatus, 'SUCCESS');
      expect(summary.isSummaryAvailable, isTrue);
      expect(summary.isSummaryFeedbackAdded, isTrue);
      expect(summary.isManualNote, isFalse);
    });

    test('isManualNote is true for a SUCCESS status with no AI summary object', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'summaryStatus': 'SUCCESS',
          'details': {'callInfo': <String, dynamic>{}},
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.isSummaryAvailable, isFalse);
      expect(summary.isManualNote, isTrue);
    });

    test('parses archivedAt, the scribe review fields, and hasTranscript', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'summaryStatus': 'SUCCESS',
          'archivedAt': '2026-02-01T00:00:00Z',
          'reviewId': 'rev-1',
          'reviewStatus': 'IN_REVIEW',
          'reviewNote': 'Take a look at this one',
          'reviewCreatedAt': '2026-01-31T00:00:00Z',
          'details': {
            'summary': {'sessionSummary': 'Done'},
            'callInfo': <String, dynamic>{},
            'transcript': 'the full transcript',
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.archivedAt, '2026-02-01T00:00:00Z');
      expect(summary.isArchived, isTrue);
      expect(summary.reviewId, 'rev-1');
      expect(summary.reviewStatus, 'IN_REVIEW');
      expect(summary.reviewNote, 'Take a look at this one');
      expect(summary.reviewCreatedAt, '2026-01-31T00:00:00Z');
      expect(summary.isSharedForReview, isTrue);
      expect(summary.hasTranscript, isTrue);
    });

    test('isArchived/reviewId/hasTranscript default to not-archived/null/false when absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'summaryStatus': 'SUCCESS',
          'details': {
            'summary': {'sessionSummary': 'Done'},
            'callInfo': <String, dynamic>{},
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.isArchived, isFalse);
      expect(summary.reviewId, isNull);
      expect(summary.isSharedForReview, isFalse);
      expect(summary.hasTranscript, isFalse);
    });

    test('isSharedForReview is false for a review that exists but is HIDDEN', () async {
      when(() => dio.get<Map<String, dynamic>>('/chats/9')).thenAnswer(
        (_) async => _response({
          'id': 9,
          'summaryStatus': 'SUCCESS',
          'reviewId': 'rev-1',
          'reviewStatus': 'HIDDEN',
          'details': {
            'summary': {'sessionSummary': 'Done'},
            'callInfo': <String, dynamic>{},
          },
        }),
      );

      final summary = await repository.getCallSummary(9);

      expect(summary.isSharedForReview, isFalse);
    });
  });

  group('retrySummary', () {
    test('POSTs /chats/{id}/retry-summary and parses success/message', () async {
      when(() => dio.post<Map<String, dynamic>>('/chats/9/retry-summary')).thenAnswer(
        (_) async => _response({'success': true, 'message': 'Regenerating'}),
      );

      final result = await repository.retrySummary(9);

      expect(result.success, isTrue);
      expect(result.message, 'Regenerating');
      verify(() => dio.post<Map<String, dynamic>>('/chats/9/retry-summary')).called(1);
    });

    test('defaults success to false and message to null when absent', () async {
      when(() => dio.post<Map<String, dynamic>>('/chats/9/retry-summary'))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.retrySummary(9);

      expect(result.success, isFalse);
      expect(result.message, isNull);
    });
  });

  group('createNote', () {
    test('POSTs /chats/note with no body and parses the created note', () async {
      when(() => dio.post<Map<String, dynamic>>('/chats/note')).thenAnswer(
        (_) async => _response({'chatId': 42, 'name': 'CALL-42-2026-10-27'}),
      );

      final result = await repository.createNote();

      expect(result.chatId, 42);
      expect(result.name, 'CALL-42-2026-10-27');
      verify(() => dio.post<Map<String, dynamic>>('/chats/note')).called(1);
    });

    test('defaults name to empty when absent', () async {
      when(() => dio.post<Map<String, dynamic>>('/chats/note'))
          .thenAnswer((_) async => _response({'chatId': 7}));

      final result = await repository.createNote();

      expect(result.chatId, 7);
      expect(result.name, '');
    });
  });

  group('generateNoteFromAudio', () {
    late String audioPath;

    setUp(() async {
      final file = await File('${Directory.systemTemp.path}/voice_note_repo_test.wav').create();
      await file.writeAsBytes([1, 2, 3, 4]);
      audioPath = file.path;
    });

    tearDown(() async {
      final file = File(audioPath);
      if (await file.exists()) await file.delete();
    });

    test('POSTs multipart form data to the generate-from-audio route and parses values', () async {
      when(
        () => dio.post<Map<String, dynamic>>('/chats/note/generate-from-audio', data: any(named: 'data')),
      ).thenAnswer(
        (invocation) async {
          final formData = invocation.namedArguments[#data] as FormData;
          // The "audio" part is a file upload; "fields" is the JSON-encoded catalog.
          expect(formData.files.single.key, 'audio');
          expect(formData.files.single.value.filename, 'dictation.wav');
          final fieldsPart = formData.fields.singleWhere((f) => f.key == 'fields');
          expect(fieldsPart.value, '[{"id":"sessionSummary","label":"Session Summary"}]');
          return _response({
            'transcript': 'The client discussed anxiety.',
            'values': [
              {'id': 'sessionSummary', 'value': 'The client discussed anxiety.'},
            ],
          });
        },
      );

      final result = await repository.generateNoteFromAudio(
        audioFilePath: audioPath,
        fields: [
          {'id': 'sessionSummary', 'label': 'Session Summary'},
        ],
      );

      expect(result.transcript, 'The client discussed anxiety.');
      expect(result.values, [(id: 'sessionSummary', value: 'The client discussed anxiety.')]);
    });

    test('defaults transcript/values when the response omits them', () async {
      when(
        () => dio.post<Map<String, dynamic>>('/chats/note/generate-from-audio', data: any(named: 'data')),
      ).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.generateNoteFromAudio(audioFilePath: audioPath, fields: const []);

      expect(result.transcript, '');
      expect(result.values, isEmpty);
    });
  });

  group('saveNoteTranscript', () {
    test('PUTs the transcript to /chats/:id/transcript', () async {
      when(
        () => dio.put<void>('/chats/55/transcript', data: {'transcript': 'Full dictation text.'}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.saveNoteTranscript(chatId: 55, transcript: 'Full dictation text.');

      verify(() => dio.put<void>('/chats/55/transcript', data: {'transcript': 'Full dictation text.'})).called(1);
    });
  });

  group('addSummaryFeedback', () {
    test('POSTs rating and nested feedback.issues/comment', () async {
      when(() => dio.post<void>(
            '/chats/9/summary-feedback',
            data: {
              'rating': 4,
              'feedback': {'issues': <String>[], 'comment': 'Great summary'},
            },
          )).thenAnswer((_) async => _response<void>(null));

      await repository.addSummaryFeedback(chatId: 9, rating: 4, comment: 'Great summary');

      verify(() => dio.post<void>(
            '/chats/9/summary-feedback',
            data: {
              'rating': 4,
              'feedback': {'issues': <String>[], 'comment': 'Great summary'},
            },
          )).called(1);
    });
  });

  group('updateCallSummary', () {
    test('PUTs only the changed fields nested under "summary"', () async {
      when(
        () => dio.put<Map<String, dynamic>>(
          '/chats/9/call-details',
          data: {
            'summary': {'sessionSummary': 'Updated text', 'tags': <String>[]},
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
            'summary': {'sessionSummary': 'Updated text', 'tags': <String>[]},
          },
        ),
      ).called(1);
      expect(result.sessionSummary, 'Updated text');
    });

    test('sends tags as a list of names, not the comma-joined form text (RN handleSubmit)', () {
      expect(summaryPatchForSubmission({'tags': ' anxiety, , sleep ,grief'}), {
        'tags': ['anxiety', 'sleep', 'grief'],
      });
      expect(summaryPatchForSubmission({'tags': ''}), {'tags': <String>[]});
      expect(summaryPatchForSubmission({'flow': 'x'}), {'flow': 'x'});
    });
  });

  group('CallSummaryDetails form fields', () {
    test('tags and dominantFeelings arrays become comma-separated text', () {
      final details = CallSummaryDetails.fromJson({
        'id': 1,
        'details': {
          'summary': {
            'tags': [
              {'tag': 'a', 'positivity_rating': 1},
              {'tag': 'b', 'positivity_rating': 0},
            ],
            'dominantFeelings': ['sad', 'angry'],
          },
        },
      });
      expect(details.fields['tags'], 'a, b');
      expect(details.fields['dominantFeelings'], 'sad, angry');
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
