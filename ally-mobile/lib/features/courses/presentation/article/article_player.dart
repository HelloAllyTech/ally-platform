import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';
import 'article_blocks.dart';
import 'article_cards_view.dart';
import 'article_question_card.dart';
import 'article_reading.dart';
import 'external_resource_sheet.dart';

/// RN `READ_SCROLL_THRESHOLD`: scroll fraction past which the article counts as read.
const _readScrollThreshold = 0.95;

/// RN `NO_SCROLL_READY_MS`: a body too short to scroll is readable after this.
const articleNoScrollReadyDelay = Duration(milliseconds: 3000);

const _documentExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];

/// RN `isDocumentUrl`: documents open in the OS rather than the WebView sheet.
bool isArticleDocumentUrl(String url) {
  final path = url.split('?').first.split('#').first.toLowerCase();
  return _documentExtensions.any(path.endsWith);
}

/// One piece of an article body: prose, or an inline question (RN
/// `ArticleSegment`).
sealed class ArticleSegment {
  const ArticleSegment();
}

class ArticleHtmlSegment extends ArticleSegment {
  const ArticleHtmlSegment(this.html);
  final String html;
}

class ArticleQuestionSegment extends ArticleSegment {
  const ArticleQuestionSegment(this.question);
  final ArticleQuestion question;
}

final _markerPattern = RegExp(
  r'''<div\b[^>]*\bdata-ally-question\s*=\s*["']([^"']+)["'][^>]*>\s*</div>''',
  caseSensitive: false,
);

/// Port of RN `utils/articleSegments.ts` `splitArticleHtml`: splits the body
/// on `<div data-ally-question="<id>"></div>` placeholders. A placeholder
/// with no matching question, a repeat, and a question with no placeholder
/// are all left out.
List<ArticleSegment> splitArticleHtml(String? html, List<ArticleQuestion> questions) {
  if (html == null || html.isEmpty) return const [];
  final byId = {for (final q in questions) q.id: q};
  if (byId.isEmpty) return [ArticleHtmlSegment(html)];

  final segments = <ArticleSegment>[];
  final seen = <String>{};
  void pushHtml(String value) {
    if (value.trim().isEmpty) return;
    segments.add(ArticleHtmlSegment(value));
  }

  var last = 0;
  for (final match in _markerPattern.allMatches(html)) {
    pushHtml(html.substring(last, match.start));
    last = match.end;
    final id = match.group(1)!;
    final question = byId[id];
    if (question == null || !seen.add(id)) continue;
    segments.add(ArticleQuestionSegment(question));
  }
  pushHtml(html.substring(last));
  return segments;
}

/// Port of RN `components/players/ArticlePlayer.tsx`: the article body with
/// its inline questions interleaved at their anchors, a 3pt scroll-progress
/// bar, a Resources list (opened in [ExternalResourceSheet], documents in
/// the OS), and a footer whose "Mark as read" unlocks once the reader
/// reaches the end of the body (a sentinel before Resources, or 95% scroll,
/// or 3s for a body that doesn't scroll) and every shown question is
/// answered. The last answer completes the article server-side.
///
/// The payload's `experience` picks the reading layout (see
/// [articleLayoutOf]): classic adds the cover photo above the text;
/// Magazine leads with the cover edge to edge under the host's see-through
/// top bar, then a kicker, headline and reading time, with editorial type
/// (raised initial, pull quotes); Cards hands the article to
/// [ArticleCardsView], where arriving at the last card is reaching the end.
/// Every layout draws highlight boxes and, in classic and Magazine, the
/// key takeaways before Resources.
class ArticlePlayer extends ConsumerStatefulWidget {
  const ArticlePlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.alreadyCompleted,
    required this.onCompleted,
    this.itemTitle = '',
    this.sectionTitle = '',
    this.description,
    this.onExit,
    this.onRequestNext,
    this.isLastItem = false,
  });

  final StartItemPayload payload;
  final String itemId;
  final bool alreadyCompleted;
  final void Function(TrackItemCompletionResult result) onCompleted;

  /// The item's title (Magazine headline, Cards header and cover card).
  final String itemTitle;

  /// The course section's title (Magazine and cover-card kicker).
  final String sectionTitle;

  /// The item's description HTML (Cards cover card).
  final String? description;

  /// Cards' close button: Cards replaces the host's top bar.
  final VoidCallback? onExit;

  /// Cards' Next / Finish once read: Cards replaces the host's bottom nav.
  final VoidCallback? onRequestNext;
  final bool isLastItem;

  @override
  ConsumerState<ArticlePlayer> createState() => _ArticlePlayerState();
}

