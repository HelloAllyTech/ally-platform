import {MessageThreadComment} from '@/types/reviews';

export type ThreadCommentChange =
  | {action: 'add'; comment: MessageThreadComment}
  | {action: 'edit'; commentId: string; content: string}
  | {action: 'delete'; commentId: string}
  | {action: 'hide'; commentId: string; hidden: boolean};

export interface CommentThreadBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  reviewId: string;
  threadId: string;
  reviewOwnerId?: number;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (comment: MessageThreadComment) => void;
  hideCommentThreadBottomSheet: () => void;
  footerComponent?: React.ReactNode;
  isPrivate?: boolean;
  onCommentsChanged?: (change: ThreadCommentChange) => void;
}
