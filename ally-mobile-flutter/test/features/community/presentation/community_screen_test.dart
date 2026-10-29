import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:ally_mobile_flutter/features/community/presentation/community_screen.dart';

import '../../../support/fake_translations.dart';

/// Fakes the platform side of `url_launcher` so `launchUrl()` doesn't hit a
/// real (unregistered-in-tests) platform channel. The every-tap behaviour
/// lives in the shell (see app_shell_screen_test.dart).
class _FakeUrlLauncherPlatform extends UrlLauncherPlatform {
  final List<String> launchedUrls = [];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launchedUrls.add(url);
    return true;
  }
}

void main() {
  late _FakeUrlLauncherPlatform fakeLauncher;

  setUp(() {
    fakeLauncher = _FakeUrlLauncherPlatform();
    UrlLauncherPlatform.instance = fakeLauncher;
  });

  testWidgets('when it is the first tab: shows the title and opens the community URL once', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [fixedTranslationsOverride()],
        child: const MaterialApp(home: Scaffold(body: CommunityScreen())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Community'), findsOneWidget);
    expect(fakeLauncher.launchedUrls, ['https://community.helloally.ai/']);
  });
}
