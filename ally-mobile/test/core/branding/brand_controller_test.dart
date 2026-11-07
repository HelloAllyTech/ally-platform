import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/core/auth/auth_state.dart';
import 'package:ally_mobile_flutter/core/branding/brand_controller.dart';
import 'package:ally_mobile_flutter/core/branding/tenant_branding.dart';
import 'package:ally_mobile_flutter/core/theme/app_colors.dart';
import 'package:ally_mobile_flutter/core/theme/app_theme.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';

import 'tenant_branding_test.dart' show acmeJson;

class _AuthController extends AuthController {
  _AuthController(this._initial);

  final bool _initial;

  @override
  AuthState build() => AuthState(isAuthenticated: _initial);

  void set(bool value) => state = AuthState(isAuthenticated: value);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final acme = TenantBranding.fromJson(acmeJson());

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    Brand.set(null);
  });

  tearDown(() => Brand.set(null));

  group('AppColors brand tokens', () {
    test('are the app\'s own constants while no branding is on', () {
      expect(AppColors.primary, AppColors.primaryDefault);
      expect(AppColors.appBar, const Color(0xFF0957D0));
      expect(AppColors.statusBar, const Color(0xFF0143A8));
      expect(AppColors.blue50, const Color(0xFFE2F2FF));
      expect(AppColors.onPrimary, Colors.white);
    });

    test('follow the org once its branding is set', () {
      Brand.set(acme);
      expect(AppColors.primary, const Color(0xFF8E2626));
      expect(AppColors.azureBlue, const Color(0xFF8E2626));
      expect(AppColors.appBar, const Color(0xFF8E2626));
      expect(AppColors.primaryDark, acme.ramp[600]);
      expect(AppColors.statusBar, acme.ramp[600]);
      expect(AppColors.primaryLight, acme.ramp[300]);
      expect(AppColors.blue50, acme.ramp[50]);
      expect(AppColors.onPrimary, const Color(0xFFFAF9F5));
      expect(AppTheme.light.colorScheme.primary, const Color(0xFF8E2626));
      expect(AppTheme.light.appBarTheme.backgroundColor, const Color(0xFF8E2626));
    });

    test('a disabled branding is never painted', () {
      Brand.set(TenantBranding.fromJson(acmeJson(enabled: false)));
      expect(Brand.isOn, isFalse);
      expect(AppColors.primary, AppColors.primaryDefault);
    });
  });

  group('Brand.readCached', () {
    test('restores an enabled branding and ignores a disabled or corrupt one', () async {
      SharedPreferences.setMockInitialValues({orgBrandingPrefsKey: jsonEncode(acme.toJson())});
      expect(Brand.readCached(await SharedPreferences.getInstance()), acme);

      SharedPreferences.setMockInitialValues({
        orgBrandingPrefsKey: jsonEncode(TenantBranding.fromJson(acmeJson(enabled: false)).toJson()),
      });
      expect(Brand.readCached(await SharedPreferences.getInstance()), isNull);

      SharedPreferences.setMockInitialValues({orgBrandingPrefsKey: '{not json'});
      expect(Brand.readCached(await SharedPreferences.getInstance()), isNull);
    });

    test('restoreFromPrefs paints the cache before the first frame', () async {
      SharedPreferences.setMockInitialValues({orgBrandingPrefsKey: jsonEncode(acme.toJson())});
      await Brand.restoreFromPrefs();
      expect(AppColors.primary, const Color(0xFF8E2626));
    });
  });

  group('BrandController', () {
    test('applies the org from /users/tenant, caches it, and resets on sign-out', () async {
      final auth = _AuthController(true);
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => auth),
          tenantInfoProvider.overrideWith(
            (ref) async => TenantInfo(name: 'Acme', logoUrl: null, branding: acme),
          ),
        ],
      );
      addTearDown(container.dispose);

      final sub = container.listen(brandControllerProvider, (_, _) {});
      expect(sub.read(), TenantBranding.ally);

      // Let the (fake) tenant fetch resolve and the listener run.
      await container.read(tenantInfoProvider.future);
      await Future<void>.delayed(Duration.zero);

      expect(sub.read(), acme);
      expect(Brand.current, acme);
      expect(AppColors.primary, const Color(0xFF8E2626));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(orgBrandingPrefsKey), isNotNull);

      auth.set(false);
      await Future<void>.delayed(Duration.zero);

      expect(sub.read(), TenantBranding.ally);
      expect(Brand.current, isNull);
      expect(AppColors.primary, AppColors.primaryDefault);
      expect(prefs.getString(orgBrandingPrefsKey), isNull);
    });

    test('an org with the switch off clears a stale cache', () async {
      SharedPreferences.setMockInitialValues({orgBrandingPrefsKey: jsonEncode(acme.toJson())});
      await Brand.restoreFromPrefs();
      expect(Brand.isOn, isTrue);

      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => _AuthController(true)),
          tenantInfoProvider.overrideWith((ref) async => TenantInfo(name: 'Plain', logoUrl: null)),
        ],
      );
      addTearDown(container.dispose);
      container.listen(brandControllerProvider, (_, _) {});
      await container.read(tenantInfoProvider.future);
      await Future<void>.delayed(Duration.zero);

      expect(Brand.isOn, isFalse);
      expect((await SharedPreferences.getInstance()).getString(orgBrandingPrefsKey), isNull);
    });
  });
}
