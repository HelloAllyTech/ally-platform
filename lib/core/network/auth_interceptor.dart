import 'package:dio/dio.dart';

import 'api_routes.dart';
import 'token_storage.dart';

/// Faithful port of ally-mobile (React Native)'s `baseQueryWithReauth`
/// (`src/services/api.ts`): inject the bearer token and version prefix on
/// every request, and on a 401, attempt exactly one refresh-and-retry before
/// giving up and logging the user out. Deliberately mirrors that file's
/// behavior rather than inventing a new auth flow, since the backend
/// contract (same refresh endpoint, same token pair) is unchanged by this
/// rewrite.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required Dio refreshDio,
    required TokenStorage tokenStorage,
    required Future<void> Function() onUnrecoverable,
  })  : _refreshDio = refreshDio,
        _tokenStorage = tokenStorage,
        _onUnrecoverable = onUnrecoverable;

  // A separate Dio instance with no interceptors, used only for the refresh
  // call itself — reusing the main client here would recurse back into this
  // same interceptor on a 401 from the refresh endpoint.
  final Dio _refreshDio;
  final TokenStorage _tokenStorage;
  final Future<void> Function() _onUnrecoverable;

  // RN's `api.ts` matches with `url === v2Endpoint` (exact equality), not a
  // prefix check — `startsWith` here would wrongly also match e.g.
  // `/learn/scenarios/7` (getScenarioById) against the v2-listed
  // `/learn/scenarios`, sending it to a v2 route the backend never migrated.
  bool _isV2(String path) => v2Endpoints.contains(path);

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final version = _isV2(options.path) ? 'v2' : 'v1';
    options.path = '/$version${options.path}';

    final accessToken = await _tokenStorage.accessToken;
    if (accessToken != null) {
      options.headers['authorization'] = 'Bearer $accessToken';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401) {
      handler.next(err);
      return;
    }

    final refreshToken = await _tokenStorage.refreshToken;
    final accessToken = await _tokenStorage.accessToken;
    if (refreshToken == null || accessToken == null) {
      await _onUnrecoverable();
      handler.next(err);
      return;
    }

    try {
      // _refreshDio carries no interceptor (deliberately, to avoid recursing
      // back into this one on a 401 from the refresh call itself), so unlike
      // every other request it does not get the /v1 prefix from onRequest
      // above — add it explicitly. authRefresh is not a v2 endpoint.
      final refreshResponse = await _refreshDio.post<Map<String, dynamic>>(
        '/v1${ApiRoutes.authRefresh}',
        data: {'refreshToken': refreshToken},
      );

      final newAccessToken = refreshResponse.data?['accessToken'] as String?;
      final newRefreshToken = refreshResponse.data?['refreshToken'] as String?;
      if (newAccessToken == null || newRefreshToken == null) {
        throw DioException(requestOptions: err.requestOptions);
      }

      await _tokenStorage.storeTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );

      // Retry the original request with the refreshed token.
      final retryOptions = err.requestOptions;
      retryOptions.headers['authorization'] = 'Bearer $newAccessToken';
      final retryResponse = await _refreshDio.fetch(retryOptions);
      handler.resolve(retryResponse);
    } catch (_) {
      await _onUnrecoverable();
      handler.next(err);
    }
  }
}
