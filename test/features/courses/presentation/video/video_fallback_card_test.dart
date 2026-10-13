import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

import 'package:ally_mobile_flutter/features/courses/presentation/video/video_fallback_card.dart';

/// `url_launcher`'s default platform implementation talks to a method
/// channel that has no handler registered in `flutter test` — tapping
/// "Open externally" would otherwise complete with a
/// `MissingPluginException`. `UrlLauncherPlatform.instance` is the public,
/// settable platform-interface seam real plugins implement, so a tiny fake
/// against it (recording what it was asked to launch) is the supported way
/// to verify the button wires up `launchUrl` without needing the real
/// platform channel or asserting on OS-level launch behavior.
class FakeUrlLauncherPlatform extends UrlLauncherPlatform {
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
  late FakeUrlLauncherPlatform fakeLauncher;

  setUp(() {
    fakeLauncher = FakeUrlLauncherPlatform();
    UrlLauncherPlatform.instance = fakeLauncher;
  });

  Future<void> pump(WidgetTester tester, {required VoidCallback onMarkWatched}) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: VideoFallbackCard(
              url: 'https://vimeo.com/123456',
              onMarkWatched: onMarkWatched,
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('shows an open-externally button and a mark-watched button', (tester) async {
    await pump(tester, onMarkWatched: () {});

    expect(find.text('courses.video.openVideo'), findsOneWidget);
    expect(find.text('courses.video.markWatched'), findsOneWidget);
  });

  testWidgets('tapping "open externally" launches the video url', (tester) async {
    await pump(tester, onMarkWatched: () {});

    await tester.tap(find.text('courses.video.openVideo'));
    await tester.pumpAndSettle();

    expect(fakeLauncher.launchedUrls, ['https://vimeo.com/123456']);
  });

  testWidgets('tapping "mark as watched" invokes the callback', (tester) async {
    var markWatchedCalled = false;
    await pump(tester, onMarkWatched: () => markWatchedCalled = true);

    await tester.tap(find.text('courses.video.markWatched'));
    await tester.pump();

    expect(markWatchedCalled, isTrue);
  });
}
