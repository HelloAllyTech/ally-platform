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
    required Future<String> Function() onUnrecoverable,
  })  : _refreshDio = refreshDio,
        _tokenStorage = tokenStorage,
        _onUnrecoverable = onUnrecoverable;

  // A separate Dio instance with no interceptors, used only for the refresh
  // call itself — reusing the main client here would recurse back into this
  // same interceptor on a 401 from the refresh endpoint.
  final Dio _refreshDio;
  final TokenStorage _tokenStorage;

  // When several requests' access tokens expire at the same moment (e.g.
  // Profile Settings' first-ever `/users/me` call landing right as some
  // other screen's own request also 401s), each used to kick off its own
  // independent refresh call. The backend's refresh token is single-use, so
  // the loser of that race retried with an already-rotated token and fell
  // through to `onUnrecoverable` — confirmed live as exactly why Profile
  // Settings intermittently showed "session expired" while the rest of the
  // app, whose requests had won their own races, kept working fine. All
  // concurrent 401s now await this one shared attempt instead.
  Future<_RefreshResult>? _refreshFuture;

  /// Clears the session and returns the (already-translated) message to
  /// show — see [_replace]'s doc comment for why the caller's own message
  /// is what ends up on screen, not the original technical failure.
  final Future<String> Function() _onUnrecoverable;

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
      handler.next(await _replace(err));
      return;
    }

    // `??=`'s check-and-set has no `await` in it, so however the two awaits
    // above interleaved across concurrent `onError` calls, only the first
    // caller to reach this line actually starts `_refresh`; every other
    // caller (here or arriving later while it's still running) piggybacks
    // on the same `Future` and gets the exact token it resolved to — not a
    // re-read of storage, which a concurrent caller could otherwise observe
    // mid-write or (in the no-op case this interceptor is tested against) a
    // stub that never reflects the write at all.
    final refreshResult = await (_refreshFuture ??= _refresh(refreshToken));

    if (refreshResult.accessToken == null) {
      if (refreshResult.sessionInvalid) {
        handler.next(await _replace(err));
      } else {
        // The refresh call itself didn't complete (timeout, no connectivity,
        // a transient 5xx) — this is one failed attempt, not proof the
        // session is dead. Logging out here, on ordinary mobile network
        // flakiness, is what made the app sign people out repeatedly for no
        // real reason. Tokens are untouched, so the next request just tries
        // again on its own.
        handler.next(err);
      }
      return;
    }

    try {
      final retryOptions = err.requestOptions;
      retryOptions.headers['authorization'] = 'Bearer ${refreshResult.accessToken}';
      final retryResponse = await _refreshDio.fetch(retryOptions);
      handler.resolve(retryResponse);
    } catch (_) {
      // The refresh itself succeeded — the session is fine. This one
      // request's retry failing (another network blip, an unrelated error
      // on this specific endpoint) is not a reason to sign the user out.
      handler.next(err);
    }
  }

  /// Performs the actual refresh call, exactly once per shared attempt (see
  /// `_refreshFuture`'s doc comment). Never throws — distinguishes a backend
  /// rejection of the refresh token itself (session really is over) from
  /// the attempt merely failing to complete (network/timeout/5xx, worth
  /// retrying later with the same, still-valid tokens).
  Future<_RefreshResult> _refresh(String refreshToken) async {
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
        return const _RefreshResult(accessToken: null, sessionInvalid: true);
      }

      await _tokenStorage.storeTokens(
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      );
      return _RefreshResult(accessToken: newAccessToken, sessionInvalid: false);
    } on DioException catch (e) {
      // The backend explicitly rejected this refresh token (expired,
      // already rotated, revoked) — only this counts as the session itself
      // being over. Anything else DioException can carry (no response at
      // all, a 5xx, a timeout) is the call failing, not the token being bad.
      final status = e.response?.statusCode;
      final sessionInvalid = status == 401 || status == 400;
      return _RefreshResult(accessToken: null, sessionInvalid: sessionInvalid);
    } catch (_) {
      return const _RefreshResult(accessToken: null, sessionInvalid: false);
    } finally {
      _refreshFuture = null;
    }
  }

  /// Swaps the original (technical, user-hostile) failure for a short
  /// `DioException` whose `message` is the session-expired copy the caller
  /// already shows as a snackbar — previously this only showed that toast
  /// *alongside* still forwarding the raw `err`, so whichever screen's
  /// request lost this race rendered the real failure anyway (a multi-
  /// paragraph "RequestOptions.validateStatus was configured to throw for
  /// this status code..." dump, confirmed live). `DioException.toString()`
  /// always prefixes with `DioException [type]: `, so this isn't fully
  /// clean, but it's that one line instead of the technical essay.
  Future<DioException> _replace(DioException original) async {
    final message = await _onUnrecoverable();
    return DioException(requestOptions: original.requestOptions, message: message);
  }
}

/// See `AuthInterceptor._refresh`'s doc comment: `sessionInvalid` is only
/// ever true when the backend itself rejected the refresh token, never for
/// a refresh attempt that simply failed to complete.
class _RefreshResult {
  const _RefreshResult({required this.accessToken, required this.sessionInvalid});

  final String? accessToken;
  final bool sessionInvalid;
}
