import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../network/api_client.dart';

/// RN `API_ROUTES.APP_VERSION` (`constants/general.ts`), picked per platform
/// like `services/appConfigApi.ts`'s `APP_VERSION_URL`.
const appVersionIosRoute = '/app-version/ios';
const appVersionAndroidRoute = '/app-version/android';

/// RN `APP_STORE_URLS` (`constants/general.ts`), opened by `openAppStore`.
/// These are the RN app's own store listings: the Flutter build has its own
/// bundle id / applicationId until release identity is decided, so the
/// button lands on the listing of the app this one replaces.
const appStoreUrlIos = 'https://apps.apple.com/app/helloally/id6745545012';
const appStoreUrlAndroid = 'https://play.google.com/store/apps/details?id=com.helloally.app';

bool get _isIos => defaultTargetPlatform == TargetPlatform.iOS;

/// RN `utils/version.ts` `isVersionLower`: true when [current] is lower than
/// [minimum], comparing dot-separated parts numerically, missing parts as 0.
/// A part that isn't a number (JS `Number('1-beta')` is NaN) compares
/// neither lower nor higher, so it's skipped, as in RN.
bool isVersionLower(String current, String minimum) {
  final curr = current.split('.').map(int.tryParse).toList();
  final min = minimum.split('.').map(int.tryParse).toList();
  final length = curr.length > min.length ? curr.length : min.length;
  for (var i = 0; i < length; i++) {
    final c = i < curr.length ? curr[i] : 0;
    final m = i < min.length ? min[i] : 0;
    if (c == null || m == null) continue;
    if (c < m) return true;
    if (c > m) return false;
  }
  return false;
}

/// RN `types/forceUpdate.ts` `VersionInfo`.
class VersionInfo {
  const VersionInfo({required this.currentVersion, required this.minimumVersion});

  final String currentVersion;
  final String minimumVersion;

  bool get isUpdateRequired => isVersionLower(currentVersion, minimumVersion);
}

/// RN `services/appConfigApi.ts` `getForceUpdateConfig`.
class ForceUpdateRepository {
  ForceUpdateRepository(this._dio);

  final Dio _dio;

  /// `minimumSupportedVersion` from `GET /app-version/{ios|android}`.
  Future<String?> getMinimumSupportedVersion() async {
    final response = await _dio.get<Map<String, dynamic>>(_isIos ? appVersionIosRoute : appVersionAndroidRoute);
    return response.data?['minimumSupportedVersion'] as String?;
  }
}

final forceUpdateRepositoryProvider = Provider<ForceUpdateRepository>(
  (ref) => ForceUpdateRepository(ref.watch(apiClientProvider)),
);

/// RN `getAppVersion()` (`VersionCheck.getCurrentVersion()`: the marketing
/// version, `CFBundleShortVersionString` / `versionName`).
final appVersionProvider = FutureProvider<String>((ref) async => (await PackageInfo.fromPlatform()).version);

/// RN `hooks/useForceUpdate.ts`. Fetched once per app run, like the RTK
/// query RN's Splash mounts (it reads, not watches, the repository so the
/// sign-in rebuild of the API client doesn't refetch). Null when there's no
/// minimum version; a failed check also means "no update required", the
/// same as RN, whose `versionInfo` stays null on error.
final forceUpdateProvider = FutureProvider<VersionInfo?>((ref) async {
  final minimum = await ref.read(forceUpdateRepositoryProvider).getMinimumSupportedVersion();
  if (minimum == null || minimum.isEmpty) return null;
  final current = await ref.read(appVersionProvider.future);
  return VersionInfo(currentVersion: current, minimumVersion: minimum);
});

/// RN `utils/common.ts` `openAppStore`.
Future<void> openAppStore() async {
  await launchUrl(Uri.parse(_isIos ? appStoreUrlIos : appStoreUrlAndroid), mode: LaunchMode.externalApplication);
}
