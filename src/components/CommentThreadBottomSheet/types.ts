import {MessageThreadComment} from '@/types/reviews';

export interface CommentThreadBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (comment: MessageThreadComment) => void;
  onSubmitComment?: (commentText: string) => void;
  hideCommentThreadBottomSheet: () => void;
  footerComponent?: React.ReactNode;
}
