import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

interface ReviewRequest {
  reviewId: string;
  threadId?: string;
  parentCommentId?: string;
  messageId?: string;
  selection?: Record<string, unknown>;
  comment: string;
}

interface ReviewResponse {
  success: boolean;
}

export interface MessageThreadComment {
  id: string;
  content: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    profileImage: string | null;
  };
  reactions: {
    [reactionCode: string]: number;
  };
  replyCount: number;
}

export interface MessageThread {
  id: string;
  comments: MessageThreadComment[];
  selection: Record<string, unknown>;
  createdBy: {
    id: string;
    name: string;
    profileImage: string | null;
  };
}

export interface Message {
  id: string;
  content: string;
  createdAt: string;
  startSeconds: number;
  endSeconds: number;
  senderId: string;
  threads: MessageThread[];
}

export interface GetMessagesResponse {
  data: Message[];
}

export interface GetMessagesRequest {
  reviewId: string;
  offset?: number;
  limit?: number;
}

export const reviewsApi = api.injectEndpoints({
  endpoints: builder => ({
    addReviewComment: builder.mutation<ReviewResponse, ReviewRequest>({
      query: ({
        reviewId,
        threadId,
        parentCommentId,
        messageId,
        selection,
        comment,
      }) => ({
        url: API_ROUTES.REVIEWS.ADD_REVIEW_COMMENT(reviewId),
        method: API_METHODS.POST,
        body: {
          threadId,
          parentCommentId,
          messageId,
          selection,
          comment,
        },
      }),
    }),
    getMessages: builder.query<GetMessagesResponse, GetMessagesRequest>({
      query: ({reviewId, offset, limit}) => {
        return {
          url: API_ROUTES.REVIEWS.GET_MESSAGES(reviewId),
          method: API_METHODS.GET,
          body: {offset, limit},
        };
      },
    }),
  }),
});

export const {useGetMessagesQuery, useAddReviewCommentMutation} = reviewsApi;
