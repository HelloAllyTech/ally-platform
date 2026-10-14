import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/notifications/data/notifications_repository.dart';

/// Ported from ally-mobile (React Native)'s device-token registration flow
/// (`src/services/notificationsApi.ts`'s `registerDeviceToken`, `platform`
/// field matching RN's `Platform.OS === 'ios' ? 'IOS' : 'ANDROID'` exactly).
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

  Future<void> initializeAndRegister(NotificationsRepository repository) async {
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
