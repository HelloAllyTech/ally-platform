import 'package:app_links/app_links.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/app_update/force_update_modal.dart';
import 'core/auth/auth_state.dart';
import 'core/chat/active_chat_discovery.dart';
import 'core/chat/cloud_telephony_listener.dart';
import 'core/config/app_config.dart';
import 'core/deeplink/deep_link_binding.dart';
import 'core/errors/crash_reporting.dart';
import 'core/errors/error_boundary.dart';
import 'core/localization/localization_controller.dart';
import 'core/migration/legacy_session_migration.dart';
import 'core/network/token_storage.dart';
import 'core/push/leaderboard_notification.dart';
import 'core/push/push_notification_service.dart';
import 'core/routing/app_router.dart';
import 'core/network/retry_policy.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/rn_scale.dart';
import 'core/widgets/root_scaffold_messenger.dart';

Future<void> main() async {
  // Registering FCM's background-message handler requires a (possibly
  // repeat) `Firebase.initializeApp()` call here, before `runApp()` — unlike
  // `PushNotificationService.initializeAndRegister`'s own init call (which
  // only runs once a user reaches `/home`), this one must happen on every
  // cold start regardless of auth state, since a killed app's background
  // isolate needs the handler already registered before any push can arrive.
  // Calling `Firebase.initializeApp()` twice is safe (it returns the
  // already-initialized app the second time); wrapped in try/catch for the
  // same graceful-degradation reason `PushNotificationService` already
  // documents — this app has no Firebase config files of its own yet.
  WidgetsFlutterBinding.ensureInitialized();
  var firebaseReady = false;
  try {
    await Firebase.initializeApp();
    firebaseReady = true;
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {
    // Expected until this app's own Firebase config files are added.
  }
  // RN App.tsx's ErrorBoundary + Crashlytics; reporting no-ops without
  // Firebase.
  installErrorHandling(firebaseReady: firebaseReady);
  // RN is portrait-only (Info.plist UISupportedInterfaceOrientations,
  // manifest screenOrientation="portrait"); the native files say the same,
  // this also covers iPad, whose Info.plist list Flutter keeps open.
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);

  // The store build replaces the React Native app in place: carry its
  // sign-in and preferences over once, before anything reads them.
  if (AppConfig.isProdFlavor) await migrateFromReactNativeApp(TokenStorage());

  // Universal / App Links (RN RootNavigator's Linking listener). Created
  // before runApp so the link that cold-started the app isn't missed.
  final deepLinks = AppLinks().uriLinkStream;

  runApp(
    ProviderScope(
      retry: appRetryPolicy,
      overrides: [deepLinkStreamProvider.overrideWithValue(deepLinks)],
      child: const AllyApp(),
    ),
  );
}

class AllyApp extends ConsumerStatefulWidget {
  const AllyApp({super.key});

  @override
  ConsumerState<AllyApp> createState() => _AllyAppState();
}

class _AllyAppState extends ConsumerState<AllyApp> with WidgetsBindingObserver {
  bool _wasAuthenticated = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Mirrors RN's `AppState` background→foreground listener
    // (`useCounselorChat.ts`) — re-check for a session that's still active
    // after the app was backgrounded or relaunched.
    if (state == AppLifecycleState.resumed) {
      checkForActiveChat(ref, ref.read(appRouterProvider));
    }
    ref.read(cloudTelephonyListenerProvider).onLifecycle(state);
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    // Watched here (not just read where needed) so the bundled-asset load
    // and dynamic CDN sync both kick off as soon as the app starts, not
    // lazily on first use by some screen — matches the RN app's own
    // eager-init-at-startup behavior.
    ref.watch(localizationControllerProvider);
    // Schedules/cancels RN's weekly leaderboard reminder on sign-in/out.
    ref.watch(leaderboardNotificationSyncProvider);
    // Summary and course share links (core/deeplink).
    ref.watch(deepLinkBindingProvider);

    // Mirrors RN's cold-launch discovery check, run once auth first
    // resolves to authenticated (no literal Splash screen exists here to
    // hang this off instead — see active_chat_discovery.dart's class doc).
    ref.listen(authControllerProvider, (previous, next) {
      if (next.isAuthenticated && !_wasAuthenticated) {
        checkForActiveChat(ref, ref.read(appRouterProvider));
        // RN RootNavigator's app-wide cloud-telephony socket: an incoming
        // conference call (USER_JOINED) opens Listening right away.
        ref
            .read(cloudTelephonyListenerProvider)
            .start(userId: '', onUserJoined: () => checkForActiveChat(ref, ref.read(appRouterProvider)));
      } else if (!next.isAuthenticated && _wasAuthenticated) {
        ref.read(cloudTelephonyListenerProvider).stop();
      }
      _wasAuthenticated = next.isAuthenticated;
    });

    return MaterialApp.router(
      title: 'Ally',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      // RN switches the status bar to dark content once its splash ends
      // (SplashScreen.tsx) and only a few screens override it. Screens with
      // no region of their own kept whatever was set last, so after the
      // login hero's light bar the clock was white-on-white on Home.
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.dark,
        child: RnScale(
          child: AppErrorBoundary(
            // RN re-mounts the navigator: back to Splash, which routes on
            // from the current auth state.
            onReset: () => router.go('/splash'),
            child: ForceUpdateGate(child: child!),
          ),
        ),
      ),
      // Flutter's own built-in widget strings (date pickers, dialog button
      // labels) localized across the same 5 languages the app's own
      // content supports — separate from this app's own translation
      // system (core/localization/), which flutter_localizations has no
      // involvement in.
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'),
        Locale('hi'),
        Locale('mr'),
        Locale('ta'),
        Locale('kn'),
      ],
    );
  }
}
