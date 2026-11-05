import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

/// Port of ally-mobile (React Native)'s `@sayem314/react-native-keep-awake`
/// usage: `activateKeepAwake()` on mount / `deactivateKeepAwake()` on
/// unmount of the live role-play screen (`SimulationAssistantScreen`) and
/// the Scribe/Conference listening screens (`useListeningCommon`). Keeps the
/// SCREEN on (not just the CPU, which `ForegroundRecordingService`'s
/// `allowWakeLock` already covers on Android Scribe).
///
/// Behind a provider so widget tests can override it — the real plugin
/// needs a platform channel.
class KeepAwake {
  const KeepAwake();

  Future<void> activate() async {
    try {
      await WakelockPlus.enable();
    } catch (_) {
      // Best effort, as in RN: a failed wake lock must never break a call.
    }
  }

  Future<void> deactivate() async {
    try {
      await WakelockPlus.disable();
    } catch (_) {}
  }
}

final keepAwakeProvider = Provider<KeepAwake>((ref) => const KeepAwake());
