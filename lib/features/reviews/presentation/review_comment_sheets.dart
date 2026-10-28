import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../account/data/user_profile.dart';
import '../data/review_api.dart';
import '../data/review_models.dart';
import 'comment_list_controller.dart';
import 'review_styles.dart';
import 'review_widgets.dart';

/// Everything RN threads into its comment bottom sheets from
/// `ReviewDetailsLayout`.
class ReviewSheetContext {
  const ReviewSheetContext({
    required this.api,
    required this.reviewId,
    required this.reviewOwnerId,
    required this.isPrivate,
    required this.generalCommentsThreadId,
    required this.currentUser,
    required this.onThreadChange,
    required this.onReviewChanged,
  });

  final ReviewApi api;
  final String reviewId;
  final int? reviewOwnerId;
  final bool isPrivate;
  final String? generalCommentsThreadId;
  final UserProfile? currentUser;

  /// RN's `handleThreadCommentChange` — mirrors a change in a thread's
  /// comments into the transcript's own copy.
  final void Function(String threadId, CommentChange change) onThreadChange;

  /// RN's `ReviewDetails` tag invalidation (comment count, reactions).
  final VoidCallback onReviewChanged;
}

/// A page of the comment sheet — RN's four separate sheets
/// (`ThreadsBottomSheet`, `MessageThreadsBottomSheet`,
/// `CommentThreadBottomSheet`, `ReplyBottomSheet`), which hand off to one
/// another and come back on "back" (`useReviewComments`).
sealed class ReviewSheetPage {
  const ReviewSheetPage();
}

class ThreadsSheetPage extends ReviewSheetPage {
  const ThreadsSheetPage();
}

class MessageThreadsSheetPage extends ReviewSheetPage {
  const MessageThreadsSheetPage({required this.messageContent, required this.threads});
  final String messageContent;
  final List<ReviewThread> threads;
}

class CommentThreadSheetPage extends ReviewSheetPage {
  const CommentThreadSheetPage(this.threadId);
  final String threadId;
}

class ReplySheetPage extends ReviewSheetPage {
  const ReplySheetPage(this.comment);
  final ThreadComment comment;
}

/// Shows the comment sheet starting at [initialPage]. Pages push onto a
/// stack inside the one sheet; a page's back arrow pops it, and popping the
/// last page closes the sheet — the same hops RN makes between its sheets
/// (thread → back to the list it came from; a reply opened from the inline
/// General comments → back closes).
///
/// Presentation matches RN's `BottomSheet`: white, 16pt top corners, a
/// 80x4 stroke-coloured handle, 50% black backdrop, 80% of the screen
/// (`snapPoints={['80%']}`; the per-message list opens at 60%).
Future<void> showReviewCommentSheet(
  BuildContext context, {
  required ReviewSheetContext sheetContext,
  required ReviewSheetPage initialPage,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    barrierColor: Colors.black.withValues(alpha: 0.5),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    clipBehavior: Clip.antiAlias,
    builder: (_) => ReviewCommentSheet(sheetContext: sheetContext, initialPage: initialPage),
  );
}

class ReviewCommentSheet extends StatefulWidget {
  const ReviewCommentSheet({super.key, required this.sheetContext, required this.initialPage});

  final ReviewSheetContext sheetContext;
  final ReviewSheetPage initialPage;

  @override
  State<ReviewCommentSheet> createState() => _ReviewCommentSheetState();
}

class _ReviewCommentSheetState extends State<ReviewCommentSheet> {
  late final List<ReviewSheetPage> _stack = [widget.initialPage];

  void _push(ReviewSheetPage page) => setState(() => _stack.add(page));

