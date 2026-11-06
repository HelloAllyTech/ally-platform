import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../localization/localization_controller.dart';

/// One allow-listed endpoint: RN names it by RTK endpoint name, Dio only
/// sees method + path, so each entry pins both (e.g. `GET
/// /scenario-session-reviews` is `getReviews`, but `POST` to the same path
/// is `createReview`, which RN does NOT localize).
class LanguageCodeEndpoint {
  const LanguageCodeEndpoint(this.name, this.method, this.pattern);

  /// RN endpoint name from `languageCodeEndpoints.ts`, for tests and docs.
  final String name;
  final String method;

  /// Matched against the un-versioned path (before AuthInterceptor adds
  /// `/v1`/`/v2`), with any inline `?query` stripped.
  final String pattern;
}

/// Port of ally-mobile (React Native)'s `services/languageCodeEndpoints.ts`
/// `LANGUAGE_CODE_ENDPOINTS`: endpoints whose responses carry
/// backend-generated, user-facing text. Same 18 entries; keep in sync.
/// `startScenarioSession` is deliberately absent (it has its own
/// `languageId`), as are the course grading endpoints.
const languageCodeEndpoints = <LanguageCodeEndpoint>[
  LanguageCodeEndpoint('getScenarios', 'GET', r'^/learn/scenarios$'),
  LanguageCodeEndpoint('getScenarioById', 'GET', r'^/learn/scenarios/[^/]+$'),
  LanguageCodeEndpoint('getSimulationPaths', 'GET', r'^/learn/scenario-paths$'),
  LanguageCodeEndpoint('getSimulationPathDetails', 'GET', r'^/learn/scenario-paths/[^/]+$'),
  LanguageCodeEndpoint('getCases', 'GET', r'^/learn/cases$'),
  LanguageCodeEndpoint('getCaseDetails', 'GET', r'^/learn/cases/[^/]+$'),
  LanguageCodeEndpoint('getSimulationDetails', 'GET', r'^/learn/scenario-session/[^/]+$'),
  LanguageCodeEndpoint('getEventChecklist', 'GET', r'^/learn/scenario-session/[^/]+/event-checklist$'),
  LanguageCodeEndpoint('getSimulationSkills', 'GET', r'^/learn/scenario-session/[^/]+/skills$'),
  // getReview and getReviewById are the same GET; `unread-count` shares the
  // shape but is getUnreadSimulationReviewCount, which RN doesn't localize.
  LanguageCodeEndpoint('getReviewById', 'GET', r'^/scenario-session-reviews/(?!unread-count$)[^/]+$'),
  LanguageCodeEndpoint('getReviews', 'GET', r'^/scenario-session-reviews$'),
  LanguageCodeEndpoint('getAvailableBadges', 'GET', r'^/badges/me/available$'),
  LanguageCodeEndpoint('getLeaderboard', 'GET', r'^/community/leaderboard$'),
  LanguageCodeEndpoint('endScenarioSession', 'POST', r'^/learn/scenario-session/[^/]+/end$'),
  LanguageCodeEndpoint('getLearnTracks', 'GET', r'^/learn/tracks$'),
  LanguageCodeEndpoint('getLearnTrackDetail', 'GET', r'^/learn/tracks/[^/]+$'),
  LanguageCodeEndpoint('enrollTrack', 'POST', r'^/learn/tracks/[^/]+/enroll$'),
];

final _compiled = [
  for (final e in languageCodeEndpoints) (method: e.method, re: RegExp(e.pattern)),
];

/// Whether RN would inject `languageCode` into this request.
bool isLanguageCodeEndpoint(String method, String path) {
  final bare = path.split('?').first;
  final upper = method.toUpperCase();
  return _compiled.any((e) => e.method == upper && e.re.hasMatch(bare));
}

/// RN `api.ts` `baseQuery`'s injection, centrally for every request: GETs
/// get `languageCode` as a query param, mutations get it in the JSON body.
/// The caller's own value wins (RN spreads params/body last). Must run
/// BEFORE [AuthInterceptor] so it sees the un-versioned path.
class LanguageCodeInterceptor extends Interceptor {
  LanguageCodeInterceptor(this._languageCode);

  /// RN's `i18n.resolvedLanguage ?? i18n.language ?? 'en'`.
  final Future<String> Function() _languageCode;

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (isLanguageCodeEndpoint(options.method, options.path)) {
      final languageCode = await _languageCode();
      if (options.method.toUpperCase() == 'GET') {
        options.queryParameters = {'languageCode': languageCode, ...options.queryParameters};
      } else {
        final data = options.data;
        if (data == null) {
          options.data = {'languageCode': languageCode};
        } else if (data is Map) {
          options.data = {'languageCode': languageCode, ...data};
        }
      }
    }
    handler.next(options);
  }
}

/// The applied UI language, or null while the localization controller is
/// still loading. A separate provider (rather than watching the controller
/// directly) so CDN refreshes, which replace the translations but not the
/// language, don't look like a language change.
final uiLanguageCodeProvider = Provider<String?>((ref) {
  final translations = ref.watch(localizationControllerProvider);
  if (!translations.hasValue) return null;
  return ref.read(localizationControllerProvider.notifier).currentLanguage;
});
