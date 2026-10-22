import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../features/notifications/data/notifications_repository.dart';
import '../../features/reviews/data/reviews_repository.dart';
import '../permissions/permissions_repository.dart';
import '../push/push_notification_service.dart';
import 'app_bottom_tab_bar.dart';
import 'app_drawer.dart';
import 'tab_config.dart';

/// Port of ally-mobile (React Native)'s `DrawerNavigator` + `TabNavigator`
/// combination — the single screen mounted at the app's `/home` route that
/// owns the side drawer and the floating permission-gated bottom tab bar,
/// swapping tab bodies locally (not through go_router) exactly like the RN
/// `Tab.Navigator` does. Also where push-notification device-token
/// registration fires ("once per landed on Home authenticated").
class AppShellScreen extends ConsumerStatefulWidget {
  const AppShellScreen({super.key});

  @override
  ConsumerState<AppShellScreen> createState() => _AppShellScreenState();
}

class _AppShellScreenState extends ConsumerState<AppShellScreen> {
  String? _selectedTabName;

  @override
  void initState() {
    super.initState();
    ref
        .read(pushNotificationServiceProvider)
        .initializeAndRegister(ref.read(notificationsRepositoryProvider));
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
        if (currentIndex == -1) currentIndex = 0;

        final hasUnreadReviews = ref.watch(unreadReviewCountProvider).maybeWhen(
              data: (count) => count > 0,
              orElse: () => false,
            );

        return Scaffold(
          drawer: AppDrawer(permissions: permissions),
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
                      children: [for (final tab in visibleTabs) tab.screenBuilder(context)],
                    ),
                  ),
                // RN's `useTabScreenHeader`: `showHamburger: isFirstTab` —
                // the drawer-menu icon only ever appears on the first
                // visible tab, not on every tab's screen.
                if (currentIndex == 0)
                  Positioned(
                    top: 8,
                    left: 8,
                    child: SafeArea(
                      child: IconButton(
                        icon: SvgPicture.asset('assets/icons/drawerMenu.svg', width: 24, height: 24),
                        onPressed: () => Scaffold.of(context).openDrawer(),
                      ),
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
      },
    );
  }
}
