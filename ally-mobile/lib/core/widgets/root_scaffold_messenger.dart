import 'package:flutter/material.dart';

/// Lets non-widget code (the auth interceptor's unrecoverable-401 path,
/// deep inside the network layer with no `BuildContext` of its own) show a
/// snackbar the same way RN's `showToast` call in `handleUserLogout` does —
/// pass this to `MaterialApp.router(scaffoldMessengerKey: ...)` once, at the
/// app root.
final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();
