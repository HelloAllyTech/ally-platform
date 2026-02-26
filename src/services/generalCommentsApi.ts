// TODO: Replace placeholder URLs with actual backend endpoints once available
import {API_METHODS} from '@/constants';
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
      // TODO: Update URL when backend endpoint is finalized
      query: ({reviewId, offset, limit}) => ({
        url: `/reviews/${reviewId}/general-comments`,
        method: API_METHODS.GET,
        ...(typeof offset !== 'undefined' && typeof limit !== 'undefined'
          ? {params: {offset, limit}}
          : {}),
      }),
      providesTags: ['GeneralComments'],
    }),
    addGeneralComment: builder.mutation<
      AddReviewCommentResponse,
      Pick<AddReviewCommentRequest, 'reviewId' | 'content'>
    >({
      // TODO: Update URL when backend endpoint is finalized
      query: ({reviewId, content}) => ({
        url: `/reviews/${reviewId}/general-comments`,
        method: API_METHODS.POST,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    deleteGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string}
    >({
      // TODO: Update URL when backend endpoint is finalized
      query: ({commentId}) => ({
        url: `/reviews/general-comments/${commentId}`,
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateGeneralComment: builder.mutation<
      {success: boolean},
      {commentId: string; content: string}
    >({
      // TODO: Update URL when backend endpoint is finalized
      query: ({commentId, content}) => ({
        url: `/reviews/general-comments/${commentId}`,
        method: API_METHODS.PATCH,
        body: {content},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
    updateGeneralCommentVisibility: builder.mutation<
      {success: boolean},
      {commentId: string; hidden: boolean}
    >({
      // TODO: Update URL when backend endpoint is finalized
      query: ({commentId, hidden}) => ({
        url: `/reviews/general-comments/${commentId}/visibility`,
        method: API_METHODS.PATCH,
        body: {hidden},
      }),
      invalidatesTags: ['GeneralComments'],
    }),
  }),
});

export const {
  useLazyGetGeneralCommentsQuery,
  useAddGeneralCommentMutation,
  useDeleteGeneralCommentMutation,
  useUpdateGeneralCommentMutation,
  useUpdateGeneralCommentVisibilityMutation,
} = generalCommentsApi;
