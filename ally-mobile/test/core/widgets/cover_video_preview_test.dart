import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

import 'package:ally_mobile_flutter/core/widgets/cover_video_preview.dart';

import '../../features/courses/presentation/video/fake_video_player_platform.dart';

void main() {
  late FakeVideoPlayerPlatform platform;
  late List<Uri> created;

  setUp(() {
    platform = FakeVideoPlayerPlatform();
    VideoPlayerPlatform.instance = platform;
    created = [];
  });

  VideoPlayerController factory(Uri url) {
    created.add(url);
    return VideoPlayerController.networkUrl(url);
  }

  Future<void> pump(WidgetTester tester, Widget child) =>
      tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));

  testWidgets('creates its controller on mount, shows play once ready, plays on tap, disposes on unmount', (
    tester,
  ) async {
    await pump(
      tester,
      CoverVideoPreview(url: 'https://cdn.example.com/a.mp4', controllerFactory: factory),
    );
    expect(created, [Uri.parse('https://cdn.example.com/a.mp4')]);
    expect(find.byType(CircularProgressIndicator), findsOneWidget, reason: 'loading');

    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cover-video-preview-play')), findsOneWidget);
    expect(platform.calls, isNot(contains('play')), reason: 'no autoplay');

    await tester.tap(find.byKey(const Key('cover-video-preview-play')));
    await tester.pump();
    expect(platform.calls, contains('play'));
    expect(find.byKey(const Key('cover-video-preview-pause')), findsOneWidget);

    await tester.tap(find.byKey(const Key('cover-video-preview-pause')));
    await tester.pump();
    expect(platform.calls.last, 'pause');

    await pump(tester, const SizedBox());
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump();
    expect(platform.calls, contains('dispose'));
  });

  testWidgets('shouldPause pauses a playing preview', (tester) async {
    Widget preview(bool pause) => CoverVideoPreview(
      url: 'https://cdn.example.com/a.mp4',
      shouldPause: pause,
      controllerFactory: factory,
    );
    await pump(tester, preview(false));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cover-video-preview-play')));
    await tester.pump();

    await pump(tester, preview(true));
    await tester.pump();
    expect(platform.calls.last, 'pause');
    expect(find.byKey(const Key('cover-video-preview-play')), findsOneWidget);
    expect(created, hasLength(1), reason: 'same controller across rebuilds');
  });

  testWidgets('falls back to the thumbnail when the video fails to load', (tester) async {
    platform.forceInitError = true;
    await pump(
      tester,
      CoverVideoPreview(
        url: 'https://cdn.example.com/broken.mp4',
        thumbnailUrl: 'https://cdn.example.com/thumb.png',
        controllerFactory: factory,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('cover-video-preview-thumbnail')), findsOneWidget);
  });
}
