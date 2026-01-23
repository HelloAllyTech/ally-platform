import {MessageThreadComment} from '@/types/reviews';

export interface CommentThreadBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  reviewId: string;
  threadId: string;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (comment: MessageThreadComment) => void;
  hideCommentThreadBottomSheet: () => void;
  footerComponent?: React.ReactNode;
}
