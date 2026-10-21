import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/emoji_catalog.dart';
import '../data/reactions_repository.dart';

/// Port of ally-mobile (React Native)'s `ReactionsScreen` — a view-only
/// who-reacted-with-what list, filterable by an "All"/per-emoji tab row
/// built from the real reaction counts (`ReactionFilterTabs`), with each
/// row showing an avatar + a small emoji badge overlay (`ReactionListItem`)
/// rather than a bare emoji glyph. [reviewType] picks simulation vs.
/// scribe endpoints, same role it plays in `ReviewDetailsScreen`.
///
/// Not ported: infinite-scroll pagination (RN's `useReactions` hook loads
/// more on scroll; this fetches a single page via the repository's
/// existing `limit` default). There is no way to add a reaction from this
/// screen in the real app either — a prior version of this screen invented
/// an emoji-picker row here; reacting happens from the comment/review
/// itself (`ThreadDetailScreen`'s picker), not from this list.
class ReactionsScreen extends ConsumerStatefulWidget {
  const ReactionsScreen({
    super.key,
    required this.reviewId,
    this.reviewType = ReviewType.simulation,
  });

  final String reviewId;
  final ReviewType reviewType;

  @override
  ConsumerState<ReactionsScreen> createState() => _ReactionsScreenState();
}

class _ReactionsScreenState extends ConsumerState<ReactionsScreen> {
  String? _selectedReaction;

  bool get _isScribe => widget.reviewType == ReviewType.scribe;

  @override
  Widget build(BuildContext context) {
    final reactionsAsync = _isScribe
        ? ref.watch(scribeReactionsListProvider((reviewId: widget.reviewId, reaction: _selectedReaction)))
        : ref.watch(reactionsListProvider((reviewId: widget.reviewId, reaction: _selectedReaction)));
    final countsAsync = _isScribe
        ? ref.watch(scribeReactionsCountProvider(widget.reviewId))
        : ref.watch(reactionsCountProvider(widget.reviewId));

    return Scaffold(
      appBar: AppBar(title: Text(ref.t('review.reactionsModal.title'))),
      body: Column(
        children: [
          countsAsync.maybeWhen(
            data: (counts) => counts.isEmpty ? const SizedBox.shrink() : _buildFilterTabs(counts),
            orElse: () => const SizedBox.shrink(),
          ),
          const Divider(height: 0.5),
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
                return ListView.separated(
                  itemCount: reactions.length,
                  separatorBuilder: (_, _) => const Divider(height: 0.5),
                  itemBuilder: (context, index) => _ReactionRow(reaction: reactions[index]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterTabs(Map<String, int> counts) {
    final totalCount = counts.values.fold(0, (sum, count) => sum + count);
    final sortedEntries = counts.entries.toList()..sort((a, b) => b.value.compareTo(a.value));

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: [
          _FilterTab(
            label: '${ref.t('achievements.filters.all')} $totalCount',
            isSelected: _selectedReaction == null,
            onTap: () => setState(() => _selectedReaction = null),
          ),
          const SizedBox(width: 16),
          for (final entry in sortedEntries) ...[
            _FilterTab(
              emoji: emojiGlyphFor(entry.key),
              label: '${entry.value}',
              isSelected: _selectedReaction == entry.key,
              onTap: () => setState(() => _selectedReaction = entry.key),
            ),
            const SizedBox(width: 16),
          ],
        ],
      ),
    );
  }
}

class _FilterTab extends StatelessWidget {
  const _FilterTab({required this.label, required this.isSelected, required this.onTap, this.emoji});

  final String? emoji;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (emoji != null) ...[
                Container(
                  width: 32,
                  height: 32,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                  ),
                  alignment: Alignment.center,
                  child: Text(emoji!, style: const TextStyle(fontSize: 16)),
                ),
              ],
              Text(
                label,
                style: TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  color: isSelected ? AppColors.primary : AppColors.mediumEmphasis,
                  fontWeight: isSelected ? FontWeight.w500 : FontWeight.normal,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(height: 3, width: 24, color: isSelected ? AppColors.primary : Colors.transparent),
        ],
      ),
    );
  }
}

/// RN's `ReactionListItem` — an avatar with a small emoji badge overlaid
/// at its bottom-right corner, not a bare emoji glyph as the leading icon.
class _ReactionRow extends StatelessWidget {
  const _ReactionRow({required this.reaction});

  final Reaction reaction;

  @override
  Widget build(BuildContext context) {
    final initials = reaction.createdBy.name.isNotEmpty ? reaction.createdBy.name[0].toUpperCase() : '?';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              CircleAvatar(
                radius: 20,
                backgroundImage: (reaction.createdBy.profileImage?.isNotEmpty ?? false)
                    ? NetworkImage(reaction.createdBy.profileImage!)
                    : null,
                child: (reaction.createdBy.profileImage?.isNotEmpty ?? false) ? null : Text(initials),
              ),
              Positioned(
                bottom: -2,
                right: -2,
                child: Container(
                  width: 20,
                  height: 20,
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  alignment: Alignment.center,
                  child: Text(emojiGlyphFor(reaction.reaction), style: const TextStyle(fontSize: 12)),
                ),
              ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              reaction.createdBy.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular),
            ),
          ),
        ],
      ),
    );
  }
}
