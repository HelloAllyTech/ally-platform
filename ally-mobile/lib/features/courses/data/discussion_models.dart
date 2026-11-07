/// Course discussions — inline threads attached to a Track 2.0 item
/// (`TrackDetailItem.hasDiscussion`). Mirrors ally-mobile (React Native)'s
/// `src/types/discussion.ts` 1:1, which itself mirrors ally-be's
/// `src/course-discussion/` contract.
class DiscussionAuthor {
  DiscussionAuthor({required this.id, required this.name, required this.profileImageUrl});

  factory DiscussionAuthor.fromJson(Map<String, dynamic> json) => DiscussionAuthor(
    id: (json['id'] as num).toInt(),
    name: json['name'] as String,
    profileImageUrl: json['profileImageUrl'] as String?,
  );

  final int id;
  final String name;
  final String? profileImageUrl;
}

class DiscussionPost {
  DiscussionPost({
    required this.id,
    required this.parentPostId,
    required this.depth,
    required this.author,
    required this.content,
    required this.isDeletedByAuthor,
    required this.isEdited,
    required this.editedByModerator,
    required this.isLocked,
    required this.isOwn,
    required this.createdAt,
    required this.editedAt,
    required this.editableUntil,
    required this.canEdit,
    required this.canDelete,
    required this.canReply,
    required this.canLock,
    required this.replies,
  });

  factory DiscussionPost.fromJson(Map<String, dynamic> json) => DiscussionPost(
    id: json['id'] as String,
    parentPostId: json['parentPostId'] as String?,
    // 1 = top-level, max 3.
    depth: (json['depth'] as num).toInt(),
    // Null once the post has been deleted by its author (placeholder).
    author: json['author'] != null ? DiscussionAuthor.fromJson(json['author'] as Map<String, dynamic>) : null,
    content: json['content'] as String?,
    isDeletedByAuthor: json['isDeletedByAuthor'] as bool? ?? false,
    isEdited: json['isEdited'] as bool? ?? false,
    editedByModerator: json['editedByModerator'] as bool? ?? false,
    // Thread lock — top-level posts only; replies inherit it via canReply.
    isLocked: json['isLocked'] as bool? ?? false,
    isOwn: json['isOwn'] as bool? ?? false,
    createdAt: json['createdAt'] as String,
    editedAt: json['editedAt'] as String?,
    editableUntil: json['editableUntil'] as String?,
    canEdit: json['canEdit'] as bool? ?? false,
    canDelete: json['canDelete'] as bool? ?? false,
    canReply: json['canReply'] as bool? ?? false,
    // Moderator && depth 1.
    canLock: json['canLock'] as bool? ?? false,
    replies: (json['replies'] as List<dynamic>? ?? [])
        .map((e) => DiscussionPost.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String? parentPostId;
  final int depth;
  final DiscussionAuthor? author;
  final String? content;
  final bool isDeletedByAuthor;
  final bool isEdited;
  final bool editedByModerator;
  final bool isLocked;
  final bool isOwn;
  final String createdAt;
  final String? editedAt;

  /// When the author's own edit window closes; null once it's not theirs
  /// to edit.
  final String? editableUntil;
  final bool canEdit;
  final bool canDelete;
  final bool canReply;
  final bool canLock;
  final List<DiscussionPost> replies;
}

class DiscussionViewer {
  DiscussionViewer({
    required this.userId,
    required this.canModerate,
    required this.canPost,
    required this.maxDepth,
    required this.maxLength,
    required this.editWindowMinutes,
  });

  factory DiscussionViewer.fromJson(Map<String, dynamic> json) => DiscussionViewer(
    userId: (json['userId'] as num).toInt(),
    canModerate: json['canModerate'] as bool? ?? false,
    // enabled && !isLocked && posting in the caller's own org.
    canPost: json['canPost'] as bool? ?? false,
    maxDepth: (json['maxDepth'] as num).toInt(),
    maxLength: (json['maxLength'] as num).toInt(),
    editWindowMinutes: (json['editWindowMinutes'] as num).toInt(),
  );

  final int userId;
  final bool canModerate;
  final bool canPost;
  final int maxDepth;
  final int maxLength;
  final int editWindowMinutes;
}

class DiscussionResponse {
  DiscussionResponse({
    required this.trackId,
    required this.trackItemId,
    required this.tenantId,
    required this.enabled,
    required this.isLocked,
    required this.postCount,
    required this.viewer,
    required this.posts,
  });

  factory DiscussionResponse.fromJson(Map<String, dynamic> json) => DiscussionResponse(
    trackId: json['trackId'] as String,
    trackItemId: json['trackItemId'] as String,
    tenantId: json['tenantId'] as String,
    // track_items.hasDiscussion; false => posts is [].
    enabled: json['enabled'] as bool? ?? false,
    // Whole-discussion lock.
    isLocked: json['isLocked'] as bool? ?? false,
    postCount: (json['postCount'] as num?)?.toInt() ?? 0,
    viewer: DiscussionViewer.fromJson(json['viewer'] as Map<String, dynamic>),
    // Top-level posts, newest first.
    posts: (json['posts'] as List<dynamic>? ?? [])
        .map((e) => DiscussionPost.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String trackId;
  final String trackItemId;
  final String tenantId;
  final bool enabled;
  final bool isLocked;
  final int postCount;
  final DiscussionViewer viewer;
  final List<DiscussionPost> posts;
}
