import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/quiz_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
  data: data,
  statusCode: statusCode,
  requestOptions: RequestOptions(path: ''),
);

void main() {
  late MockDio dio;
  late CoursesRepository repository;

  setUp(() {
    dio = MockDio();
    repository = CoursesRepository(dio);
  });

  group('getLearnTracks', () {
    test('GETs /learn/tracks and parses the data list', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/tracks')).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 't-1', 'title': 'Track one'},
            {'id': 't-2', 'title': 'Track two'},
          ],
        }),
      );

      final result = await repository.getLearnTracks();

      expect(result, hasLength(2));
      expect(result[0], isA<TrackListItem>());
      expect(result[0].id, 't-1');
      expect(result[1].title, 'Track two');
      verify(() => dio.get<Map<String, dynamic>>('/learn/tracks')).called(1);
    });

    test('returns an empty list when data is missing', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/tracks'))
          .thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getLearnTracks();

      expect(result, isEmpty);
    });
  });

  group('getLearnTrackDetail', () {
    test('GETs /learn/tracks/{id} and parses the full detail', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/tracks/track-1'))
          .thenAnswer(
            (_) async => _response({
              'id': 'track-1',
              'title': 'Managing anxiety',
              'status': 'IN_PROGRESS',
              'sections': <dynamic>[],
            }),
          );

      final result = await repository.getLearnTrackDetail('track-1');

      expect(result, isA<TrackDetail>());
      expect(result.id, 'track-1');
      expect(result.title, 'Managing anxiety');
      verify(() => dio.get<Map<String, dynamic>>('/learn/tracks/track-1'))
          .called(1);
    });
  });

  group('getLearnTrackProgress', () {
    test('GETs /learn/tracks/{id}/progress and parses the dashboard', () async {
      when(
        () => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/progress'),
      ).thenAnswer(
        (_) async => _response({
          'trackId': 'track-1',
          'title': 'Managing anxiety',
          'totalItems': 10,
          'completedItems': 5,
          'completionPct': 50.0,
        }),
      );

      final result = await repository.getLearnTrackProgress('track-1');

      expect(result, isA<TrackProgressDashboard>());
      expect(result.completedItems, 5);
      expect(result.completionPct, 50.0);
      verify(
        () => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/progress'),
      ).called(1);
    });
  });

  group('enrollTrack', () {
    test('POSTs /learn/tracks/{id}/enroll', () async {
      when(() => dio.post<void>('/learn/tracks/track-1/enroll'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.enrollTrack('track-1');

      verify(() => dio.post<void>('/learn/tracks/track-1/enroll')).called(1);
    });
  });

  group('startTrackItem', () {
    test(
      'POSTs /learn/tracks/items/{id}/start and parses the payload',
      () async {
        when(
          () => dio.post<Map<String, dynamic>>(
            '/learn/tracks/items/item-1/start',
          ),
        ).thenAnswer(
          (_) async => _response({
            'trackItemProgressId': 'prog-1',
            'type': 'GAME',
            'gameKey': 'breathing-exercise',
          }),
        );

        final result = await repository.startTrackItem('item-1');

        expect(result, isA<StartItemPayload>());
        expect(result.type, 'GAME');
        expect(result.gameKey, 'breathing-exercise');
        verify(
          () => dio.post<Map<String, dynamic>>(
            '/learn/tracks/items/item-1/start',
          ),
        ).called(1);
      },
    );
  });

  group('markArticleRead', () {
    test('POSTs /learn/tracks/items/{id}/article-read and parses the completion result', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/article-read',
        ),
      ).thenAnswer(
        (_) async => _response({
          'completed': true,
          'sectionCompleted': true,
          'trackCompleted': false,
        }),
      );

      final result = await repository.markArticleRead('item-1');

      expect(result.completed, true);
      expect(result.sectionCompleted, true);
      expect(result.trackCompleted, false);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/article-read',
        ),
      ).called(1);
    });
  });

  group('reportVideoProgress', () {
    test('POSTs watchedPct and parses completed/maxWatchedPct/section+trackCompleted', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/video-progress',
          data: {'watchedPct': 55.0},
        ),
      ).thenAnswer(
        (_) async => _response({
          'completed': true,
          'maxWatchedPct': 55.0,
          'sectionCompleted': true,
          'trackCompleted': true,
        }),
      );

      final result = await repository.reportVideoProgress(
        itemId: 'item-1',
        watchedPct: 55.0,
      );

      expect(result.completed, true);
      expect(result.maxWatchedPct, 55.0);
      expect(result.sectionCompleted, true);
      expect(result.trackCompleted, true);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/video-progress',
          data: {'watchedPct': 55.0},
        ),
      ).called(1);
    });

    test('defaults every field to false/the sent value when absent', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/video-progress',
          data: {'watchedPct': 30.0},
        ),
      ).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.reportVideoProgress(
        itemId: 'item-1',
        watchedPct: 30.0,
      );

      expect(result.completed, false);
      expect(result.maxWatchedPct, 30.0);
      expect(result.sectionCompleted, false);
      expect(result.trackCompleted, false);
    });
  });

  group('submitArticleQuestionAnswer', () {
    test('POSTs selectedOptionId and parses grading fields', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/article-questions/q-1/answer',
          data: {'selectedOptionId': 'opt-a'},
        ),
      ).thenAnswer(
        (_) async => _response({
          'correct': true,
          'correctOptionId': 'opt-a',
          'explanation': 'Nicely done',
        }),
      );

      final result = await repository.submitArticleQuestionAnswer(
        itemId: 'item-1',
        questionId: 'q-1',
        selectedOptionId: 'opt-a',
      );

      expect(result.correct, true);
      expect(result.correctOptionId, 'opt-a');
      expect(result.explanation, 'Nicely done');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/article-questions/q-1/answer',
          data: {'selectedOptionId': 'opt-a'},
        ),
      ).called(1);
    });
  });

  group('submitInterjectionAnswer', () {
    test('POSTs the answer JSON and parses nested grading', () async {
      final answer = QuizAnswerInput(questionId: 'q-1', booleanAnswer: true);
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/interjections/int-1/answer',
          data: answer.toJson(),
        ),
      ).thenAnswer(
        (_) async => _response({
          'correct': true,
          'grading': {'pointsAwarded': 2, 'pointsPossible': 2},
        }),
      );

      final result = await repository.submitInterjectionAnswer(
        itemId: 'item-1',
        interjectionId: 'int-1',
        answer: answer,
      );

      expect(result.correct, true);
      expect(result.pointsAwarded, 2);
      expect(result.pointsPossible, 2);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/interjections/int-1/answer',
          data: answer.toJson(),
        ),
      ).called(1);
    });

    test('defaults pointsAwarded/pointsPossible to 0 when grading fields are missing', () async {
      final answer = QuizAnswerInput(questionId: 'q-1', text: 'open answer');
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/interjections/int-2/answer',
          data: answer.toJson(),
        ),
      ).thenAnswer(
        (_) async =>
            _response({'correct': null, 'grading': <String, dynamic>{}}),
      );

      final result = await repository.submitInterjectionAnswer(
        itemId: 'item-1',
        interjectionId: 'int-2',
        answer: answer,
      );

      expect(result.correct, isNull);
      expect(result.pointsAwarded, 0);
      expect(result.pointsPossible, 0);
    });
  });

  group('submitQuizAttempt', () {
    test('POSTs all answers and parses the attempt result', () async {
      final answers = [
        QuizAnswerInput(questionId: 'q-1', selectedOptionIds: ['a']),
        QuizAnswerInput(questionId: 'q-2', booleanAnswer: true),
      ];
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/quiz-attempts',
          data: {'answers': answers.map((a) => a.toJson()).toList()},
        ),
      ).thenAnswer(
        (_) async => _response({
          'attemptId': 'attempt-1',
          'scorePct': 90.0,
          'passed': true,
          'passScore': 70,
          'attemptsUsed': 1,
          'maxAttempts': 3,
          'questionResults': <dynamic>[],
        }),
      );

      final result = await repository.submitQuizAttempt(
        itemId: 'item-1',
        answers: answers,
      );

      expect(result, isA<QuizAttemptResult>());
      expect(result.passed, true);
      expect(result.scorePct, 90.0);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/quiz-attempts',
          data: {'answers': answers.map((a) => a.toJson()).toList()},
        ),
      ).called(1);
    });
  });

  group('saveJournalDraft', () {
    test('POSTs the responses in the expected shape', () async {
      when(
        () => dio.post<void>(
          '/learn/tracks/items/item-1/journal',
          data: {
            'responses': [
              {'promptId': 'p-1', 'response': 'Grateful for today'},
            ],
          },
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.saveJournalDraft(
        itemId: 'item-1',
        responses: [(promptId: 'p-1', response: 'Grateful for today')],
      );

      verify(
        () => dio.post<void>(
          '/learn/tracks/items/item-1/journal',
          data: {
            'responses': [
              {'promptId': 'p-1', 'response': 'Grateful for today'},
            ],
          },
        ),
      ).called(1);
    });
  });

  group('submitJournal', () {
    test('POSTs /learn/tracks/items/{id}/journal/submit and parses the completion result', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/journal/submit',
        ),
      ).thenAnswer(
        (_) async => _response({
          'completed': true,
          'sectionCompleted': false,
          'trackCompleted': false,
        }),
      );

      final result = await repository.submitJournal('item-1');

      expect(result.completed, true);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/journal/submit',
        ),
      ).called(1);
    });
  });

  group('recordGameResult', () {
    test('POSTs the score and returns bestScore from the response', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/game-result',
          data: {'score': 42},
        ),
      ).thenAnswer((_) async => _response({'bestScore': 99}));

      final result = await repository.recordGameResult(
        itemId: 'item-1',
        score: 42,
      );

      expect(result, 99);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/game-result',
          data: {'score': 42},
        ),
      ).called(1);
    });

    test(
      'falls back to the submitted score when bestScore is absent',
      () async {
        when(
          () => dio.post<Map<String, dynamic>>(
            '/learn/tracks/items/item-1/game-result',
            data: {'score': 10},
          ),
        ).thenAnswer((_) async => _response(<String, dynamic>{}));

        final result = await repository.recordGameResult(
          itemId: 'item-1',
          score: 10,
        );

        expect(result, 10);
      },
    );
  });

  group('recordBranchingResult', () {
    test('POSTs the finished path and parses the server-scored result', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/branching-result',
          data: {
            'path': ['c1', 'c2'],
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'endingNodeId': 'n3',
          'score': 90,
          'passScore': 70,
          'passed': true,
          'attemptsUsed': 1,
          'maxAttempts': 3,
          'attemptsLeft': 2,
          'bestScore': 90,
          'endingsReached': ['n3'],
          'itemCompleted': true,
          'completion': {
            'completed': true,
            'sectionCompleted': false,
            'trackCompleted': false,
          },
          'exhausted': false,
          'nextRoundAt': null,
          'recap': [],
        }),
      );

      final result = await repository.recordBranchingResult(
        itemId: 'item-1',
        path: ['c1', 'c2'],
      );

      expect(result, isA<BranchingResult>());
      expect(result.endingNodeId, 'n3');
      expect(result.score, 90);
      expect(result.passed, isTrue);
      expect(result.completion, isNotNull);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/branching-result',
          data: {
            'path': ['c1', 'c2'],
          },
        ),
      ).called(1);
    });
  });

  group('placeBucketSortItem', () {
    test('POSTs the sortItemId/bucketId and parses the placement verdict', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/bucket-sort/place',
          data: {'sortItemId': 'i1', 'bucketId': 'b1'},
        ),
      ).thenAnswer(
        (_) async => _response({
          'sortItemId': 'i1',
          'correct': true,
          'placedBucketId': 'b1',
          'correctBucketId': 'b1',
          'placedCount': 1,
          'totalCount': 4,
          'finished': false,
          'itemCompleted': false,
        }),
      );

      final result = await repository.placeBucketSortItem(
        itemId: 'item-1',
        sortItemId: 'i1',
        bucketId: 'b1',
      );

      expect(result, isA<BucketSortPlacementResult>());
      expect(result.correct, isTrue);
      expect(result.placedCount, 1);
      expect(result.totalCount, 4);
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/tracks/items/item-1/bucket-sort/place',
          data: {'sortItemId': 'i1', 'bucketId': 'b1'},
        ),
      ).called(1);
    });
  });

  group('restartBucketSort', () {
    test('POSTs /learn/tracks/items/{id}/bucket-sort/restart', () async {
      when(() => dio.post<void>('/learn/tracks/items/item-1/bucket-sort/restart'))
          .thenAnswer((_) async => _response<void>(null));

      await repository.restartBucketSort('item-1');

      verify(() => dio.post<void>('/learn/tracks/items/item-1/bucket-sort/restart')).called(1);
    });
  });

  group('getNextTrackItem', () {
    test('GETs /learn/tracks/{id}/next-item and parses a found item', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/next-item')).thenAnswer(
        (_) async => _response({
          'trackCompleted': false,
          'nextItem': {
            'id': 'item-9',
            'type': 'ARTICLE',
            'order': 2,
            'title': 'Next up',
            'status': 'UNLOCKED',
            'sectionId': 's1',
            'sectionTitle': 'Advanced',
          },
        }),
      );

      final result = await repository.getNextTrackItem('track-1');

      expect(result.trackCompleted, isFalse);
      expect(result.nextItem, isNotNull);
      expect(result.nextItem!.id, 'item-9');
      expect(result.nextItem!.sectionId, 's1');
      expect(result.nextItem!.sectionTitle, 'Advanced');
      verify(() => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/next-item')).called(1);
    });

    test('a completed track has trackCompleted true and no nextItem', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/tracks/track-1/next-item'))
          .thenAnswer((_) async => _response({'trackCompleted': true, 'nextItem': null}));

      final result = await repository.getNextTrackItem('track-1');

      expect(result.trackCompleted, isTrue);
      expect(result.nextItem, isNull);
    });
  });

  group('setTrackLanguage', () {
    test('PUTs /learn/tracks/{id}/language with the chosen languageCode', () async {
      when(
        () => dio.put<void>('/learn/tracks/track-1/language', data: {'languageCode': 'hi'}),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.setTrackLanguage(trackId: 'track-1', languageCode: 'hi');

      verify(
        () => dio.put<void>('/learn/tracks/track-1/language', data: {'languageCode': 'hi'}),
      ).called(1);
    });
  });
}
