import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/widgets/app_button.dart';
import '../../../../core/widgets/app_empty_state.dart';
import '../../../../core/widgets/back_title_header.dart';
import '../../../../core/widgets/html_rich_text.dart';
import 'credits_display.dart';
import '../../../../core/widgets/sized_network_image.dart';

/// RN's `components/LearningPathDetails/LearningPathHeader.tsx` — back arrow,
/// a single ReplayPro title, and (for case/path screens) the credits read-out
/// pushed to the right. Same box as SimulationDetailsScreen's header but with
/// a `stroke.primary` divider.
class LearningPathHeader extends StatelessWidget {
  const LearningPathHeader({
    super.key,
    required this.title,
    this.showCredits = false,
    this.onBack,
  });

  final String title;
  final bool showCredits;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return BackTitleHeader(
      title: title,
      onBack: onBack,
      borderColor: AppColors.strokePrimary,
      trailing: showCredits ? const CreditsDisplay() : null,
    );
  }
}

/// RN's `<EmptyState icon={DataUnavailableIcon} title=… />` as the
/// course/case/path screens show it on a failed load: top-aligned, centred.
class LearningPathLoadError extends StatelessWidget {
  const LearningPathLoadError({super.key, required this.title, this.description});

  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: AppEmptyState(
        icon: SvgPicture.asset('assets/icons/dataUnavailable.svg'),
        title: title,
        description: description,
      ),
    );
  }
}

/// RN's `ActivityIndicator size="large" color={theme.primary}` loading state.
class LearningPathLoading extends StatelessWidget {
  const LearningPathLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      key: Key('activity-indicator'),
      child: CircularProgressIndicator(color: AppColors.primary),
    );
  }
}

/// RN's `components/LearningPathDetails/ProgressBar.tsx`: a 6px rounded
/// track (grey200) with a primary fill (green400 once complete) and
/// "X of Y completed" inline to its right.
class LearningPathProgressBar extends ConsumerWidget {
  const LearningPathProgressBar({super.key, required this.current, required this.total});

  final int current;
  final int total;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fraction = total > 0 ? (current / total).clamp(0.0, 1.0) : 0.0;
    return Row(
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: Container(
              height: 6,
              color: AppColors.grey200,
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: fraction,
                heightFactor: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: current >= total ? AppColors.green400 : AppColors.primary,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          ref.t('simulations.progressCompleted', {'current': current, 'total': total}),
          // styles.progressText: IBM_PLEX_SERIF.REGULAR + body.tiny.
          style: const TextStyle(
            fontFamily: AppFonts.ibmPlexSerifRegular,
            fontSize: 10,
            height: 14 / 10,
            letterSpacing: 0.3,
            color: AppColors.mediumEmphasis,
          ),
        ),
      ],
    );
  }
}

/// RN's `components/LearningPathDetails/LearningPathListHeader.tsx` — the
/// list header of CourseOverview, CaseDetails and SimulationPathDetails:
/// cover (only when set), centred title, rich-text description, progress bar
/// once something is done (a bordered tappable card with a chevron and hint
/// when [onProgressTap] is given, otherwise a plain 60%-wide bar), and the
/// Start/Continue button until complete. Children are spaced 12 apart.
class LearningPathListHeader extends ConsumerWidget {
  const LearningPathListHeader({
    super.key,
    required this.title,
    required this.description,
    required this.coverImageUrl,
    required this.completed,
    required this.total,
    required this.isCompleted,
    required this.startButtonLabel,
    required this.onStart,
    required this.isStartDisabled,
    required this.isLoading,
    this.onProgressTap,
  });

  final String? title;
  final String? description;
  final String? coverImageUrl;
  final int completed;
  final int total;
  final bool isCompleted;
  final String startButtonLabel;
  final VoidCallback onStart;
  final bool isStartDisabled;
  final bool isLoading;
  final VoidCallback? onProgressTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cover = coverImageUrl;
    final showProgress = completed > 0 && total > 0;
    final hasDescription = description != null && description!.trim().isNotEmpty;

    final content = <Widget>[
      // styles.pathTitle: IBM_PLEX_SERIF.MEDIUM + display.small, centred.
      Text(
        title ?? '',
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifMedium,
          fontSize: 18,
          height: 24 / 18,
          letterSpacing: 0.18,
          fontWeight: FontWeight.w500,
          color: AppColors.highEmphasis,
        ),
      ),
      if (hasDescription) HtmlRichText(html: description),
      if (showProgress)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: onProgressTap != null
              ? _TappableProgress(
                  completed: completed,
                  total: total,
                  onTap: onProgressTap!,
                )
              : Center(
                  child: FractionallySizedBox(
                    widthFactor: 0.6,
                    child: LearningPathProgressBar(current: completed, total: total),
                  ),
                ),
        ),
      if (!isCompleted)
        AppButton(
          key: const Key('learning-path-start'),
          label: startButtonLabel,
          onPressed: onStart,
          isDisabled: isStartDisabled,
          isLoading: isLoading,
        ),
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (cover != null && cover.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedNetworkImage(
                  cover,
                  height: 177,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Container(height: 177, color: AppColors.grey200),
                  loadingBuilder: (context, child, progress) => progress == null
                      ? child
                      : Container(height: 177, color: AppColors.grey200),
                ),
              ),
            ),
          for (var i = 0; i < content.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            content[i],
          ],
        ],
      ),
    );
  }
}

/// styles.progressBarTappable: bordered card, bar + chevron, primary hint.
class _TappableProgress extends ConsumerWidget {
  const _TappableProgress({required this.completed, required this.total, required this.onTap});

  final int completed;
  final int total;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Material(
      color: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.strokePrimary),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: const Key('learning-path-progress-bar'),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: LearningPathProgressBar(current: completed, total: total)),
                  const SizedBox(width: 8),
                  SvgPicture.asset('assets/icons/chevronRight.svg'),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                ref.t('courses.progressDashboard.tapHint'),
                // styles.progressTapHint: ROBOTO.REGULAR + body.tiny, medium.
                style: const TextStyle(
                  fontFamily: AppFonts.robotoRegular,
                  fontSize: 10,
                  height: 14 / 10,
                  letterSpacing: 0.3,
                  fontWeight: FontWeight.w500,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
