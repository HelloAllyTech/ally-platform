import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../account/data/account_repository.dart';

/// Mirrors ally-mobile (React Native)'s `src/constants/analytics.ts`.
enum AnalyticsType { callLogAnalytics, simulationAnalytics, unknown }

AnalyticsType _analyticsTypeFromJson(String? value) => switch (value) {
      'CALL_LOG_ANALYTICS' => AnalyticsType.callLogAnalytics,
      'SIMULATION_ANALYTICS' => AnalyticsType.simulationAnalytics,
      _ => AnalyticsType.unknown,
    };

/// Mirrors ally-mobile (React Native)'s `src/services/analyticsApi.ts`
/// `Dashboard` interface.
class Dashboard {
  Dashboard({required this.externalId, required this.name, required this.analyticsType});

  factory Dashboard.fromJson(Map<String, dynamic> json) => Dashboard(
        externalId: json['externalId'] as String,
        name: json['name'] as String? ?? '',
        analyticsType: _analyticsTypeFromJson(json['analyticsType'] as String?),
      );

  final String externalId;
  final String name;
  final AnalyticsType analyticsType;
}

/// Ported from ally-mobile (React Native)'s `src/services/analyticsApi.ts`
/// — backs the Session Metrics tab's embedded Metabase dashboards.
class AnalyticsRepository {
  AnalyticsRepository(this._dio);

  final Dio _dio;

  Future<List<Dashboard>> getDashboards() async {
    final response = await _dio.get<List<dynamic>>('/analytics/dashboard');
    return (response.data ?? [])
        .map((e) => Dashboard.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<String> getDashboardUrl(String dashboardId) async {
    final response =
        await _dio.get<Map<String, dynamic>>('/analytics/dashboard/$dashboardId');
    return response.data!['url'] as String;
  }
}

final analyticsRepositoryProvider = Provider<AnalyticsRepository>((ref) {
  return AnalyticsRepository(ref.watch(apiClientProvider));
});

/// RN's `useGetDashboardsQuery(undefined, {skip: !userData?.id})` — don't
/// fire this request until the signed-in user's identity has actually
/// resolved (relevant on a cold app start, when several providers
/// initialize concurrently). `currentUserProvider` throwing propagates as
/// this provider's own error, same as RN's query would surface one.
final dashboardsProvider = FutureProvider<List<Dashboard>>((ref) async {
  await ref.watch(currentUserProvider.future);
  return ref.watch(analyticsRepositoryProvider).getDashboards();
});

final dashboardUrlProvider = FutureProvider.family<String, String>((ref, dashboardId) {
  return ref.watch(analyticsRepositoryProvider).getDashboardUrl(dashboardId);
});