  void _pop() {
    if (_stack.length <= 1) {
      Navigator.of(context).pop();
    } else {
      setState(_stack.removeLast);
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _stack.last;
    final media = MediaQuery.of(context);
    final fraction = page is MessageThreadsSheetPage ? 0.6 : 0.8;
    final c = widget.sheetContext;

    final Widget body = switch (page) {
      ThreadsSheetPage() => _ThreadsPage(
        sheetContext: c,
        onThreadPress: (id) => _push(CommentThreadSheetPage(id)),
        onReplyPress: (comment) => _push(ReplySheetPage(comment)),
      ),
      MessageThreadsSheetPage(:final messageContent, :final threads) => _MessageThreadsPage(
        messageContent: messageContent,
        threads: threads,
        onThreadPress: (id) => _push(CommentThreadSheetPage(id)),
      ),
      CommentThreadSheetPage(:final threadId) => _CommentThreadPage(
        key: ValueKey('thread-$threadId'),
        sheetContext: c,
        threadId: threadId,
        onBack: _pop,
        onReplyPress: (comment) => _push(ReplySheetPage(comment)),
      ),
      ReplySheetPage(:final comment) => _ReplyPage(
        key: ValueKey('reply-${comment.id}'),
        sheetContext: c,
        original: comment,
        onBack: _pop,
      ),
    };

    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SizedBox(
        height: media.size.height * fraction,
        child: Column(
          children: [
            // RN's handleIndicator: 80x4, stroke primary, marginTop 8@mvs.
            Padding(
              padding: EdgeInsets.only(top: RnSize.of(context).mvs(8), bottom: 8),
              child: Container(
                width: 80,
                height: 4,
                decoration: BoxDecoration(color: AppColors.strokePrimary, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}

Future<bool> _confirmDelete(BuildContext context, WidgetRef ref, String prefix) async {
  final confirmed = await ConfirmationModal.show(
    context,
    title: ref.tr('$prefix.deleteConfirmation.title'),
    description: ref.tr('$prefix.deleteConfirmation.description'),
    confirmLabel: ref.tr('$prefix.deleteConfirmation.confirm'),
    cancelLabel: ref.tr('$prefix.deleteConfirmation.cancel'),
    confirmVariant: AppButtonVariant.destructive,
  );
  return confirmed == true;
}

/// A thread card in RN's threads lists: optional `Selected text: "…"` line,
/// the thread's first comment (no reply button, reaction picker disabled)
/// faded out under a white gradient, and a "N more comments ›" footer.
class _ThreadCard extends ConsumerWidget {
  const _ThreadCard({required this.thread, required this.moreLabel, required this.onPress, this.selectedText});

  final ReviewThread thread;
  final String? selectedText;
  final String? moreLabel;
  final VoidCallback onPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final first = thread.comments.first;
    return GestureDetector(
      key: ValueKey('thread-card-${thread.id}'),
      behavior: HitTestBehavior.opaque,
      onTap: onPress,
      child: Container(
        padding: EdgeInsets.symmetric(vertical: rn.mvs(8), horizontal: rn.s(16)),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (selectedText != null && selectedText!.isNotEmpty) ...[
              Container(
                padding: EdgeInsets.only(bottom: rn.vs(8)),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
                ),
                child: Text(
                  '${ref.t('threadsBottomSheet.selectedText')} "$selectedText"',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, 24, AppColors.highEmphasis, letterSpacing: 0.25),
                ),
              ),
              SizedBox(height: rn.vs(10)),
            ],
            Stack(
              children: [
                ReviewCommentTile(
                  comment: first,
                  showReplyButton: false,
                  disableAddReactionButton: true,
                  onCommentPress: onPress,
                ),
                if (moreLabel != null)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 83,
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.white.withValues(alpha: 0),
                              AppColors.whiteTransparent40,
                              AppColors.whiteTransparent60,
                            ],
                            stops: const [0, 0.4, 0.7],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            if (moreLabel != null) ...[
              SizedBox(height: rn.vs(10)),
              Container(height: 0.5, color: AppColors.strokePrimary),
              SizedBox(height: rn.vs(10)),
              Padding(
                padding: EdgeInsets.only(bottom: rn.mvs(2)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      moreLabel!,
                      textAlign: TextAlign.center,
                      style: ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, 18, AppColors.mediumEmphasis),
                    ),
                    SizedBox(width: rn.s(5)),
                    SvgPicture.asset(
                      'assets/icons/chevronRight.svg',
                      width: 20,
                      height: 20,
                      colorFilter: const ColorFilter.mode(AppColors.mediumEmphasis, BlendMode.srcIn),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

Widget _sheetSpinner() => const Padding(
  padding: EdgeInsets.symmetric(vertical: 40),
  child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
);

Widget _sheetEmpty(String text, {TextStyle? style}) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 40),
  child: Center(
    child: Text(text, textAlign: TextAlign.center, style: style ?? ReviewText.raw(AppFonts.ibmPlexSerifRegular, 14, null, AppColors.mediumEmphasis)),
  ),
);

/// Port of RN's `ThreadsBottomSheet`: "Comments", then Inline / General
/// tabs — every transcript-anchored thread, or the review's general
/// comments with an "Add comment" footer.
class _ThreadsPage extends ConsumerStatefulWidget {
  const _ThreadsPage({required this.sheetContext, required this.onThreadPress, required this.onReplyPress});

  final ReviewSheetContext sheetContext;
  final ValueChanged<String> onThreadPress;
  final ValueChanged<ThreadComment> onReplyPress;

  @override
  ConsumerState<_ThreadsPage> createState() => _ThreadsPageState();
}

class _ThreadsPageState extends ConsumerState<_ThreadsPage> {
  static const _limit = 20;
  int _tab = 0;
  final List<ReviewThread> _threads = [];
  int _count = 0;
  bool _loading = false;
  bool _loadedOnce = false;
  late final CommentListController _general = _generalController();

  CommentListController _generalController() {
    final c = widget.sheetContext;
    return CommentListController(
      api: c.api,
      currentUser: c.currentUser,
      fetchPage: (offset, limit) => c.api.getGeneralComments(c.reviewId, offset: offset, limit: limit),
      addComment: (content) async =>
          (await c.api.addComment(reviewId: c.reviewId, threadId: c.generalCommentsThreadId, content: content)).comment,
      onChanged: (change) {
        if (change is CommentAdded || change is CommentDeleted) c.onReviewChanged();
      },
    );
  }

  @override
  void initState() {
    super.initState();
    _loadThreads();
  }

  @override
  void dispose() {
    _general.dispose();
    super.dispose();
  }

  Future<void> _loadThreads() async {
    if (_loading || (_loadedOnce && _threads.length >= _count)) return;
    setState(() => _loading = true);
    try {
      final page = await widget.sheetContext.api.getThreads(
        widget.sheetContext.reviewId,
        offset: _threads.length,
        limit: _limit,
      );
      if (!mounted) return;
      setState(() {
        _threads.addAll(page.threads);
        _count = page.count;
      });
    } catch (_) {
      // RN shows the empty state.
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadedOnce = true;
        });
      }
    }
  }

  void _selectTab(int tab) {
    setState(() => _tab = tab);
    if (tab == 1 && !_general.hasLoadedOnce && !_general.isLoading) _general.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final labels = [ref.t('threadsBottomSheet.tabInline'), ref.t('threadsBottomSheet.tabGeneral')];
    return Column(
      children: [
        ReviewSheetTitle(title: ref.t('threadsBottomSheet.title')),
        Row(
          children: [
            for (final (i, label) in labels.indexed)
              Expanded(
                child: GestureDetector(
                  key: ValueKey('threads-tab-$i'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => _selectTab(i),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 48),
                    padding: const EdgeInsets.all(10),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: i == _tab ? AppColors.primary : Colors.transparent, width: 2),
                      ),
                    ),
                    child: Text(
                      label,
                      style: ReviewText.style(
                        RnType.bodySmall,
                        AppFonts.ibmPlexSerifMedium,
                        i == _tab ? AppColors.primary : AppColors.lowEmphasis,
                        weight: FontWeight.w400,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
        Expanded(
          child: _tab == 0
              ? _inlineList(rn)
              : _GeneralList(
                  controller: _general,
                  sheetContext: widget.sheetContext,
                  onReplyPress: widget.onReplyPress,
                ),
        ),
      ],
    );
  }

  Widget _inlineList(RnSize rn) {
    if (!_loadedOnce && _loading) return _sheetSpinner();
    final threads = _threads.where((t) => t.comments.isNotEmpty).toList();
    if (threads.isEmpty) return _sheetEmpty(ref.t('threadsBottomSheet.noThreads'));
    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.extentAfter < n.metrics.viewportDimension * 0.5) _loadThreads();
        return false;
      },
      child: ListView.separated(
        padding: EdgeInsets.only(left: 24, right: 24, top: rn.vs(16), bottom: 24),
        itemCount: threads.length + (_loading ? 1 : 0),
        separatorBuilder: (_, _) => SizedBox(height: rn.vs(16)),
        itemBuilder: (context, i) {
          if (i == threads.length) return _sheetSpinner();
          final thread = threads[i];
          final remaining = thread.commentCount - 1;
          return _ThreadCard(
            thread: thread,
            selectedText: thread.selectedText,
            moreLabel: remaining > 0
                ? (remaining == 1
                      ? ref.t('threadsBottomSheet.moreThreadsOne')
                      : ref.t('threadsBottomSheet.moreThreads', {'count': remaining}))
                : null,
            onPress: () => widget.onThreadPress(thread.id),
          );
        },
      ),
    );
  }
}

/// RN's `GeneralCommentsList` (the threads sheet's General tab) + its
/// "Add comment" footer.
class _GeneralList extends ConsumerStatefulWidget {
  const _GeneralList({required this.controller, required this.sheetContext, required this.onReplyPress});

  final CommentListController controller;
  final ReviewSheetContext sheetContext;
  final ValueChanged<ThreadComment> onReplyPress;

  @override
  ConsumerState<_GeneralList> createState() => _GeneralListState();
}

class _GeneralListState extends ConsumerState<_GeneralList> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.sheetContext;
    return _ControlledCommentPage(
      controller: widget.controller,
      input: _input,
      placeholder: ref.t('threadsBottomSheet.addComment'),
      showFooter: true,
      emptyText: ref.t('threadsBottomSheet.noGeneralComments'),
      deletePrefix: 'threadsBottomSheet',
      listPadding: (rn) => EdgeInsets.only(left: 24, right: 24, top: rn.vs(16), bottom: 24),
      gap: (rn) => rn.vs(16),
      itemBuilder: (comment, onDelete) => ControlledCommentTile(
        comment: comment,
        controller: widget.controller,
        isPrivate: c.isPrivate,
        currentUserId: c.currentUser?.id,
        reviewOwnerId: c.reviewOwnerId,
        onDelete: onDelete,
        onReplyPress: () => widget.onReplyPress(comment),
        disableAddReactionButton: c.isPrivate,
      ),
    );
  }
}

/// The shared body of RN's comment sheets: a paged list driven by a
/// [CommentListController] (spinner until the first page, an empty line,
/// load-more on scroll) and the `CommentBottomSheetFooter` input, which
/// also edits a comment once the actions menu's "Edit" fills it in.
class _ControlledCommentPage extends ConsumerStatefulWidget {
  const _ControlledCommentPage({
    required this.controller,
    required this.input,
    required this.placeholder,
    required this.showFooter,
    required this.emptyText,
    required this.deletePrefix,
    required this.itemBuilder,
    required this.listPadding,
    required this.gap,
    this.header,
  });

  final CommentListController controller;
  final TextEditingController input;
  final String placeholder;
  final bool showFooter;
  final String? emptyText;
  final String deletePrefix;
  final Widget Function(ThreadComment comment, VoidCallback onDelete) itemBuilder;
  final EdgeInsets Function(RnSize rn) listPadding;
  final double Function(RnSize rn) gap;
  final Widget? header;

  @override
  ConsumerState<_ControlledCommentPage> createState() => _ControlledCommentPageState();
}

class _ControlledCommentPageState extends ConsumerState<_ControlledCommentPage> {
  String? _editingId;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    final editing = widget.controller.editingCommentId;
    if (editing != _editingId) {
      _editingId = editing;
      // RN's handleEditComment: the footer input takes the comment's text.
      if (editing != null) {
        final comment = widget.controller.comments.where((c) => c.id == editing).firstOrNull;
        widget.input.text = comment?.content ?? '';
      }
    }
    if (mounted) setState(() {});
  }

  Future<void> _delete(ThreadComment comment) async {
    if (await _confirmDelete(context, ref, widget.deletePrefix)) {
      await widget.controller.delete(comment.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final controller = widget.controller;
    final Widget list;
    if (!controller.hasLoadedOnce) {
      list = _sheetSpinner();
    } else if (controller.comments.isEmpty && widget.header == null) {
      list = widget.emptyText == null ? const SizedBox.shrink() : _sheetEmpty(widget.emptyText!);
    } else {
      list = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < n.metrics.viewportDimension * 0.3) controller.loadMore();
          return false;
        },
        child: ListView(
          padding: widget.listPadding(rn),
          children: [
            for (final (i, comment) in controller.comments.indexed) ...[
              if (i > 0) SizedBox(height: widget.gap(rn)),
              widget.itemBuilder(comment, () => _delete(comment)),
            ],
            if (controller.isLoading) _sheetSpinner(),
          ],
        ),
      );
    }
    return Column(
      children: [
        ?widget.header,
        Expanded(child: list),
        if (widget.showFooter)
          SafeArea(
            top: false,
            child: CommentFooterInput(
              controller: widget.input,
              placeholder: widget.placeholder,
              isLoading: controller.isSubmitting,
              onSubmit: controller.submit,
            ),
          ),
      ],
    );
  }
}

/// Port of RN's `MessageThreadsBottomSheet`: the threads anchored to one
/// transcript message (opened by tapping its highlighted text).
class _MessageThreadsPage extends ConsumerWidget {
  const _MessageThreadsPage({required this.messageContent, required this.threads, required this.onThreadPress});

  final String messageContent;
  final List<ReviewThread> threads;
  final ValueChanged<String> onThreadPress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rn = RnSize.of(context);
    final visible = threads.where((t) => t.comments.isNotEmpty).toList();
    return ListView(
      padding: EdgeInsets.only(left: 24, right: 24, top: rn.vs(16), bottom: rn.vs(32)),
      children: [
        ReviewSheetTitle(title: ref.t('threadsBottomSheet.title')),
        if (visible.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: rn.vs(48)),
            child: Text(
              ref.t('messageThreadsBottomSheet.noThreads'),
              textAlign: TextAlign.center,
              style: ReviewText.serif(RnType.bodyLarge, AppColors.lowEmphasis),
            ),
          ),
        for (final thread in visible) ...[
          SizedBox(height: rn.vs(16)),
          _ThreadCard(
            thread: thread,
            // RN slices the message it was opened from, not thread.message.
            selectedText: thread.selection == null || messageContent.trim().isEmpty
                ? null
                : jsSlice(messageContent, thread.selection!.startIndex, thread.selection!.endIndex),
            moreLabel: thread.comments.length > 1 ? ref.t('threadsBottomSheet.viewMoreComments') : null,
            onPress: () => onThreadPress(thread.id),
          ),
        ],
      ],
    );
  }
}

/// Port of RN's `CommentThreadBottomSheet`: a back header, the thread's
/// comments (each with Reply, reactions and the actions menu) and an
/// "Add comment" footer, hidden on a private review.
class _CommentThreadPage extends ConsumerStatefulWidget {
  const _CommentThreadPage({
    super.key,
    required this.sheetContext,
    required this.threadId,
    required this.onBack,
    required this.onReplyPress,
  });

