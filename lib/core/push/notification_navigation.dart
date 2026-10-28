/// Direct port of ally-mobile (React Native)'s `src/utils/notificationNavigation.ts`
/// plus the `LEADERBOARD_NOTIFICATION_ID` tap special-case wired at
/// `RootNavigator.tsx:324-389` — kept as pure, directly-testable functions
/// (matching this repo's `active_chat_discovery.dart` precedent) since the
/// actual plugin callbacks that call these run outside any testable widget
/// or Riverpod context.
library;

import '../navigation/home_tab_navigation.dart';
import '../navigation/tab_config.dart' show kTabLeaderboard;

/// RN's `REMINDER_NOTIFICATION_TYPE` (`src/constants/notifications.ts`) — the
/// backend's literal value for a server-sent engagement-reminder push.
const String reminderNotificationType = 'ENGAGEMENT_REMINDER';

/// RN's `SCREEN_NAMES.SIMULATIONS` (`src/constants/navigation.ts`) — the
/// literal `screen` hint value the backend sends on a reminder payload that
/// should land on Simulations rather than the Notifications feed.
const String _simulationsScreenHint = 'Simulations';

/// RN's `LEADERBOARD_NOTIFICATION_ID` (`src/constants/leaderboard.ts`) — the
/// fixed id RN's locally-scheduled weekly leaderboard reminder uses (scheduled
/// here by `leaderboard_notification.dart`, which puts it in the payload).
const String leaderboardNotificationId = 'weekly-leaderboard';

/// Is this notification payload a server-sent engagement reminder? Mirrors
/// RN's `isReminderNotification`.
bool isReminderNotification(Map<String, dynamic>? data) => data?['type'] == reminderNotificationType;

/// Where a reminder notification's tap should land. Mirrors RN's
/// `handleReminderNavigation`: a `screen: "Simulations"` hint routes there;
/// anything else (including no hint) lands on the Notifications feed.
///
/// Unlike RN's `handleReminderNavigation`, this does not wait for a
/// navigator to leave a Splash route first — matching
/// `active_chat_discovery.dart`'s documented precedent that an imperative
/// `router.go(...)` works identically regardless of Flutter's current route
/// (there is no literal Splash screen to wait past here either).
String reminderRouteFor(Map<String, dynamic>? data) =>
    data?['screen'] == _simulationsScreenHint ? '/simulations' : '/notifications';

/// The single decision point every notification-tap handler (foreground,
/// background-but-not-killed, and cold-start) calls into. `null` means
/// "nothing to navigate for this tap."
///
/// The weekly leaderboard reminder jumps to the Leaderboard *tab*, like
/// RN's `navigateToLeaderboard` (`TabActions.jumpTo`), not a standalone
/// Leaderboard screen without the tab bar.
String? routeForNotificationTap({String? notificationId, Map<String, dynamic>? data}) {
  if (notificationId == leaderboardNotificationId) return homeTabLocation(kTabLeaderboard);
  if (isReminderNotification(data)) return reminderRouteFor(data);
  return null;
}
