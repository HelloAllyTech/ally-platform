import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/token_storage.dart';

/// Minimal auth session state for Phase 0. Mirrors the one thing
/// `userSlice.handleLogout` + the API layer's `baseQueryWithReauth` actually
/// need from the rest of the app: a single `isAuthenticated` flag the router
/// redirects on, and a `logout()` the network layer can call when a refresh
/// irrecoverably fails. Session-expired messaging (RN's `showToast` call in
/// `handleUserLogout`) is intentionally not wired yet — that needs this
/// app's real toast/snackbar pattern decided first, tracked for a follow-up
/// once Phase 0's UI shell exists.
class AuthState {
  const AuthState({required this.isAuthenticated});

  final bool isAuthenticated;

  static const unknown = AuthState(isAuthenticated: false);
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
      state = AuthState.unknown;
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

  Future<void> logout() async {
    await _tokenStorage.clear();
    state = const AuthState(isAuthenticated: false);
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
