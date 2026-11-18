import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import 'flower_petal_painter.dart';

/// A small, silent version of the box-breathing flower, for a moment of
/// waiting (the debrief being written). Same flower and the same four 4 s
/// phases as the Scribe breathing screen (hold, inhale, hold, exhale), the
/// same Inhale / Hold / Exhale labels, no countdown and no sound.
///
/// With reduced motion on, nothing animates: the flower stays half open and
/// a calm line is shown instead of the changing label.
class BreathingPacer extends ConsumerStatefulWidget {
  const BreathingPacer({super.key});

  @override
  ConsumerState<BreathingPacer> createState() => _BreathingPacerState();
}

class _BreathingPacerState extends ConsumerState<BreathingPacer>
    with SingleTickerProviderStateMixin {
  static const _phaseSeconds = 4;
  static const _labels = [
    'boxBreathing.phaseInhale',
    'boxBreathing.phaseHold',
    'boxBreathing.phaseExhale',
    'boxBreathing.phaseHold',
  ];

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: _phaseSeconds * 4),
  );
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (!reduceMotion && !_started) {
      _started = true;
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// 0 closed, 1 open: opens over the inhale, stays open, closes over the exhale.
  static double _bloom(double t) {
    final phase = (t * 4).floor().clamp(0, 3);
    final within = (t * 4) - phase;
    final eased = Curves.easeInOutQuad.transform(within);
    return switch (phase) {
      0 => eased,
      1 => 1,
      2 => 1 - eased,
      _ => 0,
    };
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    const flowerSize = 150.0;
    return Container(
      key: const Key('breathing-pacer'),
      height: 250,
      decoration: BoxDecoration(
        color: const Color(0xFF1D2020),
        borderRadius: BorderRadius.circular(12),
      ),
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = _controller.value;
          final label = reduceMotion
              ? 'postSim.debriefCards.working.breatheCalm'
              : _labels[(t * 4).floor().clamp(0, 3)];
          return Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Semantics(
                liveRegion: !reduceMotion,
                child: Text(
                  ref.t(label),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              SizedBox(
                width: flowerSize,
                height: flowerSize,
                child: Transform.translate(
                  offset: const Offset(0, flowerSize * 0.25),
                  child: CustomPaint(
                    size: const Size.square(flowerSize),
                    painter: FlowerPetalPainter(
                      bloomProgress: reduceMotion ? 0.5 : _bloom(t),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
