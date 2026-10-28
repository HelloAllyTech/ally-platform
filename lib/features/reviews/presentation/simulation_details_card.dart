import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/cover_video_preview.dart';
import '../../../core/widgets/review_type_chip.dart';
import 'review_styles.dart';
import '../../../core/widgets/sized_network_image.dart';

/// Port of ally-mobile (React Native)'s `components/SimulationDetailsCard`:
/// a bordered, rounded box (padding 8, gap 16) holding a fixed 180pt cover
/// area — the scenario's cover image, or the scribe illustration — then the
/// type chip, a one-line title and either a 2-line description with a
/// "View more"/"View less" toggle (shown only once the text actually
/// overflows, like RN's `onTextLayout` check) or a caller-supplied widget in
/// that slot (scribe cards put their Date & time / Duration rows there).
///
/// A `coverVideoUrl` plays in RN's `VideoPreview` ([CoverVideoPreview]) in
/// place of the image, paused while the screen isn't focused.
///
/// Shared by [ReviewCard] and `ShareForReviewScreen` (RN's
/// `ShareSimulationScreen`/`ShareCallLogScreen` render this same component).
class SimulationDetailsCard extends ConsumerStatefulWidget {
  const SimulationDetailsCard({
    super.key,
    required this.typeLabel,
    required this.reviewType,
    required this.title,
    this.coverImageUrl,
    this.coverVideoUrl,
    this.descriptionText,
    this.descriptionWidget,
  });

  final String typeLabel;
  final ReviewType? reviewType;
  final String? title;
  final String? coverImageUrl;

  /// RN `VideoPreview` (autoPlay off, `shouldPause={!isFocused}`).
  final String? coverVideoUrl;
  final String? descriptionText;
  final Widget? descriptionWidget;

  @override
  ConsumerState<SimulationDetailsCard> createState() => _SimulationDetailsCardState();
}

class _SimulationDetailsCardState extends ConsumerState<SimulationDetailsCard> {
  bool _expanded = false;

  static final _titleStyle = ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis);
  static final _descStyle = ReviewText.serif(RnType.bodyMedium, AppColors.mediumEmphasis);
  static final _viewMoreStyle = ReviewText.serifMedium(RnType.bodyMedium, AppColors.highEmphasis);

  Widget _cover(double height) {
    final isScribe = widget.reviewType == ReviewType.scribe;
    final image = widget.coverImageUrl;
    final video = widget.coverVideoUrl;
    return Container(
      height: height,
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: AppColors.grey50, borderRadius: BorderRadius.circular(8)),
      child: isScribe
          ? SvgPicture.asset('assets/icons/scribeReview.svg', width: double.infinity, height: height)
          : (video != null && video.isNotEmpty)
          // CoverVideoPreview pauses itself once its route is covered.
          ? CoverVideoPreview(key: const Key('scenario-video-preview'), url: video, thumbnailUrl: image, height: height)
          : (image != null && image.isNotEmpty)
          ? SizedNetworkImage(
              image,
              height: height,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Container(color: AppColors.grey100),
            )
          : null,
    );
  }

  Widget _description(String text) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(text: text, style: _descStyle),
          maxLines: 2,
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        final truncated = painter.didExceedMaxLines;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              text,
              maxLines: _expanded ? null : 2,
              overflow: _expanded ? null : TextOverflow.ellipsis,
              style: _descStyle,
            ),
            if (truncated || _expanded)
              GestureDetector(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Text(
                  _expanded ? ref.t('common.viewLess') : ref.t('common.viewMore'),
                  style: _viewMoreStyle,
                ),
              ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final description = widget.descriptionText;
    final reviewType = widget.reviewType;

    return Container(
      padding: EdgeInsets.all(rn.s(8)),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.strokePrimary, width: 0.5),
        borderRadius: BorderRadius.circular(rn.raw(16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _cover(180),
          SizedBox(height: rn.s(16)),
          if (reviewType != null)
            // Row keeps the chip hugging its label (RN `alignSelf:
            // 'flex-start'`); the shared chip fills the width otherwise.
            Row(children: [ReviewTypeChip(reviewType: reviewType, label: widget.typeLabel)]),
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: Text(
              widget.title?.isNotEmpty == true ? widget.title! : '-',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _titleStyle,
            ),
          ),
          if (widget.descriptionWidget != null) widget.descriptionWidget!,
          if (description != null && description.isNotEmpty) _description(description),
        ],
      ),
    );
  }
}

/// Port of RN's `SimulationDetailRow`: "label" in a 100@s column, then the
/// value — both IBM Plex Serif Medium (weight 400), body.small, medium
/// emphasis.
class ReviewDetailRow extends StatelessWidget {
  const ReviewDetailRow({super.key, required this.label, required this.value});

  final String label;
  final String value;

  static const _style = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifMedium,
    fontSize: 12,
    height: 16 / 12,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Row(
      children: [
        SizedBox(width: rn.s(100), child: Text(label, style: _style)),
        Expanded(child: Text(value, style: _style)),
      ],
    );
  }
}
