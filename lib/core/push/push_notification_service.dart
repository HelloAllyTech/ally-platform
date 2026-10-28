import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/notifications/data/notifications_repository.dart';
import 'notification_navigation.dart';

/// RN's `REMINDERS_CHANNEL_ID` (`src/constants/notifications.ts`) — same
/// Android notification channel id, so a user who's already muted/customized
/// it under the RN app keeps that choice after migrating (Android channel
/// settings are keyed by id and survive app reinstalls/updates).
const String remindersChannelId = 'reminders';

/// A single, plugin-singleton instance — `FlutterLocalNotificationsPlugin()`
/// is itself a factory returning one process-wide instance (see the
/// package's own source), so this is just a readable alias used from both
/// [PushNotificationService] (main isolate) and
/// [firebaseMessagingBackgroundHandler] (a separate background isolate,
/// which gets its own fresh instance when that top-level function runs).
final FlutterLocalNotificationsPlugin localNotificationsPlugin = FlutterLocalNotificationsPlugin();

/// Renders a data-only FCM message as a local notification — the single
/// display path used by both the foreground listener
/// ([PushNotificationService.initializeAndRegister]) and the
/// background-isolate handler ([firebaseMessagingBackgroundHandler]), mirroring
/// RN's single `displayRemoteMessage` (`pushNotificationService.ts`) used by
/// both `subscribeToForegroundMessages` and `index.js`'s
/// `setBackgroundMessageHandler`.
///
/// The backend sends DATA-ONLY messages ({title, body, type, screen, ...}) —
/// same convention as RN — so nothing is shown automatically by the OS; every
/// notification goes through this one path, keeping one look and one
/// tap-handling data shape across foreground/background/killed, exactly like
/// RN's "one look, one tap-handling path" comment describes for Notifee.
Future<void> displayReminderNotification(RemoteMessage message) async {
  final data = message.data;
  final title = (data['title'] as String?) ?? 'Ally';
  final body = (data['body'] as String?) ?? '';
  if (body.isEmpty) return;

  const details = NotificationDetails(
    android: AndroidNotificationDetails(
      remindersChannelId,
      'Reminders',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(),
  );

  // Notifee auto-assigns a random id per `displayNotification` call unless
  // one is given, which lets several reminders coexist in the tray rather
  // than overwriting one another — matched here with a per-call id instead
  // of a fixed one (`flutter_local_notifications` requires an int id).
  final id = DateTime.now().millisecondsSinceEpoch.remainder(0x7FFFFFFF);
  await localNotificationsPlugin.show(
    id: id,
    title: title,
    body: body,
    notificationDetails: details,
    // The tap handlers only get this string back (not the original data
    // map), so the full payload is round-tripped through it as JSON.
    payload: jsonEncode({'data': data}),
  );
}

bool _localNotificationsInitialized = false;
Future<void>? _localNotificationsInit;

/// Registers the tap handler that fires for a notification tapped while
/// this isolate is already alive — whether the app was genuinely in the
/// foreground, or merely backgrounded (not killed) and resumed by the tap —
/// then runs RN's `notifee.getInitialNotification()` cold-start check.
/// `flutter_local_notifications` unifies both live cases into one callback,
/// unlike RN/Notifee's split between `onForegroundEvent` (RootNavigator) and
/// `onBackgroundEvent` (`index.js`).
///
/// Idempotent: shared by [PushNotificationService] (server reminders) and
/// the weekly leaderboard reminder (`leaderboard_notification.dart`). On iOS
/// the default [DarwinInitializationSettings] also asks for notification
/// permission, as RN's `requestNotificationPermission` does.
Future<void> initializeLocalNotifications(GoRouter router) {
  if (_localNotificationsInitialized) return _localNotificationsInit!;
  _localNotificationsInitialized = true;
  return _localNotificationsInit = () async {
    try {
      await localNotificationsPlugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: (response) => navigateForNotificationPayload(response.payload, router),
      );
    } catch (_) {
      // Let a later caller retry (e.g. no plugin registered yet).
      _localNotificationsInitialized = false;
      rethrow;
    }
    final launchDetails = await localNotificationsPlugin.getNotificationAppLaunchDetails();
    if (launchDetails?.didNotificationLaunchApp != true) return;
    navigateForNotificationPayload(launchDetails?.notificationResponse?.payload, router);
  }();
}

/// Decodes a local notification's payload — `{"id": "...", "data":
/// {...}}`, see [displayReminderNotification] and the leaderboard reminder —
/// and routes via [routeForNotificationTap].
void navigateForNotificationPayload(String? payload, GoRouter router) {
  if (payload == null) return;
  String? notificationId;
  Map<String, dynamic> data;
  try {
    final decoded = jsonDecode(payload) as Map<String, dynamic>;
    notificationId = decoded['id'] as String?;
    data = (decoded['data'] as Map?)?.cast<String, dynamic>() ?? const {};
  } catch (_) {
    return;
  }
  final target = routeForNotificationTap(notificationId: notificationId, data: data);
  if (target != null) router.go(target);
}

