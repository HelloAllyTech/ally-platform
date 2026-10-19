import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_chat_input.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../../reactions/data/reactions_repository.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';

const _availableReactions = ['👍', '❤️', '😂', '🎉', '👏'];

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
    this.reviewType = ReviewType.simulation,
  });

  final String reviewId;
  final ReviewThread thread;
  final ReviewType reviewType;

  bool get _isScribe => reviewType == ReviewType.scribe;

  @override
  ConsumerState<ThreadDetailScreen> createState() => _ThreadDetailScreenState();
}

class _ThreadDetailScreenState extends ConsumerState<ThreadDetailScreen> {
  final _replyController = TextEditingController();
  late List<ThreadComment> _comments;
  bool _isLoadingReplies = false;
  bool _hasLoadedReplies = false;
  bool _isSubmitting = false;

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

  Future<void> _react(ThreadComment comment, String emoji) async {
    if (widget._isScribe) {
      await ref
          .read(scribeReactionsRepositoryProvider)
          .addReactionToComment(
            commentId: comment.id,
            reaction: emoji,
            action: ReactionAction.add,
          );
    } else {
      await ref
          .read(reactionsRepositoryProvider)
          .addReactionToComment(
            commentId: comment.id,
            reaction: emoji,
            action: ReactionAction.add,
          );
    }
    if (mounted) setState(() => _hasLoadedReplies = false);
    await _loadReplies();
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.thread.message;
    final remainingCount = widget.thread.commentCount - _comments.length;

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
                  _CommentTile(comment: comment, onReact: _react),
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

class _CommentTile extends StatelessWidget {
  const _CommentTile({required this.comment, required this.onReact});

  final ThreadComment comment;
  final void Function(ThreadComment comment, String emoji) onReact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        variant: AppCardVariant.flat,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                comment.authorName,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 4),
              Text(comment.content),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final entry in comment.reactions.entries)
                    Chip(
                      label: Text('${entry.key} ${entry.value}'),
                      visualDensity: VisualDensity.compact,
                      backgroundColor: comment.myReaction == entry.key
                          ? Theme.of(context).colorScheme.primaryContainer
                          : null,
                    ),
                  PopupMenuButton<String>(
                    icon: SvgPicture.asset('assets/icons/addReaction.svg', width: 18, height: 18),
                    onSelected: (emoji) => onReact(comment, emoji),
                    itemBuilder: (context) => [
                      for (final emoji in _availableReactions)
                        PopupMenuItem(
                          value: emoji,
                          child: Text(
                            emoji,
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
