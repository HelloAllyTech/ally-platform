import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_chat_input.dart';
import '../../../core/widgets/confirmation_modal.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../account/data/account_repository.dart';
import '../../reactions/data/emoji_catalog.dart';
import '../../reactions/data/reactions_repository.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';

/// Mirrors ally-mobile (React Native)'s `EDIT_COMMENT_TIME_LIMIT_MINUTES` —
/// editing a comment is only offered within this window of posting it
/// (`ReviewComment.tsx`'s `getMenuOptions`/`isMinutesPassed` gate).
const _editCommentTimeLimitMinutes = 10;

/// Mirrors ally-mobile (React Native)'s `isMinutesPassed` — same private
/// helper this codebase already duplicates per-file (see
/// `review_details_screen.dart`'s own copy).
bool _isMinutesPassed(String dateString, {int minutes = _editCommentTimeLimitMinutes}) {
  if (dateString.trim().isEmpty) return true;
  final diff = DateTime.now().toUtc().difference(DateTime.parse(dateString).toUtc());
  return diff.inSeconds / 60 >= minutes;
}

/// Port of ally-mobile (React Native)'s thread-detail view — a transcript-
/// anchored discussion (`Thread`/`MessageThreadComment`): the anchor
/// message, the root comment, further replies (paginated via
/// `getCommentReplies`), a reply box, and a per-comment reaction picker
/// (`addReactionToComment`). Starting a brand-new thread from a fresh
/// transcript selection isn't wired here — see
/// `reviews_repository.dart`'s `addThreadReply` doc comment for why.
///
/// [reviewType] picks simulation vs. scribe endpoints, same role it plays
/// in `ReviewDetailsScreen` — see that class's doc comment.
class ThreadDetailScreen extends ConsumerStatefulWidget {
  const ThreadDetailScreen({
    super.key,
    required this.reviewId,
    required this.thread,
    required this.reviewOwnerId,
    required this.isPrivate,
    this.reviewType = ReviewType.simulation,
  });

  final String reviewId;
  final ReviewThread thread;

  /// The review's owner (a different identity from a comment's own
  /// author) — gates the Hide/Unhide menu item, same as RN's
  /// `ReviewComment.tsx`'s `reviewOwnerId` prop.
  final int reviewOwnerId;

  /// Mirrors ally-mobile (React Native)'s `ReplyBottomSheet.tsx`'s
  /// `isPrivate` prop (`reviewStatus === 'HIDDEN'`): while true, a
  /// comment's whole actions menu is hidden outright (`showActionsMenu`),
  /// the reply composer at the bottom disappears entirely
  /// (`footerComponent={isPrivate ? undefined : ...}`), and — a real,
  /// confirmed asymmetry in RN's own source, not a simplification made
  /// here — only the root/anchor comment's reaction button is disabled
  /// (`disableAddReactionButton`); `renderReplyItem` never passes that prop
  /// at all, so each reply's reaction button stays fully interactive even
  /// on a private review.
  final bool isPrivate;
  final ReviewType reviewType;

  bool get _isScribe => reviewType == ReviewType.scribe;

  @override
  ConsumerState<ThreadDetailScreen> createState() => _ThreadDetailScreenState();
}

class _ThreadDetailScreenState extends ConsumerState<ThreadDetailScreen> {
  final _replyController = TextEditingController();
  final _editController = TextEditingController();
  late List<ThreadComment> _comments;
  bool _isLoadingReplies = false;
  bool _hasLoadedReplies = false;
  bool _isSubmitting = false;

  /// The comment currently swapped out for an inline edit field — mirrors
  /// RN's `editingCommentId` (`useCommentActions`).
  String? _editingCommentId;

  ThreadComment? get _rootComment => widget.thread.comments.firstOrNull;

  @override
  void initState() {
    super.initState();
    _comments = List.of(widget.thread.comments);
    if (widget.thread.commentCount > _comments.length) _loadReplies();
  }

  @override
  void dispose() {
    _replyController.dispose();
    _editController.dispose();
    super.dispose();
  }

