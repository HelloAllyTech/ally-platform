import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'package:ally_mobile_flutter/core/navigation/app_drawer.dart';
import 'package:ally_mobile_flutter/features/account/data/account_repository.dart';
import 'package:ally_mobile_flutter/features/account/data/user_profile.dart';

import '../../support/pump_app.dart';

void main() {
  group('drawerVersionLabel (RN CustomDrawerContent version line)', () {
    test('appends the dev label in development', () {
      expect(
        drawerVersionLabel(versionLabel: 'Version', version: '1.23.46', environment: 'development', devLabel: '(Dev)'),
        'Version: 1.23.46 (Dev)',
      );
    });

    test('leaves it off elsewhere (RN renders the false as nothing)', () {
      expect(
        drawerVersionLabel(versionLabel: 'Version', version: '1.23.46', environment: 'production', devLabel: '(Dev)'),
        'Version: 1.23.46 ',
      );
    });
  });

  testWidgets('shows the outlined initial avatar, menu options and the boxed Ally logo', (tester) async {
    PackageInfo.setMockInitialValues(
      appName: 'Ally',
      packageName: 'ai.helloally',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );

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
        tenantInfoProvider.overrideWith((ref) async => TenantInfo(name: 'Acme', logoUrl: null)),
      ],
    );

    expect(find.byKey(const Key('user-profile-avatar')), findsOneWidget);
    expect(find.text('L'), findsOneWidget, reason: 'upper-cased initial, like UserProfileImage');
    expect(find.byType(CircleAvatar), findsNothing);
    expect(find.text('Profile Settings'), findsOneWidget);
    expect(find.text('Report a problem'), findsOneWidget);
    expect(find.text('Logout'), findsOneWidget);
    expect(find.textContaining('Version: 1.0.0'), findsOneWidget);
    expect(
      find.byWidgetPredicate((w) => w is SvgPicture && w.bytesLoader.toString().contains('allyLogo')),
      findsOneWidget,
    );
  });
}