class _ArticlePlayerState extends ConsumerState<ArticlePlayer> {
  final _scrollController = ScrollController();
  final _resourcesKey = GlobalKey();
  late final ArticleLayout _layout = articleLayoutOf(widget.payload);
  late final List<String> _takeaways = widget.payload.articleTakeaways ?? const [];
  late final List<ArticleSegment> _segments =
      splitArticleHtml(widget.payload.html, widget.payload.articleQuestions ?? const []);
  late final List<ArticleCard> _cards = _layout == ArticleLayout.cards
      ? splitArticleCards(
          html: widget.payload.html,
          questions: widget.payload.articleQuestions ?? const [],
          takeaways: _takeaways,
          hasResources: (widget.payload.articleResources ?? const []).isNotEmpty,
        )
      : const [];
  late final Set<String> _answeredIds = {
    for (final q in widget.payload.articleQuestions ?? const <ArticleQuestion>[])
      if (q.isAnswered) q.id,
  };
  late bool _marked = widget.alreadyCompleted;
  int _scrollPct = 0;
  bool _reachedEnd = false;
  bool _isMarking = false;
  Timer? _fallbackTimer;

  List<ArticleQuestion> get _shownQuestions => _layout == ArticleLayout.cards
      ? [
          for (final c in _cards)
            if (c is ArticleQuestionCardData) c.question,
        ]
      : [
          for (final s in _segments)
            if (s is ArticleQuestionSegment) s.question,
        ];

