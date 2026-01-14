import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface CommentUser {
  id: string | number;
  name: string;
  profileImage?: string | null;
}

export interface CommentReactions {
  [reactionCode: string]: number;
}

export interface Comment {
  id: string | number;
  content: string;
  createdAt: string;
  createdBy: CommentUser;
  reactions: CommentReactions;
  replyCount: number;
}

export interface Thread {
  id: string | number;
  comments: Comment[];
  commentCount: number;
  selectedText?: string;
}

export interface ThreadsResponse {
  data: Thread[];
  count: number;
}

export interface ThreadsParams {
  reviewId: string | number;
  offset: number;
  limit: number;
}

export const reviewThreadsApi = api.injectEndpoints({
  endpoints: builder => ({
    getThreads: builder.query<ThreadsResponse, ThreadsParams>({
      query: ({reviewId, offset, limit}) => ({
        url: API_ROUTES.REVIEWS.THREADS(reviewId),
        method: API_METHODS.GET,
        params: {
          offset,
          limit,
        },
      }),
    }),
  }),
});

export const {useLazyGetThreadsQuery} = reviewThreadsApi;
