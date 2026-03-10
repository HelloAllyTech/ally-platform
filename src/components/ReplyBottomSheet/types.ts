import {MessageThreadComment} from '@/types/reviews';

import {ThreadCommentChange} from '../CommentThreadBottomSheet/types';

export interface ReplyBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  commentId: string;
  originalComment: MessageThreadComment | null;
  setOriginalComment: (comment: MessageThreadComment | null) => void;
  reviewOwnerId?: number;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (commentId: string) => void;
  onSubmitReplyPress?: (replyText: string) => void;
  hideReplyBottomSheet: () => void;
  reviewId: string;
  isPrivate?: boolean;
  onCommentsChanged?: (change: ThreadCommentChange) => void;
}
