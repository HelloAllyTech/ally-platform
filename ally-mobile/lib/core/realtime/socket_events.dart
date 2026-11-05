/// Exact wire values from ally-mobile (React Native)'s `src/types/message.ts`
/// `SocketEvent` enum — the backend (ally-be's Socket.IO gateways) is
/// unchanged by this rewrite, so these strings must match byte-for-byte.
class SocketEvent {
  SocketEvent._();

  static const sendMessage = 'SEND_MESSAGE';
  static const messageReceived = 'MESSAGE_RECEIVED';
  static const audioMessage = 'AUDIO_MESSAGE';
  static const startAudioChat = 'START_AUDIO_CHAT';
  static const chatEnded = 'CHAT_ENDED';
  static const utteranceEnded = 'UTTERANCE_ENDED';
  static const userJoined = 'USER_JOINED';
  static const sessionCreated = 'SESSION_CREATED';
  static const audioChatEnded = 'AUDIO_CHAT_ENDED';
  static const nudge = 'NUDGE';
  static const scribeStartDiagnostic = 'SCRIBE_START_DIAGNOSTIC';

  /// Server→client: a cloud-telephony (Exotel/Ozonetel) conference call's
  /// live audio, broadcast for the waveform — see `conference_listening_screen.dart`.
  static const audioStream = 'AUDIO_STREAM';

  /// Client→server only, from `ConferenceListeningScreen`'s play/pause
  /// control — mirrors RN's `publishControl`-style usage exactly: it pauses
  /// AI nudges, not any audio (there is no audio playback in this screen).
  static const audioChatPaused = 'AUDIO_CHAT_PAUSED';
  static const audioChatResumed = 'AUDIO_CHAT_RESUMED';
}
