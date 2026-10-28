/// Mirrors RN's `ReadFilter` enum (`src/constants/reviews.ts`) — the
/// All/Read/Unread row above the review list.
enum ReviewReadFilter {
  all(null, 'review.filter.all'),
  read('READ', 'review.filter.read'),
  unread('UNREAD', 'review.filter.unread');

  const ReviewReadFilter(this.apiValue, this.labelKey);

  /// `null` for [all] — RN's own `getReviews` call passes `readFilter: 'ALL'`
  /// through unconditionally, but this app's repository methods already
  /// treat "no readFilter param at all" as the all-reviews case (see their
  /// own tests), so [all] maps to omitting the param entirely instead of
  /// introducing a third "ALL" value the backend has never been sent.
  final String? apiValue;
  final String labelKey;
}

/// Mirrors RN's `SortBy` enum.
enum ReviewSortBy {
  latest('LATEST', 'review.sort.latest'),
  mostViewed('MOST_VIEWED', 'review.sort.mostViewed'),
  mostCommented('MOST_COMMENTED', 'review.sort.mostCommented');

  const ReviewSortBy(this.apiValue, this.labelKey);

  final String apiValue;
  final String labelKey;
}

/// The read-filter + sort combination the review list screen keeps as
/// local state and re-fetches on — mirrors RN's `useReviews` hook's
/// `selectedReadFilter`/`selectedSort`, which the same `ReviewList` uses
/// for both simulation and scribe reviews.
typedef ReviewListQuery = ({ReviewReadFilter readFilter, ReviewSortBy sortBy});

/// A page of reviews plus the backend's total `count`.
typedef ReviewsPage = ({List<ReviewItem> items, int count});

const defaultReviewListQuery = (
  readFilter: ReviewReadFilter.all,
  sortBy: ReviewSortBy.latest,
);

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
  ReviewScribeSession({this.id, this.summaryName, this.duration, this.createdAt});

  factory ReviewScribeSession.fromJson(Map<String, dynamic> json) =>
      ReviewScribeSession(
        id: json['id']?.toString(),
        summaryName: json['summaryName'] as String?,
        duration: json['duration']?.toString(),
        createdAt: json['createdAt'] as String?,
      );

  final String? id;
  final String? summaryName;
  final String? duration;
  final String? createdAt;
}

/// Mirrors RN's `ReviewScenario` — the scenario a simulation review's
/// session was played from.
class ReviewScenario {
  ReviewScenario({required this.title, this.description, this.coverImageUrl, this.coverVideoUrl});

  factory ReviewScenario.fromJson(Map<String, dynamic> json) => ReviewScenario(
    title: json['title'] as String? ?? '',
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
    coverVideoUrl: json['coverVideoUrl'] as String?,
  );

  final String title;
  final String? description;
  final String? coverImageUrl;

  /// RN shows a `VideoPreview` in place of the cover image when this is
  /// set; the Flutter cards don't play it yet (see `SimulationDetailsCard`).
  final String? coverVideoUrl;
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
    this.myReaction,
    this.generalCommentsThreadId,
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
    myReaction: json['myReaction'] as String?,
    generalCommentsThreadId: json['generalCommentsThreadId'] as String?,
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

  /// The signed-in user's own reaction to the review (detail response only).
  final String? myReaction;

  /// The review's general-discussion thread (detail response only) — RN's
  /// `GeneralCommentsSection` lists its comments only once this exists, and
  /// posts new general comments into it.
  final String? generalCommentsThreadId;

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
    this.authorId,
    this.hidden = false,
  });

  factory ReviewComment.fromJson(Map<String, dynamic> json) {
    final createdBy = json['createdBy'] as Map<String, dynamic>?;
    return ReviewComment(
      id: json['id'] as String,
      content: json['content'] as String? ?? '',
      createdAt: json['createdAt'] as String?,
      authorName: createdBy?['name'] as String? ?? 'Unknown',
      authorId: (createdBy?['id'] as num?)?.toInt(),
      hidden: json['hidden'] as bool? ?? false,
    );
  }

  final String id;
  final String content;
  final String? createdAt;
  final String authorName;

  /// RN's `createdBy.id` — optional there too (`id?: number`), unlike
  /// [ReviewAuthor.id] on a whole review/thread.
  final int? authorId;

  /// Whether the review's owner has hidden this comment — see
  /// `review.details.hide`/`review.details.unhide`'s gate in
  /// `ReviewComment.tsx`.
  final bool hidden;
}

