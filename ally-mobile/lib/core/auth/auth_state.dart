import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/notifications/data/notifications_repository.dart';
import '../localization/localization_controller.dart';
import '../network/token_storage.dart';
import '../push/push_notification_service.dart';
import '../widgets/toast/toast_controller.dart';

/// Minimal auth session state for Phase 0. Mirrors the one thing
/// `userSlice.handleLogout` + the API layer's `baseQueryWithReauth` actually
/// need from the rest of the app: a single `isAuthenticated` flag the router
/// redirects on, a `logout()` for a deliberate, user-initiated sign-out, and
/// `sessionExpired()` for when the network layer gives up on a refresh —
/// same split RN has (`handleLogout` vs. `handleUserLogout`'s extra
/// `showToast` call), now that the UI shell this needed exists.
class AuthState {
  const AuthState({required this.isAuthenticated, this.isRestored = true});

  final bool isAuthenticated;

  /// False only until the stored session has been read at launch. The
  /// router holds `/splash` meanwhile, so a returning user never builds
  /// the login screen on the way to Home.
  final bool isRestored;

  static const unknown = AuthState(isAuthenticated: false, isRestored: false);
}

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

/// Riverpod 3.x's `Notifier`, the current replacement for the now-removed
/// `StateNotifier`/`StateNotifierProvider` pair.
class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    _restore();
    return AuthState.unknown;
  }

  TokenStorage get _tokenStorage => ref.read(tokenStorageProvider);

  Future<void> _restore() async {
    try {
      final accessToken = await _tokenStorage.accessToken;
      state = AuthState(isAuthenticated: accessToken != null);
    } catch (_) {
      // Secure storage unreadable (corrupted keychain, a platform issue,
      // or — in tests — no plugin registered at all). Falls back to
      // "not authenticated", same as `build()`'s initial state, rather
      // than leaving an unhandled rejection floating in the zone.
      state = const AuthState(isAuthenticated: false);
    }
  }

  Future<void> signIn({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _tokenStorage.storeTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
    );
    state = const AuthState(isAuthenticated: true);
  }

  /// RN `useUser.handleUserLogout` (the drawer's Logout): deregister this
  /// device for push first, while the access token still authorises the
  /// DELETE, then clear the session. A 401 that ends the session
  /// ([sessionExpired]) skips the push step, as RN's `api.ts` does.
  Future<void> logout() async {
    if (state.isAuthenticated) {
      try {
        await ref.read(pushNotificationServiceProvider).unregister(ref.read(notificationsRepositoryProvider));
      } catch (_) {
        // Best-effort; never blocks signing out.
      }
    }
    await _tokenStorage.clear();
    state = const AuthState(isAuthenticated: false);
  }

  /// Called by the network layer when a 401 can't be recovered from (no
  /// stored tokens, or the refresh call itself failed) — same trigger as
  /// RN's `handleUserLogout`. Clears the session exactly like [logout], but
  /// also surfaces why, via RN's `showToast(t('auth.sessionExpired'), 'error')`.
  ///
  /// Returns the same message so `AuthInterceptor` can swap it in for the
  /// original technical failure, instead of also forwarding that raw error
  /// to whatever screen's request lost this race — that still happened
  /// after the toast alone was added (confirmed live: a 401 on Profile
  /// Settings kept rendering the multi-paragraph "RequestOptions.
  /// validateStatus..." dump even once the toast was showing), since
  /// nothing was actually removing it from the propagated error.
  ///
  /// No toast when nobody was signed in: there was no session to expire,
  /// and the login screen showing "Your session has expired" on a fresh
  /// install reads as a bug (it was one — see `currentUserProvider`).
  Future<String> sessionExpired() async {
    final wasAuthenticated = state.isAuthenticated;
    await _tokenStorage.clear();
    state = const AuthState(isAuthenticated: false);

    final message =
        ref.read(localizationControllerProvider).value?.t('auth.sessionExpired') ??
        'auth.sessionExpired';
    if (!wasAuthenticated) return message;
    showToast(message, type: ToastType.error);
    return message;
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
