export interface CommentsBottomSheetProps {
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
  reviewId: string | number;
  /**
   * Callback when a comment is pressed
   */
  onCommentPress?: (threadId: string | number) => void;
  /**
   * Callback when "more comments" is pressed
   */
  onMoreCommentsPress?: (
    threadId: string | number,
    remainingCount: number,
  ) => void;
}
