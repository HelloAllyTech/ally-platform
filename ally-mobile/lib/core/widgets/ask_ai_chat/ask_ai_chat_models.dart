/// Port of ally-mobile (React Native)'s
/// `SimulationFeedbackScreen/components/AskAI/types.ts` — the scenario-session
/// chat ("Ask AI", now the Debrief reply thread) message and SSE shapes.
library;

/// A transcript line the backend resolved one of Ally's `[m:ss]` timestamps
/// to. `senderId == -1` is the AI client; anything else is the learner.
class AskAiCitation {
  const AskAiCitation({
    required this.timestamp,
    required this.content,
    required this.senderId,
    required this.transcriptId,
  });

  factory AskAiCitation.fromJson(Map<String, dynamic> json) => AskAiCitation(
    timestamp: json['timestamp'] as String? ?? '',
    content: json['content'] as String? ?? '',
    senderId: (json['senderId'] as num?)?.toInt() ?? 0,
    transcriptId: (json['transcriptId'] as num?)?.toInt() ?? 0,
  );

  final String timestamp;
  final String content;
  final int senderId;
  final int transcriptId;

  bool get isClient => senderId == -1;
}

enum AskAiChatRole { user, assistant }

/// Matches the backend's chat-history row; [isStreaming] is client-only.
class AskAiChatMessage {
  const AskAiChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    this.citations,
    this.isStreaming = false,
  });

  factory AskAiChatMessage.fromJson(Map<String, dynamic> json) => AskAiChatMessage(
    id: '${json['id']}',
    role: json['role'] == 'user' ? AskAiChatRole.user : AskAiChatRole.assistant,
    content: json['content'] as String? ?? '',
    createdAt: json['createdAt'] as String? ?? '',
    citations: (json['citations'] as List<dynamic>?)
        ?.map((e) => AskAiCitation.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final AskAiChatRole role;
  final String content;
  final String createdAt;
  final List<AskAiCitation>? citations;
  final bool isStreaming;

  AskAiChatMessage copyWith({
    String? content,
    List<AskAiCitation>? citations,
    bool? isStreaming,
  }) => AskAiChatMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    createdAt: createdAt,
    citations: citations ?? this.citations,
    isStreaming: isStreaming ?? this.isStreaming,
  );
}

/// RN's `SSEEvent` union (`start` / `token` / `citations` / `done` / `error`).
sealed class AskAiSseEvent {
  const AskAiSseEvent();

  /// Mirrors RN's `JSON.parse(...) as SSEEvent` + the `switch (event.type)`
  /// that follows: an unknown `type` is simply never matched, so it's
  /// dropped here too.
  static AskAiSseEvent? fromJson(Map<String, dynamic> json) {
    switch (json['type']) {
      case 'start':
        return const AskAiSseStart();
      case 'token':
        return AskAiSseToken(json['content'] as String? ?? '');
      case 'citations':
        return AskAiSseCitations(_citations(json['citations']) ?? const []);
      case 'done':
        return AskAiSseDone(
          content: json['content'] as String?,
          citations: _citations(json['citations']),
        );
      case 'error':
        return AskAiSseError(json['error'] as String? ?? '');
      default:
        return null;
    }
  }

  static List<AskAiCitation>? _citations(Object? raw) => (raw as List<dynamic>?)
      ?.map((e) => AskAiCitation.fromJson(e as Map<String, dynamic>))
      .toList();
}

class AskAiSseStart extends AskAiSseEvent {
  const AskAiSseStart();
}

class AskAiSseToken extends AskAiSseEvent {
  const AskAiSseToken(this.content);
  final String content;
}

class AskAiSseCitations extends AskAiSseEvent {
  const AskAiSseCitations(this.citations);
  final List<AskAiCitation> citations;
}

class AskAiSseDone extends AskAiSseEvent {
  const AskAiSseDone({this.content, this.citations});
  final String? content;
  final List<AskAiCitation>? citations;
}

class AskAiSseError extends AskAiSseEvent {
  const AskAiSseError(this.error);
  final String error;
}
