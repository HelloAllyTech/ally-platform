import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../features/account/data/account_repository.dart';
import '../auth/auth_state.dart';
import 'tenant_branding.dart';

/// SharedPreferences key for the last enabled branding, so a cold start
/// paints the org's colours before `/users/tenant` answers (the consumer
/// web's `localStorage.orgBranding` pre-paint cache, same idea).
const String orgBrandingPrefsKey = 'org_branding';

/// The branding currently painted, process-wide.
///
/// `AppColors`' brand-dependent tokens (`primary`, `appBar`, ...) read
/// [current] on every access, so the 140+ call sites that paint "the
/// primary colour" follow the signed-in org without each needing a
/// `BuildContext`. Null means Ally: the app's own constants, untouched.
///
/// Writes go through [BrandController] (which also caches and resets on
/// sign-out); [restoreFromPrefs] is the one exception, for `main()`.
class Brand {
  Brand._();

  static TenantBranding? _current;

  /// The enabled branding being painted, or null for Ally's own look.
  static TenantBranding? get current => _current;

  static bool get isOn => _current != null;

  /// Only an enabled branding is ever painted; anything else means Ally.
  @visibleForTesting
  static void set(TenantBranding? branding) {
    _current = branding != null && branding.enabled ? branding : null;
  }

  /// Cold-start pre-paint: whatever the last session cached. Never throws
  /// (a corrupt cache just means Ally until the live fetch lands).
  static Future<void> restoreFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      set(readCached(prefs));
    } catch (_) {
      set(null);
    }
  }

  static TenantBranding? readCached(SharedPreferences prefs) {
    try {
      final raw = prefs.getString(orgBrandingPrefsKey);
      if (raw == null) return null;
      final branding = TenantBranding.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      return branding.enabled ? branding : null;
    } catch (_) {
      return null;
    }
  }
}

/// Keeps [Brand] in step with the signed-in org: applies the branding
/// `/users/tenant` resolves, caches an enabled one for the next cold start,
/// and goes back to Ally on sign-out so the login screen never wears the
/// previous user's org.
///
/// Watched by the app root, so a change rebuilds `MaterialApp`'s theme;
/// widgets painting `AppColors.primary` directly pick the new value up on
/// their next build. The router holds Home until the first fetch after
/// sign-in settles, so a fresh session paints the right colours from its
/// first frame rather than repainting underneath the user.
class BrandController extends Notifier<TenantBranding> {
  @override
  TenantBranding build() {
    ref.listen(tenantInfoProvider, (previous, next) {
      final branding = next.value?.branding;
      if (branding != null) apply(branding);
    });
    ref.listen(authControllerProvider, (previous, next) {
      if (previous?.isAuthenticated == true && !next.isAuthenticated) reset();
    });
    return Brand.current ?? TenantBranding.ally;
  }

  Future<void> apply(TenantBranding branding) async {
    Brand.set(branding);
    state = branding.enabled ? branding : TenantBranding.ally;
    await _cache(branding.enabled ? branding : null);
  }

  Future<void> reset() async {
    Brand.set(null);
    state = TenantBranding.ally;
    await _cache(null);
  }

  Future<void> _cache(TenantBranding? branding) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (branding == null) {
        await prefs.remove(orgBrandingPrefsKey);
      } else {
        await prefs.setString(orgBrandingPrefsKey, jsonEncode(branding.toJson()));
      }
    } catch (_) {
      // The cache only speeds up the next cold start; losing it is harmless.
    }
  }
}

final brandControllerProvider = NotifierProvider<BrandController, TenantBranding>(BrandController.new);
