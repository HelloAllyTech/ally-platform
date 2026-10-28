import 'package:go_router/go_router.dart';

/// A request to land on a specific bottom tab when going to `/home`,
/// carried as the route's `extra`. Each request is a new object, so asking
/// for the same tab twice still switches to it the second time (the shell
/// compares requests by identity, not by tab name, so an unrelated rebuild
/// of `/home` never yanks the user back to a tab they already left).
class HomeTabRequest {
  HomeTabRequest(this.tabName);

  /// A `TabConfig.name` (`kTabLearn`, `kTabLeaderboard`, ...).
  final String tabName;
}

/// `/home?tab=<name>`: the location [goToHomeTab] goes to. The query
/// parameter is informational (it reads well in logs and lets a pure
/// route-decision function name a tab); [AppShellScreen] acts on the
/// [HomeTabRequest] extra.
String homeTabLocation(String tabName) => Uri(path: '/home', queryParameters: {'tab': tabName}).toString();

/// RN `utils/navigation.ts` `navigateToTab` (and `navigateToLearnTab` /
/// `navigateToCallLogTab`), and RootNavigator's `TabActions.jumpTo` for the
/// leaderboard reminder: reset to the home shell showing [tabName]. A tab
/// the user can't see falls back to the first visible tab.
void goToHomeTab(GoRouter router, String tabName) =>
    router.go(homeTabLocation(tabName), extra: HomeTabRequest(tabName));

/// Goes to [location]; a `/home?tab=` location produced by
/// [homeTabLocation] goes through [goToHomeTab] so the tab is selected.
void goToLocation(GoRouter router, String location) {
  final uri = Uri.parse(location);
  final tab = uri.queryParameters['tab'];
  if (uri.path == '/home' && tab != null) {
    goToHomeTab(router, tab);
  } else {
    router.go(location);
  }
}