  int get _unansweredCount => _shownQuestions.where((q) => !_answeredIds.contains(q.id)).length;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _evaluateScrollability());
  }

  @override
  void didUpdateWidget(ArticlePlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A resumed item whose completion arrives after mount.
    if (widget.alreadyCompleted && !_marked) _marked = true;
  }

  @override
  void dispose() {
    _fallbackTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  /// Offset of RN's `article-end-sentinel` from the top of the scroll
  /// content: everything above the Resources block.
  double? _sentinelY() {
    if (!_scrollController.hasClients) return null;
    final position = _scrollController.position;
    final contentHeight = position.maxScrollExtent + position.viewportDimension;
    final resourcesBox = _resourcesKey.currentContext?.findRenderObject() as RenderBox?;
    final resourcesHeight = resourcesBox?.size.height ?? 0;
    return contentHeight - 16 - resourcesHeight;
  }

  void _evaluateScrollability() {
    if (!mounted || !_scrollController.hasClients) return;
    final sentinelY = _sentinelY();
    final layoutH = _scrollController.position.viewportDimension;
    if (sentinelY != null && sentinelY > 0 && layoutH > 0 && sentinelY <= layoutH && _fallbackTimer == null) {
      _fallbackTimer = Timer(articleNoScrollReadyDelay, () {
        if (mounted) setState(() => _reachedEnd = true);
      });
    }
  }

  bool _handleScroll(ScrollNotification notification) {
    if (notification.depth != 0) return false;
    final m = notification.metrics;
    final max = m.maxScrollExtent;
    final pct = max <= 0 ? 100 : ((m.pixels / max) * 100).round().clamp(0, 100);
    final sentinelY = _sentinelY();
    final reached = sentinelY != null && sentinelY > 0 && m.pixels + m.viewportDimension >= sentinelY;
    if (pct != _scrollPct || (reached && !_reachedEnd)) {
      setState(() {
        _scrollPct = pct;
        if (reached) _reachedEnd = true;
      });
    }
    return false;
  }

  void _handleQuestionAnswered(String questionId, ArticleQuestionAnswerResult result) {
    setState(() => _answeredIds.add(questionId));
    final completion = result.completion;
    if (completion != null && completion.completed) {
      setState(() => _marked = true);
      widget.onCompleted(completion);
    }
  }

  Future<void> _handleResourcePress(ArticleResource resource) async {
    if (isArticleDocumentUrl(resource.url)) {
      final uri = Uri.tryParse(resource.url);
      if (uri != null) {
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (_) {}
      }
      return;
    }
    await ExternalResourceSheet.show(context, resource);
  }

  bool get _canMark => (_reachedEnd || _scrollPct >= _readScrollThreshold * 100) && _unansweredCount == 0;

  Future<void> _handleMarkRead() async {
    if (_marked || _isMarking) return;
    setState(() => _isMarking = true);
    try {
      final result = await ref.read(coursesRepositoryProvider).markArticleRead(widget.itemId);
      if (!mounted) return;
      setState(() => _marked = true);
      widget.onCompleted(result);
    } catch (_) {
      // Button stays available so the learner can retry.
    } finally {
      if (mounted) setState(() => _isMarking = false);
    }
  }

  void _handleCardsReachedEnd() {
    if (!_reachedEnd) setState(() => _reachedEnd = true);
  }

  Widget _markReadButton() {
    final unanswered = _unansweredCount;
    final canMark = _canMark;
    return CourseButton(
      key: const Key('article-mark-read'),
      label: unanswered > 0
          ? ref.t(
              unanswered == 1
                  ? 'courses.article.answerQuestionToContinue'
                  : 'courses.article.answerQuestionsToContinue',
            )
          : canMark
          ? ref.t('courses.article.markRead')
          : ref.t('courses.article.keepReading'),
      isDisabled: !canMark,
      isLoading: _isMarking,
      onPressed: _handleMarkRead,
    );
  }

  Widget _readChip() => Row(
    key: const Key('article-read-chip'),
    mainAxisSize: MainAxisSize.min,
    children: [
      SvgPicture.asset('assets/icons/tickRound.svg', width: 16, height: 16),
      const SizedBox(width: 6),
      Text(
        ref.t('courses.article.read'),
        style: CourseText.system(const TextStyle(fontSize: 14), AppColors.green700),
      ),
    ],
  );

  /// Cards' last-card button: mark as read, then Next / Finish.
  Widget _cardsFinalAction() {
    if (!_marked) return _markReadButton();
    final onNext = widget.onRequestNext;
    if (onNext == null) return Center(child: _readChip());
    return Row(
      children: [
        _readChip(),
        const SizedBox(width: 12),
        Expanded(
          child: CourseButton(
            key: const Key('article-cards-continue'),
            label: ref.t(widget.isLastItem ? 'courses.player.finish' : 'courses.player.next'),
            onPressed: onNext,
            iconRight: const Icon(Icons.arrow_forward, size: 16, color: Colors.white),
          ),
        ),
      ],
    );
  }

  int get _readingMinutes => articleReadingMinutes(widget.payload.html, _takeaways);

  Widget _buildResources(List<ArticleResource> resources) {
    // styles.resourcesSection: marginTop 24, borderTop 1, paddingTop 16,
    // gap 8.
    return Container(
      key: _resourcesKey,
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.only(top: 16),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.strokePrimary)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: withGap<Widget>([
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              ref.t('courses.article.resourcesHeading'),
              style: CourseText.serifMedium(
                CourseType.bodyMedium,
                AppColors.highEmphasis,
                weight: FontWeight.w500,
              ),
            ),
          ),
          for (final resource in resources)
            ArticleResourceRow(resource: resource, onTap: () => _handleResourcePress(resource)),
        ], () => const SizedBox(height: 8)),
      ),
    );
  }

  /// The body, inline questions, takeaways, end sentinel and Resources.
  /// Magazine passes its editorial type.
  List<Widget> _buildArticleFlow(List<ArticleResource> resources, {bool magazine = false}) {
    final firstHtml = _segments.indexWhere((s) => s is ArticleHtmlSegment);
    return [
      for (var i = 0; i < _segments.length; i++)
        switch (_segments[i]) {
          ArticleHtmlSegment(:final html) => HtmlRichText(
            html: html,
            calloutBuilder: articleCalloutBuilder,
            paragraphStyle: magazine ? _magazineParagraph : null,
            pullQuoteStyle: magazine ? _magazinePullQuote : null,
            pullQuoteBorderColor: magazine ? AppColors.primary : null,
            // Only the article's opening paragraph takes the initial.
            dropCapStyle: magazine && i == firstHtml
                ? TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 44,
                    height: 1,
                    color: AppColors.primary,
                  )
                : null,
          ),
          ArticleQuestionSegment(:final question) => ArticleQuestionCard(
            key: ValueKey('article-question-${question.id}'),
            itemId: widget.itemId,
            question: question,
            onAnswered: (result) => _handleQuestionAnswered(question.id, result),
          ),
        },
      if (_takeaways.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: ArticleTakeaways(takeaways: _takeaways),
        ),
      const SizedBox(key: Key('article-end-sentinel')),
      if (resources.isNotEmpty) _buildResources(resources),
    ];
  }

  static const _magazineParagraph = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 15,
    height: 24 / 15,
    color: AppColors.darkCharcoal,
  );

  static const _magazinePullQuote = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontStyle: FontStyle.italic,
    fontSize: 18,
    height: 26 / 18,
    color: AppColors.highEmphasis,
  );

  Widget _buildClassicContent(List<ArticleResource> resources) {
    final cover = widget.payload.articleCover;
    return SingleChildScrollView(
      key: const Key('article-scroll'),
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (cover != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: ArticlePhoto(key: const Key('article-cover'), cover: cover, height: 180, radius: 12),
            ),
          ..._buildArticleFlow(resources),
        ],
      ),
    );
  }

  /// Magazine: the cover edge to edge (under the host's overlay top bar),
  /// a white body overlapping it by 22 with rounded top corners, scrolling
  /// with the page. No cover: just the body, under the normal top bar.
  Widget _buildMagazineContent(List<ArticleResource> resources) {
    const photoHeight = 300.0;
    const overlap = 22.0;
    final cover = widget.payload.articleCover;
    final immersive = _layout == ArticleLayout.magazineImmersive && cover != null;
    final questionCount = _shownQuestions.length;
    final body = Container(
      key: const Key('article-magazine-body'),
      padding: EdgeInsets.fromLTRB(20, immersive ? 24 : 18, 20, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: immersive ? const BorderRadius.vertical(top: Radius.circular(overlap)) : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.sectionTitle.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                widget.sectionTitle.toUpperCase(),
                key: const Key('article-magazine-kicker'),
                style: TextStyle(
                  fontFamily: AppFonts.robotoRegular,
                  fontSize: 10.5,
                  height: 14 / 10.5,
                  letterSpacing: 1.1,
                  fontWeight: FontWeight.w500,
                  color: AppColors.primary,
                ),
              ),
            ),
          Text(
            widget.itemTitle,
            key: const Key('article-magazine-title'),
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifMedium,
              fontSize: 25,
              height: 32 / 25,
              fontWeight: FontWeight.w500,
              color: AppColors.highEmphasis,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            [
              ref.t('courses.article.minRead', {'count': _readingMinutes}),
              if (questionCount > 0) ref.t('courses.article.quickChecks', {'count': questionCount}),
            ].join(' · '),
            key: const Key('article-magazine-meta'),
            style: CourseText.roboto(CourseType.bodySmall, AppColors.mediumEmphasis),
          ),
          Container(height: 1, margin: const EdgeInsets.symmetric(vertical: 16), color: AppColors.strokePrimary),
          ..._buildArticleFlow(resources, magazine: true),
        ],
      ),
    );
    return SingleChildScrollView(
      key: const Key('article-scroll'),
      controller: _scrollController,
      child: immersive
          ? Stack(
              fit: StackFit.passthrough,
              children: [
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: photoHeight,
                  child: ArticlePhoto(key: const Key('article-magazine-photo'), cover: cover, height: photoHeight),
                ),
                Padding(padding: const EdgeInsets.only(top: photoHeight - overlap), child: body),
              ],
            )
          : body,
    );
  }

  @override
  Widget build(BuildContext context) {
    final resources = widget.payload.articleResources ?? const <ArticleResource>[];

    if (_layout == ArticleLayout.cards) {
      return ArticleCardsView(
        cards: _cards,
        itemId: widget.itemId,
        itemTitle: widget.itemTitle,
        sectionTitle: widget.sectionTitle,
        description: widget.description,
        cover: widget.payload.articleCover,
        readingMinutes: _readingMinutes,
        questionCount: _shownQuestions.length,
        answeredIds: _answeredIds,
        onQuestionAnswered: (question, result) => _handleQuestionAnswered(question.id, result),
        resources: resources,
        onResourceTap: _handleResourcePress,
        onExit: widget.onExit,
        onReachedFinal: _handleCardsReachedEnd,
        finalAction: _cardsFinalAction(),
      );
    }

    final magazine = _layout == ArticleLayout.magazine || _layout == ArticleLayout.magazineImmersive;
    return Column(
      children: [
        // styles.progressTrack: height 3, grey[100]; fill primary. Not over
        // Magazine's cover photo, where the host's overlay bar sits.
        if (_layout != ArticleLayout.magazineImmersive)
          Container(
            key: const Key('article-progress-track'),
            height: 3,
            color: AppColors.grey100,
            alignment: Alignment.centerLeft,
            child: FractionallySizedBox(
              widthFactor: _scrollPct / 100,
              child: Container(key: const Key('article-progress-fill'), color: AppColors.primary),
            ),
          ),
        Expanded(
          child: NotificationListener<ScrollNotification>(
            onNotification: _handleScroll,
            child: NotificationListener<ScrollMetricsNotification>(
              onNotification: (_) {
                _evaluateScrollability();
                return false;
              },
              child: magazine ? _buildMagazineContent(resources) : _buildClassicContent(resources),
            ),
          ),
        ),
        // styles.footer: borderTop 0.5, padding 16, centred.
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
          ),
          alignment: Alignment.center,
          child: _marked ? _readChip() : _markReadButton(),
        ),
      ],
    );
  }
}