  final ReviewSheetContext sheetContext;
  final String threadId;
  final VoidCallback onBack;
  final ValueChanged<ThreadComment> onReplyPress;

  @override
  ConsumerState<_CommentThreadPage> createState() => _CommentThreadPageState();
}

class _CommentThreadPageState extends ConsumerState<_CommentThreadPage> {
  final _input = TextEditingController();
  late final CommentListController _controller;

  @override
  void initState() {
    super.initState();
    final c = widget.sheetContext;
    _controller = CommentListController(
      api: c.api,
      currentUser: c.currentUser,
      fetchPage: (offset, limit) => c.api.getThreadComments(widget.threadId, offset: offset, limit: limit),
      addComment: (content) async =>
          (await c.api.addComment(reviewId: c.reviewId, threadId: widget.threadId, content: content)).comment,
      onChanged: (change) {
        c.onThreadChange(widget.threadId, change);
        if (change is CommentAdded || change is CommentDeleted) c.onReviewChanged();
      },
    )..refresh();
  }

  @override
  void dispose() {
    _controller.dispose();
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.sheetContext;
    return _ControlledCommentPage(
      controller: _controller,
      input: _input,
      header: ReviewSheetBackHeader(title: ref.t('commentThreadBottomSheet.title'), onBack: widget.onBack),
      placeholder: ref.t('commentThreadBottomSheet.addComment'),
      showFooter: !c.isPrivate,
      emptyText: ref.t('commentThreadBottomSheet.noComments'),
      deletePrefix: 'commentThreadBottomSheet',
      listPadding: (rn) => EdgeInsets.only(left: rn.s(24), right: rn.s(24), top: rn.vs(12), bottom: 150),
      gap: (rn) => rn.vs(12),
      itemBuilder: (comment, onDelete) => ControlledCommentTile(
        comment: comment,
        controller: _controller,
        isPrivate: c.isPrivate,
        currentUserId: c.currentUser?.id,
        reviewOwnerId: c.reviewOwnerId,
        onDelete: onDelete,
        onReplyPress: () => widget.onReplyPress(comment),
      ),
    );
  }
}

/// Port of RN's `ReplyBottomSheet`: a back header, the comment being
/// replied to, its replies indented 54@s, and an "Add reply" footer
/// (hidden on a private review). Deleting the original goes back.
class _ReplyPage extends ConsumerStatefulWidget {
  const _ReplyPage({super.key, required this.sheetContext, required this.original, required this.onBack});

