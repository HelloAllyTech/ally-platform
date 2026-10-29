import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';

/// Direct port of RN's `SessionScoreMeter` — a 5-segment horizontal gauge
/// (red → grey → green) with a pointer that slides to the current [score],
/// clamped to [-100, 100] matching RN's own clamp exactly.
///
/// Segment colors are this app's nearest approximations of RN's named
/// theme colors (`tomatoRed`/`salmonRed`/`platinumGray`/`sageGreen`/
/// `jadeGreen`), which aren't ported as their own tokens yet — the gauge's
/// actual shape/behavior (segment count, clamp range, pointer animation) is
/// the real RN fidelity, not the literal hex values.
class SessionScoreMeter extends ConsumerWidget {
  const SessionScoreMeter({super.key, required this.score});

  final int score;

  static const _colors = [
    Color(0xFFE53935), // tomato red
    Color(0xFFEF9A9A), // salmon red
    Color(0xFFBDBDBD), // platinum gray
    Color(0xFFA5D6A7), // sage green
    Color(0xFF2E7D32), // jade green
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clamped = score.clamp(-100, 100);
    final fraction = (clamped + 100) / 200;
    final segmentIndex = (fraction * _colors.length).floor().clamp(0, _colors.length - 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(ref.t('simulationPage.simulationScore'), style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 6),
        LayoutBuilder(
          builder: (context, constraints) {
            return SizedBox(
              height: 20,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Row(
                    children: [
                      for (final color in _colors)
                        Expanded(
                          child: Container(height: 8, color: color),
                        ),
                    ],
                  ),
                  AnimatedPositioned(
                    key: const ValueKey('score-meter-pointer'),
                    duration: const Duration(milliseconds: 240),
                    curve: Curves.easeInOut,
                    left: (fraction * constraints.maxWidth - 8).clamp(0, constraints.maxWidth - 16),
                    top: -4,
                    child: Container(
                      width: 16,
                      height: 16,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _colors[segmentIndex],
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}
