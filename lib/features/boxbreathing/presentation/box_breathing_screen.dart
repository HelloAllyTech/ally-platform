import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import 'flower_petal_painter.dart';

/// Direct port of ally-mobile (React Native)'s `BreathingScreen`/
/// `BoxBreathingAnimation` — a dot travels to each of the 4 corners of a
/// square (one per phase, in order: Hold "one" top-left, Inhale "two"
/// top-right, Hold "three" bottom-right, Exhale "four" bottom-left, then
/// back to "one"), with a 5-petal flower blooming open in the center during
/// Inhale/the Hold that follows it and closing during Exhale/the Hold that
/// follows that. Every phase lasts the same fixed 4 seconds (RN's
/// `animationDuration` prop, always 4000ms regardless of the `phases`
/// array's own per-phase `time` field — confirmed by reading the real
/// component: that field isn't wired to any actual timing).
///
/// RN's own first-render effect advances the phase index immediately on
/// mount (before the user ever perceives the initial "one"/Hold state), so
/// the cycle is effectively always first observed starting on Inhale —
/// matched here by simply starting `_phase` there directly.
///
/// Not ported: the call-flow integration (a 3s `CallEndOverlay` shown
/// first, a "View Call Summary" button, hardware-back resetting to
/// CallLog) — this screen has no real entry point yet in this app (no
/// screen currently pushes `/box-breathing`), so there's no live call
/// context to integrate with. The breathing sound effect (RN loops an audio
/// asset via `SoundPlayer`, restarting it every time Inhale begins) is also
/// not ported — this app has no audio-playback package yet, same blocker as
/// the Review screens' missing audio player. Mute has no actual audio
/// effect in RN either when there's no sound playing to mute, so it's kept
/// as the same decorative icon toggle it already was.
///
/// Also a deliberate, pre-existing choice kept as-is: RN's own pause effect
/// resets the phase/dot/flower all the way back to the very first "one"
/// phase the instant playback pauses, rather than freezing mid-animation —
/// this reads as an artifact of how that effect was written (nothing in the
/// PRD calls for losing progress on pause) rather than an intentional
/// product decision, so this keeps the already-tested freeze-in-place pause
/// behavior instead of reproducing it.
class BoxBreathingScreen extends ConsumerStatefulWidget {
  const BoxBreathingScreen({super.key});

  @override
  ConsumerState<BoxBreathingScreen> createState() => _BoxBreathingScreenState();
}

enum _Phase { holdA, inhale, holdB, exhale }

