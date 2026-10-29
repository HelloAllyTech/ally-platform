import 'dart:convert';

import 'package:flutter/foundation.dart' show Factory;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_styles.dart';

/// Every game bundle the app can render, by `TrackGameKey` string — each
/// asset is the exact HTML ally-mobile (React Native)'s `GamePlayer` embeds
/// in a WebView (`components/players/games/*Html.ts`), extracted verbatim
/// since the bundle is host-agnostic by design (see class doc below).
const Map<String, String> _gameAssetPaths = {
  'TREX_RUNNER': 'assets/games/trex_runner.html',
  'TIC_TAC_TOE': 'assets/games/tic_tac_toe.html',
  'MEMORY_MATCH': 'assets/games/memory_match.html',
  'CUB_N_PUP': 'assets/games/cub_n_pup.html',
  'SNAKE': 'assets/games/snake.html',
  'SPROUT': 'assets/games/sprout.html',
};

/// How tall a WebView each game needs, mirroring the RN `GamePlayer`'s own
/// `GAME_HEIGHT` map — a bundle sizes itself to whatever viewport it's
/// given, so this is the one layout fact about a game the host needs.
const Map<String, double> _gameHeights = {
  'TREX_RUNNER': 200,
  'TIC_TAC_TOE': 400,
  'MEMORY_MATCH': 380,
  'CUB_N_PUP': 440,
  'SNAKE': 400,
  'SPROUT': 420,
};


/// RN `FRAME_STRING_KEYS`: words a bundle draws inside its own WebView, by
/// game. Handed to the frame as `window.__allyGameStrings` before the
/// document runs, so the first paint is in the learner's language. The
/// values are templates for the bundle to fill (`{{moves}}`), so they are
/// looked up without interpolation. A bundle falls back to its own English
/// when a game has no entry.
const Map<String, Map<String, String>> gameFrameStringKeys = {
  'MEMORY_MATCH': {
    'moves': 'courses.game.frameStrings.MEMORY_MATCH.moves',
    'restart': 'courses.game.frameStrings.MEMORY_MATCH.restart',
    'wonTitle': 'courses.game.frameStrings.MEMORY_MATCH.wonTitle',
    'wonDetail': 'courses.game.frameStrings.MEMORY_MATCH.wonDetail',
    'playAgain': 'courses.game.frameStrings.MEMORY_MATCH.playAgain',
    'cardLabel': 'courses.game.frameStrings.MEMORY_MATCH.cardLabel',
  },
  'CUB_N_PUP': {
    'levels': 'courses.game.frameStrings.CUB_N_PUP.levels',
    'close': 'courses.game.frameStrings.CUB_N_PUP.close',
    'nextLevel': 'courses.game.frameStrings.CUB_N_PUP.nextLevel',
    'solved': 'courses.game.frameStrings.CUB_N_PUP.solved',
    'tutorial': 'courses.game.frameStrings.CUB_N_PUP.tutorial',
    'hintDragToStar': 'courses.game.frameStrings.CUB_N_PUP.hintDragToStar',
    'hintRotate': 'courses.game.frameStrings.CUB_N_PUP.hintRotate',
    'hintFree': 'courses.game.frameStrings.CUB_N_PUP.hintFree',
    'hintPivot': 'courses.game.frameStrings.CUB_N_PUP.hintPivot',
    'hintRotateLink': 'courses.game.frameStrings.CUB_N_PUP.hintRotateLink',
  },
  'SNAKE': {
    'score': 'courses.game.frameStrings.SNAKE.score',
    'best': 'courses.game.frameStrings.SNAKE.best',
    'restart': 'courses.game.frameStrings.SNAKE.restart',
    'gameOver': 'courses.game.frameStrings.SNAKE.gameOver',
  },
  'SPROUT': {
    'pickerLabel': 'courses.game.frameStrings.SPROUT.pickerLabel',
    'plantSUCCULENT': 'courses.game.frameStrings.SPROUT.plantSUCCULENT',
    'plantMARIGOLD': 'courses.game.frameStrings.SPROUT.plantMARIGOLD',
    'plantFERN': 'courses.game.frameStrings.SPROUT.plantFERN',
    'plantTOMATO': 'courses.game.frameStrings.SPROUT.plantTOMATO',
    'visitorsLabel': 'courses.game.frameStrings.SPROUT.visitorsLabel',
    'hintStart': 'courses.game.frameStrings.SPROUT.hintStart',
    'aimSoil': 'courses.game.frameStrings.SPROUT.aimSoil',
    'aimLeaves': 'courses.game.frameStrings.SPROUT.aimLeaves',
    'aimAway': 'courses.game.frameStrings.SPROUT.aimAway',
    'stateDry': 'courses.game.frameStrings.SPROUT.stateDry',
    'stateGood': 'courses.game.frameStrings.SPROUT.stateGood',
    'stateWet': 'courses.game.frameStrings.SPROUT.stateWet',
    'stage0': 'courses.game.frameStrings.SPROUT.stage0',
    'stage1': 'courses.game.frameStrings.SPROUT.stage1',
    'stage2': 'courses.game.frameStrings.SPROUT.stage2',
    'stage3': 'courses.game.frameStrings.SPROUT.stage3',
    'stage4': 'courses.game.frameStrings.SPROUT.stage4',
    'stage5': 'courses.game.frameStrings.SPROUT.stage5',
    'leafDropped': 'courses.game.frameStrings.SPROUT.leafDropped',
    'leafScorched': 'courses.game.frameStrings.SPROUT.leafScorched',
    'bloomed': 'courses.game.frameStrings.SPROUT.bloomed',
    'plantAnother': 'courses.game.frameStrings.SPROUT.plantAnother',
    'visitorArrived': 'courses.game.frameStrings.SPROUT.visitorArrived',
    'visitorBEE': 'courses.game.frameStrings.SPROUT.visitorBEE',
    'visitorBUTTERFLY': 'courses.game.frameStrings.SPROUT.visitorBUTTERFLY',
    'visitorLADYBIRD': 'courses.game.frameStrings.SPROUT.visitorLADYBIRD',
  },
};

