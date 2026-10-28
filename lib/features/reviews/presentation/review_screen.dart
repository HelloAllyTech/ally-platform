import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/custom_dropdown.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';
import 'review_card.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen` — one screen, not
/// two tabs/routes. The Scribe/Simulation switcher only renders when the
/// signed-in user holds *both* `VIEW_SIMULATION_REVIEWS` and
/// `VIEW_SCRIBE_REVIEWS`; with only one, that permission's list renders
/// directly with no switcher — same `showTypeTabs`/`reviewTypeTabs` logic
/// as the real screen. Confirmed from source this switcher is a genuinely
/// different widget from the generic pill `AppTabView` used elsewhere
/// (CallLogScreen, the read-filter row below): `react-native-tab-view`'s
/// `TabBar`, an underline indicator over plain text, not a pill — see
/// [_UnderlineTabRow].
class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

enum _ReviewTab { scribe, simulation }

class _ReviewScreenState extends ConsumerState<ReviewScreen> {
  _ReviewTab? _activeTab;

  @override
  Widget build(BuildContext context) {
    final permissionsAsync = ref.watch(userPermissionsProvider);

    return permissionsAsync.when(
      loading: () => const Scaffold(
        body: SafeArea(child: Center(child: CircularProgressIndicator())),
      ),
      error: (error, _) => Scaffold(
        body: SafeArea(child: Center(child: Text('$error'))),
      ),
      data: (permissions) => _buildScreen(permissions),
    );
  }

