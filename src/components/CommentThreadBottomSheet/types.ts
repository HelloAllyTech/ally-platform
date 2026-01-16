export interface CommentThreadBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  threadId: string | number;
  onLikePress?: (commentId: string | number) => void;
  onReplyPress?: (commentId: string | number) => void;
  onAddCommentPress?: (commentText: string) => void;
}
