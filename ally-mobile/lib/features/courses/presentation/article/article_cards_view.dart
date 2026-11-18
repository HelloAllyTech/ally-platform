import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';
import 'article_blocks.dart';
import 'article_question_card.dart';
import 'article_reading.dart';

/// Cards mode's warm page background.
const articleCardsBackground = Color(0xFFF6F5F1);
const _segmentIdle = Color(0xFFE3E1DA);
const _pageTurn = Duration(milliseconds: 280);

/// The Cards experience: a header (close, title, "i / n"), one progress
/// segment per card, the cards in a swipeable [PageView], and back / Next
/// under them. It replaces the host's top bar and bottom nav.
///
/// The learner can't get past a question they haven't answered: the pages
/// after it aren't built yet, so a swipe stops there and Next is disabled.
/// Arriving at the last card is "reaching the end" ([onReachedFinal]); that
/// card's button is [finalAction] (the article's mark-as-read).
class ArticleCardsView extends ConsumerStatefulWidget {
  const ArticleCardsView({
    super.key,
    required this.cards,
    required this.itemId,
    required this.itemTitle,
    required this.sectionTitle,
    required this.description,
    required this.cover,
    required this.readingMinutes,
    required this.questionCount,
    required this.answeredIds,
    required this.onQuestionAnswered,
    required this.resources,
    required this.onResourceTap,
    required this.onExit,
    required this.onReachedFinal,
    required this.finalAction,
  });

  final List<ArticleCard> cards;
  final String itemId;
  final String itemTitle;
  final String sectionTitle;
  final String? description;
  final ArticleCover? cover;
  final int readingMinutes;
  final int questionCount;
  final Set<String> answeredIds;
  final void Function(ArticleQuestion question, ArticleQuestionAnswerResult result) onQuestionAnswered;
  final List<ArticleResource> resources;
  final ValueChanged<ArticleResource> onResourceTap;
  final VoidCallback? onExit;
  final VoidCallback onReachedFinal;
  final Widget finalAction;

  @override
  ConsumerState<ArticleCardsView> createState() => _ArticleCardsViewState();
}

class _ArticleCardsViewState extends ConsumerState<ArticleCardsView> {
  final _controller = PageController();
  int _index = 0;
  int _maxVisited = 0;

  int get _lastIndex => widget.cards.length - 1;

  /// Pages up to and including the first unanswered question.
  int get _reachableCount {
    for (var i = 0; i < widget.cards.length; i++) {
      final card = widget.cards[i];
      if (card is ArticleQuestionCardData && !widget.answeredIds.contains(card.question.id)) return i + 1;
    }
    return widget.cards.length;
  }