  final ReviewSheetContext sheetContext;
  final ThreadComment original;
  final VoidCallback onBack;

  @override
  ConsumerState<_ReplyPage> createState() => _ReplyPageState();
}

class _ReplyPageState extends ConsumerState<_ReplyPage> {
  final _input = TextEditingController();
  late ThreadComment _original = widget.original;
  late final CommentListController _replies;

  @override
  void initState() {
    super.initState();
    final c = widget.sheetContext;
    _replies = CommentListController(
      api: c.api,
      currentUser: c.currentUser,
      fetchPage: (offset, limit) => c.api.getCommentReplies(widget.original.id, offset: offset, limit: limit),
      addComment: (content) async =>
          (await c.api.addComment(reviewId: c.reviewId, parentCommentId: widget.original.id, content: content)).reply,
      onChanged: (change) {
        if (change is CommentAdded || change is CommentDeleted) c.onReviewChanged();
      },
    )..refresh();
  }

  @override
  void dispose() {
    _replies.dispose();
    _input.dispose();
    super.dispose();
  }

  Future<void> _deleteOriginal() async {
    if (!await _confirmDelete(context, ref, 'replyBottomSheet')) return;
    try {
      await widget.sheetContext.api.deleteComment(_original.id);
      widget.sheetContext.onReviewChanged();
    } catch (_) {
      // RN only logs this.
    }
    widget.onBack();
  }

