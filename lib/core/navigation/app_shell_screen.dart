import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/achievements/presentation/badge_popup.dart';
import '../../features/notifications/data/notifications_repository.dart';
import '../../features/reviews/data/reviews_repository.dart';
import '../permissions/permissions_repository.dart';
import '../permissions/user_permissions.dart';
import '../push/push_notification_service.dart';
import '../routing/app_router.dart';
import 'app_bottom_tab_bar.dart';
import 'app_drawer.dart';
import 'drawer_menu_button.dart';
import 'home_tab_navigation.dart';
import 'tab_config.dart';

/// Port of ally-mobile (React Native)'s `DrawerNavigator` + `TabNavigator`
/// combination — the single screen mounted at the app's `/home` route that
/// owns the side drawer and the floating permission-gated bottom tab bar,
/// swapping tab bodies locally (not through go_router) exactly like the RN
/// `Tab.Navigator` does. Also where push-notification device-token
/// registration fires ("once per landed on Home authenticated").
///
/// Also owns what RN wires per tab screen:
/// - Android back on a tab root (`useTabBackToHomeHandler` on Search,
///   Community, Progress and UserAnalytics; the same exit-or-first-tab
///   handler on Learn and CallLog; react-navigation's default
///   `backBehavior: 'firstRoute'` for the rest): back on any tab but the
///   first visible one goes to the first; back on the first leaves the app.
/// - The badge-unlock popup ([BadgePopupHost]) on the Learn tab, and on the
///   Review tab for reviewer-only users, as RN's SimulationsScreen and
///   ReviewScreen mount `<BadgePopup />`.
/// - [tabRequest]: land on a given tab (`goToHomeTab`, RN `navigateToTab`).
class AppShellScreen extends ConsumerStatefulWidget {
  const AppShellScreen({super.key, this.tabRequest});

  final HomeTabRequest? tabRequest;

  @override
  ConsumerState<AppShellScreen> createState() => _AppShellScreenState();
}

class _AppShellScreenState extends ConsumerState<AppShellScreen> {
  String? _selectedTabName;

  // Tabs mount the first time they're opened and then stay mounted, like
  // react-navigation's bottom tabs (`lazy: true` by default). Building all
  // of them up front fired every tab's fetches at launch, competing with
  // the first tab for network and CPU.
  final Set<String> _visitedTabNames = {};

  final _badgePopupKey = GlobalKey<BadgePopupHostState>();
  bool _isBadgePopupShowing = false;

  @override
  void initState() {
    super.initState();
    _selectedTabName = widget.tabRequest?.tabName;
    ref
        .read(pushNotificationServiceProvider)
        .initializeAndRegister(ref.read(notificationsRepositoryProvider), ref.read(appRouterProvider));
  }

  @override
  void didUpdateWidget(AppShellScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final request = widget.tabRequest;
    if (request != null && !identical(request, oldWidget.tabRequest)) {
      _selectedTabName = request.tabName;
    }
  }

  @override
  Widget build(BuildContext context) {
    final permissionsAsync = ref.watch(userPermissionsProvider);

    return permissionsAsync.when(
      // Matches `BottomTabs`'s own `if (userLoading) return null`: avoid a
      // flash of the wrong tab set before permissions resolve.
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(body: Center(child: Text('$error'))),
      data: (permissions) {
        final visibleTabs = visibleTabsFor(permissions);
        _selectedTabName ??= getFirstVisibleTab(permissions);
        var currentIndex = visibleTabs.indexWhere((t) => t.name == _selectedTabName);
        if (currentIndex == -1) {
          // A requested tab this user can't see: the first visible one.
          currentIndex = 0;
          if (visibleTabs.isNotEmpty) _selectedTabName = visibleTabs.first.name;
        }
        final currentTabName = visibleTabs.isEmpty ? null : visibleTabs[currentIndex].name;
        // RN's BadgePopup polls only while its screen is focused: the Learn
        // tab, or the Review tab for reviewer-only users, with this shell
        // the top route.
        final badgePopupActive = permissions.contains(UserPermissions.viewUserBadges) &&
            (ModalRoute.of(context)?.isCurrent ?? true) &&
            (currentTabName == kTabLearn || (currentTabName == kTabReview && isReviewerOnly(permissions)));
        if (visibleTabs.isNotEmpty) _visitedTabNames.add(visibleTabs[currentIndex].name);

        final hasUnreadReviews = ref.watch(unreadReviewCountProvider).maybeWhen(
              data: (count) => count > 0,
              orElse: () => false,
            );

        final scaffold = Scaffold(
          drawer: AppDrawer(permissions: permissions, activeTabName: _selectedTabName),
          body: Builder(
            builder: (context) => Stack(
              children: [
                if (visibleTabs.isEmpty)
                  const Center(child: Text('No accessible tabs for this account'))
                else
                  // Each tab body (`TabScreenHeader` et al.) assumes RN's
                  // per-screen `paddingTop: insets.top`, which nothing here
                  // replicated — this `Stack` paints full-bleed behind the
                  // status bar, so the header text sat under/behind it.
                  // Bottom stays unsafed: the floating `AppBottomTabBar`
                  // handles its own inset, and screens already reserve
                  // scroll padding to clear it.
                  SafeArea(
                    bottom: false,
                    child: IndexedStack(
                      index: currentIndex,
                      children: [
                        // RN's `useTabScreenHeader`: `showHamburger:
                        // isFirstTab` — only the first visible tab's header
                        // carries the drawer-menu button.
                        for (final (i, tab) in visibleTabs.indexed)
                          _visitedTabNames.contains(tab.name)
                              ? DrawerMenuScope(
                                  onOpenDrawer: i == 0 ? Scaffold.of(context).openDrawer : null,
                                  child: tab.screenBuilder(context),
                                )
                              : const SizedBox.shrink(),
                      ],
                    ),
                  ),
                if (visibleTabs.isNotEmpty)
                  AppBottomTabBar(
                    visibleTabs: visibleTabs,
                    currentIndex: currentIndex,
                    hasUnreadReviews: hasUnreadReviews,
                    onTap: (index) => setState(() => _selectedTabName = visibleTabs[index].name),
                  ),
              ],
            ),
          ),
        );

        return PopScope(
          canPop: currentIndex == 0 && !_isBadgePopupShowing,
          onPopInvokedWithResult: (didPop, _) {
            if (didPop) return;
            // RN's popup is a Modal whose onRequestClose closes the badge.
            if (_isBadgePopupShowing) {
              _badgePopupKey.currentState?.close();
              return;
            }
            if (visibleTabs.isNotEmpty) setState(() => _selectedTabName = visibleTabs.first.name);
          },
          child: Stack(
            fit: StackFit.expand,
            children: [
              scaffold,
              BadgePopupHost(
                key: _badgePopupKey,
                active: badgePopupActive,
                onShowingChanged: (showing) => setState(() => _isBadgePopupShowing = showing),
              ),
            ],
          ),
        );
      },
    );
  }
}
