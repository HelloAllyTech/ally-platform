import 'package:flutter/material.dart';

/// Scoped port of ally-mobile (React Native)'s `BoxBreathingScreen` — a
/// 4-phase (inhale/hold/exhale/hold) breathing guide animation, no backend
/// calls. The original's exact timing/copy per phase and session-length
/// configuration aren't verified against the RN source line-by-line here;
/// this reproduces the standard 4-4-4-4 box-breathing pattern.
class BoxBreathingScreen extends StatefulWidget {
  const BoxBreathingScreen({super.key});

  @override
  State<BoxBreathingScreen> createState() => _BoxBreathingScreenState();
}

enum _Phase { inhale, holdIn, exhale, holdOut }

const _phaseLabel = {
  _Phase.inhale: 'Breathe in',
  _Phase.holdIn: 'Hold',
  _Phase.exhale: 'Breathe out',
  _Phase.holdOut: 'Hold',
};

class _BoxBreathingScreenState extends State<BoxBreathingScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  _Phase _phase = _Phase.inhale;

  static const _phaseDuration = Duration(seconds: 4);

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _phaseDuration)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          setState(() => _phase = _Phase.values[(_phase.index + 1) % 4]);
          _controller
            ..reset()
            ..forward();
        }
      })
      ..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Box breathing')),
      body: Center(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            final scale = _startScale + (_targetScale - _startScale) * _controller.value;
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
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
                const SizedBox(height: 32),
                Text(_phaseLabel[_phase]!, style: Theme.of(context).textTheme.headlineSmall),
              ],
            );
          },
        ),
      ),
    );
  }
}