  Widget _buildScreen(List<String> permissions) {
    final hasSimulation = permissions.contains(
      UserPermissions.viewSimulationReviews,
    );
    final hasScribe = permissions.contains(UserPermissions.viewScribeReviews);
    final canViewSimulationDetail = permissions.contains(
      UserPermissions.viewSimulationReview,
    );
    final canViewScribeDetail = permissions.contains(
      UserPermissions.viewScribeReview,
    );

    // Scribe listed first, matching the real REVIEW_TYPE_TABS order.
    if (hasScribe && hasSimulation) {
      _activeTab ??= _ReviewTab.scribe;
    } else if (hasScribe) {
      _activeTab = _ReviewTab.scribe;
    } else if (hasSimulation) {
      _activeTab = _ReviewTab.simulation;
    } else {
      _activeTab = null;
    }

    final showTabs = hasScribe && hasSimulation;

    return Scaffold(
      backgroundColor: AppColors.surfaceContainerLow,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              color: Colors.white,
              child: Column(
                children: [
                  TabScreenHeader(title: ref.t('review.title')),
                  if (showTabs)
                    _UnderlineTabRow<_ReviewTab>(
                      tabs: [
                        AppTabViewItem(
                          key: _ReviewTab.scribe,
                          label: ref.t('review.tabs.scribe'),
                        ),
                        AppTabViewItem(
                          key: _ReviewTab.simulation,
                          label: ref.t('review.tabs.simulation'),
                        ),
                      ],
                      activeTab: _activeTab!,
                      onTabChange: (tab) => setState(() => _activeTab = tab),
                    ),
                ],
              ),
            ),
            Expanded(
              child: _activeTab == null
                  ? Center(child: Text(ref.t('review.empty.title')))
                  : _activeTab == _ReviewTab.simulation
                  ? _ReviewList(
                      key: const ValueKey('simulation'),
                      familyProvider: reviewsListProvider,
                      reviewType: ReviewType.simulation,
                      canViewDetails: canViewSimulationDetail,
                      onReviewTapped: (review) async {
                        await ref
                            .read(reviewsRepositoryProvider)
                            .markAsRead(review.id);
                        if (mounted) context.push('/reviews/${review.id}');
                      },
                    )
                  : _ReviewList(
                      key: const ValueKey('scribe'),
                      familyProvider: scribeReviewsListProvider,
                      reviewType: ReviewType.scribe,
                      canViewDetails: canViewScribeDetail,
                      onReviewTapped: (review) async {
                        await ref
                            .read(scribeReviewsRepositoryProvider)
                            .markAsRead(review.id);
                        if (mounted) {
                          context.push(
                            '/reviews/${review.id}',
                            extra: ReviewType.scribe,
                          );
                        }
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of ally-mobile (React Native)'s `react-native-tab-view` `TabBar` as
/// configured on `ReviewScreen` — plain text (medium weight + primary color
/// when active, regular + low-emphasis otherwise) over a 2px bottom
/// indicator, equal-width tabs. Distinct from the pill-style [AppTabView].
class _UnderlineTabRow<T> extends StatelessWidget {
  const _UnderlineTabRow({required this.tabs, required this.activeTab, required this.onTabChange});

  final List<AppTabViewItem<T>> tabs;
  final T activeTab;
  final ValueChanged<T> onTabChange;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            for (final tab in tabs)
              Expanded(
                child: GestureDetector(
                  onTap: () => onTabChange(tab.key),
                  behavior: HitTestBehavior.opaque,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      tab.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: AppFonts.ibmPlexSerifMedium,
                        color: tab.key == activeTab ? AppColors.primary : AppColors.lowEmphasis,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
        Row(
          children: [
            for (final tab in tabs)
              Expanded(
                child: Container(
                  height: 2,
                  color: tab.key == activeTab ? AppColors.primary : Colors.transparent,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _ReviewList extends ConsumerStatefulWidget {
  const _ReviewList({
    super.key,
    required this.familyProvider,
    required this.reviewType,
    required this.canViewDetails,
    required this.onReviewTapped,
  });

  final FutureProviderFamily<List<ReviewItem>, ReviewListQuery> familyProvider;
  final ReviewType reviewType;
  final bool canViewDetails;
  final Future<void> Function(ReviewItem review) onReviewTapped;

  @override
  ConsumerState<_ReviewList> createState() => _ReviewListState();
}

class _ReviewListState extends ConsumerState<_ReviewList> {
  ReviewListQuery _query = defaultReviewListQuery;

  @override
  Widget build(BuildContext context) {
    final reviewsAsync = ref.watch(widget.familyProvider(_query));

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              // Not `IntrinsicWidth` around `AppTabView`: its internal
              // `Row` uses `Expanded` tabs, and `Expanded`/`Flexible`
              // children have no well-defined intrinsic width in Flutter —
              // wrapping it that way overflowed instead of sizing to
              // content. `Expanded` here instead (fill the space the
              // dropdown doesn't need) is the closest content-preserving
              // fix without a bespoke content-width tab widget.
              Expanded(
                child: AppTabView<ReviewReadFilter>(
                  tabs: [
                    for (final filter in ReviewReadFilter.values)
                      AppTabViewItem(key: filter, label: ref.t(filter.labelKey)),
                  ],
                  activeTab: _query.readFilter,
                  onTabChange: (filter) => setState(() => _query = (readFilter: filter, sortBy: _query.sortBy)),
                ),
              ),
              const SizedBox(width: 8),
              // RN's `CustomDropdown` here gets no `fixedWidth` (only
              // `alignModalRight`) — its header sizes to the current
              // selection only (RN's `alignSelf: 'flex-start'`), not to the
              // widest option. `AppDropdown` (Material's `DropdownMenu`)
              // can't do that — it always sizes its closed field to the
              // widest possible entry, which is why this filter used to
              // render as wide as "Most commented" even while showing the
              // short "Latest".
              CustomDropdown(
                value: ref.t(_query.sortBy.labelKey),
                options: [for (final sort in ReviewSortBy.values) ref.t(sort.labelKey)],
                onSelect: (label) {
                  final sort = ReviewSortBy.values.firstWhere((s) => ref.t(s.labelKey) == label);
                  setState(() => _query = (readFilter: _query.readFilter, sortBy: sort));
                },
                // RN's shared `Dropdown.tsx` base header style + `fieldValueText`.
                headerDecoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.all(Radius.circular(4)),
                ),
                headerTextStyle: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 22 / 14,
                  letterSpacing: 0.2,
                  color: AppColors.mediumEmphasis,
                ),
                itemTextStyle: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 22 / 14,
                  letterSpacing: 0.2,
                  color: AppColors.highEmphasis,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: reviewsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) =>
                Center(child: Text('${ref.t('review.error.title')}: $error')),
            data: (reviews) {
              if (reviews.isEmpty) {
                return Center(child: Text(ref.t('review.empty.title')));
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                itemCount: reviews.length,
                separatorBuilder: (_, _) => const SizedBox(height: 16),
                itemBuilder: (context, index) {
                  final review = reviews[index];
                  return ReviewCard(
                    review: review,
                    reviewType: widget.reviewType,
                    canViewDetails: widget.canViewDetails,
                    onOpenReview: () => widget.onReviewTapped(review),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
