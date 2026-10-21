import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';

/// Scoped port of ally-mobile (React Native)'s `BreathingScreen`/
/// `BoxBreathingAnimation` — a 4-phase breathing guide animation with
/// play/pause/mute controls and a per-phase 1-4 numeric countdown. Each
/// phase lasts a fixed 4 seconds (RN's `animationDuration` prop, always
/// 4000ms regardless of the `phases` array's own per-phase `time` field —
/// confirmed by reading the real component: that field isn't wired to any
/// actual timing, so the uniform 4-4-4-4 cadence this already used was
/// correct, not a bug).
///
/// Not ported: the call-flow integration (a 3s `CallEndOverlay` shown
/// first, a "View Call Summary" button, hardware-back resetting to
/// CallLog) — this screen has no real entry point yet in this app (no
/// screen currently pushes `/box-breathing`), so there's no live call
/// context to integrate with. Mute has no actual audio effect in RN
/// either (its own comment: "Mute doesn't affect Lottie") — ported as the
/// same decorative icon toggle, not a functional no-op gap.
class BoxBreathingScreen extends ConsumerStatefulWidget {
  const BoxBreathingScreen({super.key});

  @override
  ConsumerState<BoxBreathingScreen> createState() => _BoxBreathingScreenState();
}

enum _Phase { inhale, holdIn, exhale, holdOut }

class _BoxBreathingScreenState extends ConsumerState<BoxBreathingScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _controller;
  _Phase _phase = _Phase.inhale;
  bool _isPlaying = true;
  bool _isMuted = false;
  int _seconds = 1;
  Timer? _countdownTimer;

  static const _phaseDuration = Duration(seconds: 4);

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

  double get _targetScale {
    switch (_phase) {
      case _Phase.inhale:
        return 1.0;
      case _Phase.holdIn:
        return 1.0;
      case _Phase.exhale:
        return 0.5;
      case _Phase.holdOut:
        return 0.5;
    }
  }

  double get _startScale {
    switch (_phase) {
      case _Phase.inhale:
        return 0.5;
      case _Phase.holdIn:
        return 1.0;
      case _Phase.exhale:
        return 1.0;
      case _Phase.holdOut:
        return 0.5;
    }
  }

  String _phaseLabel(_Phase phase) {
    switch (phase) {
      case _Phase.inhale:
        return ref.t('boxBreathing.phaseInhale');
      case _Phase.holdIn:
      case _Phase.holdOut:
        return ref.t('boxBreathing.phaseHold');
      case _Phase.exhale:
        return ref.t('boxBreathing.phaseExhale');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(ref.t('boxBreathing.title'))),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, child) {
                  final scale = _startScale + (_targetScale - _startScale) * _controller.value;
                  return Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Stack(
                        alignment: Alignment.center,
                        children: [
                          Transform.scale(
                            scale: scale,
                            child: Container(
                              width: 180,
                              height: 180,
                              decoration: BoxDecoration(
                                color: Theme.of(context).colorScheme.primaryContainer,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          Text('$_seconds', style: Theme.of(context).textTheme.displayMedium),
                        ],
                      ),
                      const SizedBox(height: 32),
                      Text(_phaseLabel(_phase), style: Theme.of(context).textTheme.headlineSmall),
                    ],
                  );
                },
              ),
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
