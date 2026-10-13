import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:ally_mobile_flutter/features/community/presentation/community_screen.dart';

/// Fakes the platform side of `url_launcher` so `launchUrl()` doesn't hit a
/// real (unregistered-in-tests) platform channel. `CommunityScreen` has no
/// Riverpod/translation dependency at all (see its own doc comment: it's
/// deliberately just a redirect, no UI), so this doesn't need `pumpApp` or
/// `preWarmTranslations` — only a real `GoRouter` ancestor, for
/// `context.canPop()`/`context.pop()`.
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

  testWidgets('renders nothing, pops, and opens the community URL externally', (tester) async {
    final router = GoRouter(
      initialLocation: '/home',
      routes: [
        GoRoute(path: '/home', builder: (context, state) => const Scaffold(body: Text('home'))),
        GoRoute(path: '/community', builder: (context, state) => const CommunityScreen()),
      ],
    );

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();

    router.push('/community');
    await tester.pump();

    // The real behavior described in community_screen.dart's doc comment:
    // it renders no UI of its own.
    expect(find.text('home'), findsNothing);
    expect(find.byType(CommunityScreen), findsOneWidget);

    // Flush the addPostFrameCallback that pops and launches the URL.
    await tester.pump();
    await tester.pump();

    expect(find.text('home'), findsOneWidget, reason: 'should have popped back');
    expect(fakeLauncher.launchedUrls, ['https://community.helloally.ai/']);
  });
}
