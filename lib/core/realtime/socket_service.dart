import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../auth/auth_state.dart';
import '../config/app_config.dart';
import '../network/token_storage.dart';

/// Faithful port of ally-mobile (React Native)'s `useSocket.ts` — same
/// Socket.IO connection config, same reconnection behavior, and most
/// importantly, the same fix for the bug documented in that file's own
/// comment:
///
///   "counselors accumulating four to seven live sockets on
///   /microphone-chat" — caused by `connect()` creating a brand-new `io(...)`
///   on every call with no guard, so re-renders / effect re-entries left
///   orphaned sockets nobody could close.
///
/// Riverpod naturally avoids the *mechanism* of that bug: a `Provider`
/// instance isn't recreated on every widget rebuild the way a React hook's
/// closure can re-run `io(...)`, so this service is instantiated once per
/// app session rather than once per render. The idempotent-connect guard
/// below is kept anyway — belt and suspenders — since nothing prevents two
/// *callers* from both invoking `connect()` around the same time.
class SocketService {
  SocketService(this._tokenStorage);

  final TokenStorage _tokenStorage;

  io.Socket? _socket;
  bool _isConnecting = false;

  /// RN `useSocket`'s `RETRY_AFTER_FAILURE_MS`: when opening the socket
  /// throws (token read, client setup), try again after this long.
  static const retryAfterFailure = Duration(milliseconds: 2000);
  Timer? _retryTimer;

  /// RN `generationRef`: bumped by [disconnect], so a connect that was
  /// awaiting the token when the owner disconnected abandons itself
  /// instead of installing a socket nobody holds.
  int _generation = 0;

  bool get isConnected => _socket?.connected ?? false;

  /// [namespacePath] matches RN's `env.MICROPHONE_SOCKET_PATH` style config —
  /// a Socket.IO namespace like `/microphone-chat`, not the engine.io
  /// transport path (always `/socket.io`, set below).
  Future<void> connect({
    required String namespacePath,
    required String userId,
    Map<String, void Function(dynamic data)> eventCallbacks = const {},
    void Function()? onConnect,
    void Function(String? reason)? onDisconnect,
    void Function(Object? error)? onConnectionError,
  }) async {
    _retryTimer?.cancel();
    _retryTimer = null;
    // Already ours — never replace it, matching useSocket.ts exactly.
    if (_socket != null) {
      if (_socket!.connected != true) _socket!.connect();
      return;
    }
    if (_isConnecting) return;
    _isConnecting = true;
    final generation = _generation;

    try {
      final accessToken = await _tokenStorage.accessToken;
      if (generation != _generation) return;
      if (accessToken == null) {
        return;
      }

      final socket = io.io(
        '${AppConfig.requireApiBaseUrl}$namespacePath',
        io.OptionBuilder()
            .setPath('/socket.io')
            .setTransports(['websocket', 'polling'])
            // Fetched fresh on every (re)connection attempt, matching the
            // JS client's callback-style `auth` — a static map here would
            // replay a stale token forever across reconnects, same problem
            // the RN code's comment calls out explicitly.
            .setAuthFn((callback) async {
              final freshToken = await _tokenStorage.accessToken;
              callback({'token': freshToken ?? accessToken});
            })
            .enableReconnection()
            .setReconnectionAttempts(5)
            .setReconnectionDelay(1000)
            .setReconnectionDelayMax(5000)
            .setTimeout(10000)
            .enableForceNew()
            .disableAutoConnect()
            .build(),
      );

      socket.onConnect((_) => onConnect?.call());
      socket.onDisconnect((reason) => onDisconnect?.call(reason?.toString()));
      socket.onConnectError((error) => onConnectionError?.call(error));
      socket.onError((error) {});

      eventCallbacks.forEach((event, handler) {
        socket.on(event, handler);
      });

      _socket = socket;
      socket.connect();
    } catch (_) {
      if (generation != _generation) return;
      _retryTimer = Timer(retryAfterFailure, () {
        _retryTimer = null;
        connect(
          namespacePath: namespacePath,
          userId: userId,
          eventCallbacks: eventCallbacks,
          onConnect: onConnect,
          onDisconnect: onDisconnect,
          onConnectionError: onConnectionError,
        );
      });
    } finally {
      if (generation == _generation) _isConnecting = false;
    }
  }

  void disconnect() {
    _generation++;
    _retryTimer?.cancel();
    _retryTimer = null;
    _isConnecting = false;
    final socket = _socket;
    _socket = null;
    socket?.clearListeners();
    socket?.disconnect();
    socket?.dispose();
  }

  void emit(String event, Map<String, dynamic> data) {
    _socket?.emit(event, data);
  }
}

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService(ref.watch(tokenStorageProvider));
  ref.onDispose(service.disconnect);
  return service;
});
