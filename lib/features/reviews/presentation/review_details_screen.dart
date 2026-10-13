import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/reviews_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `ReviewDetailsScreen` — the
/// review note + author, plus a real flat discussion (general comments,
/// matching `generalCommentsApi.ts`'s scope exactly). Transcript-anchored
/// threaded comments (replies to a specific message/selection), reactions
/// on individual comments, and review-status updates (approve/request
/// changes) are real further work, not ported here.
class ReviewDetailsScreen extends ConsumerStatefulWidget {
  const ReviewDetailsScreen({super.key, required this.reviewId});

  final String reviewId;

  @override
  ConsumerState<ReviewDetailsScreen> createState() => _ReviewDetailsScreenState();
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
    final commentsAsync = ref.watch(generalCommentsProvider(widget.reviewId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Review'),
        actions: [
          IconButton(
            icon: const Icon(Icons.emoji_emotions_outlined),
            tooltip: 'Reactions',
            onPressed: () => context.push('/reactions/${widget.reviewId}'),
          ),
        ],
      ),
      body: reviewAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load review: $error')),
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
                        backgroundImage: review.createdBy.profileImage.isNotEmpty
                            ? NetworkImage(review.createdBy.profileImage)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Text(review.createdBy.name, style: Theme.of(context).textTheme.titleMedium),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(review.note),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: commentsAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(child: Text('Failed to load comments: $error')),
                data: (comments) => comments.isEmpty
                    ? const Center(child: Text('No comments yet.'))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: comments.length,
                        itemBuilder: (context, index) {
                          final comment = comments[index];
                          return ListTile(
                            dense: true,
                            leading: const Icon(Icons.comment_outlined),
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
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _commentController,
                        decoration: const InputDecoration(
                          hintText: 'Add a comment...',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.send),
                      onPressed: _isSubmitting ? null : _submitComment,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
