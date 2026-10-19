import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/reactions_repository.dart';

const _availableReactions = ['👍', '❤️', '😂', '🎉', '👏'];

/// Port of ally-mobile (React Native)'s `ReactionsScreen` — reaction-count
/// summary + who-reacted list for a review, plus an emoji picker to add
/// your own reaction. [reviewType] picks simulation vs. scribe endpoints,
/// same role it plays in `ReviewDetailsScreen`.
class ReactionsScreen extends ConsumerWidget {
  const ReactionsScreen({
    super.key,
    required this.reviewId,
    this.reviewType = ReviewType.simulation,
  });

  final String reviewId;
  final ReviewType reviewType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isScribe = reviewType == ReviewType.scribe;
    final reactionsAsync = isScribe
        ? ref.watch(scribeReactionsListProvider(reviewId))
        : ref.watch(reactionsListProvider(reviewId));
    final countsAsync = isScribe
        ? ref.watch(scribeReactionsCountProvider(reviewId))
        : ref.watch(reactionsCountProvider(reviewId));

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('review.reactionsModal.title'))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              children: [
                for (final emoji in _availableReactions)
                  ActionChip(
                    label: Text(emoji, style: const TextStyle(fontSize: 20)),
                    onPressed: () async {
                      if (isScribe) {
                        await ref
                            .read(scribeReactionsRepositoryProvider)
                            .addReactionToReview(
                              reviewId: reviewId,
                              reaction: emoji,
                              action: ReactionAction.add,
                            );
                        ref.invalidate(scribeReactionsListProvider(reviewId));
                        ref.invalidate(scribeReactionsCountProvider(reviewId));
                      } else {
                        await ref
                            .read(reactionsRepositoryProvider)
                            .addReactionToReview(
                              reviewId: reviewId,
                              reaction: emoji,
                              action: ReactionAction.add,
                            );
                        ref.invalidate(reactionsListProvider(reviewId));
                        ref.invalidate(reactionsCountProvider(reviewId));
                      }
                    },
                  ),
              ],
            ),
          ),
          countsAsync.maybeWhen(
            data: (counts) => counts.isEmpty
                ? const SizedBox.shrink()
                : Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Wrap(
                      spacing: 12,
                      children: [
                        for (final entry in counts.entries)
                          Text('${entry.key} ${entry.value}'),
                      ],
                    ),
                  ),
            orElse: () => const SizedBox.shrink(),
          ),
          const Divider(),
          Expanded(
            child: reactionsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Text(
                  '${ref.t('review.error.loadReactionsFailed')}: $error',
                ),
              ),
              data: (reactions) {
                if (reactions.isEmpty) {
                  return Center(
                    child: Text(ref.t('review.reactionsModal.noReactionsYet')),
                  );
                }
                return ListView.builder(
                  itemCount: reactions.length,
                  itemBuilder: (context, index) {
                    final reaction = reactions[index];
                    return ListTile(
                      leading: Text(
                        reaction.reaction,
                        style: const TextStyle(fontSize: 24),
                      ),
                      title: Text(reaction.createdBy.name),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
