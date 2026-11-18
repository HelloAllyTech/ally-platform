import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/theme/app_radius.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../../../core/widgets/sized_network_image.dart';

/// Port of ally-mobile (React Native)'s `src/components/SimulationCard/
/// SimulationCard.tsx` — the Learn tab's course / case / role-play /
/// pathway card.
///
/// The RN card declares a drop shadow but also `overflow: 'hidden'`, which on
/// iOS clips the shadow away — what actually renders is an outlined card
/// (0.5px `stroke.primary`, radius 24), so no shadow here.
class SimulationCard extends ConsumerWidget {
  const SimulationCard({
    super.key,
    required this.title,
    this.description,
    this.coverImageUrl,
    this.rightAccessory,
    this.onTap,
    this.titleMaxLines = 2,
    this.descriptionMaxLines = 3,
    this.triggerWarnings = const [],
  });

  final String title;
  final String? description;
  final String? coverImageUrl;
  final Widget? rightAccessory;
  final VoidCallback? onTap;
  final int titleMaxLines;
  final int descriptionMaxLines;
  final List<String> triggerWarnings;

  static const _titleStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 16,
    height: 24 / 16,
    letterSpacing: 0.5,
    fontWeight: FontWeight.w500,
    color: AppColors.highEmphasis,
  );

  static const _descStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    fontWeight: FontWeight.w400,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plainDescription = htmlToPlainText(description);
    final cover = coverImageUrl;

    return Padding(
      // styles.cardContainer
      padding: const EdgeInsets.all(2),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.xl3),
          side: const BorderSide(color: AppColors.strokePrimary, width: 0.5),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (cover != null && cover.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(left: 8, right: 8, bottom: 8),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.xl2),
                      child: SizedNetworkImage(
                        cover,
                        height: 180,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            Container(height: 180, color: AppColors.grey100),
                        loadingBuilder: (context, child, progress) => progress == null
                            ? child
                            : Container(height: 180, color: AppColors.grey100),
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(bottom: 5),
                              child: Text(
                                title.isEmpty ? '-' : title,
                                maxLines: titleMaxLines,
                                overflow: TextOverflow.ellipsis,
                                style: _titleStyle,
                              ),
                            ),
                            if (plainDescription.isNotEmpty)
                              Text(
                                plainDescription,
                                maxLines: descriptionMaxLines,
                                overflow: TextOverflow.ellipsis,
                                style: _descStyle,
                              ),
                            if (triggerWarnings.isNotEmpty) ...[
                              // styles.separator
                              Container(
                                height: 0.5,
                                margin: const EdgeInsets.symmetric(vertical: 10),
                                color: AppColors.strokePrimary,
                              ),
                              Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: Text(
                                  ref.t('common.triggerWarnings'),
                                  style: _descStyle.copyWith(color: AppColors.highEmphasis),
                                ),
                              ),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final warning in triggerWarnings)
                                    _TriggerWarningChip(label: warning),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                      ?rightAccessory,
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// styles.chip / styles.chipText.
class _TriggerWarningChip extends StatelessWidget {
  const _TriggerWarningChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.grey50,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.grey300, width: 0.5),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontFamily: AppFonts.ibmPlexSerifRegular,
          fontSize: 11,
          height: 16 / 11,
          letterSpacing: 0.5,
          color: AppColors.mediumEmphasis,
        ),
      ),
    );
  }
}
