import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/start_item_payload.dart';

enum _Phase { inhale, holdIn, exhale, holdOut }

/// Direct port of ally-mobile (React Native)'s `BreathingExerciseScreen` —
/// a dot traces the 4 edges of a square (inhale: top-left→top-right, hold:
/// →bottom-right, exhale: →bottom-left, hold: →top-left), one edge per
/// phase, each edge's travel time set by that phase's own configured
/// duration (so unlike `BoxBreathingScreen`'s uniform 4s cadence, these
/// phases can genuinely differ in length). Runs `config.cycles` times, then
/// simply stops on the finished edge — RN's own component comment notes
/// the PRD never specifies behavior after the last cycle beyond "the
/// learner can leave at any point", so this matches that exactly rather
/// than inventing an end screen.
class BreathingExerciseScreen extends ConsumerStatefulWidget {
  const BreathingExerciseScreen({super.key, required this.config});

  final BreathingExerciseContent config;

  @override
  ConsumerState<BreathingExerciseScreen> createState() => _BreathingExerciseScreenState();
}

class _BreathingExerciseScreenState extends ConsumerState<BreathingExerciseScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  _Phase _phase = _Phase.inhale;
  int _cycle = 1;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _advance();
      });
    WidgetsBinding.instance.addPostFrameCallback((_) => _runPhase(_Phase.inhale, 1));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Duration _durationFor(_Phase phase) {
    final seconds = switch (phase) {
      _Phase.inhale => widget.config.inhaleSeconds,
      _Phase.holdIn => widget.config.holdInSeconds,
      _Phase.exhale => widget.config.exhaleSeconds,
      _Phase.holdOut => widget.config.holdOutSeconds,
    };
    return Duration(milliseconds: (seconds * 1000).round());
  }

  _Phase _nextPhase(_Phase phase) => switch (phase) {
    _Phase.inhale => _Phase.holdIn,
    _Phase.holdIn => _Phase.exhale,
    _Phase.exhale => _Phase.holdOut,
    _Phase.holdOut => _Phase.inhale,
  };

  void _runPhase(_Phase phase, int cycle) {
    if (cycle > widget.config.cycles) return;
    setState(() {
      _phase = phase;
      _cycle = cycle;
    });
    _controller
      ..duration = _durationFor(phase)
      ..forward(from: 0);
  }

  void _advance() {
    final next = _nextPhase(_phase);
    final nextCycle = _phase == _Phase.holdOut ? _cycle + 1 : _cycle;
    _runPhase(next, nextCycle);
  }

  /// The dot's corner-to-corner travel for the current phase, as a
  /// 0..1-normalized (x, y) pair over the square — multiplied by the real
  /// square size at paint time.
  (Offset start, Offset end) _edgeFor(_Phase phase) => switch (phase) {
    _Phase.inhale => (const Offset(0, 0), const Offset(1, 0)),
    _Phase.holdIn => (const Offset(1, 0), const Offset(1, 1)),
    _Phase.exhale => (const Offset(1, 1), const Offset(0, 1)),
    _Phase.holdOut => (const Offset(0, 1), const Offset(0, 0)),
  };

  String _instructionFor(_Phase phase) => switch (phase) {
    _Phase.inhale => widget.config.inhaleText,
    _Phase.holdIn => widget.config.holdInText,
    _Phase.exhale => widget.config.exhaleText,
    _Phase.holdOut => widget.config.holdOutText,
  };

  @override
  Widget build(BuildContext context) {
    final squareSize = (MediaQuery.of(context).size.width * 0.8).clamp(0, 300).toDouble();
    const dotSize = 20.0;
    final (start, end) = _edgeFor(_phase);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: TextButton(
                  onPressed: () => context.pop(),
                  child: Text(
                    ref.t('courses.player.exit'),
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      color: AppColors.primary,
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Text(
                        _instructionFor(_phase),
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontFamily: AppFonts.ibmPlexSerifMedium,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                    ),
                    const SizedBox(height: 40),
                    SizedBox(
                      key: const ValueKey('breathing-square'),
                      width: squareSize,
                      height: squareSize,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          border: Border.all(color: AppColors.lightGray2, width: 2),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: AnimatedBuilder(
                          animation: _controller,
                          builder: (context, child) {
                            final progress = Curves.linear.transform(_controller.value);
                            final position = Offset.lerp(start, end, progress)!;
                            return Stack(
                              clipBehavior: Clip.none,
                              children: [
                                Positioned(
                                  left: position.dx * squareSize - dotSize / 2,
                                  top: position.dy * squareSize - dotSize / 2,
                                  child: const _BreathingDot(size: dotSize),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 40),
                    Text(
                      ref.t('courses.breathing.cycleProgress', {
                        'current': _cycle.clamp(0, widget.config.cycles),
                        'total': widget.config.cycles,
                      }),
                      style: const TextStyle(color: AppColors.mediumEmphasis),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BreathingDot extends StatelessWidget {
  const _BreathingDot({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('breathing-dot'),
      width: size,
      height: size,
      decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
    );
  }
}
