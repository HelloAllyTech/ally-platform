import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/realtime/livekit_room_service.dart';
import '../../simulations/data/simulations_repository.dart';

/// Phase 1's other half: live roleplay voice, mirroring ally-mobile (React
/// Native)'s `SimulationAssistantScreen.tsx` connection flow —
/// `room.connect(liveKitServerUrl, accessToken)`, both values owned by the
/// backend's session-creation response (unchanged by this rewrite).
///
/// [scenarioSessionId], when provided (set by SimulationDetailsScreen's real
/// "start simulation" flow), enables the "End session" action, which calls
/// the same `endScenarioSession` endpoint the RN screen uses and routes to
/// SimulationFeedbackScreen — closing the real scenario → session →
/// feedback loop end to end, not just proving the LiveKit connection in
/// isolation as Phase 1 originally scoped it.
///
/// Scoped to proving the connection + background-audio claim, not the full
/// SimulationAssistantScreen UI (live transcript, feedback nudges, AI
/// avatar) — that's substantial, separate work for a later phase.
class RoleplayVoiceScreen extends ConsumerStatefulWidget {
  const RoleplayVoiceScreen({
    super.key,
    required this.liveKitServerUrl,
    required this.accessToken,
    this.scenarioSessionId,
  });

  final String liveKitServerUrl;
  final String accessToken;
  final String? scenarioSessionId;

  @override
  ConsumerState<RoleplayVoiceScreen> createState() =>
      _RoleplayVoiceScreenState();
}

class _RoleplayVoiceScreenState extends ConsumerState<RoleplayVoiceScreen> {
  bool _isConnected = false;
  bool _isMicEnabled = false;
  bool _isEnding = false;
  String? _error;

  @override
  void dispose() {
    ref.read(liveKitRoomServiceProvider).disconnect();
    super.dispose();
  }

  Future<void> _connect() async {
    setState(() => _error = null);

    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      setState(() => _error = 'Microphone permission denied.');
      return;
    }

    try {
      final service = ref.read(liveKitRoomServiceProvider);
      await service.connect(
        liveKitServerUrl: widget.liveKitServerUrl,
        accessToken: widget.accessToken,
      );
      await service.setMicrophoneEnabled(true);
      setState(() {
        _isConnected = true;
        _isMicEnabled = true;
      });
    } catch (e) {
      setState(() => _error = 'Failed to connect: $e');
    }
  }

  Future<void> _disconnect() async {
    await ref.read(liveKitRoomServiceProvider).disconnect();
    setState(() {
      _isConnected = false;
      _isMicEnabled = false;
    });
  }

  Future<void> _toggleMic() async {
    final next = !_isMicEnabled;
    await ref.read(liveKitRoomServiceProvider).setMicrophoneEnabled(next);
    setState(() => _isMicEnabled = next);
  }

  Future<void> _endSession() async {
    final sessionId = widget.scenarioSessionId;
    if (sessionId == null) return;
    setState(() => _isEnding = true);
    try {
      await ref.read(simulationsRepositoryProvider).endScenarioSession(sessionId);
      await _disconnect();
      if (mounted) context.pushReplacement('/simulations/feedback/$sessionId');
    } catch (e) {
      setState(() => _error = 'Failed to end session: $e');
    } finally {
      if (mounted) setState(() => _isEnding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Roleplay voice')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _isConnected ? Icons.podcasts : Icons.podcasts_outlined,
                size: 64,
                color: _isConnected ? Colors.green : null,
              ),
              const SizedBox(height: 16),
              Text(_isConnected ? 'Connected to room' : 'Not connected'),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              const SizedBox(height: 24),
              if (!_isConnected)
                FilledButton(onPressed: _connect, child: const Text('Connect'))
              else ...[
                FilledButton.icon(
                  onPressed: _toggleMic,
                  icon: Icon(_isMicEnabled ? Icons.mic : Icons.mic_off),
                  label: Text(_isMicEnabled ? 'Mute' : 'Unmute'),
                ),
                const SizedBox(height: 12),
                if (widget.scenarioSessionId != null)
                  FilledButton(
                    onPressed: _isEnding ? null : _endSession,
                    style: FilledButton.styleFrom(backgroundColor: Colors.red),
                    child: _isEnding
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('End session'),
                  )
                else
                  OutlinedButton(
                    onPressed: _disconnect,
                    child: const Text('Disconnect'),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
