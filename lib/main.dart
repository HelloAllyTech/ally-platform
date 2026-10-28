import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth/auth_state.dart';
import 'core/chat/active_chat_discovery.dart';
import 'core/localization/localization_controller.dart';
import 'core/push/push_notification_service.dart';
import 'core/routing/app_router.dart';
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
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {
    // Expected until this app's own Firebase config files are added.
  }

  runApp(const ProviderScope(child: AllyApp()));
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
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    // Watched here (not just read where needed) so the bundled-asset load
    // and dynamic CDN sync both kick off as soon as the app starts, not
    // lazily on first use by some screen — matches the RN app's own
    // eager-init-at-startup behavior.
    ref.watch(localizationControllerProvider);

    // Mirrors RN's cold-launch discovery check, run once auth first
    // resolves to authenticated (no literal Splash screen exists here to
    // hang this off instead — see active_chat_discovery.dart's class doc).
    ref.listen(authControllerProvider, (previous, next) {
      if (next.isAuthenticated && !_wasAuthenticated) {
        checkForActiveChat(ref, ref.read(appRouterProvider));
      }
      _wasAuthenticated = next.isAuthenticated;
    });

    return MaterialApp.router(
      title: 'Ally',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      builder: (context, child) => RnScale(child: child!),
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