class _BoxBreathingScreenState extends ConsumerState<BoxBreathingScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _controller;
  _Phase _phase = _Phase.inhale;
  bool _isPlaying = true;
  bool _isMuted = false;
  int _seconds = 1;
  Timer? _countdownTimer;

  static const _phaseDuration = Duration(seconds: 4);
  static const _dotSize = 14.0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = AnimationController(vsync: this, duration: _phaseDuration)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          setState(() => _phase = _Phase.values[(_phase.index + 1) % 4]);
          _restartCountdown();
          _controller
            ..reset()
            ..forward();
        }
      })
      ..forward();
    _restartCountdown();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _countdownTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  /// Backgrounding the app (screen lock, switching apps) pauses playback,
  /// same as RN's `AppState.addEventListener('change', ...)` handler.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      if (_isPlaying) _setPlaying(false);
    }
  }

  void _restartCountdown() {
    _countdownTimer?.cancel();
    setState(() => _seconds = 1);
    if (!_isPlaying) return;
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_seconds >= 4) {
        timer.cancel();
        return;
      }
      setState(() => _seconds++);
    });
  }

  void _setPlaying(bool playing) {
    setState(() => _isPlaying = playing);
    if (playing) {
      _controller.forward();
      _restartCountdown();
    } else {
      _controller.stop();
      _countdownTimer?.cancel();
    }
  }

  _Phase _predecessor(_Phase phase) => _Phase.values[(phase.index - 1 + 4) % 4];

  /// The dot's corner, as a 0..1-normalized (left, top) pair over the
  /// square — matches RN's `position: {top, left}` per phase exactly.
  Offset _cornerFor(_Phase phase) => switch (phase) {
    _Phase.holdA => const Offset(0, 0),
    _Phase.inhale => const Offset(1, 0),
    _Phase.holdB => const Offset(1, 1),
    _Phase.exhale => const Offset(0, 1),
  };

  double _bloomTargetFor(_Phase phase) => switch (phase) {
    _Phase.holdA => 0,
    _Phase.inhale => 1,
    _Phase.holdB => 1,
    _Phase.exhale => 0,
  };

  String _phaseLabel(_Phase phase) {
    switch (phase) {
      case _Phase.inhale:
        return ref.t('boxBreathing.phaseInhale');
      case _Phase.holdA:
      case _Phase.holdB:
        return ref.t('boxBreathing.phaseHold');
      case _Phase.exhale:
        return ref.t('boxBreathing.phaseExhale');
    }
  }

  @override
  Widget build(BuildContext context) {
    final startCorner = _cornerFor(_predecessor(_phase));
    final endCorner = _cornerFor(_phase);
    final startBloom = _bloomTargetFor(_predecessor(_phase));
    final endBloom = _bloomTargetFor(_phase);

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('boxBreathing.title'))),
      body: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                // RN's own `min(SCREEN_WIDTH * 0.8, 350)` is purely
                // width-based and assumes a tall portrait phone screen —
                // also bounded by the actually available height here so a
                // short viewport (a small/landscape device, or this
                // screen's own label + countdown text above/below it)
                // never overflows the column.
                final widthBudget = (MediaQuery.of(context).size.width * 0.8).clamp(0, 350).toDouble();
                final heightBudget = (constraints.maxHeight - 160).clamp(80, 350).toDouble();
                final squareSize = math.min(widthBudget, heightBudget);
                final flowerSize = squareSize * 0.8 < 280 ? squareSize * 0.8 : 280.0;
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_phaseLabel(_phase), style: Theme.of(context).textTheme.headlineSmall),
                      const SizedBox(height: 24),
                      SizedBox(
                        width: squareSize,
                        height: squareSize,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            border: Border.all(color: const Color(0xFF555555), width: 2),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: AnimatedBuilder(
                            animation: _controller,
                            builder: (context, child) {
                              final progress = Curves.linear.transform(_controller.value);
                              final position = Offset.lerp(startCorner, endCorner, progress)!;
                              final bloom = startBloom + (endBloom - startBloom) * progress;
                              return Stack(
                                clipBehavior: Clip.none,
                                alignment: Alignment.center,
                                children: [
                                  SizedBox(
                                    width: flowerSize,
                                    height: flowerSize,
                                    child: CustomPaint(painter: FlowerPetalPainter(bloomProgress: bloom)),
                                  ),
                                  Positioned(
                                    left: position.dx * squareSize - _dotSize / 2,
                                    top: position.dy * squareSize - _dotSize / 2,
                                    child: Container(
                                      key: const ValueKey('box-breathing-dot'),
                                      width: _dotSize,
                                      height: _dotSize,
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        shape: BoxShape.circle,
                                        boxShadow: [
                                          BoxShadow(
                                            color: Colors.white.withValues(alpha: 0.5),
                                            blurRadius: 8,
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                      ),
                      const SizedBox(height: 32),
                      Text('$_seconds', style: Theme.of(context).textTheme.displayMedium),
                    ],
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 40),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _ControlButton(
                  icon: _isMuted ? Icons.volume_off : Icons.volume_up,
                  onPressed: () => setState(() => _isMuted = !_isMuted),
                ),
                const SizedBox(width: 20),
                _ControlButton(
                  icon: _isPlaying ? Icons.pause : Icons.play_arrow,
                  onPressed: () => _setPlaying(!_isPlaying),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFE0E0E0),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox(width: 56, height: 56, child: Icon(icon)),
      ),
    );
  }
}
