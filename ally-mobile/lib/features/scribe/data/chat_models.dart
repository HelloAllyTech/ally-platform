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

/// Mirrors RN's `AllyPlatforms` enum (`src/constants/general.ts`) — only the
/// value `isWebMicrophoneMode`-equivalent checks need.
class AllyPlatform {
  AllyPlatform._();

  static const mobile = 'MOBILE';
  static const web = 'WEB';
}

/// Mirrors RN's `MessageType` enum (`src/types/message.ts`).
class MessageType {
  MessageType._();

  static const text = 'TEXT';
  static const nudge = 'NUDGE';
  static const stage = 'STAGE';
}

/// Scoped port of RN's `ChatMessage` (`src/types/message.ts`) — a single
/// persisted message on a chat, as returned inside `Chat.messages` for
/// rehydrating a transcript already in progress (e.g. after `USER_JOINED`).
class ChatMessage {
  ChatMessage({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    id: (json['id'] as num).toInt(),
    chatId: (json['chatId'] as num).toInt(),
    senderId: (json['senderId'] as num).toInt(),
    type: json['type'] as String,
    content: json['content'] as String,
    createdAt: json['createdAt'] as String,
  );

  final int id;
  final int chatId;
  final int senderId;
  final String type;
  final String content;
  final String createdAt;
}

/// Scoped port of RN's `Chat` interface (`src/types/message.ts`) — the
/// fields `ConferenceListeningScreen`/`ScribeRecordingScreen` and the
/// active-chat check need. `client`/`counselor` (full `User` objects)
/// aren't modeled, since nothing ported so far renders them.
class Chat {
  Chat({
    required this.chatId,
    required this.status,
    required this.provider,
    required this.startedAt,
    this.endedAt,
    this.platform,
    this.messages = const [],
  });

  factory Chat.fromJson(Map<String, dynamic> json) => Chat(
    chatId: (json['chatId'] as num).toInt(),
    status: json['status'] as String,
    provider: json['provider'] as String,
    startedAt: json['startedAt'] as String,
    endedAt: json['endedAt'] as String?,
    platform: json['platform'] as String?,
    messages: (json['messages'] as List<dynamic>? ?? [])
        .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final int chatId;
  final String status;
  final String provider;
  final String startedAt;
  final String? endedAt;
  final String? platform;
  final List<ChatMessage> messages;

  bool get isConferenceCall => ChatProvider.conferenceCallProviders.contains(provider);

  /// Mirrors RN's `isWebMicrophoneMode` (`useListeningCommon.ts`) — a
  /// microphone chat started from the web dashboard rather than this app,
  /// where the mobile client can only listen, not control (mute/pause) or
  /// stream its own audio.
  bool get isWebMicrophoneMode =>
      provider == ChatProvider.microphone && platform == AllyPlatform.web;
}

/// Mirrors RN's `FeedbackResponse` (`src/types/message.ts`) — a stored
/// thumbs-up/down rating on a nudge. `rating` is `1` for thumbs-up, `0` for
/// thumbs-down (RN's own convention, not a boolean).
class NudgeFeedback {
  NudgeFeedback({required this.feedbackId, required this.rating});

  factory NudgeFeedback.fromJson(Map<String, dynamic> json) => NudgeFeedback(
    feedbackId: (json['feedbackId'] as num).toInt(),
    rating: (json['rating'] as num).toInt(),
  );

  final int feedbackId;
  final int rating;
}

/// Scoped port of RN's `Nudge` type — an AI coaching tip delivered live over
/// the `NUDGE` socket event during a recording session. See
/// `nudge_section.dart`.
class Nudge {
  Nudge({
    required this.id,
    required this.content,
    required this.chatId,
    required this.senderId,
    required this.createdAt,
    this.feedback,
  });

  factory Nudge.fromJson(Map<String, dynamic> json) => Nudge(
    id: (json['id'] as num).toInt(),
    content: json['content'] as String,
    chatId: (json['chatId'] as num).toInt(),
    senderId: (json['senderId'] as num).toInt(),
    createdAt: json['createdAt'] as String,
    feedback: json['feedback'] != null
        ? NudgeFeedback.fromJson(json['feedback'] as Map<String, dynamic>)
        : null,
  );

  final int id;
  final String content;
  final int chatId;
  final int senderId;
  final String createdAt;
  final NudgeFeedback? feedback;

  Nudge copyWithFeedback(NudgeFeedback feedback) => Nudge(
    id: id,
    content: content,
    chatId: chatId,
    senderId: senderId,
    createdAt: createdAt,
    feedback: feedback,
  );
}