  @override
  void initState() {
    super.initState();
    // A one-card article is already at its end.
    if (_lastIndex == 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onReachedFinal();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handlePageChanged(int index) {
    setState(() {
      _index = index;
      if (index > _maxVisited) _maxVisited = index;
    });
    if (index == _lastIndex) widget.onReachedFinal();
  }

  void _next() {
    if (_index + 1 >= _reachableCount) return;
    _controller.nextPage(duration: _pageTurn, curve: Curves.easeOut);
  }

  void _back() {
    if (_index == 0) return;
    _controller.previousPage(duration: _pageTurn, curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final count = widget.cards.length;
    return ColoredBox(
      key: const Key('article-cards'),
      color: articleCardsBackground,
      child: Column(
        children: [
          _buildHeader(count),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: withGap<Widget>([
                for (var i = 0; i < count; i++)
                  Expanded(
                    child: Container(
                      key: ValueKey('article-cards-segment-$i'),
                      height: 3,
                      decoration: BoxDecoration(
                        color: i <= _maxVisited ? AppColors.primary : _segmentIdle,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
              ], () => const SizedBox(width: 4)),
            ),
          ),
          Expanded(
            child: PageView.builder(
              key: const Key('article-cards-pager'),
              controller: _controller,
              itemCount: _reachableCount,
              onPageChanged: _handlePageChanged,
              itemBuilder: (context, index) => _KeepAlive(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: _buildCard(widget.cards[index]),
                ),
              ),
            ),
          ),
          _buildFooter(),
        ],
      ),
    );
  }

  Widget _buildHeader(int count) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 16, 10),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: ref.t('courses.player.exit'),
            child: GestureDetector(
              key: const Key('article-cards-close'),
              behavior: HitTestBehavior.opaque,
              onTap: widget.onExit,
              child: SizedBox(
                width: 36,
                height: 36,
                child: Center(
                  child: SizedBox(width: 16, height: 16, child: SvgPicture.asset('assets/icons/close.svg')),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              widget.itemTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: CourseText.serifMedium(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            '${_index + 1} / $count',
            key: const Key('article-cards-counter'),
            style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    final card = widget.cards[_index];
    final Widget action;
    if (_index == _lastIndex) {
      action = widget.finalAction;
    } else {
      final blocked = card is ArticleQuestionCardData && !widget.answeredIds.contains(card.question.id);
      action = CourseButton(
        key: const Key('article-cards-next'),
        label: ref.t(card is ArticleCoverCard ? 'courses.article.startReading' : 'courses.player.next'),
        isDisabled: blocked,
        onPressed: _next,
        iconRight: const Icon(Icons.arrow_forward, size: 16, color: Colors.white),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      child: Row(
        children: [
          if (_index > 0) ...[
            Semantics(
              button: true,
              label: ref.t('courses.player.prev'),
              child: GestureDetector(
                key: const Key('article-cards-back'),
                behavior: HitTestBehavior.opaque,
                onTap: _back,
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.strokePrimary),
                  ),
                  child: const Icon(Icons.arrow_back, size: 18, color: AppColors.highEmphasis),
                ),
              ),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(child: action),
        ],
      ),
    );
  }

  Widget _buildCard(ArticleCard card) {
    final (photo, content) = switch (card) {
      ArticleCoverCard() => (widget.cover, _coverContent()),
      ArticleSectionCard(:final photo) => (photo, _sectionContent(card)),
      ArticleQuestionCardData(:final question) => (null, _questionContent(question)),
      ArticleEndCard() => (null, _endContent(card)),
    };
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 18, offset: Offset(0, 6))],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (photo != null) ArticlePhoto(key: const Key('article-card-photo'), cover: photo, height: 170),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: content),
            ),
          ),
        ],
      ),
    );
  }

  Widget _kicker(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text.toUpperCase(),
      key: const Key('article-card-kicker'),
      style: TextStyle(
        fontFamily: AppFonts.robotoRegular,
        fontSize: 10.5,
        height: 14 / 10.5,
        letterSpacing: 1.1,
        fontWeight: FontWeight.w500,
        color: AppColors.primary,
      ),
    ),
  );

  Widget _title(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(
      text,
      key: const Key('article-card-title'),
      style: const TextStyle(
        fontFamily: AppFonts.ibmPlexSerifMedium,
        fontSize: 21,
        height: 28 / 21,
        fontWeight: FontWeight.w500,
        color: AppColors.highEmphasis,
      ),
    ),
  );

  static const _bodyStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 15,
    height: 23 / 15,
    color: AppColors.darkCharcoal,
  );

  List<Widget> _coverContent() {
    final description = htmlToPlainText(widget.description);
    final checks = widget.questionCount;
    return [
      if (widget.sectionTitle.isNotEmpty) _kicker(widget.sectionTitle),
      _title(widget.itemTitle),
      if (description.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(description, style: _bodyStyle),
        ),
      Text(
        [
          ref.t('courses.article.minRead', {'count': widget.readingMinutes}),
          if (checks > 0) ref.t('courses.article.quickChecks', {'count': checks}),
        ].join(' · '),
        key: const Key('article-cards-meta'),
        style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
      ),
    ];
  }

  List<Widget> _sectionContent(ArticleSectionCard card) => [
    if (card.kicker != null) _kicker(card.kicker!),
    if (card.title != null) _title(card.title!),
    if (card.html.trim().isNotEmpty)
      HtmlRichText(html: card.html, paragraphStyle: _bodyStyle, calloutBuilder: articleCalloutBuilder),
  ];

  List<Widget> _questionContent(ArticleQuestion question) => [
    _kicker(ref.t('courses.article.question.title')),
    ArticleQuestionCard(
      key: ValueKey('article-question-${question.id}'),
      itemId: widget.itemId,
      question: question,
      embedded: true,
      onAnswered: (result) => widget.onQuestionAnswered(question, result),
    ),
  ];

  List<Widget> _endContent(ArticleEndCard card) {
    final resources = widget.resources;
    return [
      _kicker(ref.t(card.takeaways.isNotEmpty ? 'courses.article.takeaways' : 'courses.article.resourcesHeading')),
      if (card.takeaways.isNotEmpty) ArticleTakeaways(takeaways: card.takeaways, showHeading: false),
      if (card.hasResources && resources.isNotEmpty) ...[
        if (card.takeaways.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 8),
            child: Text(
              ref.t('courses.article.resourcesHeading'),
              style: CourseText.serifMedium(CourseType.bodyMedium, AppColors.highEmphasis, weight: FontWeight.w500),
            ),
          ),
        ...withGap<Widget>([
          for (final resource in resources)
            ArticleResourceRow(resource: resource, onTap: () => widget.onResourceTap(resource)),
        ], () => const SizedBox(height: 8)),
      ],
    ];
  }
}

/// Keeps a page (and an answered question's verdict) alive when it scrolls
/// out of the [PageView].
class _KeepAlive extends StatefulWidget {
  const _KeepAlive({required this.child});

  final Widget child;

  @override
  State<_KeepAlive> createState() => _KeepAliveState();
}

class _KeepAliveState extends State<_KeepAlive> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return widget.child;
  }
}
