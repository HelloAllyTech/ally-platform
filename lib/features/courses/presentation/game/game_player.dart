import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';

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
  final VoidCallback onCompleted;

  @override
  ConsumerState<GamePlayer> createState() => _GamePlayerState();
}

class _GamePlayerState extends ConsumerState<GamePlayer> {
  WebViewController? _controller;
  int? _bestScore;
  int? _lastScore;
  String? _loadError;

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
      if (mounted) widget.onCompleted();
    });
    _loadGame();
  }

  Future<void> _loadGame() async {
    final gameKey = widget.payload.gameKey;
    final assetPath = _gameAssetPaths[gameKey];
    if (assetPath == null) {
      setState(() => _loadError = ref.tr('courses.player.unsupportedTitle'));
      return;
    }
    final html = await rootBundle.loadString(assetPath);
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('AllyGameChannel', onMessageReceived: _handleMessage)
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
    final height = _gameHeights[gameKey] ?? 300;

    if (_loadError != null) {
      return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_loadError!)));
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if ((widget.payload.gameIntro ?? '').isNotEmpty) ...[
          Text(
            widget.payload.gameIntro!,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
        ],
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: height,
            child: _controller == null
                ? const Center(child: CircularProgressIndicator())
                : WebViewWidget(controller: _controller!),
          ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (_lastScore != null) ...[
              Text(ref.t('courses.game.lastScore.$gameKey', {'score': _lastScore})),
              const SizedBox(width: 16),
            ],
            if (_bestScore != null)
              Text(ref.t('courses.game.bestScore.$gameKey', {'score': _bestScore})),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          ref.t('courses.game.optional'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