  Future<void> _loadReplies() async {
    final root = _rootComment;
    if (root == null || _isLoadingReplies) return;
    setState(() => _isLoadingReplies = true);
    try {
      final result = widget._isScribe
          ? await ref
              .read(scribeReviewsRepositoryProvider)
              .getCommentReplies(root.id, limit: 50)
          : await ref
              .read(reviewsRepositoryProvider)
              .getCommentReplies(root.id, limit: 50);
      setState(() {
        final seenIds = _comments.map((c) => c.id).toSet();
        _comments.addAll(result.replies.where((r) => !seenIds.contains(r.id)));
        _hasLoadedReplies = true;
      });
    } catch (_) {
      // Stays retryable via the "Load replies" button below.
    } finally {
      if (mounted) setState(() => _isLoadingReplies = false);
    }
  }

  Future<void> _submitReply() async {
    final content = _replyController.text.trim();
    if (content.isEmpty) return;
    setState(() => _isSubmitting = true);
    try {
      if (widget._isScribe) {
        await ref
            .read(scribeReviewsRepositoryProvider)
            .addThreadReply(
              reviewId: widget.reviewId,
              threadId: widget.thread.id,
              content: content,
            );
      } else {
        await ref
            .read(reviewsRepositoryProvider)
            .addThreadReply(
              reviewId: widget.reviewId,
              threadId: widget.thread.id,
              content: content,
            );
      }
      _replyController.clear();
      _hasLoadedReplies = false;
      await _loadReplies();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _react(ThreadComment comment, String reactionId) async {
    if (widget._isScribe) {
      await ref
          .read(scribeReactionsRepositoryProvider)
          .addReactionToComment(
            commentId: comment.id,
            reaction: reactionId,
            action: ReactionAction.add,
          );
    } else {
      await ref
          .read(reactionsRepositoryProvider)
          .addReactionToComment(
            commentId: comment.id,
            reaction: reactionId,
            action: ReactionAction.add,
          );
    }
    if (mounted) setState(() => _hasLoadedReplies = false);
    await _loadReplies();
  }

  /// Mirrors RN's `handleEditCommentInline` — starts an inline edit, no
  /// modal (see `GeneralCommentsSection.tsx`/`CommentThreadBottomSheet.tsx`).
  void _startEdit(ThreadComment comment) {
    setState(() {
      _editingCommentId = comment.id;
      _editController.text = comment.content;
    });
  }

  void _cancelEdit() {
    setState(() => _editingCommentId = null);
  }

  Future<void> _submitEdit(String commentId) async {
    final content = _editController.text.trim();
    if (content.isEmpty) return;
    setState(() => _isSubmitting = true);
    try {
      if (widget._isScribe) {
        await ref
            .read(scribeReviewsRepositoryProvider)
            .updateComment(commentId: commentId, content: content);
      } else {
        await ref.read(reviewsRepositoryProvider).updateComment(commentId: commentId, content: content);
      }
      if (!mounted) return;
      setState(() {
        _comments = [
          for (final c in _comments)
            if (c.id == commentId) c.copyWith(content: content) else c,
        ];
        _editingCommentId = null;
      });
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  /// Mirrors RN's `handleDeleteComment`/`ConfirmationModal` pair in
  /// `CommentThreadBottomSheet.tsx`.
  Future<void> _confirmAndDelete(String commentId) async {
    final confirmed = await ConfirmationModal.show(
      context,
      title: ref.t('commentThreadBottomSheet.deleteConfirmation.title'),
      description: ref.t('commentThreadBottomSheet.deleteConfirmation.description'),
      confirmLabel: ref.t('commentThreadBottomSheet.deleteConfirmation.confirm'),
      cancelLabel: ref.t('commentThreadBottomSheet.deleteConfirmation.cancel'),
      confirmVariant: AppButtonVariant.destructive,
    );
    if (confirmed != true) return;
    try {
      if (widget._isScribe) {
        await ref.read(scribeReviewsRepositoryProvider).deleteComment(commentId);
      } else {
        await ref.read(reviewsRepositoryProvider).deleteComment(commentId);
      }
      if (!mounted) return;
      setState(() => _comments = _comments.where((c) => c.id != commentId).toList());
      // Matches RN's `deleteComment` tag invalidation (`ReviewThreads`) —
      // the thread list's reply count needs to reflect the removal.
      ref.invalidate(
        widget._isScribe
            ? scribeReviewThreadsProvider(widget.reviewId)
            : reviewThreadsProvider(widget.reviewId),
      );
    } catch (_) {
      // RN only logs this (console.error) and leaves the comment in place.
    }
  }

  Future<void> _toggleHidden(ThreadComment comment) async {
    final hidden = !comment.hidden;
    try {
      if (widget._isScribe) {
        await ref
            .read(scribeReviewsRepositoryProvider)
            .updateCommentVisibility(commentId: comment.id, hidden: hidden);
      } else {
        await ref
            .read(reviewsRepositoryProvider)
            .updateCommentVisibility(commentId: comment.id, hidden: hidden);
      }
      if (!mounted) return;
      setState(() {
        _comments = [
          for (final c in _comments)
            if (c.id == comment.id) c.copyWith(hidden: hidden) else c,
        ];
      });
    } catch (_) {
      // RN only logs this (console.error) and leaves the comment as-is.
    }
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.thread.message;
    final remainingCount = widget.thread.commentCount - _comments.length;
    final currentUserId = ref.watch(currentUserProvider).value?.id;

    return Scaffold(
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('commentThreadBottomSheet.title')),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (message != null)
                  AppCard(
                    variant: AppCardVariant.flat,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            message.senderId == -1
                                ? ref.t('review.details.clientSaid')
                                : ref.t('review.details.learnerSaid'),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            message.content,
                            style: const TextStyle(fontStyle: FontStyle.italic),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                for (final comment in _comments)
                  _CommentTile(
                    comment: comment,
                    onReact: _react,
                    isEditing: _editingCommentId == comment.id,
                    editController: _editController,
                    onStartEdit: () => _startEdit(comment),
                    onSubmitEdit: () => _submitEdit(comment.id),
                    onCancelEdit: _cancelEdit,
                    onDelete: () => _confirmAndDelete(comment.id),
                    onToggleHidden: () => _toggleHidden(comment),
                    // RN's `showActionsMenu={!isPrivate}` hides the whole
                    // menu trigger outright on a private review, regardless
                    // of ownership.
                    canEditOrDelete:
                        !widget.isPrivate &&
                        currentUserId != null &&
                        comment.authorId != null &&
                        currentUserId == comment.authorId &&
                        !comment.hidden,
                    canEdit:
                        !widget.isPrivate &&
                        currentUserId != null &&
                        comment.authorId != null &&
                        currentUserId == comment.authorId &&
                        !comment.hidden &&
                        !_isMinutesPassed(comment.createdAt ?? ''),
                    canHide:
                        !widget.isPrivate && currentUserId != null && currentUserId == widget.reviewOwnerId,
                    // RN only passes `disableAddReactionButton` on the
                    // root/anchor comment, never on a reply — see the class
                    // doc's note on this asymmetry.
                    disableReactions: widget.isPrivate && comment.id == _rootComment?.id,
                  ),
                if (remainingCount > 0 && !_hasLoadedReplies)
                  Center(
                    child: TextButton(
                      onPressed: _isLoadingReplies ? null : _loadReplies,
                      child: _isLoadingReplies
                          ? const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(
                              remainingCount == 1
                                  ? ref.t('review.details.loadMoreRepliesOne')
                                  : ref.t(
                                      'review.details.loadMoreReplies',
                                      {'count': remainingCount},
                                    ),
                            ),
                    ),
                  ),
              ],
            ),
          ),
          // Mirrors RN's `footerComponent={isPrivate ? undefined :
          // renderFooterComponent}` — the reply composer disappears
          // entirely on a private review, not just disabled.
          if (!widget.isPrivate)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: AppChatInput(
                  controller: _replyController,
                  placeholder: ref.t('review.details.replyPlaceholder'),
                  enabled: !_isSubmitting,
                  onSend: _submitReply,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Mirrors RN's `ReviewComment.tsx`'s per-comment menu, built here as a
/// `PopupMenuButton` instead of RN's `ActionsMenu` bottom sheet: Edit/Delete
/// gated on comment ownership (plus the edit time window for Edit
/// specifically, and never on an already-hidden comment), Hide/Unhide
/// gated on review ownership — a different identity, so both groups can
/// appear together for a reviewer commenting on their own review.
class _CommentTile extends ConsumerWidget {
  const _CommentTile({
    required this.comment,
    required this.onReact,
    required this.isEditing,
    required this.editController,
    required this.onStartEdit,
    required this.onSubmitEdit,
    required this.onCancelEdit,
    required this.onDelete,
    required this.onToggleHidden,
    required this.canEditOrDelete,
    required this.canEdit,
    required this.canHide,
    required this.disableReactions,
  });

  final ThreadComment comment;
  final void Function(ThreadComment comment, String reactionId) onReact;
  final bool isEditing;
  final TextEditingController editController;
  final VoidCallback onStartEdit;
  final VoidCallback onSubmitEdit;
  final VoidCallback onCancelEdit;
  final VoidCallback onDelete;
  final VoidCallback onToggleHidden;
  final bool canEditOrDelete;
  final bool canEdit;
  final bool canHide;

  /// Mirrors RN's `disableAddReactionButton` — only ever true for the
  /// root/anchor comment on a private review; see the class doc on
  /// [ThreadDetailScreen.isPrivate] for why replies never get this.
  final bool disableReactions;

  bool get _hasMenu => canEditOrDelete || canHide;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        // RN's shared ReviewComment component: name is
                        // IBM_PLEX_SERIF.MEDIUM — titleSmall already matches
                        // family and size, just needs the Medium weight.
                        Flexible(
                          child: Text(
                            comment.authorName,
                            style: Theme.of(
                              context,
                            ).textTheme.titleSmall?.copyWith(fontFamily: AppFonts.ibmPlexSerifMedium),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (comment.hidden) ...[
                          const SizedBox(width: 8),
                          Icon(Icons.visibility_off_outlined, size: 14, color: Theme.of(context).hintColor),
                          const SizedBox(width: 2),
                          Text(
                            ref.t('review.hidden'),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (!isEditing && _hasMenu)
                    PopupMenuButton<String>(
                      key: const Key('comment-actions-menu'),
                      icon: const Icon(Icons.more_vert, size: 18),
                      onSelected: (action) {
                        switch (action) {
                          case 'edit':
                            onStartEdit();
                          case 'delete':
                            onDelete();
                          case 'hide':
                            onToggleHidden();
                        }
                      },
                      itemBuilder: (context) => [
                        if (canEdit)
                          PopupMenuItem(value: 'edit', child: Text(ref.t('review.details.edit'))),
                        if (canEditOrDelete)
                          PopupMenuItem(
                            value: 'delete',
                            child: Text(ref.t('review.details.delete')),
                          ),
                        if (canHide)
                          PopupMenuItem(
                            value: 'hide',
                            child: Text(
                              ref.t(comment.hidden ? 'review.details.unhide' : 'review.details.hide'),
                            ),
                          ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 4),
              if (isEditing)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      key: const Key('comment-edit-field'),
                      controller: editController,
                      autofocus: true,
                      maxLines: null,
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: onCancelEdit,
                          child: Text(ref.t('common.cancel')),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
                          key: const Key('comment-edit-save'),
                          onPressed: onSubmitEdit,
                          child: Text(ref.t('common.save')),
                        ),
                      ],
                    ),
                  ],
                )
              else
                Text(comment.content, style: comment.hidden ? const TextStyle(color: Colors.grey) : null),
              const SizedBox(height: 8),
              if (!isEditing)
                Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    // `entry.key` is the backend's unicode-codepoint reaction
                    // id (e.g. "1f44d"), not the glyph — same ids RN's
                    // EMOJI_UNICODE_MAP keys off, so a reaction added from
                    // either client renders correctly in both.
                    for (final entry in comment.reactions.entries)
                      Chip(
                        label: Text('${emojiGlyphFor(entry.key)} ${entry.value}'),
                        visualDensity: VisualDensity.compact,
                        backgroundColor: comment.myReaction == entry.key
                            ? Theme.of(context).colorScheme.primaryContainer
                            : null,
                      ),
                    // RN keeps the icon visible but inert
                    // (`disableAddReactionButton`) rather than hiding it —
                    // matched here with a plain, non-interactive icon.
                    if (disableReactions)
                      SvgPicture.asset('assets/icons/addReaction.svg', width: 18, height: 18)
                    else
                      PopupMenuButton<String>(
                        icon: SvgPicture.asset('assets/icons/addReaction.svg', width: 18, height: 18),
                        onSelected: (reactionId) => onReact(comment, reactionId),
                        itemBuilder: (context) => [
                          for (final id in kPlatformEmojiIds)
                            PopupMenuItem(
                              value: id,
                              child: Text(
                                emojiGlyphFor(id),
                                style: const TextStyle(fontSize: 18),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}
