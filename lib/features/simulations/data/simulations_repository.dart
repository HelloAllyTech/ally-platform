import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'simulation_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/simulationsApi.ts`
/// — same routes (`API_ROUTES.LEARN`). This is a large API surface in the
/// original (rooms, checklist events, upcoming-path/case-scenario lookups —
/// a separate "what's next" card shown elsewhere, not the same as
/// `SimulationPathDetails.nextScenario`'s client-side computation);
/// scoped here to what SimulationsScreen, SimulationDetailsScreen,
/// SimulationPathDetailsScreen, CaseDetailsScreen, and
/// SimulationFeedbackScreen actually need.
class SimulationsRepository {
  SimulationsRepository(this._dio);

  final Dio _dio;

  /// Matches ally-mobile (React Native)'s `getSimulationDetails` query
  /// exactly: same route, same `enableRecommendations=true` param.
  Future<SimulationSummary> getSimulationDetails(
    String scenarioSessionId,
  ) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-session/$scenarioSessionId',
      queryParameters: {'enableRecommendations': true},
    );
    return SimulationSummary.fromJson(response.data!);
  }

  /// The real endpoint wraps the array in a `{data: [...]}` envelope — RN's
  /// `simulationsApi.ts` unwraps it via `transformResponse`, which is why
  /// its declared return type (`Scenario[]`) looks like a bare array. A bare
  /// `List&lt;dynamic&gt;` request here throws (confirmed live: "type
  /// `_Map&lt;String, dynamic&gt;` is not a subtype of type
  /// `List&lt;dynamic&gt;?`").
  Future<List<Scenario>> getScenarios() async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/scenarios');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data.map((e) => Scenario.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Scenario> getScenarioById(int id) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenarios/$id',
    );
    return Scenario.fromJson(response.data!);
  }

  Future<SimulationCredits> getSimulationCredits() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/simulation-credits',
    );
    return SimulationCredits.fromJson(response.data!);
  }

  Future<List<SimulationPath>> getScenarioPaths() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-paths',
    );
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => SimulationPath.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<SimulationPathDetails> getSimulationPathDetails(String pathId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-paths/$pathId',
    );
    return SimulationPathDetails.fromJson(response.data!);
  }

  Future<void> createPathSession(String pathId) async {
    await _dio.post<void>('/learn/scenario-paths/$pathId/create-session');
  }

  /// Looks up the real session id behind a completed path scenario item —
  /// same purpose as `getScenarioSessionByCaseItem`, for paths.
  Future<String?> getScenarioSessionByPathItem(String pathSessionItemId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-session/scenario-path-session-item/$pathSessionItemId',
    );
    return response.data?['id'] as String?;
  }

  Future<SessionData> startScenarioSession({
    required int scenarioId,
    String? scenarioPathSessionItemId,
    String? caseSessionItemId,
    int? languageId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/scenario-session-start',
      data: {
        'scenarioId': scenarioId,
        'scenarioPathSessionItemId': ?scenarioPathSessionItemId,
        'caseSessionItemId': ?caseSessionItemId,
        'languageId': ?languageId,
      },
    );
    return SessionData.fromJson(response.data!);
  }

  Future<void> endScenarioSession(String scenarioSessionId) async {
    await _dio.post<void>('/learn/scenario-session/$scenarioSessionId/end');
  }

  /// Cases (`/learn/cases`) are structurally identical to scenario paths in
  /// the backend contract — ally-mobile (React Native)'s `src/types/
  /// simulations.ts` literally defines `Case = SimulationPath` and
  /// `CaseDetails = SimulationPathDetails` as type aliases, not separate
  /// shapes. Reusing the same models here rather than duplicating them.
  Future<List<SimulationPath>> getCases() async {
    final response = await _dio.get<Map<String, dynamic>>('/learn/cases');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => SimulationPath.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<SimulationPathDetails> getCaseDetails(String caseId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/cases/$caseId',
    );
    return SimulationPathDetails.fromJson(response.data!);
  }

  Future<void> createCaseSession(String caseId) async {
    await _dio.post<void>('/learn/cases/$caseId/create-session');
  }

  /// Looks up the real session id behind a completed case scenario item —
  /// used to open that scenario's feedback screen (the RN screen's
  /// "file icon" / view-completed-session action).
  Future<String?> getScenarioSessionByCaseItem(String caseSessionItemId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-session/case-session-item/$caseSessionItemId',
    );
    return response.data?['id'] as String?;
  }

  /// RN `simulationsApi.getEventChecklist` (ally-be `learn.controller.ts`
  /// `scenario-session/:id/event-checklist`).
  Future<List<EventChecklistItem>> getEventChecklist(String scenarioSessionId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/learn/scenario-session/$scenarioSessionId/event-checklist',
    );
    return (response.data?['eventChecklist'] as List<dynamic>? ?? const [])
        .map((e) => EventChecklistItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> addSimulationFeedback({
    required String scenarioSessionId,
    required int rating,
    required String comment,
    List<String>? tags,
  }) async {
    await _dio.post<void>(
      '/learn/scenario-session/$scenarioSessionId/feedback',
      data: {
        'rating': rating,
        'feedback': comment,
        if (tags != null && tags.isNotEmpty) 'tags': tags,
      },
    );
  }
}

final simulationsRepositoryProvider = Provider<SimulationsRepository>((ref) {
  return SimulationsRepository(ref.watch(apiClientProvider));
});

final scenariosProvider = FutureProvider<List<Scenario>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getScenarios();
});

final simulationCreditsProvider = FutureProvider<SimulationCredits>((ref) {
  return ref.watch(simulationsRepositoryProvider).getSimulationCredits();
});

final scenarioByIdProvider = FutureProvider.family<Scenario, int>((ref, id) {
  return ref.watch(simulationsRepositoryProvider).getScenarioById(id);
});

final scenarioPathsProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getScenarioPaths();
});

final simulationPathDetailsProvider =
    FutureProvider.family<SimulationPathDetails, String>((ref, pathId) {
      return ref
          .watch(simulationsRepositoryProvider)
          .getSimulationPathDetails(pathId);
    });

final casesProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getCases();
});

final caseDetailsProvider =
    FutureProvider.family<SimulationPathDetails, String>((ref, caseId) {
      return ref.watch(simulationsRepositoryProvider).getCaseDetails(caseId);
    });

final simulationSummaryProvider =
    FutureProvider.family<SimulationSummary, String>((ref, scenarioSessionId) {
      return ref
          .watch(simulationsRepositoryProvider)
          .getSimulationDetails(scenarioSessionId);
    });

/// RN `useGetEventChecklistQuery({scenarioSessionId})`.
final eventChecklistProvider = FutureProvider.autoDispose.family<List<EventChecklistItem>, String>((
  ref,
  scenarioSessionId,
) {
  return ref.watch(simulationsRepositoryProvider).getEventChecklist(scenarioSessionId);
});
