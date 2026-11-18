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
  SimulationsRepository(this._dio, {void Function(Set<SimulationCacheTag> tags)? onInvalidate})
      : _onInvalidate = onInvalidate;

  final Dio _dio;

  /// RN `invalidatesTags` on this API's mutations: the provider wires it to
  /// `ref.invalidate` of the matching providers, so every caller gets the
  /// same refetch RN does without each screen remembering to.
  final void Function(Set<SimulationCacheTag> tags)? _onInvalidate;

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
    _onInvalidate?.call(const {SimulationCacheTag.pathDetails, SimulationCacheTag.paths});
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
    String? trackItemProgressId,
    int? languageId,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/learn/scenario-session-start',
      data: {
        'scenarioId': scenarioId,
        'scenarioPathSessionItemId': ?scenarioPathSessionItemId,
        'caseSessionItemId': ?caseSessionItemId,
        // Links the session to a Track 2.0 roleplay item's progress row
        // (ally-be `start-scenario-session-request.dto.ts`).
        'trackItemProgressId': ?trackItemProgressId,
        'languageId': ?languageId,
      },
    );
    return SessionData.fromJson(response.data!);
  }

  /// RN `endScenarioSession`: body `{enableRecommendations: true}` (plus the
  /// injected `languageCode`), and it invalidates credits and path/case
  /// progress.
  Future<void> endScenarioSession(String scenarioSessionId) async {
    await _dio.post<void>(
      '/learn/scenario-session/$scenarioSessionId/end',
      data: {'enableRecommendations': true},
    );
    _onInvalidate?.call(const {
      SimulationCacheTag.credits,
      SimulationCacheTag.paths,
      SimulationCacheTag.pathDetails,
      SimulationCacheTag.cases,
      SimulationCacheTag.caseDetails,
    });
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
    _onInvalidate?.call(const {SimulationCacheTag.caseDetails, SimulationCacheTag.cases});
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

/// RN `simulationsApi` tag types (`SimulationCredits`, `SimulationPaths`, ...).
enum SimulationCacheTag { credits, paths, pathDetails, cases, caseDetails }

final Provider<SimulationsRepository> simulationsRepositoryProvider = Provider<SimulationsRepository>((ref) {
  return SimulationsRepository(
    ref.watch(apiClientProvider),
    onInvalidate: (tags) {
      for (final tag in tags) {
        switch (tag) {
          case SimulationCacheTag.credits:
            ref.invalidate(simulationCreditsProvider);
          case SimulationCacheTag.paths:
            ref.invalidate(scenarioPathsProvider);
          case SimulationCacheTag.pathDetails:
            ref.invalidate(simulationPathDetailsProvider);
          case SimulationCacheTag.cases:
            ref.invalidate(casesProvider);
          case SimulationCacheTag.caseDetails:
            ref.invalidate(caseDetailsProvider);
        }
      }
    },
  );
});

final scenariosProvider = FutureProvider<List<Scenario>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getScenarios();
});

final simulationCreditsProvider = FutureProvider<SimulationCredits>((ref) {
  return ref.watch(simulationsRepositoryProvider).getSimulationCredits();
});

final scenarioByIdProvider = FutureProvider.autoDispose.family<Scenario, int>((ref, id) {
  return ref.watch(simulationsRepositoryProvider).getScenarioById(id);
});

final scenarioPathsProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getScenarioPaths();
});

final simulationPathDetailsProvider =
    FutureProvider.autoDispose.family<SimulationPathDetails, String>((ref, pathId) {
      return ref
          .watch(simulationsRepositoryProvider)
          .getSimulationPathDetails(pathId);
    });

final casesProvider = FutureProvider<List<SimulationPath>>((ref) {
  return ref.watch(simulationsRepositoryProvider).getCases();
});

final caseDetailsProvider =
    FutureProvider.autoDispose.family<SimulationPathDetails, String>((ref, caseId) {
      return ref.watch(simulationsRepositoryProvider).getCaseDetails(caseId);
    });

final simulationSummaryProvider =
    FutureProvider.autoDispose.family<SimulationSummary, String>((ref, scenarioSessionId) {
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
