import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_chat_input.dart';
import '../data/reviews_repository.dart';
import 'thread_detail_screen.dart';

/// Scoped port of ally-mobile (React Native)'s `ReviewDetailsScreen` — the
/// review note + author, a flat general discussion (matching
/// `generalCommentsApi.ts`'s scope exactly), and transcript-anchored
/// discussion threads (`reviewThreadsApi.ts`'s `getThreads` — see
/// `ThreadDetailScreen` for replies + comment-level reactions). Starting a
/// *new* thread from a fresh transcript selection, and review-status
/// updates (approve/request changes), are real further work — see
/// `reviews_repository.dart`'s doc comments.
class ReviewDetailsScreen extends ConsumerStatefulWidget {
  const ReviewDetailsScreen({super.key, required this.reviewId});

  final String reviewId;

  @override
  ConsumerState<ReviewDetailsScreen> createState() =>
      _ReviewDetailsScreenState();
}

class _ReviewDetailsScreenState extends ConsumerState<ReviewDetailsScreen> {
  final _commentController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submitComment() async {
    final content = _commentController.text.trim();
    if (content.isEmpty) return;
    setState(() => _isSubmitting = true);
    try {
      await ref
          .read(reviewsRepositoryProvider)
          .addGeneralComment(reviewId: widget.reviewId, content: content);
      _commentController.clear();
      ref.invalidate(generalCommentsProvider(widget.reviewId));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reviewAsync = ref.watch(reviewDetailProvider(widget.reviewId));

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(ref.t('review.title')),
          actions: [
            IconButton(
              icon: SvgPicture.asset('assets/icons/smile.svg', width: 24, height: 24),
              tooltip: ref.t('review.reactionsModal.title'),
              onPressed: () => context.push('/reactions/${widget.reviewId}'),
            ),
          ],
          bottom: TabBar(
            tabs: [
              Tab(text: ref.t('courses.discussion.heading')),
              Tab(text: ref.t('review.details.threadsTab')),
            ],
          ),
        ),
        body: reviewAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Text('${ref.t('review.error.loadReviewFailed')}: $error'),
          ),
          data: (review) => Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          backgroundImage:
                              review.createdBy.profileImage.isNotEmpty
                              ? NetworkImage(review.createdBy.profileImage)
                              : null,
                        ),
                        const SizedBox(width: 12),
                        Text(
                          review.createdBy.name,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(review.note),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: TabBarView(
                  children: [
                    _buildDiscussionTab(),
                    _ThreadsTab(reviewId: widget.reviewId),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDiscussionTab() {
    final commentsAsync = ref.watch(generalCommentsProvider(widget.reviewId));

    return Column(
      children: [
        Expanded(
          child: commentsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => Center(
              child: Text(
                '${ref.t('review.error.loadCommentsFailed')}: $error',
              ),
            ),
            data: (comments) => comments.isEmpty
                ? Center(child: Text(ref.t('review.details.noCommentsYet')))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: comments.length,
                    itemBuilder: (context, index) {
                      final comment = comments[index];
                      return ListTile(
                        dense: true,
                        leading: SvgPicture.asset('assets/icons/chatBubble.svg', width: 20, height: 20),
                        title: Text(comment.authorName),
                        subtitle: Text(comment.content),
                      );
                    },
                  ),
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: AppChatInput(
              controller: _commentController,
              placeholder: ref.t('review.details.addCommentPlaceholder'),
              enabled: !_isSubmitting,
              onSend: _submitComment,
            ),
          ),
        ),
      ],
    );
  }
}

class _ThreadsTab extends ConsumerWidget {
  const _ThreadsTab({required this.reviewId});

  final String reviewId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadsAsync = ref.watch(reviewThreadsProvider(reviewId));

    return threadsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Text('${ref.t('review.error.loadThreadsFailed')}: $error'),
      ),
      data: (threads) => threads.isEmpty
          ? Center(child: Text(ref.t('threadsBottomSheet.noThreads')))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: threads.length,
              itemBuilder: (context, index) {
                final thread = threads[index];
                final rootComment = thread.comments.firstOrNull;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: AppCard(
                    variant: AppCardVariant.flat,
                    child: ListTile(
                      title: Text(
                        thread.message?.content ?? '(transcript moment)',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontStyle: FontStyle.italic),
                      ),
                      subtitle: rootComment != null
                          ? Text(
                              '${rootComment.authorName}: ${rootComment.content}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            )
                          : null,
                      trailing: Text('${thread.commentCount}'),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ThreadDetailScreen(
                            reviewId: reviewId,
                            thread: thread,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
    );
  }
}
