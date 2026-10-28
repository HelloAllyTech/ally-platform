import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../data/simulations_repository.dart';

/// The "⚡ 23/120" credits read-out RN draws in two places with identical
/// styles: `SimulationsScreen`'s `renderCreditsDisplay` and
/// `LearningPathHeader`'s `credits` slot. Credits USED (bold) over the limit
/// (small), turning red once [SimulationCredits.isLow]. Renders nothing until
/// the credits have loaded (RN: `if (!credits) return null`).
///
/// No permission gate here: RN only fetches credits for users with
/// `edit:scenario-session`, and every screen showing this sits behind the
/// Learn tab, which requires that same permission.
class CreditsDisplay extends ConsumerWidget {
  const CreditsDisplay({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final credits = ref.watch(simulationCreditsProvider).value;
    if (credits == null) return const SizedBox.shrink();

    return Row(
      key: const Key('credits-display'),
      mainAxisSize: MainAxisSize.min,
      children: [
        // RN: <BoltIcon width={14} height={14} /> (11x16 viewBox, contained).
        SizedBox(
          width: 14,
          height: 14,
          child: SvgPicture.asset('assets/icons/bolt.svg'),
        ),
        const SizedBox(width: 4),
        Text.rich(
          TextSpan(
            // styles.creditText: IBM_PLEX_SERIF.MEDIUM + display.small,
            // red[300] when low (RN's default text colour otherwise).
            text: '${credits.consumedCredits}',
            style: TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 18,
              height: 24 / 18,
              letterSpacing: 0.18,
              fontWeight: FontWeight.w500,
              color: credits.isLow ? AppColors.softCoralRed : Colors.black,
            ),
            children: [
              // styles.creditLimitText: body.tiny, darkGray; nested, so it
              // keeps the parent's family.
              TextSpan(
                text: '/${credits.creditLimit}',
                style: const TextStyle(
                  fontSize: 10,
                  height: 14 / 10,
                  letterSpacing: 0.3,
                  color: AppColors.darkGray,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
