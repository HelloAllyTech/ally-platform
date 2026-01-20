import {API_METHODS, API_ROUTES} from '@/constants';
import {
  GetThreadCommentsRequest,
  GetThreadCommentsResponse,
  GetThreadsParams,
  RepliesParams,
  ThreadsResponse,
} from '@/types/reviews';

import {api} from './api';
import {
  generateMockCommentReplies,
  generateMockThreadComments,
  generateMockThreadsData,
} from './reviewThreadsApi.mock';

export const reviewThreadsApi = api.injectEndpoints({
  endpoints: builder => ({
    getThreads: builder.query<ThreadsResponse, GetThreadsParams>({
      queryFn: async (
        {reviewId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        // Return mock data in development mode
        if (__DEV__) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));
          const allData = generateMockThreadsData();
          const paginatedData = allData.data.slice(
            offset,
            (offset ?? 0) + (limit ?? 0),
          );
          return {data: {data: paginatedData, count: allData.count}};
        }

        // In production, make actual API call using baseQuery
        const result = await baseQuery({
          url: API_ROUTES.REVIEWS.THREADS(reviewId),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {body: {offset, limit}}
            : {}),
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as ThreadsResponse};
      },
    }),
    getThreadComments: builder.query<
      GetThreadCommentsResponse,
      GetThreadCommentsRequest
    >({
      queryFn: async (
        {threadId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        // Return mock data in development mode
        if (__DEV__) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));

          const {data, count} = generateMockThreadComments(
            threadId,
            offset ?? 0,
            limit ?? 0,
          );

          return {
            data: {data, count},
          };
        }

        // In production, make actual API call using baseQuery
        const result = await baseQuery({
          url: API_ROUTES.REVIEWS.GET_THREAD_COMMENTS(String(threadId)),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {body: {offset, limit}}
            : {}),
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as GetThreadCommentsResponse};
      },
    }),
    getCommentReplies: builder.query<GetThreadCommentsResponse, RepliesParams>({
      queryFn: async (
        {commentId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        // Return mock data in development mode
        if (__DEV__) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));

          const {data, count} = generateMockCommentReplies(
            commentId,
            offset ?? 0,
            limit ?? 10,
          );

          return {
            data: {
              data,
              count,
            },
          };
        }

        // In production, make actual API call using baseQuery
        const result = await baseQuery({
          url: API_ROUTES.REVIEWS.GET_COMMENT_REPLIES(String(commentId)),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {body: {offset, limit}}
            : {}),
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as GetThreadCommentsResponse};
      },
    }),
  }),
});

export const {
  useLazyGetThreadsQuery,
  useLazyGetThreadCommentsQuery,
  useLazyGetCommentRepliesQuery,
} = reviewThreadsApi;