/// FCM's background-message handler: fires in a separate background isolate
/// when a push arrives while the app is backgrounded or fully killed. Must
/// be a top-level function annotated `@pragma('vm:entry-point')` so the Dart
/// compiler doesn't strip it — registered from `main.dart`, mirroring RN's
/// `index.js`-module-scope `messaging().setBackgroundMessageHandler(...)`
/// (also registered before the app itself starts rendering, for the same
/// reason: it must exist before any background push can arrive).
///
/// Unlike RN, this does no tap-routing of its own — only display. A tap on
/// the notification this shows is handled by whichever of
/// [PushNotificationService]'s two tap paths applies once the main isolate
/// is running: `onDidReceiveNotificationResponse` if the app was merely
/// backgrounded (its isolate, and that callback's registration, survived),
/// or `getNotificationAppLaunchDetails()` on the next cold start if the app
/// was fully killed. RN draws the same line for the same reason: its
/// `index.js`-level `onBackgroundEvent` handler explicitly does nothing for
/// a reminder tap and defers to the foreground/initial-notification paths
/// once the app is up.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    await localNotificationsPlugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    await displayReminderNotification(message);
  } catch (_) {
    // Best-effort, same graceful-degradation contract as the rest of this
    // file — a missing Firebase project must not crash a background isolate
    // the app itself has no visibility into.
  }
}

/// Ported from ally-mobile (React Native)'s device-token registration flow
/// (`src/services/notificationsApi.ts`'s `registerDeviceToken`, `platform`
/// field matching RN's `Platform.OS === 'ios' ? 'IOS' : 'ANDROID'` exactly),
/// plus (new) RN's engagement-reminder push display and tap-to-navigate flow
/// (`src/services/pushNotificationService.ts`, `src/navigation/
/// RootNavigator.tsx`'s foreground/initial-notification effects, and
/// `src/utils/notificationNavigation.ts` — see `notification_navigation.dart`
/// for the ported pure routing logic).
///
/// IMPORTANT PREREQUISITE, external to this code: Firebase won't actually
/// initialize without this app's own `google-services.json` (Android) /
/// `GoogleService-Info.plist` (iOS) registered in the Firebase Console
/// against this app's distinct package name/bundle ID
/// (`com.helloally.ally_mobile_flutter` / `com.helloally.allyMobileFlutter`
/// — not the real app's). That's Firebase Console setup, not something
/// fixable in code, same category of gap as Google/Apple sign-in. Every
/// call here is wrapped so a missing/misconfigured Firebase project
/// degrades to "push notifications don't work yet" rather than crashing
/// app startup.
class PushNotificationService {
  bool _initialized = false;

  Future<void> initializeAndRegister(NotificationsRepository repository, GoRouter router) async {
    // Local notifications (tap routing, the cold-start check) don't depend
    // on Firebase: the locally-scheduled weekly leaderboard reminder needs
    // them even while this app has no Firebase project configured.
    try {
      await initializeLocalNotifications(router);
    } catch (_) {
      // Same graceful-degradation contract as the rest of this class.
    }

    try {
      await Firebase.initializeApp();
    } catch (error) {
      // Expected until this app's own Firebase config files are added —
      // see class doc comment. Every other feature must keep working.
      return;
    }

    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();

      final token = await messaging.getToken();
      if (token != null) {
        await repository.registerDeviceToken(token: token, platform: _platform);
      }

      if (!_initialized) {
        _initialized = true;
        messaging.onTokenRefresh.listen((newToken) {
          repository.registerDeviceToken(token: newToken, platform: _platform);
        });

        // Foreground-only: `firebaseMessagingBackgroundHandler` (registered
        // separately, in `main.dart`) covers backgrounded/killed arrival —
        // mirrors RN's split between `subscribeToForegroundMessages`
        // (RootNavigator effect) and `setBackgroundMessageHandler`
        // (`index.js`, module scope).
        FirebaseMessaging.onMessage.listen(displayReminderNotification);
      }
    } catch (error) {
      // A real Firebase project but a still-rejected token request (e.g.
      // permission denied) shouldn't be fatal either — same reasoning.
      return;
    }
  }

  // `defaultTargetPlatform`, not `dart:io`'s `Platform` — the latter throws
  // `UnsupportedError` on web (no OS concept in a browser), and this getter
  // needs to stay callable on every target this app builds for.
  String get _platform => defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID';
}

final pushNotificationServiceProvider = Provider<PushNotificationService>((ref) {
  return PushNotificationService();
});
