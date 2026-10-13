import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

/// Ported from ally-mobile (React Native)'s `src/services/bugReportApi.ts`.
/// The optional `context` field (device/app-state metadata the RN app
/// attaches via `BugReportContext`) is not collected in this pass — just
/// the description, which is the part the user actually types.
class BugReportRepository {
  BugReportRepository(this._dio);

  final Dio _dio;

  Future<void> createBugReport(String description) async {
    await _dio.post<void>(
      '/product-roadmap/bug-reports',
      data: {'description': description},
    );
  }
}

final bugReportRepositoryProvider = Provider<BugReportRepository>((ref) {
  return BugReportRepository(ref.watch(apiClientProvider));
});
