import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/widgets/sized_network_image.dart';
import '../../data/start_item_payload.dart';
import '../course_styles.dart';

/// The look of one highlight-box kind.
class _CalloutLook {
  const _CalloutLook({
    required this.labelKey,
    required this.glyph,
    required this.background,
    required this.iconBackground,
    required this.labelColor,
    this.textColor,
  });

  final String labelKey;
  final String glyph;
  final Color background;
  final Color iconBackground;
  final Color labelColor;
  final Color? textColor;
}

_CalloutLook? _calloutLook(String kind) {
  switch (kind) {
    case 'say':
      return const _CalloutLook(
        labelKey: 'courses.article.callout.say',
        glyph: '“',
        background: Color(0xFFEEF5EE),
        iconBackground: Color(0xFF2F6B3B),
        labelColor: Color(0xFF2F6B3B),
        textColor: Color(0xFF1F3A24),
      );
    case 'info':
      return _CalloutLook(
        labelKey: 'courses.article.callout.info',
        glyph: 'i',
        background: AppColors.blue50,
        iconBackground: AppColors.primary,
        labelColor: AppColors.primary,
      );
    case 'warn':
      return const _CalloutLook(
        labelKey: 'courses.article.callout.warn',
        glyph: '!',
        background: Color(0xFFFFF5E5),
        iconBackground: Color(0xFFA2620B),
        labelColor: Color(0xFF8A5309),
      );
    default:
      return null;
  }
}

/// `HtmlRichText.calloutBuilder` for articles: a box for `say`/`info`/
/// `warn`, and null (the text shown plainly) for a kind this build doesn't
/// know.
Widget? articleCalloutBuilder(String kind, Widget Function(TextStyle? textStyle) content) {
  final look = _calloutLook(kind);
  if (look == null) return null;
  return ArticleCallout(
    key: Key('article-callout-$kind'),
    kind: kind,
    child: content(look.textColor == null ? null : TextStyle(color: look.textColor)),
  );
}

/// A highlight box: icon square, a small translated label, then the text.
class ArticleCallout extends ConsumerWidget {
  const ArticleCallout({super.key, required this.kind, required this.child});

  final String kind;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final look = _calloutLook(kind);
    if (look == null) return child;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.fromLTRB(13, 12, 13, 4),
      decoration: BoxDecoration(color: look.background, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: look.iconBackground, borderRadius: BorderRadius.circular(8)),
            child: Text(
              look.glyph,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifMedium,
                fontSize: 15,
                height: 1,
                fontWeight: FontWeight.w500,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 1, bottom: 4),
                  child: Text(
                    ref.t(look.labelKey).toUpperCase(),
                    key: Key('article-callout-label-$kind'),
                    style: TextStyle(
                      fontFamily: AppFonts.robotoRegular,
                      fontSize: 10.5,
                      height: 14 / 10.5,
                      letterSpacing: 0.9,
                      fontWeight: FontWeight.w500,
                      color: look.labelColor,
                    ),
                  ),
                ),
                child,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "Key takeaways": numbered rows with round badges. [showHeading] is off
/// on the Cards end card, whose kicker already says it.
class ArticleTakeaways extends ConsumerWidget {
  const ArticleTakeaways({super.key, required this.takeaways, this.showHeading = true, this.textStyle});

  final List<String> takeaways;
  final bool showHeading;
  final TextStyle? textStyle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rowStyle = textStyle ?? CourseText.serif(CourseType.bodyMedium, AppColors.highEmphasis);
    return Column(
      key: const Key('article-takeaways'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showHeading)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              ref.t('courses.article.takeaways'),
              style: CourseText.serifMedium(CourseType.bodyLarge, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          ),
        for (var i = 0; i < takeaways.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 22,
                  height: 22,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppColors.blue50, shape: BoxShape.circle),
                  child: Text(
                    '${i + 1}',
                    style: TextStyle(
                      fontFamily: AppFonts.robotoRegular,
                      fontSize: 11,
                      height: 1,
                      fontWeight: FontWeight.w500,
                      color: AppColors.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: Text(takeaways[i], style: rowStyle)),
              ],
            ),
          ),
      ],
    );
  }
}

/// A photo that fills [height] (cover fit); a grey box while it can't load.
class ArticlePhoto extends StatelessWidget {
  const ArticlePhoto({super.key, required this.cover, required this.height, this.radius = 0});

  final ArticleCover cover;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final image = SizedBox(
      height: height,
      width: double.infinity,
      child: SizedNetworkImage(
        cover.url,
        fit: BoxFit.cover,
        semanticLabel: cover.alt,
        errorBuilder: (_, _, _) => Container(color: AppColors.grey200),
      ),
    );
    if (radius <= 0) return image;
    return ClipRRect(borderRadius: BorderRadius.circular(radius), child: image);
  }
}

/// One curated link in an article's Resources list.
class ArticleResourceRow extends StatelessWidget {
  const ArticleResourceRow({super.key, required this.resource, required this.onTap});

  final ArticleResource resource;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      child: GestureDetector(
        key: ValueKey('article-resource-${resource.id}'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        // styles.resourceRow: border 1, radius 10, padding 12/10, gap 8.
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.strokePrimary),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  resource.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: CourseText.roboto(CourseType.bodySmall, AppColors.primary, weight: FontWeight.w500),
                ),
              ),
              const SizedBox(width: 8),
              SvgPicture.asset('assets/icons/chevronRight.svg'),
            ],
          ),
        ),
      ),
    );
  }
}
