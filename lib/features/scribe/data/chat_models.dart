/// Mirrors ally-mobile (React Native)'s `ChatProvider` enum
/// (`src/types/message.ts`) — which transport started a chat. A
/// `ConferenceCallProviders` chat ([exotelConferenceCall]/[ozonetel]) is
/// what `ConferenceListeningScreen` renders; [microphone] is Scribe's own
/// recording screen.
class ChatProvider {
  ChatProvider._();

  static const exotelConferenceCall = 'EXOTEL_CONFERENCE_CALL';
  static const microphone = 'MICROPHONE';
  static const webrtc = 'WEBRTC';
  static const ozonetel = 'OZONETEL';
  static const audioUpload = 'AUDIO_UPLOAD';

  static const conferenceCallProviders = [exotelConferenceCall, ozonetel];
}

/// Mirrors RN's `ChatStatus` enum.
class ChatStatus {
  ChatStatus._();

  static const ended = 'ENDED';
  static const paused = 'PAUSED';
  static const active = 'ACTIVE';
}

/// Scoped port of RN's `Chat` interface (`src/types/message.ts`) — only the
/// fields `ConferenceListeningScreen` and the active-chat check need.
/// `client`/`counselor` (full `User` objects) and `messages` aren't modeled,
/// since nothing ported so far renders them.
class Chat {
  Chat({
    required this.chatId,
    required this.status,
    required this.provider,
    required this.startedAt,
    this.endedAt,
  });

  factory Chat.fromJson(Map<String, dynamic> json) => Chat(
    chatId: (json['chatId'] as num).toInt(),
    status: json['status'] as String,
    provider: json['provider'] as String,
    startedAt: json['startedAt'] as String,
    endedAt: json['endedAt'] as String?,
  );

  final int chatId;
  final String status;
  final String provider;
  final String startedAt;
  final String? endedAt;

  bool get isConferenceCall => ChatProvider.conferenceCallProviders.contains(provider);
}
