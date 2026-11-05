import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  GetMessagesResponse,
  MessageThreadComment,
} from '@/types/reviews';

export interface ReviewApiAdapter {
  fetchMessages: (params: {
    reviewId: string;
    offset: number;
    limit: number;
  }) => Promise<{data?: GetMessagesResponse}>;
  messagesState: {isLoading: boolean; isFetching: boolean; isError: boolean};
  addComment: (
    payload: AddReviewCommentRequest,
  ) => Promise<{data?: AddReviewCommentResponse}>;
  isAddingComment: boolean;
  refetchReviewData: () => void;
}

export interface ReviewMetadata {
  reactions: Record<string, number>;
  commentsCount: number;
  myReaction: string | null;
  createdBy: {id: number; name: string};
  reviewOwnerId?: number;
  generalCommentsThreadId: string;
}

export type {ReviewType} from '@/contexts/ReviewApiContext';

export type {MessageThreadComment};