/// The bridge shim plus (when the game has [gameFrameStringKeys]) the
/// translated strings, as one `<script>` to run before the bundle's own.
/// RN does this with `injectedJavaScriptBeforeContentLoaded`;
/// `webview_flutter` has no such hook, so it is prepended to the document.
/// `jsonEncode` keeps a quote or newline in a translation from breaking out.
String gameBootstrapScript(Map<String, String>? strings) {
  final buffer = StringBuffer('<script>')
    ..write(
      'if (window.AllyGameChannel && !window.ReactNativeWebView) {'
      'window.ReactNativeWebView = {postMessage: function(d) { AllyGameChannel.postMessage(d); }};'
      '}',
    );
  if (strings != null) buffer.write('window.__allyGameStrings = ${jsonEncode(strings)};');
  buffer.write('</script>');
  return buffer.toString();
}

/// Inserts [script] at the start of the document's `<head>` (or before
/// everything when there is none), so it runs before any bundle script.
String injectBeforeContent(String html, String script) {
  final head = RegExp(r'<head[^>]*>', caseSensitive: false).firstMatch(html);
  if (head != null) return html.replaceRange(head.end, head.end, script);
  return '$script$html';
}

/// Port of ally-mobile (React Native)'s `GamePlayer` — renders a
/// self-contained HTML5 game bundle in a WebView.
///
/// The bundle is the same file the web app serves from its
/// `public/games/` directory, and it detects its host at runtime: it posts
/// to `window.ReactNativeWebView` if present, `window.parent` otherwise.
/// `webview_flutter`'s own bridge is a named `JavaScriptChannel`
/// (`object.postMessage(string)`), not a `window.ReactNativeWebView`
/// global, so this player injects a one-line shim once the page finishes
/// loading that defines `window.ReactNativeWebView.postMessage` in terms
/// of the real channel — same approach as the RN host, just aimed at a
/// different bridge object. The shim only needs to exist by the time the
/// learner actually finishes a run (the bundle's own synchronous "ready"
/// ping fires during initial parse, before this can run, and is dropped
/// the same way it would be in a browser tab with no parent listening —
/// harmless, since nothing here depends on it).
///
/// A game completes server-side the moment it's opened — this reports
/// `onCompleted` on mount (matching the RN screen's own comment: "Next is
/// live before the learner has touched the game") and records a run's
/// score as a possible personal best, which is a fire-and-forget: a lost
/// personal best is not worth surfacing an error for.
class GamePlayer extends ConsumerStatefulWidget {
  const GamePlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.onCompleted,
  });

  final StartItemPayload payload;
  final String itemId;
  final void Function(TrackItemCompletionResult result) onCompleted;

  @override
  ConsumerState<GamePlayer> createState() => _GamePlayerState();
}

class _GamePlayerState extends ConsumerState<GamePlayer> {
  WebViewController? _controller;
  int? _bestScore;
  int? _lastScore;
  bool _unsupported = false;

