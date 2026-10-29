import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/back_title_header.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../data/emoji_catalog.dart';
import '../data/reactions_repository.dart';
import '../../../core/widgets/sized_network_image.dart';

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
/// itself (the comment sheets' picker), not from this list.
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
      backgroundColor: Colors.white,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // RN: styles.header — paddingHorizontal 10, back arrow marginRight
          // 16, REPLAY_PRO headline display.small; no rule under it.
          BackTitleHeader(
            title: ref.t('review.reactionsModal.title'),
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            gap: 16,
            borderColor: null,
          ),
          _buildFilterTabs(countsAsync.value ?? const {}),
          Expanded(child: _buildList()),
        ],
      ),
    );
  }

  Widget _buildList() {
    if (!_loadedFirstPage) {
      if (_error != null) {
        return Center(child: Text(ref.t('review.error.loadReactionsFailed'), style: _emptyStyle));
      }
      return const SizedBox.shrink();
    }
    if (_reactions.isEmpty) {
      // RN: ListEmptyComponent centred in the list (listContentEmpty).
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: Text(ref.t('review.reactionsModal.noReactionsYet'), style: _emptyStyle),
        ),
      );
    }
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 12),
        itemCount: _reactions.length + (_loading ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == _reactions.length) {
            return Padding(
              padding: EdgeInsets.only(top: 24, bottom: bottomInset + 120),
              child: const Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                ),
              ),
            );
          }
          return _ReactionRow(reaction: _reactions[index]);
        },
      ),
    );
  }

  static const _emptyStyle = TextStyle(
    fontFamily: AppFonts.robotoRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.lowEmphasis,
  );

  /// RN's `ReactionFilterTabs`: "All N" plus one tab per reaction type
  /// (emoji bubble + count), most-used first, under a 0.5 rule; the
  /// selected tab gets a 3pt azure bar across its full width.
  Widget _buildFilterTabs(Map<String, int> counts) {
    final totalCount = counts.values.fold(0, (sum, count) => sum + count);
    // RN's `useReactions.ts` excludes any reaction type with a 0 count.
    final sortedEntries = counts.entries.where((e) => e.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.only(left: 20, right: 20, top: 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            _FilterTab(
              label: '${ref.t('achievements.filters.all')} $totalCount',
              isSelected: _selectedReaction == null,
              onTap: () => _selectReaction(null),
            ),
            for (final entry in sortedEntries) ...[
              const SizedBox(width: 16),
              _FilterTab(
                emoji: emojiGlyphFor(entry.key),
                label: '${entry.value}',
                isSelected: _selectedReaction == entry.key,
                onTap: () => _selectReaction(entry.key),
              ),
            ],
          ],
        ),
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

  static const _labelStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  @override
  Widget build(BuildContext context) {
    final isAll = emoji == null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: isAll
                ? Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      label,
                      style: isSelected
                          ? _labelStyle.copyWith(
                              color: AppColors.azureBlue,
                              // RN: IBM Plex Serif Regular at 500 → Medium face.
                              fontFamily: AppFonts.ibmPlexSerifMedium,
                              fontWeight: FontWeight.w500,
                            )
                          : _labelStyle,
                    ),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.strokePrimary, width: 0.5),
                        ),
                        child: Text(emoji!, style: const TextStyle(fontFamily: _systemFont, fontSize: 16)),
                      ),
                      const SizedBox(width: 4),
                      Text(label, style: _labelStyle),
                    ],
                  ),
          ),
          if (isSelected)
            Positioned(
              left: 0,
              right: 0,
              bottom: -1,
              child: Container(
                key: const Key('reaction-filter-indicator'),
                height: 3,
                decoration: const BoxDecoration(
                  color: AppColors.azureBlue,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(2)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// RN `<Text>` with no fontFamily: the iOS system font.
const _systemFont = 'CupertinoSystemText';

/// RN's `ReactionListItem`: a 40pt avatar (grey200 initial placeholder)
/// with a 20pt white emoji badge at its bottom-right, then the name, on a
/// row with a 0.5 bottom rule.
class _ReactionRow extends StatelessWidget {
  const _ReactionRow({required this.reaction});

  final Reaction reaction;

  @override
  Widget build(BuildContext context) {
    final name = reaction.createdBy.name;
    final initials = name.isNotEmpty ? name[0].toUpperCase() : '';
    final image = reaction.createdBy.profileImage;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.strokePrimary, width: 0.5)),
      ),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              ClipOval(
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: (image?.isNotEmpty ?? false)
                      ? SizedNetworkImage(image!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink())
                      : Container(
                          color: AppColors.grey200,
                          alignment: Alignment.center,
                          child: Text(
                            initials,
                            style: const TextStyle(
                              fontFamily: AppFonts.robotoRegular,
                              fontSize: 14,
                              height: 22 / 14,
                              letterSpacing: 0.2,
                              fontWeight: FontWeight.w500,
                              color: AppColors.mediumEmphasis,
                            ),
                          ),
                        ),
                ),
              ),
              Positioned(
                bottom: -2,
                right: -2,
                child: Container(
                  width: 20,
                  height: 20,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                    boxShadow: const [BoxShadow(color: Color(0x1A000000), offset: Offset(0, 1), blurRadius: 2)],
                  ),
                  child: Text(emojiGlyphFor(reaction.reaction), style: const TextStyle(fontFamily: _systemFont, fontSize: 12)),
                ),
              ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 22 / 14,
                letterSpacing: 0.2,
                color: AppColors.highEmphasis,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
