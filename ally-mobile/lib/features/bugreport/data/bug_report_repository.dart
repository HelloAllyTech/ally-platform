import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../../core/network/api_client.dart';

/// Ported from ally-mobile (React Native)'s `src/services/bugReportApi.ts`.
/// `context` mirrors RN's `getBugReportContext` — silently-captured
/// diagnostic metadata, never shown in the UI — matching its own admitted
/// best-effort device label (no device-info package installed there
/// either, same here: a generic "Android device"/"iPhone", not a real
/// model).
class BugReportRepository {
  BugReportRepository(this._dio);

  final Dio _dio;

  Future<void> createBugReport(String description, {String? screen}) async {
    await _dio.post<void>(
      '/product-roadmap/bug-reports',
      data: {'description': description, 'context': await _buildContext(screen)},
    );
  }

  Future<Map<String, dynamic>> _buildContext(String? screen) async {
    final info = await PackageInfo.fromPlatform();
    return {
      'screen': ?screen,
      'appVersion': info.version,
      'device': Platform.isAndroid
          ? 'Android device'
          : Platform.isIOS
              ? 'iPhone'
              : 'Unknown device',
      'os': Platform.isAndroid
          ? 'Android ${Platform.operatingSystemVersion}'
          : Platform.isIOS
              ? 'iOS ${Platform.operatingSystemVersion}'
              : Platform.operatingSystem,
      'clientTimestamp': DateTime.now().toUtc().toIso8601String(),
    };
  }
}

final bugReportRepositoryProvider = Provider<BugReportRepository>((ref) {
  return BugReportRepository(ref.watch(apiClientProvider));
});
