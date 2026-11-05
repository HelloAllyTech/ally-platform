import {API_METHODS, API_ROUTES} from '@/constants';
import {
  GetThreadCommentsResponse,
  GetThreadsParams,
  RepliesParams,
  ThreadsResponse,
} from '@/types/reviews';

import {api} from './api';

export const scribeReviewThreadsApi = api.injectEndpoints({
  endpoints: builder => ({
    getScribeThreads: builder.query<ThreadsResponse, GetThreadsParams>({
      queryFn: async (
        {reviewId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        const result = await baseQuery({
          url: API_ROUTES.SCRIBE_REVIEWS.THREADS(reviewId),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {params: {offset, limit, includeMessage: true}}
            : {}),
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as ThreadsResponse};
      },
      providesTags: ['ReviewThreads'],
    }),
    getScribeCommentReplies: builder.query<
      GetThreadCommentsResponse,
      RepliesParams
    >({
      queryFn: async (
        {commentId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        const result = await baseQuery({
          url: API_ROUTES.SCRIBE_REVIEWS.GET_COMMENT_REPLIES(String(commentId)),
          method: API_METHODS.GET,
          ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
            ? {params: {offset, limit}}
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
  useLazyGetScribeThreadsQuery,
  useLazyGetScribeCommentRepliesQuery,
} = scribeReviewThreadsApi;