  Future<void> _hideOriginal(bool hidden) async {
    try {
      await widget.sheetContext.api.updateCommentVisibility(commentId: _original.id, hidden: hidden);
      if (mounted) setState(() => _original = _original.copyWith(hidden: hidden));
    } catch (_) {}
  }

  Future<void> _reactOriginal(String? current, String unicode) async {
    final action = reactionActionFor(current, unicode);
    try {
      await widget.sheetContext.api.addReactionToComment(commentId: _original.id, reaction: unicode, action: action);
      if (mounted) {
        setState(() => _original = CommentListController.applyReaction(_original, current, unicode, action));
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final c = widget.sheetContext;
    return _ControlledCommentPage(
      controller: _replies,
      input: _input,
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ReviewSheetBackHeader(title: ref.t('replyBottomSheet.title'), onBack: widget.onBack),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: rn.s(24), vertical: rn.vs(12)),
            child: ReviewCommentTile(
              comment: _original,
              showReplyButton: false,
              onEmojiSelect: _reactOriginal,
              currentUserId: c.currentUser?.id,
              reviewOwnerId: c.reviewOwnerId,
              onDelete: _deleteOriginal,
              onHide: _hideOriginal,
              showActionsMenu: !c.isPrivate,
              disableAddReactionButton: c.isPrivate,
            ),
          ),
        ],
      ),
      placeholder: ref.t('replyBottomSheet.addReply'),
      showFooter: !c.isPrivate,
      emptyText: null,
      deletePrefix: 'replyBottomSheet',
      listPadding: (rn) => EdgeInsets.only(left: rn.s(54), right: rn.s(24), top: rn.vs(12), bottom: 250),
      gap: (rn) => rn.vs(12),
      itemBuilder: (reply, onDelete) => ControlledCommentTile(
        comment: reply,
        controller: _replies,
        isPrivate: c.isPrivate,
        currentUserId: c.currentUser?.id,
        reviewOwnerId: c.reviewOwnerId,
        onDelete: onDelete,
        showReplyButton: false,
      ),
    );
  }
}

