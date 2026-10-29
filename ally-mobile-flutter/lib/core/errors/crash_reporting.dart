import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'error_boundary.dart';

/// Wires Flutter's global error hooks the way RN's `App.tsx` +
/// `components/ErrorBoundary` + `@react-native-firebase/crashlytics` do:
///
/// - a widget that throws while building swaps the app for RN's
///   `ErrorFallback` ([renderErrorWidgetBuilder] + [AppErrorBoundary])
///   instead of leaving a dead grey box;
/// - framework errors are reported to Crashlytics as non-fatal, like RN's
///   `crashlytics().recordError(error, 'UnhandledRenderError')`;
/// - uncaught async errors are reported as fatal (RN Firebase reports
///   native crashes automatically; this is the Dart-side equivalent).
///
/// [firebaseReady] is whether `Firebase.initializeApp()` succeeded. It
/// doesn't until the Firebase config files exist (see `main.dart`), and
/// then Crashlytics is left alone entirely: errors are still printed and
/// the fallback still shows, nothing is reported, nothing throws.
/// Reporting must never be what stops the fallback from showing, so every
/// Crashlytics call is guarded, as RN's `componentDidCatch` does.
void installErrorHandling({required bool firebaseReady}) {
  ErrorWidget.builder = renderErrorWidgetBuilder;

  final crashlytics = firebaseReady ? _tryCrashlytics() : null;
  final previousOnError = FlutterError.onError;
  FlutterError.onError = (details) {
    (previousOnError ?? FlutterError.presentError)(details);
    if (crashlytics == null) return;
    try {
      crashlytics.recordFlutterError(details);
    } catch (_) {
      // See above: reporting is best-effort.
    }
  };

  if (crashlytics == null) return;
  PlatformDispatcher.instance.onError = (error, stack) {
    try {
      crashlytics.recordError(error, stack, fatal: true);
    } catch (_) {
      // Best-effort.
    }
    // Not handled: the engine still logs it as before.
    return false;
  };
}

FirebaseCrashlytics? _tryCrashlytics() {
  try {
    return FirebaseCrashlytics.instance;
  } catch (error) {
    debugPrint('Crashlytics unavailable: $error');
    return null;
  }
}
