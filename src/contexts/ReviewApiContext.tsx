import {createContext, useContext} from 'react';

import {
  useAddGeneralCommentMutation,
  useDeleteGeneralCommentMutation,
  useLazyGetGeneralCommentsQuery,
  useUpdateGeneralCommentMutation,
  useUpdateGeneralCommentVisibilityMutation,
} from '@/services/generalCommentsApi';
import {
  useAddReactionToCommentMutation,
  useAddReactionToReviewMutation,
  useLazyGetReactionsCountQuery,
  useLazyGetReactionsQuery,
} from '@/services/reactionsApi';
import {
  useAddReviewCommentMutation,
  useDeleteCommentMutation,
  useLazyGetThreadCommentsQuery,
  useUpdateCommentMutation,
  useUpdateCommentVisibilityMutation,
} from '@/services/reviewsApi';
import {
  useLazyGetCommentRepliesQuery,
  useLazyGetThreadsQuery,
} from '@/services/reviewThreadsApi';
import {
  useAddScribeGeneralCommentMutation,
  useDeleteScribeGeneralCommentMutation,
  useLazyGetScribeGeneralCommentsQuery,
  useUpdateScribeGeneralCommentMutation,
  useUpdateScribeGeneralCommentVisibilityMutation,
} from '@/services/scribeGeneralCommentsApi';
import {
  useAddScribeReactionToCommentMutation,
  useAddScribeReactionToReviewMutation,
  useLazyGetScribeReactionsCountQuery,
  useLazyGetScribeReactionsQuery,
} from '@/services/scribeReactionsApi';
import {
  useAddScribeReviewCommentMutation,
  useDeleteScribeCommentMutation,
  useLazyGetScribeThreadCommentsQuery,
  useUpdateScribeCommentMutation,
  useUpdateScribeCommentVisibilityMutation,
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

  // reviewThreadsApi — threads list + comment replies
  useLazyGetThreads: typeof useLazyGetThreadsQuery;
  useLazyGetCommentReplies: typeof useLazyGetCommentRepliesQuery;

  // reactionsApi
  useLazyGetReactions: typeof useLazyGetReactionsQuery;
  useLazyGetReactionsCount: typeof useLazyGetReactionsCountQuery;
  useAddReactionToComment: typeof useAddReactionToCommentMutation;
  useAddReactionToReview: typeof useAddReactionToReviewMutation;

  // generalCommentsApi
  useLazyGetGeneralComments: typeof useLazyGetGeneralCommentsQuery;
  useAddGeneralComment: typeof useAddGeneralCommentMutation;
  useDeleteGeneralComment: typeof useDeleteGeneralCommentMutation;
  useUpdateGeneralComment: typeof useUpdateGeneralCommentMutation;
  useUpdateGeneralCommentVisibility: typeof useUpdateGeneralCommentVisibilityMutation;
}

export const simulationApiHooks: ReviewApiHooks = {
  reviewType: 'simulation',
  useLazyGetThreadComments: useLazyGetThreadCommentsQuery,
  useAddReviewComment: useAddReviewCommentMutation,
  useDeleteComment: useDeleteCommentMutation,
  useUpdateComment: useUpdateCommentMutation,
  useUpdateCommentVisibility: useUpdateCommentVisibilityMutation,
  useLazyGetThreads: useLazyGetThreadsQuery,
  useLazyGetCommentReplies: useLazyGetCommentRepliesQuery,
  useLazyGetReactions: useLazyGetReactionsQuery,
  useLazyGetReactionsCount: useLazyGetReactionsCountQuery,
  useAddReactionToComment: useAddReactionToCommentMutation,
  useAddReactionToReview: useAddReactionToReviewMutation,
  useLazyGetGeneralComments: useLazyGetGeneralCommentsQuery,
  useAddGeneralComment: useAddGeneralCommentMutation,
  useDeleteGeneralComment: useDeleteGeneralCommentMutation,
  useUpdateGeneralComment: useUpdateGeneralCommentMutation,
  useUpdateGeneralCommentVisibility: useUpdateGeneralCommentVisibilityMutation,
};

export const scribeApiHooks: ReviewApiHooks = {
  reviewType: 'scribe',
  useLazyGetThreadComments: useLazyGetScribeThreadCommentsQuery,
  useAddReviewComment: useAddScribeReviewCommentMutation,
  useDeleteComment: useDeleteScribeCommentMutation,
  useUpdateComment: useUpdateScribeCommentMutation,
  useUpdateCommentVisibility: useUpdateScribeCommentVisibilityMutation,
  useLazyGetThreads: useLazyGetScribeThreadsQuery,
  useLazyGetCommentReplies: useLazyGetScribeCommentRepliesQuery,
  useLazyGetReactions: useLazyGetScribeReactionsQuery,
  useLazyGetReactionsCount: useLazyGetScribeReactionsCountQuery,
  useAddReactionToComment: useAddScribeReactionToCommentMutation,
  useAddReactionToReview: useAddScribeReactionToReviewMutation,
  useLazyGetGeneralComments: useLazyGetScribeGeneralCommentsQuery,
  useAddGeneralComment: useAddScribeGeneralCommentMutation,
  useDeleteGeneralComment: useDeleteScribeGeneralCommentMutation,
  useUpdateGeneralComment: useUpdateScribeGeneralCommentMutation,
  useUpdateGeneralCommentVisibility:
    useUpdateScribeGeneralCommentVisibilityMutation,
};

const ReviewApiContext = createContext<ReviewApiHooks>(simulationApiHooks);

export const ReviewApiProvider = ReviewApiContext.Provider;

export function useReviewApiHooks(): ReviewApiHooks {
  return useContext(ReviewApiContext);
}
