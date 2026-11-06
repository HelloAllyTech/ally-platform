import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'package:ally_mobile_flutter/core/branding/brand_controller.dart';
import 'package:ally_mobile_flutter/core/branding/tenant_branding.dart';
import 'package:ally_mobile_flutter/core/navigation/app_drawer.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';

import '../../support/pump_app.dart';
import '../branding/tenant_branding_test.dart' show acmeJson;

class _BrandedController extends BrandController {
  _BrandedController(this.branding);

  final TenantBranding branding;

  @override
  TenantBranding build() => branding;
}

void main() {
  testWidgets('a branded org shows its name and welcome line up top and "Powered by Ally" by the mark',
      (tester) async {
    PackageInfo.setMockInitialValues(
      appName: 'Ally',
      packageName: 'ai.helloally',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );
    final acme = TenantBranding.fromJson(acmeJson());

    await pumpApp(
      tester,
      const Scaffold(body: AppDrawer(permissions: [])),
      overrides: [
        currentUserProvider.overrideWith(
          (ref) async => UserProfile(
            id: 1,
            email: 'learner@example.com',
            name: 'learner',
            phone: '',
            profileImageUrl: null,
            profileCompleted: true,
          ),
        ),
        tenantInfoProvider.overrideWith((ref) async => TenantInfo(name: 'Acme', logoUrl: null, branding: acme)),
        brandControllerProvider.overrideWith(() => _BrandedController(acme)),
      ],
    );

    expect(find.byKey(const Key('drawer-org-display-name')), findsOneWidget);
    expect(find.text('Acme Helpline'), findsOneWidget);
    expect(find.byKey(const Key('drawer-org-welcome-line')), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.byKey(const Key('drawer-powered-by-ally')), findsOneWidget);
    expect(find.text('Powered by Ally'), findsOneWidget);
    // The Ally mark itself stays.
    expect(
      find.byWidgetPredicate((w) => w is SvgPicture && w.bytesLoader.toString().contains('allyLogo')),
      findsOneWidget,
    );
  });
}
