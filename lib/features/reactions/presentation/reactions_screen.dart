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
/// Pages like RN's `useReactions`: 20 at a time, the next page requested
/// when the list nears its end (FlatList's `onEndReachedThreshold: 0.3`),
/// until the rows loaded reach the backend's total `count`; picking a
/// filter tab starts over from offset 0. There is no way to add a reaction from this
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
  final List<Reaction> _reactions = [];
  int _total = 0;
  bool _loading = false;
  bool _loadedFirstPage = false;
  Object? _error;

  // Bumped on every filter change so a page that lands after the user has
  // switched tabs is dropped instead of appended to the wrong list.
  int _generation = 0;

  bool get _isScribe => widget.reviewType == ReviewType.scribe;
  bool get _hasMore => _reactions.length < _total;

  @override
  void initState() {
    super.initState();
    _loadPage();
  }

  Future<void> _loadPage() async {
    if (_loading) return;
    final generation = _generation;
    setState(() => _loading = true);
    try {
      final page = _isScribe
          ? await ref.read(scribeReactionsRepositoryProvider).getReactions(
                widget.reviewId,
                offset: _reactions.length,
                reaction: _selectedReaction,
              )
          : await ref.read(reactionsRepositoryProvider).getReactions(
                widget.reviewId,
                offset: _reactions.length,
                reaction: _selectedReaction,
              );
      if (!mounted || generation != _generation) return;
      setState(() {
        _reactions.addAll(page.items);
        _total = page.total;
        _loadedFirstPage = true;
        _error = null;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() => _error = error);
    } finally {
      if (mounted && generation == _generation) setState(() => _loading = false);
    }
  }

  void _selectReaction(String? reaction) {
    if (reaction == _selectedReaction) return;
    setState(() {
      _selectedReaction = reaction;
      _generation++;
      _reactions.clear();
      _total = 0;
      _loading = false;
      _loadedFirstPage = false;
      _error = null;
    });
    _loadPage();
  }

  bool _onScroll(ScrollNotification notification) {
    final metrics = notification.metrics;
    if (_hasMore && !_loading && metrics.extentAfter < metrics.viewportDimension * 0.3) {
      _loadPage();
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
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
          Expanded(child: _buildList()),
        ],
      ),
    );
  }

  Widget _buildList() {
    if (!_loadedFirstPage) {
      if (_error != null) {
        return Center(child: Text('${ref.t('review.error.loadReactionsFailed')}: $_error'));
      }
      return const Center(child: CircularProgressIndicator());
    }
    if (_reactions.isEmpty) {
      return Center(child: Text(ref.t('review.reactionsModal.noReactionsYet')));
    }
    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: ListView.separated(
        // One extra row for the next-page spinner while more remain.
        itemCount: _reactions.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 0.5),
        itemBuilder: (context, index) {
          if (index == _reactions.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return _ReactionRow(reaction: _reactions[index]);
        },
      ),
    );
  }

  Widget _buildFilterTabs(Map<String, int> counts) {
    final totalCount = counts.values.fold(0, (sum, count) => sum + count);
    // RN's `useReactions.ts` excludes any reaction type with a 0 count
    // before building tabs — a backend response that includes a now-empty
    // type (every reaction of it removed) would otherwise show a stray
    // "0" tab RN never shows.
    final sortedEntries = counts.entries.where((e) => e.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: [
          _FilterTab(
            label: '${ref.t('achievements.filters.all')} $totalCount',
            isSelected: _selectedReaction == null,
            onTap: () => _selectReaction(null),
          ),
          const SizedBox(width: 16),
          for (final entry in sortedEntries) ...[
            _FilterTab(
              emoji: emojiGlyphFor(entry.key),
              label: '${entry.value}',
              isSelected: _selectedReaction == entry.key,
              onTap: () => _selectReaction(entry.key),
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
