import {API_METHODS, API_ROUTES} from '@/constants';
import {
  AddReviewCommentRequest,
  AddReviewCommentResponse,
  GetThreadCommentsResponse,
} from '@/types';

import {api} from './api';

interface GetGeneralCommentsParams {
  reviewId: string;
  offset?: number;
  limit?: number;
}

export const scribeGeneralCommentsApi = api.injectEndpoints({
  endpoints: builder => ({
    getScribeGeneralComments: builder.query<
      GetThreadCommentsResponse,
      GetGeneralCommentsParams
    >({
      query: ({reviewId, offset, limit}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENTS(reviewId),
        method: API_METHODS.GET,
        ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
          ? {params: {offset, limit}}
          : {}),
      }),
      providesTags: ['GeneralComments'],
    }),
    getScribeGeneralCommentsOverview: builder.query<
      GetThreadCommentsResponse,
      GetGeneralCommentsParams
    >({
      query: ({reviewId, offset = 0, limit = 2}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENTS_OVERVIEW(reviewId),
        method: API_METHODS.GET,
        params: {offset, limit, sortOrder: 'DESC', sortBy: 'createdAt'},
      }),
    }),
    addScribeGeneralComment: builder.mutation<
      AddReviewCommentResponse,
      Pick<AddReviewCommentRequest, 'reviewId' | 'content'>
    >({
      query: ({reviewId, content}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENTS(reviewId),
        method: API_METHODS.POST,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    deleteScribeGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string}
    >({
      query: ({commentId}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENT_BY_ID(commentId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateScribeGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      query: ({commentId, content}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENT_BY_ID(commentId),
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateScribeGeneralCommentVisibility: builder.mutation<
      {success: boolean},
      {commentId: string; hidden: boolean}
    >({
      query: ({commentId, hidden}) => ({
        url: API_ROUTES.SCRIBE_REVIEWS.GENERAL_COMMENT_VISIBILITY(commentId),
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
  }),
});

export const {
  useLazyGetScribeGeneralCommentsQuery,
  useLazyGetScribeGeneralCommentsOverviewQuery,
  useAddScribeGeneralCommentMutation,
  useDeleteScribeGeneralCommentMutation,
  useUpdateScribeGeneralCommentMutation,
  useUpdateScribeGeneralCommentVisibilityMutation,
} = scribeGeneralCommentsApi;
