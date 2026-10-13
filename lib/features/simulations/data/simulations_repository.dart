import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'simulation_models.dart';

/// Ported from ally-mobile (React Native)'s `src/services/simulationsApi.ts`
/// — same routes (`API_ROUTES.LEARN`). This is a large API surface in the
/// original (rooms, cases, checklist events, upcoming-path/case-scenario
/// lookups); scoped here to what SimulationsScreen, SimulationDetailsScreen,
/// SimulationPathDetailsScreen, and SimulationFeedbackScreen actually need.
/// Case-based sessions (as opposed to scenario-path sessions) are not
/// ported in this pass.
class SimulationsRepository {
  SimulationsRepository(this._dio);

  final Dio _dio;

  Future<List<Scenario>> getScenarios() async {
    final response = await _dio.get<List<dynamic>>('/learn/scenarios');
    return (response.data ?? [])
        .map((e) => Scenario.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Scenario> getScenarioById(int id) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/learn/scenarios/$id');
    return Scenario.fromJson(response.data!);
  }

  Future<SimulationCredits> getSimulationCredits() async {
    final response =
        await _dio.get<Map<String, dynamic>>('/simulation-credits');
    return SimulationCredits.fromJson(response.data!);
  }

  Future<List<SimulationPath>> getScenarioPaths() async {
    final response =
        await _dio.get<Map<String, dynamic>>('/learn/scenario-paths');
    final data = response.data?['data'] as List<dynamic>? ?? [];
    return data
        .map((e) => SimulationPath.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<SimulationPathDetails> getSimulationPathDetails(String pathId) async {
    final response = await _dio
        .get<Map<String, dynamic>>('/learn/scenario-paths/$pathId');
    return SimulationPathDetails.fromJson(response.data!);
  }

  Future<SessionData> startScenarioSession({
    required int scenarioId,
    String? scenarioPathSessionItemId,
    int? languageId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/scenario-session-start',
      data: {
        'scenarioId': scenarioId,
        if (scenarioPathSessionItemId != null)
          'scenarioPathSessionItemId': scenarioPathSessionItemId,
        if (languageId != null) 'languageId': languageId,
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
    final response = await _dio.get<Map<String, dynamic>>('/learn/cases/$caseId');
    return SimulationPathDetails.fromJson(response.data!);
  }

  Future<void> createCaseSession(String caseId) async {
    await _dio.post<void>('/learn/cases/$caseId/create-session');
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

final scenarioByIdProvider =
    FutureProvider.family<Scenario, int>((ref, id) {
  return ref.watch(simulationsRepositoryProvider).getScenarioById(id);
});

final scenarioPathsProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getScenarioPaths();
});

final simulationPathDetailsProvider =
    FutureProvider.family<SimulationPathDetails, String>((ref, pathId) {
  return ref.watch(simulationsRepositoryProvider).getSimulationPathDetails(pathId);
});

final casesProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getCases();
});

final caseDetailsProvider =
    FutureProvider.family<SimulationPathDetails, String>((ref, caseId) {
  return ref.watch(simulationsRepositoryProvider).getCaseDetails(caseId);
});
