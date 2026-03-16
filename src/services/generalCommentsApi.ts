// Scenario session reviews – general comments
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

export const generalCommentsApi = api.injectEndpoints({
  endpoints: builder => ({
    getGeneralComments: builder.query<
      GetThreadCommentsResponse,
      GetGeneralCommentsParams
    >({
      query: ({reviewId, offset, limit}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENTS(reviewId),
        method: API_METHODS.GET,
        ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
          ? {params: {offset, limit}}
          : {}),
      }),
      providesTags: ['GeneralComments'],
    }),
    getGeneralCommentsOverview: builder.query<
      GetThreadCommentsResponse,
      GetGeneralCommentsParams
    >({
      query: ({reviewId, offset = 0, limit = 2}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENTS_OVERVIEW(reviewId),
        method: API_METHODS.GET,
        params: {offset, limit, sortOrder: 'DESC', sortBy: 'createdAt'},
      }),
    }),
    addGeneralComment: builder.mutation<
      AddReviewCommentResponse,
      Pick<AddReviewCommentRequest, 'reviewId' | 'content'>
    >({
      query: ({reviewId, content}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENTS(reviewId),
        method: API_METHODS.POST,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    deleteGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string}
    >({
      query: ({commentId}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENT_BY_ID(commentId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      query: ({commentId, content}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENT_BY_ID(commentId),
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateGeneralCommentVisibility: builder.mutation<
      {success: boolean},
      {commentId: string; hidden: boolean}
    >({
      query: ({commentId, hidden}) => ({
        url: API_ROUTES.SIMULATION_REVIEWS.GENERAL_COMMENT_VISIBILITY(
          commentId,
        ),
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
  }),
});

export const {
  useLazyGetGeneralCommentsQuery,
  useLazyGetGeneralCommentsOverviewQuery,
  useAddGeneralCommentMutation,
  useDeleteGeneralCommentMutation,
  useUpdateGeneralCommentMutation,
  useUpdateGeneralCommentVisibilityMutation,
} = generalCommentsApi;
