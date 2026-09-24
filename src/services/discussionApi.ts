import {API_METHODS, API_ROUTES} from '@/constants';
import {
  DiscussionModeratorTenant,
  DiscussionPost,
  DiscussionResponse,
  DiscussionSuccessResult,
} from '@/types';

import {api} from './api';

/**
 * Course discussion learner/moderator APIs — inline threads attached to a
 * Track 2.0 item (see ally-be's `docs/course-discussions.md`). Every
 * mutation is tagged by `itemId` so it invalidates exactly the one thread
 * it affects; the reply/edit/delete/lock-post routes are addressed by
 * `postId` alone server-side, so the caller (which always knows which
 * item's thread it's acting in) passes `itemId` through just for cache
 * invalidation — it is never sent to the server.
 */
export const discussionApi = api.injectEndpoints({
  endpoints: builder => ({
    getDiscussion: builder.query<DiscussionResponse, {itemId: string}>({
      query: ({itemId}) => ({
        url: API_ROUTES.DISCUSSION.GET(itemId),
        method: API_METHODS.GET,
      }),
      providesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    getDiscussionModeratorTenants: builder.query<
      DiscussionModeratorTenant[],
      {itemId: string}
    >({
      query: ({itemId}) => ({
        url: API_ROUTES.DISCUSSION.TENANTS(itemId),
        method: API_METHODS.GET,
      }),
    }),

    createDiscussionPost: builder.mutation<
      DiscussionPost,
      {itemId: string; content: string}
    >({
      query: ({itemId, content}) => ({
        url: API_ROUTES.DISCUSSION.CREATE_POST(itemId),
        method: API_METHODS.POST,
        body: {content},
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    replyToDiscussionPost: builder.mutation<
      DiscussionPost,
      {itemId: string; postId: string; content: string}
    >({
      query: ({postId, content}) => ({
        url: API_ROUTES.DISCUSSION.REPLY(postId),
        method: API_METHODS.POST,
        body: {content},
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    editDiscussionPost: builder.mutation<
      DiscussionPost,
      {itemId: string; postId: string; content: string}
    >({
      query: ({postId, content}) => ({
        url: API_ROUTES.DISCUSSION.POST(postId),
        method: API_METHODS.PUT,
        body: {content},
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    deleteDiscussionPost: builder.mutation<
      DiscussionSuccessResult,
      {itemId: string; postId: string}
    >({
      query: ({postId}) => ({
        url: API_ROUTES.DISCUSSION.POST(postId),
        method: API_METHODS.DELETE,
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    lockDiscussionPost: builder.mutation<
      DiscussionPost,
      {itemId: string; postId: string; locked: boolean}
    >({
      query: ({postId, locked}) => ({
        url: API_ROUTES.DISCUSSION.LOCK_POST(postId),
        method: API_METHODS.PUT,
        body: {locked},
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),

    lockDiscussion: builder.mutation<
      DiscussionSuccessResult,
      {itemId: string; locked: boolean}
    >({
      query: ({itemId, locked}) => ({
        url: API_ROUTES.DISCUSSION.LOCK_DISCUSSION(itemId),
        method: API_METHODS.PUT,
        body: {locked},
      }),
      invalidatesTags: (_result, _error, {itemId}) => [
        {type: 'CourseDiscussion', id: itemId},
      ],
    }),
  }),
});

export const {
  useGetDiscussionQuery,
  useGetDiscussionModeratorTenantsQuery,
  useCreateDiscussionPostMutation,
  useReplyToDiscussionPostMutation,
  useEditDiscussionPostMutation,
  useDeleteDiscussionPostMutation,
  useLockDiscussionPostMutation,
  useLockDiscussionMutation,
} = discussionApi;
