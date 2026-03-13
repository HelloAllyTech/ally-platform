import {createContext, useContext} from 'react';

import {
  useAddReactionToCommentMutation,
  useAddReactionToReviewMutation,
  useLazyGetReactionsCountQuery,
  useLazyGetReactionsQuery,
} from '@/services/reactionsApi';
import {
  useAddReviewCommentMutation,
  useDeleteCommentMutation,
  useGetGeneralReviewCommentsQuery,
  useLazyGetGeneralReviewCommentsQuery,
  useLazyGetThreadCommentsQuery,
  useUpdateCommentMutation,
  useUpdateCommentVisibilityMutation,
  useUpdateReviewStatusMutation,
} from '@/services/reviewsApi';
import {
  useLazyGetCommentRepliesQuery,
  useLazyGetThreadsQuery,
} from '@/services/reviewThreadsApi';
import {
  useAddScribeReactionToCommentMutation,
  useAddScribeReactionToReviewMutation,
  useLazyGetScribeReactionsCountQuery,
  useLazyGetScribeReactionsQuery,
} from '@/services/scribeReactionsApi';
import {
  useAddScribeReviewCommentMutation,
  useDeleteScribeCommentMutation,
  useGetScribeGeneralReviewCommentsQuery,
  useLazyGetScribeGeneralReviewCommentsQuery,
  useLazyGetScribeThreadCommentsQuery,
  useUpdateScribeCommentMutation,
  useUpdateScribeCommentVisibilityMutation,
  useUpdateScribeReviewStatusMutation,
} from '@/services/scribeReviewsApi';
import {
  useLazyGetScribeCommentRepliesQuery,
  useLazyGetScribeThreadsQuery,
} from '@/services/scribeReviewThreadsApi';

export type ReviewType = 'simulation' | 'scribe';

export interface ReviewApiHooks {
  reviewType: ReviewType;

  // reviewsApi — comment CRUD + thread comments
  useLazyGetThreadComments: typeof useLazyGetThreadCommentsQuery;
  useAddReviewComment: typeof useAddReviewCommentMutation;
  useDeleteComment: typeof useDeleteCommentMutation;
  useUpdateComment: typeof useUpdateCommentMutation;
  useUpdateCommentVisibility: typeof useUpdateCommentVisibilityMutation;
  useUpdateReviewStatus: typeof useUpdateReviewStatusMutation;

  // reviewThreadsApi — threads list + comment replies
  useLazyGetThreads: typeof useLazyGetThreadsQuery;
  useLazyGetCommentReplies: typeof useLazyGetCommentRepliesQuery;

  // reactionsApi
  useLazyGetReactions: typeof useLazyGetReactionsQuery;
  useLazyGetReactionsCount: typeof useLazyGetReactionsCountQuery;
  useAddReactionToComment: typeof useAddReactionToCommentMutation;
  useAddReactionToReview: typeof useAddReactionToReviewMutation;

  // general comments (fetched via reviewsApi)
  useLazyGetGeneralReviewComments: typeof useLazyGetGeneralReviewCommentsQuery;
  useGetGeneralReviewComments: typeof useGetGeneralReviewCommentsQuery;
}

export const simulationApiHooks: ReviewApiHooks = {
  reviewType: 'simulation',
  useLazyGetThreadComments: useLazyGetThreadCommentsQuery,
  useAddReviewComment: useAddReviewCommentMutation,
  useDeleteComment: useDeleteCommentMutation,
  useUpdateComment: useUpdateCommentMutation,
  useUpdateCommentVisibility: useUpdateCommentVisibilityMutation,
  useUpdateReviewStatus: useUpdateReviewStatusMutation,
  useLazyGetThreads: useLazyGetThreadsQuery,
  useLazyGetCommentReplies: useLazyGetCommentRepliesQuery,
  useLazyGetReactions: useLazyGetReactionsQuery,
  useLazyGetReactionsCount: useLazyGetReactionsCountQuery,
  useAddReactionToComment: useAddReactionToCommentMutation,
  useAddReactionToReview: useAddReactionToReviewMutation,
  useLazyGetGeneralReviewComments: useLazyGetGeneralReviewCommentsQuery,
  useGetGeneralReviewComments: useGetGeneralReviewCommentsQuery,
};

export const scribeApiHooks: ReviewApiHooks = {
  reviewType: 'scribe',
  useLazyGetThreadComments: useLazyGetScribeThreadCommentsQuery,
  useAddReviewComment: useAddScribeReviewCommentMutation,
  useDeleteComment: useDeleteScribeCommentMutation,
  useUpdateComment: useUpdateScribeCommentMutation,
  useUpdateCommentVisibility: useUpdateScribeCommentVisibilityMutation,
  useUpdateReviewStatus: useUpdateScribeReviewStatusMutation,
  useLazyGetThreads: useLazyGetScribeThreadsQuery,
  useLazyGetCommentReplies: useLazyGetScribeCommentRepliesQuery,
  useLazyGetReactions: useLazyGetScribeReactionsQuery,
  useLazyGetReactionsCount: useLazyGetScribeReactionsCountQuery,
  useAddReactionToComment: useAddScribeReactionToCommentMutation,
  useAddReactionToReview: useAddScribeReactionToReviewMutation,
  useLazyGetGeneralReviewComments: useLazyGetScribeGeneralReviewCommentsQuery,
  useGetGeneralReviewComments: useGetScribeGeneralReviewCommentsQuery,
};

const ReviewApiContext = createContext<ReviewApiHooks>(simulationApiHooks);

export const ReviewApiProvider = ReviewApiContext.Provider;

export function useReviewApiHooks(): ReviewApiHooks {
  return useContext(ReviewApiContext);
}
