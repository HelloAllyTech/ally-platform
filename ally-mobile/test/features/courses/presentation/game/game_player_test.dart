import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:ally_mobile_flutter/features/courses/data/course_models.dart';
import 'package:ally_mobile_flutter/features/courses/data/courses_repository.dart';
import 'package:ally_mobile_flutter/features/courses/data/start_item_payload.dart';
import 'package:ally_mobile_flutter/features/courses/presentation/game/game_player.dart';

/// `webview_flutter`'s `WebViewWidget` needs a real platform channel that
/// doesn't exist under `flutter test` — `WebViewController()` throws
/// synchronously (a `Null check operator used on a null value`, since
/// `WebViewPlatform.instance` defaults to `null` rather than a fake/
/// placeholder implementation like `video_player`'s) as soon as a *valid*
/// `gameKey` reaches the `await rootBundle.loadString(...)` continuation in
/// `_loadGame()`. So every test here either stays on the "unrecognized
/// gameKey" early-return path (which never constructs a controller, and is
/// itself one of the real behaviors to cover) or stops pumping before that
/// continuation runs. The actual WebView<->Dart `postMessage` bridge
/// (`_handleMessage`, private to `_GamePlayerState`) isn't reachable from a
/// different library and can't be exercised this way — see the note on the
/// last test below.
class MockCoursesRepository extends Mock implements CoursesRepository {}

void main() {
  late MockCoursesRepository repository;

  setUp(() {
    repository = MockCoursesRepository();
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [coursesRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(home: Scaffold(body: child)),
      ),
    );
  }

  StartItemPayload payloadFor(
    String? gameKey, {
    TrackItemCompletionResult? completion,
  }) => StartItemPayload(
    trackItemProgressId: 'p1',
    type: 'GAME',
    gameKey: gameKey,
    gameIntro: 'Have fun!',
    gameBestScore: 7,
    gameCompletion: completion,
  );

  testWidgets(
    'onCompleted fires immediately on mount with the payload\'s real completion result',
    (tester) async {
      // The server already marked a GAME item complete the moment
      // `startTrackItem` returned (see the class doc in game_player.dart) —
      // `onCompleted` fires synchronously from `initState`, independent of
      // whether the gameKey is even recognized, carrying whatever
      // section/track-completed flags the initial payload came with.
      TrackItemCompletionResult? received;
      await pump(
        tester,
        GamePlayer(
          payload: payloadFor(
            'NOT_A_REAL_GAME',
            completion: TrackItemCompletionResult(
              completed: true,
              sectionCompleted: true,
              trackCompleted: false,
            ),
          ),
          itemId: 'item1',
          onCompleted: (result) => received = result,
        ),
      );

      expect(received?.completed, isTrue);
      expect(received?.sectionCompleted, isTrue);
      expect(received?.trackCompleted, isFalse);
    },
  );

  testWidgets(
    'falls back to a bare completed result when the payload carries none',
    (tester) async {
      TrackItemCompletionResult? received;
      await pump(
        tester,
        GamePlayer(
          payload: payloadFor('NOT_A_REAL_GAME'),
          itemId: 'item1',
          onCompleted: (result) => received = result,
        ),
      );

      expect(received?.completed, isTrue);
      expect(received?.sectionCompleted, isFalse);
      expect(received?.trackCompleted, isFalse);
    },
  );

  testWidgets(
    'an unrecognized gameKey shows the not-supported fallback instead of crashing',
    (tester) async {
      await pump(
        tester,
        GamePlayer(
          payload: payloadFor('NOT_A_REAL_GAME'),
          itemId: 'item1',
          onCompleted: (_) {},
        ),
      );
      await tester.pumpAndSettle();

      // No `runAsync`, so localization hasn't resolved — the raw key is a
      // fine signal that the unsupported-fallback branch rendered.
      expect(find.text('courses.player.unsupportedTitle'), findsOneWidget);
    },
  );

  testWidgets('a null gameKey also falls back cleanly', (tester) async {
    await pump(
      tester,
      GamePlayer(
        payload: payloadFor(null),
        itemId: 'item1',
        onCompleted: (_) {},
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('courses.player.unsupportedTitle'), findsOneWidget);
  });

  // Deliberately not covered, and not safely coverable in this environment:
  //
  // - A *recognized* gameKey (e.g. 'SNAKE'): `_loadGame()` resolves
  //   `rootBundle.loadString(...)` synchronously enough in `flutter test`
  //   (asset reads here don't need a real async escape, unlike the
  //   project's own `runAsync` localization path) that it reaches
  //   `WebViewController()` within the very first `pumpWidget()` call —
  //   before the test gets a chance to observe the in-between loading
  //   state — and throws ("A platform implementation for `webview_flutter`
  //   has not been set..."), confirmed by actually running it. There's no
  //   window in which `_controller` is null, `_loadError` is null, *and*
  //   the controller hasn't been constructed yet to inspect.
  // - `_handleMessage`'s score-recording behavior (the WebView->Dart
  //   `postMessage` bridge): it's a method on `_GamePlayerState`, private
  //   to game_player.dart, so it isn't reachable from this test file, and
  //   driving it for real needs an actual WebView executing the bundle's
  //   JS, which `flutter test` can't run at all.
}
