/// Mirrors ally-mobile (React Native)'s `src/types/reviews.ts`. Only the
/// fields the ported list/detail screens use — the RN type carries
/// scenario/scenarioSession/scribeSession variants and per-reaction-code
/// counts not modeled here.
class ReviewAuthor {
  ReviewAuthor({
    required this.id,
    required this.name,
    required this.profileImage,
  });

  factory ReviewAuthor.fromJson(Map<String, dynamic> json) => ReviewAuthor(
    id: (json['id'] as num).toInt(),
    name: json['name'] as String,
    profileImage: json['profileImage'] as String? ?? '',
  );

  final int id;
  final String name;
  final String profileImage;
}

/// Mirrors RN's `ScenarioSessionData` — present on both the review list and
/// detail responses for simulation reviews (never for scribe reviews).
class ReviewScenarioSession {
  ReviewScenarioSession({this.audioUrl, this.duration, this.createdAt});

  factory ReviewScenarioSession.fromJson(Map<String, dynamic> json) =>
      ReviewScenarioSession(
        audioUrl: json['audioUrl'] as String?,
        duration: json['duration']?.toString(),
        createdAt: json['createdAt'] as String?,
      );

  final String? audioUrl;

  /// A string of seconds (RN types it `duration: string`, not a number) —
  /// kept as a raw string here too; `formatDurationFromSeconds` parses it.
  final String? duration;
  final String? createdAt;
}

/// Mirrors RN's `ScribeSessionData` — the scribe-review equivalent of
/// [ReviewScenarioSession] (no `audioUrl`: scribe reviews never carry one).
class ReviewScribeSession {
  ReviewScribeSession({this.summaryName, this.duration, this.createdAt});

  factory ReviewScribeSession.fromJson(Map<String, dynamic> json) =>
      ReviewScribeSession(
        summaryName: json['summaryName'] as String?,
        duration: json['duration']?.toString(),
        createdAt: json['createdAt'] as String?,
      );

  final String? summaryName;
  final String? duration;
  final String? createdAt;
}

/// Mirrors RN's `ReviewScenario` — the scenario a simulation review's
/// session was played from. `coverImageUrl`/`coverVideoUrl` aren't modeled
/// here: this scoped port's `ReviewCard` shows title/description text only,
/// not RN's `SimulationDetailsCard` cover art.
class ReviewScenario {
  ReviewScenario({required this.title, this.description});

  factory ReviewScenario.fromJson(Map<String, dynamic> json) => ReviewScenario(
    title: json['title'] as String? ?? '',
    description: json['description'] as String?,
  );

  final String title;
  final String? description;
}

class ReviewItem {
  ReviewItem({
    required this.id,
    required this.createdAt,
    required this.note,
    required this.createdBy,
    required this.commentsCount,
    required this.summaryName,
    this.reviewStatus,
    this.scenarioSession,
    this.scenario,
    this.scribeSession,
    this.reactions = const {},
  });

  factory ReviewItem.fromJson(Map<String, dynamic> json) => ReviewItem(
    id: json['id'] as String,
    createdAt: json['createdAt'] as String,
    note: json['note'] as String? ?? '',
    createdBy: ReviewAuthor.fromJson(json['createdBy'] as Map<String, dynamic>),
    commentsCount: (json['commentsCount'] as num?)?.toInt() ?? 0,
    summaryName: json['summaryName'] as String?,
    reviewStatus: json['reviewStatus'] as String?,
    scenarioSession: json['scenarioSession'] != null
        ? ReviewScenarioSession.fromJson(json['scenarioSession'] as Map<String, dynamic>)
        : null,
    scenario: json['scenario'] != null
        ? ReviewScenario.fromJson(json['scenario'] as Map<String, dynamic>)
        : null,
    scribeSession: json['scribeSession'] != null
        ? ReviewScribeSession.fromJson(json['scribeSession'] as Map<String, dynamic>)
        : null,
    reactions: (json['reactions'] as Map<String, dynamic>? ?? {}).map(
      (key, value) => MapEntry(key, (value as num).toInt()),
    ),
  );

  final String id;
  final String createdAt;
  final String note;
  final ReviewAuthor createdBy;
  final int commentsCount;
  final String? summaryName;

