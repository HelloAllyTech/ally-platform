import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/reviews_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `ReviewDetailsScreen` — the
/// review note + author. Comment threads, reactions, and status updates
/// (approve/request changes) are real further work, not ported here.
class ReviewDetailsScreen extends ConsumerWidget {
  const ReviewDetailsScreen({super.key, required this.reviewId});

  final String reviewId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviewAsync = ref.watch(reviewDetailProvider(reviewId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Review'),
        actions: [
          IconButton(
            icon: const Icon(Icons.emoji_emotions_outlined),
            tooltip: 'Reactions',
            onPressed: () => context.push('/reactions/$reviewId'),
          ),
        ],
      ),
      body: reviewAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Failed to load review: $error')),
        data: (review) => Padding(
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
              const SizedBox(height: 16),
              Text(
                '${review.commentsCount} comment${review.commentsCount == 1 ? '' : 's'} '
                '(threaded comments not ported yet)',
                style: const TextStyle(color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
