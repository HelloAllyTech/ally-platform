import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player/video_player.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

import 'package:ally_mobile_flutter/features/courses/presentation/video/video_player_widget.dart';

import 'fake_video_player_platform.dart';

/// `video_player` needs a platform channel that doesn't exist under
/// `flutter test`. [FakeVideoPlayerPlatform] (see that file's doc comment)
/// is a real `VideoPlayerPlatform` implementation — the same pattern the
/// `video_player` package itself uses for its own test suite — so these
/// tests exercise real `VideoPlayerController`/`VideoPlayerWidget` behavior,
/// not a stub of this app's own code.
void main() {
  late FakeVideoPlayerPlatform fakePlatform;

  setUp(() {
    fakePlatform = FakeVideoPlayerPlatform();
    VideoPlayerPlatform.instance = fakePlatform;
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(ProviderScope(child: MaterialApp(home: child)));
  }

  /// Every test must end by unmounting the widget (dispose cancels the
  /// widget's internal 500ms progress-poll `Timer.periodic`) — otherwise
  /// `flutter_test`'s fake-async zone reports "A Timer is still pending"
  /// once the test body returns.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
  }

  testWidgets('shows a loading indicator before initialization completes', (tester) async {
    await pump(
      tester,
      VideoPlayerWidget(url: 'https://example.com/v.mp4', onProgressTime: (_) {}, onPauseOrEnd: () {}),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await unmount(tester);
  });

  testWidgets('renders the video player once initialized and starts playing', (tester) async {
    await pump(
      tester,
      VideoPlayerWidget(url: 'https://example.com/v.mp4', onProgressTime: (_) {}, onPauseOrEnd: () {}),
    );

    // Let the fake platform's `initialized` event (posted via
    // scheduleMicrotask) and the controller's event-stream subscription
    // drain.
    await tester.pump();
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(fakePlatform.calls, contains('play'));

    await unmount(tester);
  });

  testWidgets('shows the load-failed state when the platform errors', (tester) async {
    fakePlatform.forceInitError = true;

    await pump(
      tester,
      VideoPlayerWidget(url: 'https://example.com/v.mp4', onProgressTime: (_) {}, onPauseOrEnd: () {}),
    );
    await tester.pump();
    await tester.pump();

    // Localization isn't loaded (no `runAsync` here — the fake-async zone
    // can't drain `rootBundle.loadString`'s real I/O), so `ref.t()` falls
    // back to the raw key — that's a fine signal that the error branch
    // rendered.
    expect(find.text('courses.video.loadFailed'), findsOneWidget);

    await unmount(tester);
  });

  testWidgets('reports playhead position as it polls', (tester) async {
    final reported = <double>[];
    await pump(
      tester,
      VideoPlayerWidget(
        url: 'https://example.com/v.mp4',
        onProgressTime: reported.add,
        onPauseOrEnd: () {},
      ),
    );
    await tester.pump();
    await tester.pump();

    // The widget's own poll timer ticks every 500ms; the fake platform
    // advances the reported position by 500ms on every `getPosition` call
    // (driven by `video_player`'s internal 100ms position timer), so
    // advancing fake time here produces real forward progress.
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));

    expect(reported, isNotEmpty);
    expect(reported.last, greaterThan(0));

    await unmount(tester);
  });

  testWidgets('pause()/resume() on the state delegate to the controller', (tester) async {
    final key = GlobalKey<VideoPlayerWidgetState>();
    await pump(
      tester,
      VideoPlayerWidget(
        key: key,
        url: 'https://example.com/v.mp4',
        onProgressTime: (_) {},
        onPauseOrEnd: () {},
      ),
    );
    await tester.pump();
    await tester.pump();

    fakePlatform.calls.clear();
    await key.currentState!.pause();
    expect(fakePlatform.calls, contains('pause'));

    fakePlatform.calls.clear();
    await key.currentState!.resume();
    expect(fakePlatform.calls, contains('play'));

    await unmount(tester);
  });

  testWidgets('stops sampling while paused, reports the pause once, and still samples a seek while paused',
      (tester) async {
    final key = GlobalKey<VideoPlayerWidgetState>();
    final reported = <double>[];
    var pauses = 0;
    await pump(
      tester,
      VideoPlayerWidget(
        key: key,
        url: 'https://example.com/v.mp4',
        onProgressTime: reported.add,
        onPauseOrEnd: () => pauses++,
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(reported, isNotEmpty);

    await key.currentState!.pause();
    await tester.pump(const Duration(milliseconds: 100));
    expect(pauses, 1);
    final afterPause = reported.length;

    // Paused: the playhead doesn't move, so nothing is sampled.
    await tester.pump(const Duration(seconds: 3));
    expect(reported.length, afterPause);

    // A seek while paused is still reported (interjection crossing checks
    // depend on it).
    await tester.tap(find.byType(VideoProgressIndicator));
    await tester.pump(const Duration(milliseconds: 100));
    expect(reported.length, afterPause + 1);
    expect(reported.last, closeTo(50, 2), reason: 'tap at the middle of a 100s scrub bar');
    expect(pauses, 1);

    await unmount(tester);
  });
}
