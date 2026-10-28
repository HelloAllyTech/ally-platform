import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../simulations/data/simulation_models.dart';

/// RN `SessionProgress/constants.ts` `DIFFICULTY_STATE_SCORE_MAP` — score
/// bands per difficulty, one per state (min inclusive, max exclusive).
const _difficultyStateScoreMap = <String, List<({int? min, int? max})>>{
  'EASY': [
    (min: null, max: -50),
    (min: -50, max: 20),
    (min: 20, max: 70),
    (min: 70, max: null),
  ],
  'MEDIUM': [
    (min: null, max: -20),
    (min: -20, max: 50),
    (min: 50, max: 100),
    (min: 100, max: null),
  ],
  'HARD': [
    (min: null, max: -10),
    (min: -10, max: 100),
    (min: 100, max: 200),
    (min: 200, max: null),
  ],
};

/// RN `SessionProgress/utils.ts` `getCurrentStateIndex`: the highest band
/// the score falls in; 0 for an unknown difficulty.
int currentStateIndex(int score, String? difficultyLevel) {
  final bands = _difficultyStateScoreMap[difficultyLevel];
  if (bands == null) return 0;
  for (var i = bands.length - 1; i >= 0; i--) {
    final band = bands[i];
    final meetsMin = band.min == null || score >= band.min!;
    final meetsMax = band.max == null || score < band.max!;
    if (meetsMin && meetsMax) return i;
  }
  return 0;
}

/// Port of RN `SimulationAssistantScreen/components/SessionProgress`: a
/// vertical stepper of the scenario's `stateNames` on `#1d2020` — a dot per
/// state (14 active, 10 otherwise; `#57f646` active/completed, `#3D4045`
/// ahead), a 2-wide connector to the next row (green once completed), and
/// the state name in Roboto 12/16.
class SessionProgress extends StatelessWidget {
  const SessionProgress({
    super.key,
    required this.stateNames,
    required this.difficultyLevel,
    required this.score,
  });

  final List<StateInstruction> stateNames;
  final String? difficultyLevel;
  final int score;

  @override
  Widget build(BuildContext context) {
    if (stateNames.isEmpty) return const SizedBox.shrink();
    final rn = RnSize.of(context);
    final current = currentStateIndex(score, difficultyLevel);
    return Container(
      key: const ValueKey('session-progress'),
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1D2020),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < stateNames.length; i++)
            _row(
              rn,
              stateNames[i],
              isActive: i == current,
              isCompleted: i < current,
              isLast: i == stateNames.length - 1,
            ),
        ],
      ),
    );
  }

  Widget _row(
    RnSize rn,
    StateInstruction state, {
    required bool isActive,
    required bool isCompleted,
    required bool isLast,
  }) {
    final dotSize = isActive ? 14.0 : 10.0;
    final dotColor = isActive || isCompleted
        ? AppColors.callGreen
        : AppColors.callDivider;
    final labelColor = isActive
        ? AppColors.callGreen
        : isCompleted
        ? AppColors.infoTabInactive
        : AppColors.lightGray6B;
    final bottom = isLast ? 0.0 : rn.vs(10);
    return Stack(
      key: ValueKey('session-progress-state-${state.stateId}'),
      clipBehavior: Clip.none,
      children: [
        // RN `connector`: left 6, from the row's middle down past its
        // bottom padding into the next row.
        if (!isLast)
          Positioned(
            left: 6,
            width: 2,
            top: 0,
            bottom: -bottom,
            child: LayoutBuilder(
              builder: (context, c) => Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  height: c.maxHeight / 2 + bottom / 2,
                  color: isCompleted
                      ? AppColors.callGreen
                      : AppColors.callDivider,
                ),
              ),
            ),
          ),
        Padding(
          padding: EdgeInsets.only(bottom: bottom),
          child: Row(
            children: [
              Container(
                key: ValueKey('session-progress-dot-${state.stateId}'),
                width: dotSize,
                height: dotSize,
                decoration: BoxDecoration(
                  color: dotColor,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  state.name,
                  style: TextStyle(
                    fontFamily: AppFonts.robotoRegular,
                    fontSize: 12,
                    height: 16 / 12,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                    color: labelColor,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