/// Mirrors `src/types/reviews.ts`'s `MessageData` — the transcript message
/// a review thread is anchored to.
class ReviewThreadMessage {
  ReviewThreadMessage({
    required this.id,
    required this.content,
    required this.senderId,
  });

  // ally-be serialises message ids as numbers (`ReviewMessageDto.id`), so
  // don't cast to String.
  factory ReviewThreadMessage.fromJson(Map<String, dynamic> json) =>
      ReviewThreadMessage(
        id: json['id'].toString(),
        content: json['content'] as String? ?? '',
        senderId: (json['senderId'] as num?)?.toInt() ?? 0,
      );

  final String id;
  final String content;
  final int senderId;
}

/// Mirrors `src/types/reviews.ts`'s `MessageThreadComment` — one comment
/// (or reply) on a review, in any of its threads: transcript-anchored,
/// general, or a reply to another comment. Carries per-reaction-code
/// counts and the caller's own reaction.
class ThreadComment {
  ThreadComment({
    required this.id,
    required this.content,
    required this.createdAt,
    required this.authorName,
    required this.reactions,
    required this.myReaction,
    this.authorId,
    this.authorProfileImage,
    this.replyCount = 0,
    this.hidden = false,
  });

  factory ThreadComment.fromJson(Map<String, dynamic> json) {
    final createdBy = json['createdBy'] as Map<String, dynamic>?;
    return ThreadComment(
      id: json['id'] as String,
      content: json['content'] as String? ?? '',
      createdAt: json['createdAt'] as String?,
      authorName: createdBy?['name'] as String? ?? 'Unknown',
      authorId: (createdBy?['id'] as num?)?.toInt(),
      authorProfileImage: createdBy?['profileImage'] as String?,
      reactions: (json['reactions'] as Map<String, dynamic>? ?? {}).map(
        (key, value) => MapEntry(key, (value as num).toInt()),
      ),
      myReaction: json['myReaction'] as String?,
      replyCount: (json['replyCount'] as num?)?.toInt() ?? 0,
      hidden: json['hidden'] as bool? ?? false,
    );
  }

  final String id;
  final String content;
  final String? createdAt;
  final String authorName;
  final Map<String, int> reactions;
  final String? myReaction;

  /// RN's `createdBy.id` — optional there too, unlike [ReviewAuthor.id].
  final int? authorId;
  final String? authorProfileImage;
  final int replyCount;

  /// Whether the review's owner has hidden this comment.
  final bool hidden;

  ThreadComment copyWith({
    String? content,
    bool? hidden,
    Map<String, int>? reactions,
    String? Function()? myReaction,
  }) => ThreadComment(
    id: id,
    content: content ?? this.content,
    createdAt: createdAt,
    authorName: authorName,
    authorId: authorId,
    authorProfileImage: authorProfileImage,
    reactions: reactions ?? this.reactions,
    myReaction: myReaction != null ? myReaction() : this.myReaction,
    replyCount: replyCount,
    hidden: hidden ?? this.hidden,
  );
}

/// RN's `TextSelection` — character offsets into a transcript message's
/// `content` (not counting the "Speaker: " prefix), plus the selected text.
class ReviewTextSelection {
  const ReviewTextSelection({
    required this.startIndex,
    required this.endIndex,
    this.selectedText = '',
  });

  factory ReviewTextSelection.fromJson(Map<String, dynamic>? json) => ReviewTextSelection(
    startIndex: (json?['startIndex'] as num?)?.toInt() ?? 0,
    endIndex: (json?['endIndex'] as num?)?.toInt() ?? 0,
    selectedText: json?['selectedText'] as String? ?? '',
  );

  final int startIndex;
  final int endIndex;
  final String selectedText;

  Map<String, dynamic> toJson() => {
    'startIndex': startIndex,
    'endIndex': endIndex,
    'selectedText': selectedText,
  };
}

