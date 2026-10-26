import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';

/// A single LiveKit data-channel message, decoded best-effort. Every
/// consumer (checklist, turn-status, pause/resume ack, ...) pattern-matches
/// on [json]/[topic] itself, mirroring ally-mobile (React Native)'s single
/// `onDataReceived` handler (`SimulationAssistantScreen.tsx`), which also
/// inspects every incoming message regardless of LiveKit `topic` rather
/// than filtering by it up front — the agent worker (ally-ai-learn) sends
/// several message families (`AGENT_STATE`, checklist/score feedback,
/// pause/resume/connection-state control, live supervisor notes) over the
/// same channel, several with no `topic` at all.
class LiveKitDataMessage {
  LiveKitDataMessage({required this.topic, required this.raw, required this.json});

  /// Decodes a raw data-channel payload — `json` is `null` when the bytes
  /// aren't valid UTF-8 JSON mapping to an object, so a malformed or
  /// unrecognized message never crashes a listener.
  factory LiveKitDataMessage.decode(List<int> raw, String? topic) {
    Map<String, dynamic>? decoded;
    try {
      final value = jsonDecode(utf8.decode(raw));
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {
      decoded = null;
    }
    return LiveKitDataMessage(topic: topic, raw: raw, json: decoded);
  }

  final String? topic;
  final List<int> raw;
  final Map<String, dynamic>? json;
}

/// Thin wrapper around LiveKit's `Room`, mirroring exactly what
/// ally-mobile (React Native)'s `SimulationAssistantScreen.tsx` does:
/// `room.connect(liveKitServerUrl, accessToken)`, where both values come
/// from the backend's session-creation response (unchanged by this
/// rewrite — same session API, same token minting). This is the other
/// half of Phase 1 alongside [ForegroundRecordingService]/[SocketService]:
/// LiveKit's own SDK already declares background-audio support on both
/// platforms (see Flutter-Migration-Plan.pdf), which is the actual bet this
/// migration is making for live roleplay voice specifically.
///
/// [dataMessages]/[publishData] are the data-channel plumbing RN's
/// `SimulationAssistantScreen` builds its checklist, turn-status and
/// pause/resume features on top of — kept generic (raw decoded messages in,
/// a raw payload out) rather than hardcoded to one feature's shape, since
/// the backend already sends at least two more message families
/// (`connection-state`, live supervisor notes) no client consumes yet.
class LiveKitRoomService {
  Room? _room;

  Room get room => _room ??= Room();

  bool get isConnected => _room?.connectionState == ConnectionState.connected;

  EventsListener<RoomEvent>? _listener;
  final _dataController = StreamController<LiveKitDataMessage>.broadcast();

  /// Every data-channel message received while connected. A broadcast
  /// stream so more than one consumer (e.g. a checklist handler and a
  /// turn-status handler) can listen independently.
  Stream<LiveKitDataMessage> get dataMessages => _dataController.stream;

  Future<void> connect({
    required String liveKitServerUrl,
    required String accessToken,
  }) async {
    await room.connect(liveKitServerUrl, accessToken);
    await _listener?.dispose();
    _listener = room.createListener()
      ..on<DataReceivedEvent>((event) {
        _dataController.add(LiveKitDataMessage.decode(event.data, event.topic));
      });
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    await room.localParticipant?.setMicrophoneEnabled(enabled);
  }

  /// Sends a client→agent control message over the data channel — mirrors
  /// RN's `publishControl` (`room.localParticipant.publishData(...,
  /// {reliable: true})`), used today for pause/resume.
  Future<void> publishData(
    Map<String, dynamic> payload, {
    bool reliable = true,
    String? topic,
  }) async {
    await room.localParticipant?.publishData(
      utf8.encode(jsonEncode(payload)),
      reliable: reliable,
      topic: topic,
    );
  }

  Future<void> disconnect() async {
    await _listener?.dispose();
    _listener = null;
    await _room?.disconnect();
  }

  Future<void> dispose() async {
    await _listener?.dispose();
    _listener = null;
    await _room?.dispose();
    _room = null;
    await _dataController.close();
  }
}

final liveKitRoomServiceProvider = Provider<LiveKitRoomService>((ref) {
  final service = LiveKitRoomService();
  ref.onDispose(service.dispose);
  return service;
});