  @override
  void initState() {
    super.initState();
    _bestScore = widget.payload.gameBestScore;
    // The server already completed this item by the time startTrackItem
    // returned — tell the player immediately so Next unlocks. Deferred to
    // a post-frame callback rather than called synchronously here: the
    // parent (`CourseItemPlayerScreenState`)'s `onCompleted` calls its own
    // `setState()`, and calling that synchronously from this child's
    // `initState` — i.e. while the parent is still partway through
    // mounting the tree it just built, not itself "currently building" —
    // throws "setState() or markNeedsBuild() called during build" (found
    // via widget testing; see game_player_test.dart). A post-frame
    // callback still fires effectively immediately (before the next
    // frame), just safely outside the build phase.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.onCompleted(
          widget.payload.gameCompletion ??
              TrackItemCompletionResult(
                completed: true,
                sectionCompleted: false,
                trackCompleted: false,
              ),
        );
      }
    });
    _loadGame();
  }

  Future<void> _loadGame() async {
    final gameKey = widget.payload.gameKey;
    final assetPath = _gameAssetPaths[gameKey];
    if (assetPath == null) {
      setState(() => _unsupported = true);
      return;
    }
    final rawHtml = await rootBundle.loadString(assetPath);
    if (!mounted) return;
    final keys = gameFrameStringKeys[gameKey];
    final strings = keys == null ? null : {for (final e in keys.entries) e.key: ref.tr(e.value)};
    final html = injectBeforeContent(rawHtml, gameBootstrapScript(strings));
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'AllyGameChannel',
        onMessageReceived: _handleMessage,
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            // Required for `source={{html}}`-equivalent loads — the
            // bundle has no reach into the app beyond this one shim.
            _controller?.runJavaScript(
              'window.ReactNativeWebView = {'
              'postMessage: function(data) { AllyGameChannel.postMessage(data); }'
              '};',
            );
          },
        ),
      )
      ..setBackgroundColor(Colors.white)
      ..loadHtmlString(html);
    if (mounted) setState(() => _controller = controller);
  }

  void _handleMessage(JavaScriptMessage message) {
    final Map<String, dynamic> data;
    try {
      data = Map<String, dynamic>.from(jsonDecode(message.message) as Map);
    } catch (_) {
      return;
    }
    if (data['source'] != 'ally-game') return;
    if (data['type'] == 'over' && data['score'] is num) {
      final score = (data['score'] as num).toInt();
      setState(() {
        _lastScore = score;
        if (_bestScore == null || score > _bestScore!) _bestScore = score;
      });
      ref
          .read(coursesRepositoryProvider)
          .recordGameResult(itemId: widget.itemId, score: score)
          .catchError((_) => score);
    }
  }

  @override
  Widget build(BuildContext context) {
    final gameKey = widget.payload.gameKey;
    final height = _gameHeights[gameKey];

    if (_unsupported || height == null) {
      // styles.unsupported: centred column, gap 12, paddingHorizontal 24.
      return Center(
        key: const Key('game-unsupported'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                ref.t('courses.player.unsupportedTitle'),
                textAlign: TextAlign.center,
                style: CourseText.serif(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
              ),
              const SizedBox(height: 12),
              Text(
                ref.t('courses.player.unsupportedBody'),
                textAlign: TextAlign.center,
                style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
              ),
            ],
          ),
        ),
      );
    }

    final small = CourseText.serif(CourseType.bodySmall, AppColors.mediumEmphasis);
    // styles.content: flexGrow 1, centred, gap 12, padding 16.
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        key: const Key('game-player'),
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: (constraints.maxHeight - 32).clamp(0, double.infinity)),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: withGap<Widget>([
              if ((widget.payload.gameIntro ?? '').isNotEmpty)
                Text(
                  widget.payload.gameIntro!,
                  textAlign: TextAlign.center,
                  style: CourseText.serif(CourseType.bodyMedium, AppColors.mediumEmphasis),
                ),
              // styles.frame: full width, radius 12, white.
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: double.infinity,
                  height: height,
                  color: Colors.white,
                  child: _controller == null
                      ? const Center(child: CircularProgressIndicator())
                      : WebViewWidget(
                          controller: _controller!,
                          // Nested inside the SingleChildScrollView below, so
                          // without this a drag starting on the game canvas
                          // (rotating CUB_N_PUP's puzzle, dragging SPROUT's
                          // plant, swiping SNAKE) loses the gesture arena to
                          // that scroll view's own vertical drag recognizer
                          // and never reaches the WebView at all — RN's host
                          // doesn't hit this (it disables the WebView's own
                          // internal scrolling instead, a native-side knob
                          // webview_flutter has no equivalent of), but the
                          // framework's own documented fix for "parent
                          // Scrollable claims the drag before a nested
                          // platform view sees it" is an eager recognizer.
                          gestureRecognizers: {
                            Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
                          },
                        ),
                ),
              ),
              Text(ref.t('courses.game.controlsTouch.$gameKey'), textAlign: TextAlign.center, style: small),
              if (_lastScore != null || _bestScore != null)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: withGap<Widget>([
                    if (_lastScore != null)
                      Text(ref.t('courses.game.lastScore.$gameKey', {'score': _lastScore}), style: small),
                    if (_bestScore != null)
                      Text(
                        ref.t('courses.game.bestScore.$gameKey', {'score': _bestScore}),
                        style: CourseText.serif(CourseType.bodySmall, AppColors.highEmphasis, weight: FontWeight.w500),
                      ),
                  ], () => const SizedBox(width: 16)),
                ),
              Text(ref.t('courses.game.optional'), textAlign: TextAlign.center, style: small),
            ], () => const SizedBox(height: 12)),
          ),
        ),
      ),
    );
  }
}
