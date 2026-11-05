import {MessageThreadComment} from '@/types/reviews';

import {ThreadCommentChange} from '../CommentThreadBottomSheet/types';

export interface ThreadsBottomSheetProps {
  /**
   * Whether the review is private (read only mode)
   */
  isPrivate?: boolean;
  /**
   * Whether the bottom sheet is visible
   */
  visible: boolean;
  /**
   * Callback when the bottom sheet is closed
   */
  onClose: () => void;
  /**
   * Review ID to fetch threads for
   */
  reviewId: string;
  /**
   * Review owner ID
   */
  reviewOwnerId?: number;
  /**
   * Callback when a comment is pressed
   */
  onThreadPress?: (threadId: string) => void;
  /**
   * Callback when add reaction is pressed on a general comment
   */
  onAddReactionPress?: (commentId: string) => void;
  /**
   * Callback when reply is pressed on a general comment
   */
  onReplyPress?: (comment: MessageThreadComment) => void;
  /**
   * Callback when general comments change (add/edit/delete/hide)
   */
  onCommentsChanged?: (change: ThreadCommentChange) => void;
  /**
   * General comments thread ID
   */
  generalCommentsThreadId: string;
}
