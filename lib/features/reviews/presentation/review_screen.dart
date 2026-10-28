import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/navigation/screen_focus_listener.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../../core/widgets/app_empty_state.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
import 'review_card.dart';
import 'review_styles.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen`: the tab header,
/// then — when the user holds both `VIEW_SIMULATION_REVIEWS` and
/// `VIEW_SCRIBE_REVIEWS` — a Scribe/Simulation `react-native-tab-view`
/// `TabBar` (Scribe first, `REVIEW_TYPE_TABS`); with only one, that list
/// renders directly. Each list is RN's `ReviewList`.
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  ReviewType? _activeTab;

  @override
  Widget build(BuildContext context) {
    final permissionsAsync = ref.watch(userPermissionsProvider);

    return permissionsAsync.when(
      loading: () => const Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(child: Center(child: CircularProgressIndicator(color: AppColors.primary))),
      ),
      // Never the raw exception (RN getErrorDetails' fallback copy).
      error: (_, _) => Scaffold(body: SafeArea(child: Center(child: Text(ref.t('common.somethingWentWrong'))))),
      data: _buildScreen,
    );
  }

  Widget _buildScreen(List<String> permissions) {
    final hasSimulation = permissions.contains(UserPermissions.viewSimulationReviews);
    final hasScribe = permissions.contains(UserPermissions.viewScribeReviews);
    final tabs = [if (hasScribe) ReviewType.scribe, if (hasSimulation) ReviewType.simulation];
    final active = tabs.contains(_activeTab) ? _activeTab! : (tabs.isEmpty ? ReviewType.simulation : tabs.first);

    Widget list(ReviewType type) => _ReviewList(
      key: ValueKey(type),
      reviewType: type,
      canViewReview: permissions.contains(
        type == ReviewType.scribe ? UserPermissions.viewScribeReview : UserPermissions.viewSimulationReview,
      ),
    );

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            TabScreenHeader(title: ref.t('review.title')),
            Expanded(
              child: ColoredBox(
                color: AppColors.lightGray9,
                child: Column(
                  children: [
                    if (tabs.length > 1)
                      _ReviewTypeTabBar(
                        tabs: [for (final tab in tabs) (key: tab, label: ref.t('review.tabs.${tab.name}'))],
                        active: active,
                        onChange: (tab) => setState(() => _activeTab = tab),
                      ),
                    Expanded(
                      child: tabs.isEmpty
                          // Neither list permission: RN would still mount a
                          // ReviewList; showing its empty state avoids a
                          // request the backend would refuse.
                          ? Padding(
                              padding: const EdgeInsets.only(top: 26),
                              child: Align(
                                alignment: Alignment.topCenter,
                                child: AppEmptyState(
                                  iconAsset: 'assets/icons/emptyReviews.svg',
                                  title: ref.t('review.empty.title'),
                                  description: ref.t('review.empty.description'),
                                ),
                              ),
                            )
                          : list(active),
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

/// RN's `react-native-tab-view` `TabBar` as `ReviewScreen` styles it: white,
/// padding 4, equal-width tabs (padding 10, min height 48) with IBM Plex
/// Serif Medium body.small labels (primary when active, low emphasis
/// otherwise), a 2pt primary indicator, and the library's hairline shadow.
class _ReviewTypeTabBar extends StatelessWidget {
  const _ReviewTypeTabBar({required this.tabs, required this.active, required this.onChange});

  final List<({ReviewType key, String label})> tabs;
  final ReviewType active;
  final ValueChanged<ReviewType> onChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Color(0x1A000000), offset: Offset(0, 0.5), blurRadius: 0.5)],
      ),
      child: Row(
        children: [
          for (final tab in tabs)
            Expanded(
              child: GestureDetector(
                key: ValueKey('review-type-tab-${tab.key.name}'),
                behavior: HitTestBehavior.opaque,
                onTap: () => onChange(tab.key),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 48),
                  padding: const EdgeInsets.all(10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: tab.key == active ? AppColors.primary : Colors.transparent,
                        width: 2,
                      ),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Text(
                      tab.label,
                      textAlign: TextAlign.center,
                      style: ReviewText.style(
                        RnType.bodySmall,
                        AppFonts.ibmPlexSerifMedium,
                        tab.key == active ? AppColors.primary : AppColors.lowEmphasis,
                        weight: FontWeight.w400,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Port of RN's `ReviewScreen/components/ReviewList.tsx` + `useReviews`:
/// the All/Read/Unread pill tabs and the sort dropdown, then an infinite
/// list (10 per page) of [ReviewCard]s with pull-to-refresh, the
/// `EmptyState` illustration when empty, and a footer spinner while more
/// remain. Opening a review is gated on [canViewReview]; marking it read
/// happens on the details screen (RN marks it after 10s there, not on tap).
class _ReviewList extends ConsumerStatefulWidget {
  const _ReviewList({super.key, required this.reviewType, required this.canViewReview});

  final ReviewType reviewType;
  final bool canViewReview;

  @override
  ConsumerState<_ReviewList> createState() => _ReviewListState();
}

class _ReviewListState extends ConsumerState<_ReviewList> {
  static const _limit = 10;

  ReviewReadFilter _readFilter = ReviewReadFilter.all;
  ReviewSortBy _sort = ReviewSortBy.latest;
  final List<ReviewItem> _reviews = [];
  bool _isFetching = false;
  bool _hasMore = true;
  bool _loadedOnce = false;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _fetch(reset: true);
  }

  Future<ReviewsPage> _getPage(int offset) {
    final readFilter = _readFilter.apiValue;
    final sortBy = _sort.apiValue;
    return widget.reviewType == ReviewType.scribe
        ? ref
              .read(scribeReviewsRepositoryProvider)
              .getScribeReviews(readFilter: readFilter, sortBy: sortBy, limit: _limit, offset: offset)
        : ref
              .read(reviewsRepositoryProvider)
              .getReviews(readFilter: readFilter, sortBy: sortBy, limit: _limit, offset: offset);
  }

  Future<void> _fetch({required bool reset}) async {
    if (!reset && (_isFetching || !_hasMore)) return;
    if (reset) {
      _generation++;
      _reviews.clear();
      _hasMore = true;
    }
    final generation = _generation;
    final offset = _reviews.length;
    setState(() => _isFetching = true);
    try {
      final page = await _getPage(offset);
      if (!mounted || generation != _generation) return;
      setState(() {
        _reviews.addAll(page.items);
        _hasMore = page.items.length == _limit && offset + page.items.length < page.count;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() => _hasMore = false);
      // RN: showToast(t('review.error.title'), 'error').
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(ref.tr('review.error.title'))));
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _isFetching = false;
          _loadedOnce = true;
        });
      }
    }
  }

  void _openReview(ReviewItem review) {
    context.push('/reviews/${review.id}', extra: widget.reviewType);
  }

  bool _onScroll(ScrollNotification notification) {
    final metrics = notification.metrics;
    // FlatList onEndReachedThreshold 0.5.
    if (metrics.extentAfter < metrics.viewportDimension * 0.5) unawaited(_fetch(reset: false));
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final showFooter = _isFetching || _hasMore;
    final isEmpty = _loadedOnce && !_isFetching && _reviews.isEmpty;

    // RN ReviewList `useFocusEffect`: every return to the list (not the
    // first focus) refreshes it from page 0.
    return ScreenFocusListener(
      onFocus: () => _fetch(reset: true),
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.only(top: 16, left: rn.s(16), right: rn.s(16)),
            child: Row(
              children: [
                Expanded(
                  child: _ContentWidthTabs<ReviewReadFilter>(
                    tabs: [for (final f in ReviewReadFilter.values) (key: f, label: ref.t(f.labelKey))],
                    active: _readFilter,
                    onChange: (filter) {
                      if (filter == _readFilter) return;
                      setState(() => _readFilter = filter);
                      _fetch(reset: true);
                    },
                  ),
                ),
                SizedBox(width: rn.s(8)),
                _SortDropdown(
                  value: ref.t(_sort.labelKey),
                  options: [for (final sort in ReviewSortBy.values) ref.t(sort.labelKey)],
                  onSelect: (label) {
                    final sort = ReviewSortBy.values.firstWhere((s) => ref.tr(s.labelKey) == label);
                    if (sort == _sort) return;
                    setState(() => _sort = sort);
                    _fetch(reset: true);
                  },
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => _fetch(reset: true),
              child: NotificationListener<ScrollNotification>(
                onNotification: _onScroll,
                // Builder: review cards are only constructed as they scroll
                // in (the list pages without bound); the empty state and
                // paging footer follow the cards.
                child: ListView.builder(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: EdgeInsets.only(left: rn.s(16), right: rn.s(16), top: 10, bottom: 360),
                  itemCount: _reviews.length + (isEmpty ? 1 : 0) + (showFooter ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index < _reviews.length) {
                      final review = _reviews[index];
                      // contentContainerStyle gap 10 + ItemSeparator 8@s.
                      return Padding(
                        padding: EdgeInsets.only(top: index == 0 ? 0 : 10 + rn.s(8)),
                        child: ReviewCard(
                          key: ValueKey(review.id),
                          review: review,
                          reviewType: widget.reviewType,
                          onOpenReview: widget.canViewReview ? () => _openReview(review) : null,
                        ),
                      );
                    }
                    if (isEmpty && index == _reviews.length) {
                      return AppEmptyState(
                        iconAsset: 'assets/icons/emptyReviews.svg',
                        title: ref.t('review.empty.title'),
                        description: ref.t('review.empty.description'),
                      );
                    }
                    return Padding(
                      padding: EdgeInsets.only(top: _reviews.isEmpty ? 0 : 10, bottom: 0),
                      child: Padding(
                        padding: EdgeInsets.symmetric(vertical: rn.s(16)),
                        child: const Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// RN's shared pill `TabView` in `tabWidthMode="content"`: each tab is as
/// wide as its label (padding 12/4) plus an equal share of the leftover
/// width (`flexGrow: 1, flexShrink: 0`), unlike [AppTabView]'s equal tabs.
class _ContentWidthTabs<T> extends StatelessWidget {
  const _ContentWidthTabs({required this.tabs, required this.active, required this.onChange});

  final List<({T key, String label})> tabs;
  final T active;
  final ValueChanged<T> onChange;

  static final _label = ReviewText.serif(RnType.labelMedium, AppColors.mediumEmphasis);

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final scaler = MediaQuery.textScalerOf(context);
        final widths = [
          for (final tab in tabs)
            (TextPainter(
                  text: TextSpan(text: tab.label, style: _label),
                  textDirection: TextDirection.ltr,
                  maxLines: 1,
                  textScaler: scaler,
                )..layout())
                .width
                .ceilToDouble() +
                8 +
                2,
        ];
        final total = widths.fold(0.0, (a, b) => a + b);
        final available = constraints.maxWidth - 1;
        // Labels wider than the row (long translations) shrink
        // proportionally instead of overflowing.
        if (total > available && total > 0) {
          for (var i = 0; i < widths.length; i++) {
            widths[i] = widths[i] * available / total;
          }
        }
        final free = (available - total).clamp(0.0, double.infinity);
        final extra = tabs.isEmpty ? 0.0 : free / tabs.length;
        return Container(
          decoration: BoxDecoration(
            color: AppColors.lightGray19,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.lightGray4, width: 0.5),
          ),
          child: Row(
            children: [
              for (final (i, tab) in tabs.indexed)
                GestureDetector(
                  key: ValueKey('read-filter-${tab.label}'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onChange(tab.key),
                  child: Container(
                    width: widths[i] + extra,
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                    alignment: Alignment.center,
                    decoration: tab.key == active
                        ? BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(7),
                            border: Border.all(color: AppColors.lightGray2, width: 0.5),
                          )
                        : null,
                    child: Text(
                      tab.label,
                      maxLines: 1,
                      overflow: TextOverflow.clip,
                      style: tab.key == active ? _label.copyWith(color: AppColors.highEmphasis) : _label,
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// Port of RN's `CustomDropdown` with `alignModalRight`: a white header
/// (value + 6pt arrow) that opens an absolutely positioned option card under
/// it, right-aligned, at least as wide as the longest option + 36.
class _SortDropdown extends StatefulWidget {
  const _SortDropdown({required this.value, required this.options, required this.onSelect});

  final String value;
  final List<String> options;
  final ValueChanged<String> onSelect;

  @override
  State<_SortDropdown> createState() => _SortDropdownState();
}

class _SortDropdownState extends State<_SortDropdown> {
  final _controller = OverlayPortalController();
  final _link = LayerLink();

  static final _headerStyle = ReviewText.serif(RnType.bodyMedium, AppColors.mediumEmphasis);
  static final _itemStyle = ReviewText.serif(RnType.bodyMedium, AppColors.highEmphasis);

  @override
  Widget build(BuildContext context) {
    final longest = widget.options.fold('', (a, b) => a.length >= b.length ? a : b);
    final longestWidth =
        (TextPainter(
              text: TextSpan(text: longest, style: _itemStyle),
              textDirection: TextDirection.ltr,
              textScaler: MediaQuery.textScalerOf(context),
            )..layout())
            .width;

    return CompositedTransformTarget(
      link: _link,
      child: OverlayPortal(
        controller: _controller,
        overlayChildBuilder: (context) => Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: _controller.hide),
            ),
            CompositedTransformFollower(
              link: _link,
              targetAnchor: Alignment.bottomRight,
              followerAnchor: Alignment.topRight,
              offset: const Offset(0, -2),
              child: Align(
                alignment: Alignment.topRight,
                widthFactor: 1,
                heightFactor: 1,
                child: Container(
                  key: const Key('sort-dropdown-menu'),
                  constraints: BoxConstraints(minWidth: (longestWidth + 36).ceilToDouble(), maxHeight: 200),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.lightGray7),
                    boxShadow: const [BoxShadow(color: Color(0x33000000), offset: Offset(0, 2), blurRadius: 4)],
                  ),
                  child: SingleChildScrollView(
                    child: IntrinsicWidth(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final option in widget.options)
                            GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () {
                                _controller.hide();
                                widget.onSelect(option);
                              },
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                                child: Text(
                                  option,
                                  style: option == widget.value
                                      ? _itemStyle.copyWith(color: AppColors.primary, fontWeight: FontWeight.w500)
                                      : _itemStyle,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        child: GestureDetector(
          key: const Key('sort-dropdown'),
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() => _controller.isShowing ? _controller.hide() : _controller.show()),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(widget.value, style: _headerStyle),
                const SizedBox(width: 8),
                SvgPicture.asset('assets/icons/arrowDown.svg', width: RnSize.of(context).raw(6), height: RnSize.of(context).raw(6)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
