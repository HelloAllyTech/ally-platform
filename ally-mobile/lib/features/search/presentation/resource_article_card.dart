import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/search_repository.dart';

/// Port of RN `components/ResourceArticleCard` with its default
/// `colorTheme="light"` (the Search tab): category chip and horizontally
/// scrolling tag chips, the heading, and the content clamped to 3 lines with
/// "View more" + downArrow until tapped open; tapping the open content
/// collapses it again. The in-call dark variant is
/// `scribe_reference_search.dart`'s `DarkResourceArticleCard`.
class ResourceArticleCard extends ConsumerStatefulWidget {
  const ResourceArticleCard({super.key, required this.article});

  final ResourceArticle article;

  @override
  ConsumerState<ResourceArticleCard> createState() => _ResourceArticleCardState();
}

class _ResourceArticleCardState extends ConsumerState<ResourceArticleCard> {
  bool _expanded = false;

  static const _content = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 18 / 14,
    color: AppColors.darkGray6,
  );

  void _toggle() => setState(() => _expanded = !_expanded);

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final article = widget.article;
    return Container(
      margin: EdgeInsets.symmetric(vertical: rn.vs(6)),
      padding: EdgeInsets.symmetric(vertical: rn.vs(10)),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.lightGray14, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // styles.topRow
          Padding(
            padding: EdgeInsets.only(bottom: rn.vs(12)),
            child: Row(
              children: [
                Container(
                  height: 24,
                  margin: EdgeInsets.only(left: rn.s(10), right: rn.s(8)),
                  padding: EdgeInsets.symmetric(horizontal: rn.s(12), vertical: rn.vs(3)),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppColors.white4, borderRadius: BorderRadius.circular(16)),
                  child: Text(
                    article.category,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 12,
                      height: 16 / 12,
                      color: AppColors.darkGray14,
                    ),
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final tag in article.tags)
                          Container(
                            margin: EdgeInsets.only(left: rn.s(8)),
                            padding: EdgeInsets.symmetric(horizontal: rn.s(12), vertical: rn.mvs(2)),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.lightGray14, width: 0.5),
                            ),
                            child: Text(
                              tag,
                              style: TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 12,
                                height: rn.mvs(20) / 12,
                                color: AppColors.darkGray15,
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
          Padding(
            padding: EdgeInsets.symmetric(horizontal: rn.s(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(bottom: rn.vs(8)),
                  child: Text(
                    article.heading,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 16,
                      height: 18 / 16,
                      color: Colors.black,
                    ),
                  ),
                ),
                // RN LayoutAnimation easeInEaseOut on toggle.
                AnimatedSize(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeInOut,
                  alignment: Alignment.topCenter,
                  child: _expanded
                      ? GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: _toggle,
                          child: Text(article.content, style: _content),
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(article.content, maxLines: 3, overflow: TextOverflow.ellipsis, style: _content),
                            GestureDetector(
                              key: const Key('resource-article-view-more'),
                              behavior: HitTestBehavior.opaque,
                              onTap: _toggle,
                              child: Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      ref.t('common.viewMore'),
                                      style: const TextStyle(
                                        fontFamily: AppFonts.ibmPlexSerifRegular,
                                        fontSize: 13,
                                        height: 18 / 13,
                                        color: AppColors.darkGray6,
                                      ),
                                    ),
                                    SvgPicture.asset(
                                      'assets/icons/downArrow.svg',
                                      width: 24,
                                      height: 24,
                                      colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
