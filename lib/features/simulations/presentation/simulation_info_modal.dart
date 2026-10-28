import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/cover_video_preview.dart';
import '../../../core/widgets/sized_network_image.dart';

/// RN `SimulationDetailsModal` in its read-only form, as the Feedback
/// short-session summary (`SimulationSummary`, the help icon beside the
/// title) and the review header (`ReviewTranscriptHeader`) open it:
/// `fitContent`, no order, no language picker, no start button,
/// `headerTitle` = the scenario title, `title` = "Simulation Details".
/// Cover video (`VideoPreview`) when there is one, else the cover image.
class SimulationInfoModal extends ConsumerWidget {
  const SimulationInfoModal({
    super.key,
    this.headerTitle,
    this.title,
    this.description,
    this.coverImageUrl,
    this.coverVideoUrl,
  });

  final String? headerTitle;
  final String? title;
  final String? description;
  final String? coverImageUrl;
  final String? coverVideoUrl;

  /// RN `<Modal transparent animationType="fade">` over a blackAlpha700
  /// backdrop; only the X (or system back, `onRequestClose`) closes it.
  static Future<void> show(
    BuildContext context, {
    String? headerTitle,
    String? title,
    String? description,
    String? coverImageUrl,
    String? coverVideoUrl,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: AppColors.blackAlpha700,
      builder: (_) => SimulationInfoModal(
        headerTitle: headerTitle,
        title: title,
        description: description,
        coverImageUrl: coverImageUrl,
        coverVideoUrl: coverVideoUrl,
      ),
    );
  }

  static const _labelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final video = coverVideoUrl;
    final cover = coverImageUrl;
    final desc = description;

    return Dialog(
      key: const Key('simulation-info-modal'),
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      // styles.modalBackdrop paddingHorizontal 20; modalContainer radius.lg.
      insetPadding: const EdgeInsets.symmetric(horizontal: 20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        // modalContainerFitContent: height auto, maxHeight 80%.
        constraints: BoxConstraints(maxWidth: 500, maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 16, top: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: FractionallySizedBox(
                      // styles.headerTitle maxWidth 90%.
                      widthFactor: 0.9,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        headerTitle ?? '',
                        style: const TextStyle(
                          fontFamily: AppFonts.replayProHeadline,
                          fontSize: 18,
                          height: 24 / 18,
                          letterSpacing: 0.18,
                          fontWeight: FontWeight.w300,
                          color: AppColors.highEmphasis,
                        ),
                      ),
                    ),
                  ),
                  GestureDetector(
                    key: const Key('simulation-info-modal-close'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => Navigator.of(context).pop(),
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      // close.svg's #424242 fill is baked in; RN's `color`
                      // prop doesn't reach it.
                      child: SvgPicture.asset('assets/icons/close.svg', width: 20, height: 20),
                    ),
                  ),
                ],
              ),
            ),
            // contentContainer + contentContainerFitContent (flex 0, shrink).
            Flexible(
              child: Container(
                margin: const EdgeInsets.all(16),
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.strokePrimary, width: 0.35),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // styles.mediaContainer padding 12 (always present).
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: video != null && video.isNotEmpty
                          ? CoverVideoPreview(
                              key: const Key('simulation-info-modal-video'),
                              url: video,
                              thumbnailUrl: cover,
                            )
                          : cover == null || cover.isEmpty
                          ? const SizedBox.shrink()
                          : ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: SizedNetworkImage(
                                cover,
                                height: 180,
                                width: double.infinity,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(height: 180, color: AppColors.grey200),
                              ),
                            ),
                    ),
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (title != null && title!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 8),
                                // styles.title: IBM_PLEX_SERIF.REGULAR + body.large.
                                child: Text(
                                  title!,
                                  style: const TextStyle(
                                    fontFamily: AppFonts.ibmPlexSerifRegular,
                                    fontSize: 16,
                                    height: 24 / 16,
                                    letterSpacing: 0.5,
                                    color: AppColors.highEmphasis,
                                  ),
                                ),
                              ),
                            if (desc != null && desc.isNotEmpty) ...[
                              Padding(
                                padding: const EdgeInsets.only(bottom: 4),
                                child: Text(ref.t('learn.scenario.scenarioLabel'), style: _labelStyle),
                              ),
                              Padding(
                                padding: const EdgeInsets.only(bottom: 6),
                                child: Text(
                                  desc,
                                  style: _labelStyle.copyWith(fontFamily: AppFonts.ibmPlexSerifRegular),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
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
