import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Port of ally-mobile (React Native)'s `useNetworkConnectivity` (NetInfo):
/// `true` while the device has no network connection. RN also treats
/// "connected but `isInternetReachable === false`" as offline;
/// connectivity_plus reports interfaces only, so a captive/dead Wi-Fi reads
/// as online here and surfaces as a socket error instead.
///
/// Drives the Listening screens' NETWORK-vs-SOCKET disconnected states and
/// hides "Try again" while offline. Errors (e.g. no plugin in tests) read
/// as online, so a failed probe never blocks a session.
final isOfflineProvider = StreamProvider<bool>((ref) async* {
  final connectivity = Connectivity();
  bool isOffline(List<ConnectivityResult> results) =>
      results.isEmpty || results.every((r) => r == ConnectivityResult.none);
  try {
    yield isOffline(await connectivity.checkConnectivity());
    yield* connectivity.onConnectivityChanged.map(isOffline);
  } catch (_) {
    yield false;
  }
});
