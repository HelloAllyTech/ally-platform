/**
 * Course discussions — inline threads attached to a Track 2.0 item
 * (`track_items.hasDiscussion`). Mirrors ally-be's
 * `src/course-discussion/` contract 1:1; see
 * `docs/course-discussions.md` in ally-be for the full API contract.
 */

export interface DiscussionAuthor {
  id: number;
  name: string;
  profileImageUrl: string | null;
}

export interface DiscussionPost {
  id: string;
  parentPostId: string | null;
  /** 1 = top-level, max 3. */
  depth: number;
  /** Null once the post has been deleted by its author (placeholder). */
  author: DiscussionAuthor | null;
  /** Null once deleted by author. */
  content: string | null;
  isDeletedByAuthor: boolean;
  isEdited: boolean;
  editedByModerator: boolean;
  /** Thread lock — top-level posts only; replies inherit it via `canReply`. */
  isLocked: boolean;
  isOwn: boolean;
  createdAt: string;
  editedAt: string | null;
  /** When the author's own edit window closes; null once it's not theirs to edit. */
  editableUntil: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canReply: boolean;
  /** Moderator && depth 1. */
  canLock: boolean;
  replies: DiscussionPost[];
}

export interface DiscussionViewer {
  userId: number;
  canModerate: boolean;
  /** enabled && !isLocked && posting in the caller's own org. */
  canPost: boolean;
  maxDepth: number;
  maxLength: number;
  editWindowMinutes: number;
}

export interface DiscussionResponse {
  trackId: string;
  trackItemId: string;
  tenantId: string;
  /** track_items.hasDiscussion; false => posts is []. */
  enabled: boolean;
  /** Whole-discussion lock. */
  isLocked: boolean;
  postCount: number;
  viewer: DiscussionViewer;
  /** Top-level posts, newest first. */
  posts: DiscussionPost[];
}

export interface DiscussionSuccessResult {
  success: true;
}

export interface DiscussionModeratorTenant {
  tenantId: string;
  tenantName?: string;
}
