import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/permissions/permissions_repository.dart';
import '../../../core/permissions/user_permissions.dart';
import '../../../core/widgets/app_tab_view.dart';
import '../../../core/widgets/review_type_chip.dart';
import '../../../core/widgets/tab_screen_header.dart';
import '../data/review_models.dart';
import '../data/reviews_repository.dart';
import '../data/scribe_reviews_repository.dart';

/// Port of ally-mobile (React Native)'s `ReviewScreen` — one screen, not
/// two tabs/routes. An `AppTabView` switches between simulation reviews and
/// scribe reviews only when the signed-in user holds *both*
/// `VIEW_SIMULATION_REVIEWS` and `VIEW_SCRIBE_REVIEWS`; with only one, that
/// permission's list renders directly with no switcher — same
/// `showTypeTabs`/`reviewTypeTabs` logic as the real screen (which uses
/// `react-native-tab-view`'s swipeable TabBar; this uses the same pill
/// `AppTabView` CallLogScreen uses, for visual consistency across the app
/// rather than introducing a second distinct tab-switcher look with no
/// specific styling evidence for this screen).
///
/// Not ported: the read-filter (All/Read/Unread) row and sort dropdown
/// `ReviewList.tsx` renders above its list, and the scribe-review detail
/// thread screen (`ScribeReviewDetailsScreen` has no Flutter port yet) —
/// tapping a scribe review is therefore always disabled here, same as a
/// real account lacking `VIEW_SCRIBE_REVIEW` would see.
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
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(body: Center(child: Text('$error'))),
      data: (permissions) => _buildScreen(permissions),
    );
  }

  Widget _buildScreen(List<String> permissions) {
    final hasSimulation = permissions.contains(UserPermissions.viewSimulationReviews);
    final hasScribe = permissions.contains(UserPermissions.viewScribeReviews);
    final canViewSimulationDetail = permissions.contains(UserPermissions.viewSimulationReview);

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
      body: Column(
        children: [
          TabScreenHeader(title: ref.t('review.title'), subtitle: ref.t('nav.tabs.review')),
          if (showTabs)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: AppTabView<_ReviewTab>(
                tabs: [
                  AppTabViewItem(key: _ReviewTab.scribe, label: ref.t('review.tabs.scribe')),
                  AppTabViewItem(
                    key: _ReviewTab.simulation,
                    label: ref.t('review.tabs.simulation'),
                  ),
                ],
                activeTab: _activeTab!,
                onTabChange: (tab) => setState(() => _activeTab = tab),
              ),
            ),
          Expanded(
            child: _activeTab == null
                ? Center(child: Text(ref.t('review.empty.title')))
                : _activeTab == _ReviewTab.simulation
                    ? _ReviewList(
                        provider: reviewsListProvider,
                        reviewType: ReviewType.simulation,
                        canViewDetails: canViewSimulationDetail,
                        onReviewTapped: (review) async {
                          await ref.read(reviewsRepositoryProvider).markAsRead(review.id);
                          if (mounted) context.push('/reviews/${review.id}');
                        },
                      )
                    : _ReviewList(
                        provider: scribeReviewsListProvider,
                        reviewType: ReviewType.scribe,
                        // No ScribeReviewDetailsScreen port exists yet — same
                        // visible effect as an account lacking
                        // VIEW_SCRIBE_REVIEW: the list shows, tapping doesn't.
                        canViewDetails: false,
                        onReviewTapped: (review) async {
                          await ref.read(scribeReviewsRepositoryProvider).markAsRead(review.id);
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

class _ReviewList extends ConsumerWidget {
  const _ReviewList({
    required this.provider,
    required this.reviewType,
    required this.canViewDetails,
    required this.onReviewTapped,
  });

  final FutureProvider<List<ReviewItem>> provider;
  final ReviewType reviewType;
  final bool canViewDetails;
  final Future<void> Function(ReviewItem review) onReviewTapped;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviewsAsync = ref.watch(provider);

    return reviewsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('${ref.t('review.error.title')}: $error')),
      data: (reviews) {
        if (reviews.isEmpty) {
          return Center(child: Text(ref.t('review.empty.title')));
        }
        final label = ref.t(
          'review.feedCard.reviewType',
          {'reviewType': reviewType == ReviewType.scribe ? 'Scribe' : 'Simulation'},
        );
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
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: ReviewTypeChip(reviewType: reviewType, label: label),
                  ),
                  Text(review.note, maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ),
              isThreeLine: true,
              trailing: review.commentsCount > 0 ? Chip(label: Text('${review.commentsCount}')) : null,
              enabled: canViewDetails,
              onTap: canViewDetails ? () => onReviewTapped(review) : null,
            );
          },
        );
      },
    );
  }
}
