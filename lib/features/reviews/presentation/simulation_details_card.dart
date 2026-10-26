import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/review_type_chip.dart';

/// Port of ally-mobile (React Native)'s `SimulationDetailsCard` — a
/// bordered, rounded box: a cover image/illustration strip on top, then a
/// padded body with the type chip, a single-line title, and either a
/// 2-line-truncated description with a "View more"/"View less" toggle
/// (simulation reviews) or a caller-supplied widget in that same slot
/// (scribe reviews' Date&time/Duration rows — scribe sessions have no
/// separate description field to show there, confirmed as a deliberate
/// RN reuse, not a bug). RN only shows the toggle once it measures the
/// text actually overflowing 2 lines (`onTextLayout`); this always shows
/// it whenever there's description text, a reasonable simplification
/// since scenario descriptions are effectively always longer than that in
/// practice — a short description would show a working but unnecessary
/// toggle rather than a missing one.
///
/// Shared by [ReviewCard] (`review_card.dart`) and `ShareForReviewScreen`
/// (RN's `ShareSimulationScreen`/`ShareCallLogScreen`, which render this
/// exact same component as a context card above the note field).
class SimulationDetailsCard extends ConsumerStatefulWidget {
  const SimulationDetailsCard({
    super.key,
    required this.typeLabel,
    required this.reviewType,
    required this.title,
    this.coverImageUrl,
    this.illustrationAsset,
    this.descriptionText,
    this.descriptionWidget,
  });

  final String typeLabel;
  final ReviewType reviewType;
  final String? title;
  final String? coverImageUrl;
  final String? illustrationAsset;
  final String? descriptionText;
  final Widget? descriptionWidget;

  @override
  ConsumerState<SimulationDetailsCard> createState() => _SimulationDetailsCardState();
}

class _SimulationDetailsCardState extends ConsumerState<SimulationDetailsCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final hasDescriptionText = widget.descriptionText?.isNotEmpty ?? false;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.coverImageUrl != null)
            Image.network(
              widget.coverImageUrl!,
              height: 180,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => const SizedBox(height: 180),
            )
          else if (widget.illustrationAsset != null)
            Container(
              height: 180,
              width: double.infinity,
              color: AppColors.surfaceContainerLow,
              padding: const EdgeInsets.all(24),
              child: SvgPicture.asset(widget.illustrationAsset!, fit: BoxFit.contain),
            ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ReviewTypeChip(reviewType: widget.reviewType, label: widget.typeLabel),
                const SizedBox(height: 4),
                Text(
                  widget.title?.isNotEmpty == true ? widget.title! : '-',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    color: AppColors.highEmphasis,
                  ),
                ),
                if (widget.descriptionWidget != null)
                  Padding(padding: const EdgeInsets.only(top: 4), child: widget.descriptionWidget!),
                if (hasDescriptionText) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      widget.descriptionText!,
                      maxLines: _expanded ? null : 2,
                      overflow: _expanded ? null : TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: AppColors.mediumEmphasis),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _expanded = !_expanded),
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        _expanded ? ref.t('common.viewLess') : ref.t('common.viewMore'),
                        style: const TextStyle(color: AppColors.primary, fontSize: 13),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Port of ally-mobile (React Native)'s `SimulationDetailRow` — a plain
/// "label: value" line, used both standalone (above [SimulationDetailsCard]
/// for simulation reviews) and inside it (as the scribe description slot).
class ReviewDetailRow extends StatelessWidget {
  const ReviewDetailRow({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: const TextStyle(fontSize: 12, color: AppColors.mediumEmphasis),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 12,
                color: AppColors.highEmphasis,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