/// Port of RN's `CommentInput`: the short sheet (25%, no handle) that opens
/// after "Add comment" on a transcript selection — a grey pill input and
/// the send button. Returns the typed comment, or null if dismissed.
Future<String?> showTranscriptCommentInput(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    barrierColor: Colors.black.withValues(alpha: 0.5),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    builder: (context) => const _CommentInputSheet(),
  );
}

class _CommentInputSheet extends ConsumerStatefulWidget {
  const _CommentInputSheet();

  @override
  ConsumerState<_CommentInputSheet> createState() => _CommentInputSheetState();
}

class _CommentInputSheetState extends ConsumerState<_CommentInputSheet> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text;
    if (text.trim().isEmpty) return;
    Navigator.of(context).pop(text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final style = ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Padding(
        padding: EdgeInsets.only(left: 24, right: 24, top: rn.mvs(12), bottom: rn.mvs(30)),
        child: Row(
          children: [
            Expanded(
              child: ReviewPillInput(
                key: const Key('transcript-comment-input'),
                controller: _controller,
                placeholder: ref.t('commentInput.placeholder'),
                fillColor: AppColors.lightGray,
                autofocus: true,
                textStyle: style,
                onSubmitted: (_) => _send(),
              ),
            ),
            const SizedBox(width: 8),
            SendArrowButton(onPressed: _send, enabled: _controller.text.trim().isNotEmpty),
          ],
        ),
      ),
    );
  }
}
