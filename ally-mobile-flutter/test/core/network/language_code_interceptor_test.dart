import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/network/api_client.dart';
import 'package:ally_mobile_flutter/core/network/language_code_interceptor.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _RecordingHandler extends RequestInterceptorHandler {
  RequestOptions? next_;

  @override
  void next(RequestOptions requestOptions) => next_ = requestOptions;
}

Future<RequestOptions> _run(RequestOptions options, {String lang = 'hi'}) async {
  final handler = _RecordingHandler();
  await LanguageCodeInterceptor(() async => lang).onRequest(options, handler);
  return handler.next_!;
}

class _FakeAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(isAuthenticated: true);
}

class _Lang extends Notifier<String?> {
  @override
  String? build() => 'en';

  void set(String? value) => state = value;
}

void main() {
  test('allowlist has exactly RN LANGUAGE_CODE_ENDPOINTS (getReview shares getReviewById)', () {
    expect(languageCodeEndpoints.map((e) => e.name).toSet(), {
      'getScenarios', 'getScenarioById', 'getSimulationPaths', 'getSimulationPathDetails',
      'getCases', 'getCaseDetails', 'getSimulationDetails', 'getEventChecklist',
      'getSimulationSkills', 'getReviewById', 'getReviews', 'getAvailableBadges',
      'getLeaderboard', 'endScenarioSession', 'getLearnTracks', 'getLearnTrackDetail',
      'enrollTrack',
    });
  });

  group('matched per endpoint family', () {
    const matched = {
      'simulations': [
        ('GET', '/learn/scenarios'),
        ('GET', '/learn/scenarios/42'),
        ('GET', '/learn/scenario-paths'),
        ('GET', '/learn/scenario-paths/p1'),
        ('GET', '/learn/cases'),
        ('GET', '/learn/cases/c1'),
        ('GET', '/learn/scenario-session/s1'),
        ('GET', '/learn/scenario-session/s1/event-checklist'),
        ('GET', '/learn/scenario-session/s1/skills'),
        ('POST', '/learn/scenario-session/s1/end'),
      ],
      'reviews': [
        ('GET', '/scenario-session-reviews'),
        ('GET', '/scenario-session-reviews/r1'),
      ],
      'badges/leaderboard': [
        ('GET', '/badges/me/available'),
        ('GET', '/community/leaderboard'),
      ],
      'courses': [
        ('GET', '/learn/tracks'),
        ('GET', '/learn/tracks/t1'),
        ('POST', '/learn/tracks/t1/enroll'),
      ],
    };
    const notMatched = [
      ('GET', '/scenario-session-reviews/unread-count'),
      ('POST', '/scenario-session-reviews'),
      ('PATCH', '/scenario-session-reviews/r1'),
      ('GET', '/scenario-session-reviews/r1/messages'),
      ('GET', '/scribe-session-reviews'),
      ('GET', '/scribe-session-reviews/r1'),
      ('GET', '/community/leaderboard/my-rank'),
      ('GET', '/badges/me'),
      ('GET', '/learn/tracks/t1/next-item'),
      ('GET', '/learn/tracks/t1/progress'),
      ('POST', '/learn/tracks/items/i1/quiz-attempts'),
      ('POST', '/learn/scenario-paths/p1/create-session'),
      ('GET', '/learn/scenario-session/scenario-path-session-item/x'),
      ('POST', '/learn/scenario-session-start'),
      ('GET', '/learn/scenario-session/s1/messages'),
      ('GET', '/learn/scenario-sessions'),
    ];
    for (final family in matched.entries) {
      test(family.key, () {
        for (final (method, path) in family.value) {
          expect(isLanguageCodeEndpoint(method, path), isTrue, reason: '$method $path');
        }
      });
    }
    test('everything else is left alone', () {
      for (final (method, path) in notMatched) {
        expect(isLanguageCodeEndpoint(method, path), isFalse, reason: '$method $path');
      }
    });
    test('inline query string is ignored for matching', () {
      expect(isLanguageCodeEndpoint('GET', '/learn/scenarios?x=1'), isTrue);
    });
  });

  group('injection', () {
    test('GET puts languageCode in the query; caller params kept', () async {
      final out = await _run(RequestOptions(
        path: '/community/leaderboard',
        method: 'GET',
        queryParameters: {'window': 'weekly'},
      ));
      expect(out.queryParameters, {'languageCode': 'hi', 'window': 'weekly'});
    });

    test("a caller's own languageCode wins (RN spreads params last)", () async {
      final out = await _run(RequestOptions(
        path: '/learn/tracks',
        method: 'GET',
        queryParameters: {'languageCode': 'ta'},
      ));
      expect(out.queryParameters['languageCode'], 'ta');
    });

    test('mutation with no body gets {languageCode}', () async {
      final out = await _run(RequestOptions(path: '/learn/tracks/t1/enroll', method: 'POST'));
      expect(out.data, {'languageCode': 'hi'});
    });

    test('mutation body is merged', () async {
      final out = await _run(RequestOptions(
        path: '/learn/scenario-session/s1/end',
        method: 'POST',
        data: {'enableRecommendations': true},
      ));
      expect(out.data, {'languageCode': 'hi', 'enableRecommendations': true});
    });

    test('non-listed endpoints untouched', () async {
      final out = await _run(RequestOptions(path: '/scribe-session-reviews', method: 'GET'));
      expect(out.queryParameters, isEmpty);
    });
  });

  test('a UI language switch rebuilds the API client (RN resetApiState)', () async {
    final langProvider = NotifierProvider<_Lang, String?>(_Lang.new);
    final container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith(_FakeAuthController.new),
      apiBaseUrlProvider.overrideWithValue('http://localhost:8001'),
      uiLanguageCodeProvider.overrideWith((ref) => ref.watch(langProvider)),
    ]);
    addTearDown(container.dispose);
    container.listen(apiClientProvider, (_, _) {});

    final first = container.read(apiClientProvider);
    container.read(langProvider.notifier).set('en');
    expect(identical(container.read(apiClientProvider), first), isTrue);
    container.read(langProvider.notifier).set('hi');
    expect(identical(container.read(apiClientProvider), first), isFalse);
  });
}
