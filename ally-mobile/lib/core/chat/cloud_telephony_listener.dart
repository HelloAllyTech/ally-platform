import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_state.dart';
import '../config/app_config.dart';
import '../realtime/socket_events.dart';
import '../realtime/socket_service.dart';

/// Port of ally-mobile (React Native)'s app-wide cloud-telephony socket
/// (`RootNavigator.tsx`: `useSocketConnection({path: CLOUD_TELEPHONY_PATH,
/// eventCallbacks: {USER_JOINED: checkCounselorChat}})`). A conference call
/// is answered on the counsellor's phone with no screen open; the server
/// then emits `USER_JOINED` on this namespace, and the active-chat check
/// routes to the Listening screen straight away instead of on the next
/// resume or relaunch.
///
/// Its own [SocketService] instance — the shared `socketServiceProvider`
/// belongs to whichever Listening screen is open (RN keeps these as
/// separate sockets too). Like RN's `useSocketConnection` default, it is
/// dropped when the app goes to the background and reconnected when it
/// comes back. There is deliberately no app-wide microphone socket (RN's
/// comment: it doubled every counsellor's connections).
class CloudTelephonyListener {
  CloudTelephonyListener(this._socket);

  final SocketService _socket;
  bool _active = false;
  String? _userId;
  VoidCallback? _onUserJoined;

  bool get isActive => _active;

  /// Connects (idempotent) for the signed-in [userId]; [onUserJoined] runs
  /// the active-chat check.
  Future<void> start({required String userId, required VoidCallback onUserJoined}) async {
    _userId = userId;
    _onUserJoined = onUserJoined;
    _active = true;
    await _connect();
  }

  Future<void> _connect() async {
    final userId = _userId;
    if (!_active || userId == null) return;
    await _socket.connect(
      namespacePath: AppConfig.cloudTelephonyPath,
      userId: userId,
      eventCallbacks: {SocketEvent.userJoined: (_) => _onUserJoined?.call()},
    );
  }

  /// App lifecycle: RN `useSocketConnection` disconnects on background and
  /// reconnects on foreground.
  Future<void> onLifecycle(AppLifecycleState state) async {
    if (!_active) return;
    if (state == AppLifecycleState.resumed) {
      await _connect();
    } else if (state == AppLifecycleState.paused) {
      _socket.disconnect();
    }
  }

  /// Signed out.
  void stop() {
    _active = false;
    _userId = null;
    _onUserJoined = null;
    _socket.disconnect();
  }
}

final cloudTelephonyListenerProvider = Provider<CloudTelephonyListener>((ref) {
  final listener = CloudTelephonyListener(SocketService(ref.watch(tokenStorageProvider)));
  ref.onDispose(listener.stop);
  return listener;
});
