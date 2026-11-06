import 'package:flutter_riverpod/misc.dart' show Override;

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';

/// The real `AuthController` restores from secure storage, which has no
/// plugin in tests, so it always settles on signed out. Screens that only
/// exist behind sign-in and read `currentUserProvider` (which stays loading
/// while signed out, by design) need this to model where they actually run.
Override signedInAuthOverride() => authControllerProvider.overrideWith(_SignedInAuthController.new);

class _SignedInAuthController extends AuthController {
  @override
  AuthState build() => const AuthState(isAuthenticated: true);
}
