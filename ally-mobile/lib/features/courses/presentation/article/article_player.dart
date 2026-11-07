import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/html_rich_text.dart';
import '../../data/course_models.dart';
import '../../data/courses_repository.dart';
import '../../data/start_item_payload.dart';
import '../course_button.dart';
import '../course_styles.dart';
import 'article_question_card.dart';
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
class ArticlePlayer extends ConsumerStatefulWidget {
  const ArticlePlayer({
    super.key,
    required this.payload,
    required this.itemId,
    required this.alreadyCompleted,
    required this.onCompleted,
  });

  final StartItemPayload payload;
  final String itemId;
  final bool alreadyCompleted;
  final void Function(TrackItemCompletionResult result) onCompleted;

  @override
  ConsumerState<ArticlePlayer> createState() => _ArticlePlayerState();
}

class _ArticlePlayerState extends ConsumerState<ArticlePlayer> {
  final _scrollController = ScrollController();
  final _resourcesKey = GlobalKey();
  late final List<ArticleSegment> _segments =
      splitArticleHtml(widget.payload.html, widget.payload.articleQuestions ?? const []);
  late final Set<String> _answeredIds = {
    for (final q in widget.payload.articleQuestions ?? const <ArticleQuestion>[])
      if (q.isAnswered) q.id,
  };
  late bool _marked = widget.alreadyCompleted;
  int _scrollPct = 0;
  bool _reachedEnd = false;
  bool _isMarking = false;
  Timer? _fallbackTimer;

  List<ArticleQuestion> get _shownQuestions => [
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

  @override
  Widget build(BuildContext context) {
    final resources = widget.payload.articleResources ?? const <ArticleResource>[];
    final unanswered = _unansweredCount;
    final canMark = _canMark;

    return Column(
      children: [
        // styles.progressTrack: height 3, grey[100]; fill primary.
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
              child: SingleChildScrollView(
                key: const Key('article-scroll'),
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final segment in _segments)
                      switch (segment) {
                        ArticleHtmlSegment(:final html) => HtmlRichText(html: html),
                        ArticleQuestionSegment(:final question) => ArticleQuestionCard(
                          key: ValueKey('article-question-${question.id}'),
                          itemId: widget.itemId,
                          question: question,
                          onAnswered: (result) => _handleQuestionAnswered(question.id, result),
                        ),
                      },
                    const SizedBox(key: Key('article-end-sentinel')),
                    if (resources.isNotEmpty)
                      // styles.resourcesSection: marginTop 24, borderTop 1,
                      // paddingTop 16, gap 8.
                      Container(
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
                              _ResourceRow(resource: resource, onTap: () => _handleResourcePress(resource)),
                          ], () => const SizedBox(height: 8)),
                        ),
                      ),
                  ],
                ),
              ),
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
          child: _marked
              ? Row(
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
                )
              : CourseButton(
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
                ),
        ),
      ],
    );
  }
}

class _ResourceRow extends StatelessWidget {
  const _ResourceRow({required this.resource, required this.onTap});

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