  /// Mirrors RN's `ReviewStatus` enum ('HIDDEN' | 'IN_REVIEW'). A review is
  /// private exactly when this is 'HIDDEN' — see `isPrivate` getter below.
  final String? reviewStatus;

  final ReviewScenarioSession? scenarioSession;
  final ReviewScenario? scenario;
  final ReviewScribeSession? scribeSession;
  final Map<String, int> reactions;

  bool get isPrivate => reviewStatus == 'HIDDEN';
}

/// Mirrors ally-mobile (React Native)'s `MessageThreadComment` — used here
/// for general (not transcript-anchored) review comments only. Replies
/// (`parentCommentId` threading) and reactions on individual comments
/// aren't modeled — this is a flat discussion list, matching the scope of
/// `generalCommentsApi.ts`'s `addGeneralComment` (reviewId + content only,
/// no threading params).
class ReviewComment {
  ReviewComment({
    required this.id,
    required this.content,
    required this.createdAt,
    required this.authorName,
  });

  factory ReviewComment.fromJson(Map<String, dynamic> json) => ReviewComment(
    id: json['id'] as String,
    content: json['content'] as String? ?? '',
    createdAt: json['createdAt'] as String?,
    authorName:
        (json['createdBy'] as Map<String, dynamic>?)?['name'] as String? ??
        'Unknown',
  );

  final String id;
  final String content;
  final String? createdAt;
  final String authorName;
}

/// Mirrors `src/types/reviews.ts`'s `MessageData` — the transcript message
/// a review thread is anchored to.
class ReviewThreadMessage {
  ReviewThreadMessage({
    required this.id,
    required this.content,
    required this.senderId,
  });

  factory ReviewThreadMessage.fromJson(Map<String, dynamic> json) =>
      ReviewThreadMessage(
        id: json['id'] as String,
        content: json['content'] as String? ?? '',
        senderId: (json['senderId'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String content;
  final int senderId;
}

/// Mirrors `src/types/reviews.ts`'s `MessageThreadComment` — a single
/// comment within a transcript-anchored thread (as opposed to
/// [ReviewComment], the flat general-discussion shape). Carries
/// per-reaction-code counts and the caller's own reaction, unlike
/// [ReviewComment].
class ThreadComment {
  ThreadComment({
    required this.id,
    required this.content,
    required this.createdAt,
    required this.authorName,
    required this.reactions,
    required this.myReaction,
  });

  factory ThreadComment.fromJson(Map<String, dynamic> json) => ThreadComment(
    id: json['id'] as String,
    content: json['content'] as String? ?? '',
    createdAt: json['createdAt'] as String?,
    authorName:
        (json['createdBy'] as Map<String, dynamic>?)?['name'] as String? ??
        'Unknown',
    reactions: (json['reactions'] as Map<String, dynamic>? ?? {}).map(
      (key, value) => MapEntry(key, (value as num).toInt()),
    ),
    myReaction: json['myReaction'] as String?,
  );

  final String id;
  final String content;
  final String? createdAt;
  final String authorName;
  final Map<String, int> reactions;
  final String? myReaction;
}

/// Mirrors `src/types/reviews.ts`'s `Thread` — a transcript-anchored
/// discussion thread. `comments` is whatever page the `threads` list
/// endpoint included (commonly just the first comment); further replies
/// are paged separately via `getCommentReplies`.
class ReviewThread {
  ReviewThread({
    required this.id,
    required this.comments,
    required this.commentCount,
    required this.createdBy,
    required this.message,
  });

  factory ReviewThread.fromJson(Map<String, dynamic> json) => ReviewThread(
    id: json['id'] as String,
    comments: (json['comments'] as List<dynamic>? ?? [])
        .map((e) => ThreadComment.fromJson(e as Map<String, dynamic>))
        .toList(),
    commentCount: (json['commentCount'] as num?)?.toInt() ?? 0,
    createdBy: ReviewAuthor.fromJson(json['createdBy'] as Map<String, dynamic>),
    message: json['message'] != null
        ? ReviewThreadMessage.fromJson(json['message'] as Map<String, dynamic>)
        : null,
  );

  final String id;
  final List<ThreadComment> comments;
  final int commentCount;
  final ReviewAuthor createdBy;
  final ReviewThreadMessage? message;
}
