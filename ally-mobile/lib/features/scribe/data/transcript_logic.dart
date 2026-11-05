import 'chat_models.dart';

/// Mirrors RN's `Transcription` interface (`src/types/message.ts`) — one
/// entry in a live transcript bucket (the counsellor's own speech, or the
/// client's). `isFinal`/`isSentenceComplete` default to `true` when a
/// message carries neither (matching how RN's own type declares both
/// optional, and how pre-existing REST-fetched messages are rehydrated —
/// see `rehydrateTranscriptions` below): a message silently missing these
/// flags should read as complete, not get stuck looking "in progress."
class Transcription {
  Transcription({
    required this.id,
    required this.message,
    required this.senderId,
    required this.timestamp,
    this.isFinal = true,
    this.isSentenceComplete = true,
  });

  factory Transcription.fromJson(Map<String, dynamic> json) => Transcription(
    id: (json['id'] as num).toInt(),
    message: json['content'] as String,
    senderId: (json['senderId'] as num).toInt(),
    timestamp: json['createdAt'] as String,
    isFinal: json['isFinal'] as bool? ?? true,
    isSentenceComplete: json['isSentenceComplete'] as bool? ?? true,
  );

  final int id;
  final String message;
  final int senderId;
  final String timestamp;
  final bool isFinal;
  final bool isSentenceComplete;

  Transcription copyWith({String? message, bool? isFinal, bool? isSentenceComplete}) =>
      Transcription(
        id: id,
        message: message ?? this.message,
        senderId: senderId,
        timestamp: timestamp,
        isFinal: isFinal ?? this.isFinal,
        isSentenceComplete: isSentenceComplete ?? this.isSentenceComplete,
      );
}

/// Direct port of RN's `processTranscription` (`useListeningCommon.ts`) —
/// the state machine behind "live partial text that fills in as more of an
/// utterance streams in":
/// - no prior entry: append [payload] as-is.
/// - the last entry isn't final yet: it's a live partial — REPLACE it with
///   [payload] (keeping the original `id`/`senderId`/`timestamp`).
/// - the last entry is final but its sentence isn't complete, and [payload]
///   is also final: the STT pipeline split one spoken sentence across two
///   chunks — CONCATENATE [payload]'s text onto it with a space.
/// - otherwise: append [payload] as a new entry.
List<Transcription> processTranscription(
  List<Transcription> previous,
  Transcription payload,
) {
  if (previous.isEmpty) return [payload];

  final last = previous.last;
  if (!last.isFinal) {
    return [
      ...previous.sublist(0, previous.length - 1),
      last.copyWith(
        message: payload.message,
        isFinal: payload.isFinal,
        isSentenceComplete: payload.isSentenceComplete,
      ),
    ];
  }

  if (!last.isSentenceComplete && last.isFinal && payload.isFinal) {
    return [
      ...previous.sublist(0, previous.length - 1),
      last.copyWith(
        message: '${last.message} ${payload.message}',
        isFinal: payload.isFinal,
        isSentenceComplete: payload.isSentenceComplete,
      ),
    ];
  }

  return [...previous, payload];
}

/// Direct port of RN's `updateLastTranscription` — the `UTTERANCE_ENDED`
/// handler's job: forcibly mark the last entry in a bucket as final and
/// sentence-complete, independent of whether any further `MESSAGE_RECEIVED`
/// ever arrives for it (otherwise a trailing partial line could linger
/// looking "in progress" forever).
List<Transcription> markLastTranscriptionComplete(List<Transcription> previous) {
  if (previous.isEmpty) return previous;
  return [
    ...previous.sublist(0, previous.length - 1),
    previous.last.copyWith(isFinal: true, isSentenceComplete: true),
  ];
}

/// Direct port of RN's "process existing messages from chatData" effect
/// (`MicrophoneListeningScreen.tsx`) — rehydrates a transcript already in
/// progress (e.g. the chat existed before this screen attached, or the
/// screen reconnected) from `Chat.messages`, splitting by [userId] into the
/// "mine" vs "theirs" buckets `processTranscription` keeps separately.
/// Every rehydrated entry is marked final/sentence-complete, matching RN
/// exactly, since a persisted message is by definition no longer streaming.
({List<Transcription> mine, List<Transcription> theirs}) rehydrateTranscriptions(
  List<ChatMessage> messages,
  int userId,
) {
  final textMessages = messages.reversed.where((m) => m.type == MessageType.text).map(
    (m) => Transcription(
      id: m.id,
      message: m.content,
      senderId: m.senderId,
      timestamp: m.createdAt,
    ),
  );
  final mine = <Transcription>[];
  final theirs = <Transcription>[];
  for (final t in textMessages) {
    (t.senderId == userId ? mine : theirs).add(t);
  }
  return (mine: mine, theirs: theirs);
}
