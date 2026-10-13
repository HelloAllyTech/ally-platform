/// Mirrors ally-mobile (React Native)'s `src/types/reviews.ts`. Only the
/// fields the ported list/detail screens use — the RN type carries
/// scenario/scenarioSession/scribeSession variants and per-reaction-code
/// counts not modeled here.
class ReviewAuthor {
  ReviewAuthor({required this.id, required this.name, required this.profileImage});

  factory ReviewAuthor.fromJson(Map<String, dynamic> json) => ReviewAuthor(
        id: (json['id'] as num).toInt(),
        name: json['name'] as String,
        profileImage: json['profileImage'] as String? ?? '',
      );

  final int id;
  final String name;
  final String profileImage;
}

class ReviewItem {
  ReviewItem({
    required this.id,
    required this.createdAt,
    required this.note,
    required this.createdBy,
    required this.commentsCount,
    required this.summaryName,
  });

  factory ReviewItem.fromJson(Map<String, dynamic> json) => ReviewItem(
        id: json['id'] as String,
        createdAt: json['createdAt'] as String,
        note: json['note'] as String? ?? '',
        createdBy: ReviewAuthor.fromJson(json['createdBy'] as Map<String, dynamic>),
        commentsCount: (json['commentsCount'] as num?)?.toInt() ?? 0,
        summaryName: json['summaryName'] as String?,
      );

  final String id;
  final String createdAt;
  final String note;
  final ReviewAuthor createdBy;
  final int commentsCount;
  final String? summaryName;
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
        authorName: (json['createdBy'] as Map<String, dynamic>?)?['name'] as String? ?? 'Unknown',
      );

  final String id;
  final String content;
  final String? createdAt;
  final String authorName;
}
