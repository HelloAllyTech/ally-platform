import 'dart:io';

import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Android-only, once-ever system prompt asking to exempt Ally from battery
/// optimization.
///
/// The foreground-service declaration (`AndroidManifest.xml`'s top comment)
/// satisfies *stock* Android's Doze rules, but budget-segment OEM skins —
/// MIUI (Xiaomi), ColorOS (Oppo), FuntouchOS (Vivo), and similar, more
/// common on the cheaper/older phones a counsellor is more likely to carry —
/// run their own, stricter battery managers that freeze or kill a
/// foreground service anyway unless the user has separately whitelisted the
/// app. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` was already declared in the
/// manifest but never actually requested — no user ever saw this system
/// dialog — which is the likely reason summary failures were reported as
/// device-specific (older/cheaper Android only) rather than universal.
/// Added 2026-11.
///
/// Fire-and-forget by design: never await this against a session actually
/// starting — it shows a system dialog that needs a tap, and a Scribe
/// session must never wait on it. Asks only once per install (tracked in
/// SharedPreferences), because unlike a runtime permission, Android allows
/// re-showing this exact dialog after a decline, and asking every session
/// would be a nag for anyone who declined on purpose.
Future<void> requestBatteryOptimizationExemptionOnce() async {
  if (!Platform.isAndroid) return;
  try {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_askedKey) ?? false) return;
    await prefs.setBool(_askedKey, true);
    final status = await Permission.ignoreBatteryOptimizations.status;
    if (status.isGranted) return;
    await Permission.ignoreBatteryOptimizations.request();
  } catch (_) {
    // Best-effort hardening only — never block a session over this.
  }
}

const _askedKey = 'battery_optimization_exemption_asked';
