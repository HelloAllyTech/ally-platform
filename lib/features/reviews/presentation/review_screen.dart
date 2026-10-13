import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/reviews_repository.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen` — review list with
/// mark-read on open. Read/unread filter toggle from the RN screen not
/// exposed yet (always fetches the default sort).
class ReviewScreen extends ConsumerWidget {
  const ReviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviewsAsync = ref.watch(reviewsListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Reviews')),
      body: reviewsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            Center(child: Text('Failed to load reviews: $error')),
        data: (reviews) {
          if (reviews.isEmpty) {
            return const Center(child: Text('No reviews yet.'));
          }
          return ListView.separated(
            itemCount: reviews.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final review = reviews[index];
              return ListTile(
                leading: CircleAvatar(
                  backgroundImage: review.createdBy.profileImage.isNotEmpty
                      ? NetworkImage(review.createdBy.profileImage)
                      : null,
                  child: review.createdBy.profileImage.isEmpty
                      ? Text(
                          review.createdBy.name.isNotEmpty
                              ? review.createdBy.name[0].toUpperCase()
                              : '?',
                        )
                      : null,
                ),
                title: Text(review.summaryName ?? review.createdBy.name),
                subtitle: Text(
                  review.note,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: review.commentsCount > 0
                    ? Chip(label: Text('${review.commentsCount}'))
                    : null,
                onTap: () async {
                  await ref
                      .read(reviewsRepositoryProvider)
                      .markAsRead(review.id);
                  if (context.mounted) context.push('/reviews/${review.id}');
                },
              );
            },
          );
        },
      ),
    );
  }
}
