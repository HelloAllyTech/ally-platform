import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulations_repository.dart';

class MockDio extends Mock implements Dio {}

Response<T> _response<T>(T? data, {int statusCode = 200}) => Response<T>(
      data: data,
      statusCode: statusCode,
      requestOptions: RequestOptions(path: ''),
    );

void main() {
  late MockDio dio;
  late SimulationsRepository repository;

  setUp(() {
    dio = MockDio();
    repository = SimulationsRepository(dio);
  });

  group('getSimulationDetails', () {
    test('GETs the scenario-session route with enableRecommendations', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/session-1',
          queryParameters: {'enableRecommendations': true},
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'session-1',
          'startedAt': '2026-01-01T00:00:00.000Z',
        }),
      );

      final result = await repository.getSimulationDetails('session-1');

      expect(result.id, 'session-1');
      verify(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/session-1',
          queryParameters: {'enableRecommendations': true},
        ),
      ).called(1);
    });
  });

  group('getScenarios', () {
    test('GETs /learn/scenarios and maps every entry in the data envelope', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/scenarios')).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 1, 'title': 'First'},
            {'id': 2, 'title': 'Second'},
          ],
        }),
      );

      final result = await repository.getScenarios();

      expect(result, hasLength(2));
      expect(result[0].title, 'First');
      expect(result[1].id, 2);
    });

    test('returns an empty list when the data field is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/scenarios')).thenAnswer(
        (_) async => _response(<String, dynamic>{}),
      );

      final result = await repository.getScenarios();

      expect(result, isEmpty);
    });
  });

  group('getScenarioById', () {
    test('GETs /learn/scenarios/:id', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/scenarios/7')).thenAnswer(
        (_) async => _response({'id': 7, 'title': 'Scenario seven'}),
      );

      final result = await repository.getScenarioById(7);

      expect(result.id, 7);
      expect(result.title, 'Scenario seven');
      verify(() => dio.get<Map<String, dynamic>>('/learn/scenarios/7')).called(1);
    });
  });

  group('getSimulationCredits', () {
    test('GETs /simulation-credits', () async {
      when(() => dio.get<Map<String, dynamic>>('/simulation-credits')).thenAnswer(
        (_) async => _response({'creditLimit': 10, 'consumedCredits': 3}),
      );

      final result = await repository.getSimulationCredits();

      expect(result.creditLimit, 10);
      expect(result.consumedCredits, 3);
    });
  });

  group('getScenarioPaths', () {
    test('GETs /learn/scenario-paths and unwraps the data envelope', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/scenario-paths')).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 'p1', 'title': 'Path one'},
          ],
        }),
      );

      final result = await repository.getScenarioPaths();

      expect(result, hasLength(1));
      expect(result.first.id, 'p1');
    });

    test('returns an empty list when the data envelope is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/scenario-paths')).thenAnswer(
        (_) async => _response(<String, dynamic>{}),
      );

      final result = await repository.getScenarioPaths();

      expect(result, isEmpty);
    });
  });

  group('getSimulationPathDetails', () {
    test('GETs /learn/scenario-paths/:id', () async {
      when(
        () => dio.get<Map<String, dynamic>>('/learn/scenario-paths/path-1'),
      ).thenAnswer((_) async => _response({'id': 'path-1', 'scenarios': []}));

      final result = await repository.getSimulationPathDetails('path-1');

      expect(result.id, 'path-1');
      verify(
        () => dio.get<Map<String, dynamic>>('/learn/scenario-paths/path-1'),
      ).called(1);
    });
  });

  group('createPathSession', () {
    test('POSTs to the create-session route for the given path', () async {
      when(
        () => dio.post<void>('/learn/scenario-paths/path-1/create-session'),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.createPathSession('path-1');

      verify(
        () => dio.post<void>('/learn/scenario-paths/path-1/create-session'),
      ).called(1);
    });
  });

  group('getScenarioSessionByPathItem', () {
    test('GETs the scenario-path-session-item route and returns the session id', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/scenario-path-session-item/item-1',
        ),
      ).thenAnswer((_) async => _response({'id': 'resolved-session-1'}));

      final result = await repository.getScenarioSessionByPathItem('item-1');

      expect(result, 'resolved-session-1');
    });

    test('returns null when the response has no id', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/scenario-path-session-item/item-1',
        ),
      ).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getScenarioSessionByPathItem('item-1');

      expect(result, isNull);
    });
  });

  group('startScenarioSession', () {
    test('posts scenarioPathSessionItemId when provided', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 5,
            'scenarioPathSessionItemId': 'item-1',
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'sess-1',
          'accessToken': 'tok',
          'liveKitServerUrl': 'wss://lk',
        }),
      );

      final result = await repository.startScenarioSession(
        scenarioId: 5,
        scenarioPathSessionItemId: 'item-1',
      );

      expect(result.id, 'sess-1');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 5,
            'scenarioPathSessionItemId': 'item-1',
          },
        ),
      ).called(1);
    });

    test('posts caseSessionItemId when provided', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 6,
            'caseSessionItemId': 'case-item-1',
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'sess-2',
          'accessToken': 'tok2',
          'liveKitServerUrl': 'wss://lk2',
        }),
      );

      final result = await repository.startScenarioSession(
        scenarioId: 6,
        caseSessionItemId: 'case-item-1',
      );

      expect(result.id, 'sess-2');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 6,
            'caseSessionItemId': 'case-item-1',
          },
        ),
      ).called(1);
    });

    test('posts only scenarioId (and languageId) when both optional ids are omitted', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 9,
            'languageId': 2,
          },
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'sess-3',
          'accessToken': 'tok3',
          'liveKitServerUrl': 'wss://lk3',
        }),
      );

      final result = await repository.startScenarioSession(
        scenarioId: 9,
        languageId: 2,
      );

      expect(result.id, 'sess-3');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {
            'scenarioId': 9,
            'languageId': 2,
          },
        ),
      ).called(1);
    });

    test('posts only scenarioId when every optional param is omitted', () async {
      when(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {'scenarioId': 11},
        ),
      ).thenAnswer(
        (_) async => _response({
          'id': 'sess-4',
          'accessToken': 'tok4',
          'liveKitServerUrl': 'wss://lk4',
        }),
      );

      final result = await repository.startScenarioSession(scenarioId: 11);

      expect(result.id, 'sess-4');
      verify(
        () => dio.post<Map<String, dynamic>>(
          '/learn/scenario-session-start',
          data: {'scenarioId': 11},
        ),
      ).called(1);
    });
  });

  group('endScenarioSession', () {
    test('POSTs {enableRecommendations: true} and invalidates RN tags', () async {
      final invalidated = <SimulationCacheTag>{};
      repository = SimulationsRepository(dio, onInvalidate: invalidated.addAll);
      when(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/end',
          data: {'enableRecommendations': true},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.endScenarioSession('sess-1');

      verify(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/end',
          data: {'enableRecommendations': true},
        ),
      ).called(1);
      // RN simulationsApi.endScenarioSession invalidatesTags.
      expect(invalidated, SimulationCacheTag.values.toSet());
    });
  });

  group('cache invalidation on create-session', () {
    test('path: SimulationPathDetails + SimulationPaths', () async {
      final invalidated = <SimulationCacheTag>{};
      repository = SimulationsRepository(dio, onInvalidate: invalidated.addAll);
      when(() => dio.post<void>('/learn/scenario-paths/p/create-session'))
          .thenAnswer((_) async => _response<void>(null));
      await repository.createPathSession('p');
      expect(invalidated, {SimulationCacheTag.pathDetails, SimulationCacheTag.paths});
    });

    test('case: CaseDetails + Cases', () async {
      final invalidated = <SimulationCacheTag>{};
      repository = SimulationsRepository(dio, onInvalidate: invalidated.addAll);
      when(() => dio.post<void>('/learn/cases/c/create-session'))
          .thenAnswer((_) async => _response<void>(null));
      await repository.createCaseSession('c');
      expect(invalidated, {SimulationCacheTag.caseDetails, SimulationCacheTag.cases});
    });
  });

  group('getCases', () {
    test('GETs /learn/cases and unwraps the data envelope', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/cases')).thenAnswer(
        (_) async => _response({
          'data': [
            {'id': 'c1', 'title': 'Case one'},
          ],
        }),
      );

      final result = await repository.getCases();

      expect(result, hasLength(1));
      expect(result.first.id, 'c1');
    });

    test('returns an empty list when the data envelope is absent', () async {
      when(() => dio.get<Map<String, dynamic>>('/learn/cases')).thenAnswer(
        (_) async => _response(<String, dynamic>{}),
      );

      final result = await repository.getCases();

      expect(result, isEmpty);
    });
  });

  group('getCaseDetails', () {
    test('GETs /learn/cases/:id', () async {
      when(
        () => dio.get<Map<String, dynamic>>('/learn/cases/case-1'),
      ).thenAnswer((_) async => _response({'id': 'case-1', 'scenarios': []}));

      final result = await repository.getCaseDetails('case-1');

      expect(result.id, 'case-1');
      verify(
        () => dio.get<Map<String, dynamic>>('/learn/cases/case-1'),
      ).called(1);
    });
  });

  group('createCaseSession', () {
    test('POSTs to the case create-session route', () async {
      when(
        () => dio.post<void>('/learn/cases/case-1/create-session'),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.createCaseSession('case-1');

      verify(
        () => dio.post<void>('/learn/cases/case-1/create-session'),
      ).called(1);
    });
  });

  group('getScenarioSessionByCaseItem', () {
    test('GETs the case-session-item route and returns the session id', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/case-session-item/case-item-1',
        ),
      ).thenAnswer((_) async => _response({'id': 'resolved-case-session-1'}));

      final result = await repository.getScenarioSessionByCaseItem(
        'case-item-1',
      );

      expect(result, 'resolved-case-session-1');
    });

    test('returns null when the response has no id', () async {
      when(
        () => dio.get<Map<String, dynamic>>(
          '/learn/scenario-session/case-session-item/case-item-1',
        ),
      ).thenAnswer((_) async => _response(<String, dynamic>{}));

      final result = await repository.getScenarioSessionByCaseItem(
        'case-item-1',
      );

      expect(result, isNull);
    });
  });

  group('addSimulationFeedback', () {
    test('POSTs rating/feedback without tags when none given', () async {
      when(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {'rating': 5, 'feedback': 'Great session'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.addSimulationFeedback(
        scenarioSessionId: 'sess-1',
        rating: 5,
        comment: 'Great session',
      );

      verify(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {'rating': 5, 'feedback': 'Great session'},
        ),
      ).called(1);
    });

    test('includes tags in the body when provided and non-empty', () async {
      when(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {
            'rating': 3,
            'feedback': 'Okay',
            'tags': ['pacing'],
          },
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.addSimulationFeedback(
        scenarioSessionId: 'sess-1',
        rating: 3,
        comment: 'Okay',
        tags: ['pacing'],
      );

      verify(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {
            'rating': 3,
            'feedback': 'Okay',
            'tags': ['pacing'],
          },
        ),
      ).called(1);
    });

    test('omits tags from the body when the list is empty', () async {
      when(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {'rating': 2, 'feedback': 'Meh'},
        ),
      ).thenAnswer((_) async => _response<void>(null));

      await repository.addSimulationFeedback(
        scenarioSessionId: 'sess-1',
        rating: 2,
        comment: 'Meh',
        tags: const [],
      );

      verify(
        () => dio.post<void>(
          '/learn/scenario-session/sess-1/feedback',
          data: {'rating': 2, 'feedback': 'Meh'},
        ),
      ).called(1);
    });
  });
}