/// Mirrors `src/types/reviews.ts`'s `Thread` — a comment thread on a review:
/// transcript-anchored ([selection] + [message]) or general.
class ReviewThread {
  ReviewThread({
    required this.id,
    required this.comments,
    required this.commentCount,
    required this.createdBy,
    required this.message,
    this.selection,
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
    selection: json['selection'] is Map<String, dynamic>
        ? ReviewTextSelection.fromJson(json['selection'] as Map<String, dynamic>)
        : null,
  );

  final String id;
  final List<ThreadComment> comments;
  final int commentCount;
  final ReviewAuthor createdBy;
  final ReviewThreadMessage? message;
  final ReviewTextSelection? selection;

  /// RN's `getSelectedText(thread)` — the anchored slice of the message.
  String? get selectedText {
    final content = message?.content;
    final sel = selection;
    if (content == null || content.isEmpty || sel == null) return null;
    return _safeSlice(content, sel.startIndex, sel.endIndex);
  }

  ReviewThread copyWith({List<ThreadComment>? comments}) => ReviewThread(
    id: id,
    comments: comments ?? this.comments,
    commentCount: commentCount,
    createdBy: createdBy,
    message: message,
    selection: selection,
  );
}

/// JS `String.prototype.slice` semantics (clamped, never throws).
String _safeSlice(String text, int start, int end) {
  final s = start.clamp(0, text.length);
  final e = end.clamp(0, text.length);
  return e > s ? text.substring(s, e) : '';
}

/// A page of comments — RN's `GetThreadCommentsResponse` (`{data, count}`).
typedef CommentPage = ({List<ThreadComment> comments, int count});

/// Mirrors `src/types/reviews.ts`'s `Message` — one transcript line on the
/// review details screen, with the comment threads anchored to it.
class TranscriptMessage {
  TranscriptMessage({
    required this.id,
    required this.content,
    required this.startSeconds,
    required this.senderId,
    required this.threads,
  });

  factory TranscriptMessage.fromJson(Map<String, dynamic> json) => TranscriptMessage(
    id: json['id'].toString(),
    content: json['content'] as String? ?? '',
    startSeconds: (json['startSeconds'] as num?)?.toDouble() ?? 0,
    senderId: (json['senderId'] as num?)?.toInt() ?? 0,
    threads: (json['threads'] as List<dynamic>? ?? [])
        .map((e) => ReviewThread.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String content;
  final double startSeconds;

  /// `-1` is the client (AI client / scribe client); anything else is the
  /// review owner.
  final int senderId;
  final List<ReviewThread> threads;

  bool get isClient => senderId == -1;

  TranscriptMessage copyWith({List<ReviewThread>? threads}) => TranscriptMessage(
    id: id,
    content: content,
    startSeconds: startSeconds,
    senderId: senderId,
    threads: threads ?? this.threads,
  );

  /// RN's `splitByCommentRanges(message.content, mapMessageThreads(threads))`.
  List<MessagePart> get parts => splitByCommentRanges(content, [
    for (final thread in threads)
      if (thread.selection != null)
        (id: thread.id, start: thread.selection!.startIndex, end: thread.selection!.endIndex),
  ]);
}

/// RN's `MessagePart` — a run of message text and the threads covering it.
class MessagePart {
  const MessagePart({required this.text, required this.commentIds, required this.start, required this.end});

  final String text;
  final List<String> commentIds;
  final int start;
  final int end;
}

/// Direct port of RN's `utils/reviews.ts` `splitByCommentRanges`: clamps
/// the ranges, cuts the text at every range boundary, tags each piece with
/// the ids of the ranges covering it, and merges neighbours with the same
/// ids.
List<MessagePart> splitByCommentRanges(
  String text,
  List<({String id, int start, int end})> ranges,
) {
  final length = text.length;
  final cleaned = [
    for (final r in ranges)
      (id: r.id, start: r.start.clamp(0, length), end: r.end.clamp(0, length)),
  ].where((r) => r.end > r.start).toList();

  if (cleaned.isEmpty) return [MessagePart(text: text, commentIds: const [], start: 0, end: length)];

  final points = <int>{0, length, for (final r in cleaned) ...[r.start, r.end]}.toList()..sort();
  final segments = <MessagePart>[];
  for (var i = 0; i < points.length - 1; i++) {
    final start = points[i];
    final end = points[i + 1];
    if (start == end) continue;
    final ids = [
      for (final r in cleaned)
        if (r.start <= start && r.end >= end) r.id,
    ];
    final chunk = text.substring(start, end);
    if (chunk.isEmpty) continue;
    final prev = segments.isEmpty ? null : segments.last;
    final same = prev != null &&
        prev.commentIds.length == ids.length &&
        Iterable<int>.generate(ids.length).every((j) => prev.commentIds[j] == ids[j]);
    if (same) {
      segments[segments.length - 1] = MessagePart(
        text: prev.text + chunk,
        commentIds: prev.commentIds,
        start: prev.start,
        end: end,
      );
    } else {
      segments.add(MessagePart(text: chunk, commentIds: ids, start: start, end: end));
    }
  }
  return segments;
}
