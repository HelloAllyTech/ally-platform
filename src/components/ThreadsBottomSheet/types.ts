export interface ThreadsBottomSheetProps {
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
}
