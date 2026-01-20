import {MessageThreadComment} from '@/types/reviews';

export interface ReplyBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  commentId: string;
  originalComment: MessageThreadComment | null;
  onAddReactionPress?: (commentId: string) => void;
  onReplyPress?: (commentId: string) => void;
  onAddReplyPress?: (replyText: string) => void;
}
