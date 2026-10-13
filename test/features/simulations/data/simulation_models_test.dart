import 'package:flutter_test/flutter_test.dart';

import 'package:ally_mobile_flutter/features/simulations/data/simulation_models.dart';

void main() {
  group('Scenario.fromJson', () {
    test('parses all fields', () {
      final scenario = Scenario.fromJson({
        'id': 12,
        'title': 'Anxious client',
        'description': 'A client presenting with anxiety',
        'coverImageUrl': 'https://example.com/cover.png',
      });

      expect(scenario.id, 12);
      expect(scenario.title, 'Anxious client');
      expect(scenario.description, 'A client presenting with anxiety');
      expect(scenario.coverImageUrl, 'https://example.com/cover.png');
    });

    test('defaults nullable fields to null when absent', () {
      final scenario = Scenario.fromJson({'id': 1, 'title': 'Bare scenario'});

      expect(scenario.description, isNull);
      expect(scenario.coverImageUrl, isNull);
    });
  });

  group('SessionData.fromJson', () {
    test('parses the LiveKit connection pair', () {
      final session = SessionData.fromJson({
        'id': 'session-1',
        'accessToken': 'token-abc',
        'liveKitServerUrl': 'wss://livekit.example.com',
      });

      expect(session.id, 'session-1');
      expect(session.accessToken, 'token-abc');
      expect(session.liveKitServerUrl, 'wss://livekit.example.com');
    });
  });

  group('SimulationCredits.fromJson', () {
    test('parses limit and consumed', () {
      final credits = SimulationCredits.fromJson({
        'creditLimit': 10,
        'consumedCredits': 4,
      });

      expect(credits.creditLimit, 10);
      expect(credits.consumedCredits, 4);
      expect(credits.remaining, 6);
    });

    test('defaults missing fields to 0', () {
      final credits = SimulationCredits.fromJson(const {});

      expect(credits.creditLimit, 0);
      expect(credits.consumedCredits, 0);
      expect(credits.remaining, 0);
    });

    test('remaining clamps at 0 when consumed exceeds limit', () {
      final credits = SimulationCredits.fromJson({
        'creditLimit': 5,
        'consumedCredits': 9,
      });

      expect(credits.remaining, 0);
    });

    test('remaining clamps at creditLimit (never negative upper bound)', () {
      final credits = SimulationCredits.fromJson({
        'creditLimit': 0,
        'consumedCredits': 0,
      });

      expect(credits.remaining, 0);
    });
  });

  group('SimulationPath.fromJson', () {
    test('parses all fields', () {
      final path = SimulationPath.fromJson({
        'id': 'path-1',
        'title': 'Beginner track',
        'description': 'Intro scenarios',
        'totalScenarios': 5,
        'completedScenarios': 2,
      });

      expect(path.id, 'path-1');
      expect(path.title, 'Beginner track');
      expect(path.description, 'Intro scenarios');
      expect(path.totalScenarios, 5);
      expect(path.completedScenarios, 2);
    });

    test('defaults missing numeric/nullable fields', () {
      final path = SimulationPath.fromJson({
        'id': 'path-2',
        'title': 'Empty track',
      });

      expect(path.description, isNull);
      expect(path.totalScenarios, 0);
      expect(path.completedScenarios, 0);
    });
  });

  group('SimulationLanguageOption.fromJson', () {
    test('parses language_id and label', () {
      final option = SimulationLanguageOption.fromJson({
        'language_id': 2,
        'label': 'Hindi',
      });

      expect(option.languageId, 2);
      expect(option.label, 'Hindi');
    });
  });

  group('SessionItemStatus parsing (via PathScenario.fromJson)', () {
    test('LOCKED maps to locked', () {
      final scenario = PathScenario.fromJson({
        'id': 's1',
        'scenarioId': 1,
        'status': 'LOCKED',
      });
      expect(scenario.status, SessionItemStatus.locked);
    });

    test('UNLOCKED maps to unlocked', () {
      final scenario = PathScenario.fromJson({
        'id': 's1',
        'scenarioId': 1,
        'status': 'UNLOCKED',
      });
      expect(scenario.status, SessionItemStatus.unlocked);
    });

    test('COMPLETED maps to completed', () {
      final scenario = PathScenario.fromJson({
        'id': 's1',
        'scenarioId': 1,
        'status': 'COMPLETED',
      });
      expect(scenario.status, SessionItemStatus.completed);
    });

    test('unrecognized/missing value falls back to unknown', () {
      final scenario = PathScenario.fromJson({'id': 's1', 'scenarioId': 1});
      expect(scenario.status, SessionItemStatus.unknown);

      final scenarioGarbage = PathScenario.fromJson({
        'id': 's1',
        'scenarioId': 1,
        'status': 'SOMETHING_ELSE',
      });
      expect(scenarioGarbage.status, SessionItemStatus.unknown);
    });
  });

  group('PathScenario.fromJson', () {
    test('parses all fields including availableLanguages', () {
      final scenario = PathScenario.fromJson({
        'id': 'ps-1',
        'scenarioId': 42,
        'order': 3,
        'title': 'Difficult conversation',
        'description': 'Practice de-escalation',
        'coverImageUrl': 'https://example.com/img.png',
        'sessionId': 'sess-9',
        'status': 'UNLOCKED',
        'availableLanguages': [
          {'language_id': 1, 'label': 'English'},
          {'language_id': 2, 'label': 'Hindi'},
        ],
      });

      expect(scenario.id, 'ps-1');
      expect(scenario.scenarioId, 42);
      expect(scenario.order, 3);
      expect(scenario.title, 'Difficult conversation');
      expect(scenario.description, 'Practice de-escalation');
      expect(scenario.coverImageUrl, 'https://example.com/img.png');
      expect(scenario.sessionId, 'sess-9');
      expect(scenario.status, SessionItemStatus.unlocked);
      expect(scenario.availableLanguages, hasLength(2));
      expect(scenario.availableLanguages![0].label, 'English');
      expect(scenario.availableLanguages![1].languageId, 2);
    });

    test('defaults missing optional fields', () {
      final scenario = PathScenario.fromJson({'id': 'ps-2', 'scenarioId': 7});

      expect(scenario.order, 0);
      expect(scenario.title, isNull);
      expect(scenario.description, isNull);
      expect(scenario.coverImageUrl, isNull);
      expect(scenario.sessionId, isNull);
      expect(scenario.availableLanguages, isNull);
    });
  });

  group('SimulationSummary.fromJson', () {
    test('parses all fields', () {
      final summary = SimulationSummary.fromJson({
        'id': 'summary-1',
        'score': 87.5,
        'startedAt': '2026-01-01T10:00:00.000Z',
        'endedAt': '2026-01-01T10:20:00.000Z',
        'whatWentWell': ['Good pacing', 'Clear empathy'],
        'areasForImprovement': ['Ask more open questions'],
        'hasFeedback': true,
        'feedbackRating': 4,
      });

      expect(summary.id, 'summary-1');
      expect(summary.score, 87.5);
      expect(summary.startedAt, '2026-01-01T10:00:00.000Z');
      expect(summary.endedAt, '2026-01-01T10:20:00.000Z');
      expect(summary.whatWentWell, ['Good pacing', 'Clear empathy']);
      expect(summary.areasForImprovement, ['Ask more open questions']);
      expect(summary.hasFeedback, isTrue);
      expect(summary.feedbackRating, 4);
    });

    test('defaults missing fields', () {
      final summary = SimulationSummary.fromJson({
        'id': 'summary-2',
        'startedAt': '2026-01-01T10:00:00.000Z',
      });

      expect(summary.score, isNull);
      expect(summary.endedAt, isNull);
      expect(summary.whatWentWell, isEmpty);
      expect(summary.areasForImprovement, isEmpty);
      expect(summary.hasFeedback, isFalse);
      expect(summary.feedbackRating, isNull);
    });

    test('score parses from an int json value via toDouble', () {
      final summary = SimulationSummary.fromJson({
        'id': 'summary-3',
        'startedAt': '2026-01-01T10:00:00.000Z',
        'score': 90,
      });

      expect(summary.score, 90.0);
    });
  });

  group('SimulationPathDetails.fromJson', () {
    test('parses all fields and nested scenarios', () {
      final details = SimulationPathDetails.fromJson({
        'id': 'path-1',
        'title': 'Beginner track',
        'description': 'Intro scenarios',
        'coverImageUrl': 'https://example.com/cover.png',
        'completedScenarios': 1,
        'completedAt': '2026-01-05T00:00:00.000Z',
        'scenarioPathSessionId': 'pathsession-1',
        'caseSessionId': null,
        'scenarios': [
          {'id': 's1', 'scenarioId': 1, 'status': 'COMPLETED'},
          {'id': 's2', 'scenarioId': 2, 'status': 'UNLOCKED'},
        ],
      });

      expect(details.id, 'path-1');
      expect(details.title, 'Beginner track');
      expect(details.description, 'Intro scenarios');
      expect(details.coverImageUrl, 'https://example.com/cover.png');
      expect(details.completedScenarios, 1);
      expect(details.completedAt, '2026-01-05T00:00:00.000Z');
      expect(details.scenarioPathSessionId, 'pathsession-1');
      expect(details.caseSessionId, isNull);
      expect(details.scenarios, hasLength(2));
    });

    test('defaults missing fields, including an absent scenarios list', () {
      final details = SimulationPathDetails.fromJson({'id': 'path-2'});

      expect(details.title, isNull);
      expect(details.description, isNull);
      expect(details.coverImageUrl, isNull);
      expect(details.completedScenarios, 0);
      expect(details.completedAt, isNull);
      expect(details.scenarioPathSessionId, isNull);
      expect(details.caseSessionId, isNull);
      expect(details.scenarios, isEmpty);
    });

    group('nextScenario', () {
      PathScenario scenario(String id, SessionItemStatus status) =>
          PathScenario.fromJson({
            'id': id,
            'scenarioId': int.parse(id.replaceAll(RegExp(r'\D'), '')),
            'status': status.name.toUpperCase(),
          });

      SimulationPathDetails detailsWith(List<PathScenario> scenarios) =>
          SimulationPathDetails(
            id: 'p',
            title: null,
            description: null,
            coverImageUrl: null,
            completedScenarios: 0,
            completedAt: null,
            scenarioPathSessionId: null,
            caseSessionId: null,
            scenarios: scenarios,
          );

      test('skips completed and locked scenarios, returns first unlocked', () {
        final details = detailsWith([
          scenario('s1', SessionItemStatus.completed),
          scenario('s2', SessionItemStatus.locked),
          scenario('s3', SessionItemStatus.unlocked),
          scenario('s4', SessionItemStatus.unlocked),
        ]);

        expect(details.nextScenario?.id, 's3');
      });

      test('returns the first completed-eligible scenario when none are completed', () {
        final details = detailsWith([
          scenario('s1', SessionItemStatus.unlocked),
          scenario('s2', SessionItemStatus.locked),
        ]);

        expect(details.nextScenario?.id, 's1');
      });

      test('returns null when every scenario is completed or locked', () {
        final details = detailsWith([
          scenario('s1', SessionItemStatus.completed),
          scenario('s2', SessionItemStatus.locked),
        ]);

        expect(details.nextScenario, isNull);
      });

      test('returns null for an empty scenario list', () {
        final details = detailsWith(const []);
        expect(details.nextScenario, isNull);
      });

      test('an unknown status scenario still counts as eligible (not completed/locked)', () {
        final details = detailsWith([
          scenario('s1', SessionItemStatus.unknown),
        ]);

        expect(details.nextScenario?.id, 's1');
      });
    });
  });
}
