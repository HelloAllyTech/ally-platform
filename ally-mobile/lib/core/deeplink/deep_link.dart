/// Port of ally-mobile (React Native)'s `src/utils/deeplink.ts`: which
/// universal / App Links the app opens, and what they point at.
///
/// Each path must also be claimed natively, or the OS opens the link in the
/// browser and this code never sees it: the `applinks:` associated domains
/// in `ios/Runner/Runner.entitlements` (plus the web app's
/// `.well-known/apple-app-site-association`) and the `autoVerify` intent
/// filter's `pathPrefix`es in `AndroidManifest.xml` (plus
/// `.well-known/assetlinks.json`).
library;

import '../config/app_config.dart';

/// RN `SUPPORTED_DEEPLINK_PATHS`.
const List<String> supportedDeepLinkPaths = ['/summary', '/course'];

/// A link the app routes.
sealed class DeepLink {
  const DeepLink();
}

/// `https://<web host>/summary/:id`, RN's call summary share link.
class SummaryDeepLink extends DeepLink {
  const SummaryDeepLink(this.callId);

  final int callId;

  @override
  bool operator ==(Object other) => other is SummaryDeepLink && other.callId == callId;

  @override
  int get hashCode => callId.hashCode;

  @override
  String toString() => 'SummaryDeepLink($callId)';
}

/// `https://<web host>/course/:trackId`, RN's course share link.
class CourseDeepLink extends DeepLink {
  const CourseDeepLink(this.trackId);

  final String trackId;

  @override
  bool operator ==(Object other) => other is CourseDeepLink && other.trackId == trackId;

  @override
  int get hashCode => trackId.hashCode;

  @override
  String toString() => 'CourseDeepLink($trackId)';
}

/// RN `isSupportedDeepLink`: https, on the web app's host
/// (`ALLY_WEB_URL`, RN's `ALLOWED_DEEPLINK_URLS`), under a supported path.
/// RN compares `URL.host`, which carries a non-default port, so the port is
/// compared too.
bool isSupportedDeepLink(Uri url, {String allyWebUrl = AppConfig.allyWebUrl}) {
  final allowed = Uri.parse(allyWebUrl);
  return url.scheme == 'https' &&
      url.host == allowed.host &&
      url.port == allowed.port &&
      supportedDeepLinkPaths.any(url.path.startsWith);
}

/// RN splits the raw `URL.pathname`, which stays percent-encoded; so does
/// [Uri.path] (unlike [Uri.pathSegments], which decodes).
List<String> _segments(Uri url) => url.path.split('/').where((s) => s.isNotEmpty).toList();

final _uuidPattern = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false);

/// RN `isCourseLink`: a `/course/...` link, valid id or not.
bool isCourseLink(Uri url) {
  final segments = _segments(url);
  return segments.isNotEmpty && segments.first == 'course';
}

/// RN `getCourseIdFromUrl`: the uuid in `/course/:trackId`, else null.
String? courseIdFromUrl(Uri url) {
  final segments = _segments(url);
  if (segments.length < 2 || segments[0] != 'course') return null;
  final id = segments[1];
  return _uuidPattern.hasMatch(id) ? id : null;
}

/// RN `getCallIdFromUrl` plus its caller's truthiness check: the second path
/// segment as a number (`Number(id)`, so `"7.0"` counts), with
/// 0 and non-numbers rejected. Call ids are integers, so a fractional value
/// is rejected too, where RN would open a summary that can't exist.
int? callIdFromUrl(Uri url) {
  final segments = _segments(url);
  if (segments.length < 2) return null;
  final value = num.tryParse(segments[1]);
  if (value == null || !value.isFinite || value == 0 || value != value.truncate()) return null;
  return value.toInt();
}

/// RN RootNavigator's `handleURL` decision: a course link (only ever a
/// course link, even with a bad id), else a summary link, else nothing.
DeepLink? parseDeepLink(Uri url, {String allyWebUrl = AppConfig.allyWebUrl}) {
  if (!isSupportedDeepLink(url, allyWebUrl: allyWebUrl)) return null;
  if (isCourseLink(url)) {
    final trackId = courseIdFromUrl(url);
    return trackId == null ? null : CourseDeepLink(trackId);
  }
  final callId = callIdFromUrl(url);
  return callId == null ? null : SummaryDeepLink(callId);
}
