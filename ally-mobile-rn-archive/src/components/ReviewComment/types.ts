export interface ReviewCommentProps {
  /**
   * User's name
   */
  name?: string;
  /**
   * Time text (e.g., "30 min", "2 hours")
   */
  time?: string;
  /**
   * Comment text content
   */
  comment?: string;
  /**
   * User's profile image URL (optional)
   */
  profileImageUrl?: string | null;
  /**
   * Array of reaction emojis
   */
  reactions?: string[];
  /**
   * Total reaction count
   */
  reactionCount?: number;
  /**
   * Number of replies
   */
  replyCount?: number;
  /**
   * Callback when like button is pressed
   */
  onAddReactionPress?: () => void;
  /**
   * Callback when reply button is pressed
   */
  onReplyPress?: () => void;
  /**
   * Callback when comment button is pressed
   */
  onCommentPress?: () => void;
  /**
   * Callback when emoji is selected
   */
  onEmojiSelect?: (currentEmoji: string | null, unicode: string) => void;
  /**
   * Whether to show the reply button
   */
  showReplyButton?: boolean;
  /**
   * Whether to show the add reaction button (emoji picker)
   */
  showAddReactionButton?: boolean;
  /**
   * Whether to disable the add reaction button
   */
  disableAddReactionButton?: boolean;
  /**
   * Selected emoji
   */
  selectedEmoji?: string | null;
  /**
   * Whether the comment is hidden
   */
  hidden?: boolean;
  /**
   * Name of the person who hid the comment
   */
  hiddenByName?: string;
  /**
   * Current user ID
   */
  currentUserId?: number;
  /**
   * Comment owner ID
   */
  commentOwnerId?: number;
  /**
   * Review owner ID
   */
  reviewOwnerId?: number;
  /**
   * Comment ID
   */
  commentId?: string;
  /**
   * Callback when edit is pressed
   */
  onEdit?: (commentId: string, commentContent: string) => void;
  /**
   * Callback when delete is pressed
   */
  onDelete?: (commentId: string) => void;
  /**
   * Callback when hide/unhide is pressed
   */
  onHide?: (commentId: string, hidden: boolean) => void;
  /**
   * Whether to show the actions menu (edit, delete, hide/unhide)
   */
  showActionsMenu?: boolean;
}
