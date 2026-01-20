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
  reviewId: string;
  /**
   * Callback when a comment is pressed
   */
  onCommentPress?: (threadId: string) => void;
}
