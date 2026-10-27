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
/// session was played from. `coverVideoUrl` isn't modeled: this scoped
/// port's `ReviewCard` shows the still cover image only, not RN's
/// `VideoPreview` for scenarios that ship a cover video instead.
class ReviewScenario {
  ReviewScenario({required this.title, this.description, this.coverImageUrl});

  factory ReviewScenario.fromJson(Map<String, dynamic> json) => ReviewScenario(
    title: json['title'] as String? ?? '',
    description: json['description'] as String?,
    coverImageUrl: json['coverImageUrl'] as String?,
  );

  final String title;
  final String? description;
  final String? coverImageUrl;
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
    this.authorId,
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
      reactions: (json['reactions'] as Map<String, dynamic>? ?? {}).map(
        (key, value) => MapEntry(key, (value as num).toInt()),
      ),
      myReaction: json['myReaction'] as String?,
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

  /// Whether the review's owner has hidden this comment.
  final bool hidden;

  ThreadComment copyWith({String? content, bool? hidden}) => ThreadComment(
    id: id,
    content: content ?? this.content,
    createdAt: createdAt,
    authorName: authorName,
    authorId: authorId,
    reactions: reactions,
    myReaction: myReaction,
    hidden: hidden ?? this.hidden,
  );
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
