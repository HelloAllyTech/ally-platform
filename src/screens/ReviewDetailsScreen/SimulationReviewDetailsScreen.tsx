import React, {useMemo} from 'react';

import {ReviewTranscriptHeader} from '@/components/ReviewTranscriptHeader/ReviewTranscriptHeader';
import {
  ReviewApiProvider,
  simulationApiHooks,
} from '@/contexts/ReviewApiContext';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddReviewCommentMutation,
  useGetReviewByIdQuery,
  useLazyGetMessagesQuery,
} from '@/services/reviewsApi';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

type Props = RootStackScreenProps<'ReviewDetails'>;

export const SimulationReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId, isPrivate} = route.params || {};

  const [fetchMessages, messagesState] = useLazyGetMessagesQuery();
  const {data: reviewData, refetch: refetchReviewData} = useGetReviewByIdQuery(
    {reviewId},
    {
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    },
  );
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddReviewCommentMutation();

  const api: ReviewApiAdapter = useMemo(
    () => ({
      fetchMessages,
      messagesState,
      addComment: addReviewComment,
      isAddingComment,
      refetchReviewData,
    }),
    [
      fetchMessages,
      messagesState,
      addReviewComment,
      isAddingComment,
      refetchReviewData,
    ],
  );

  const reviewLogic = useReviewDetailsLogic({reviewId, isPrivate, api});

  const metadata: ReviewMetadata | undefined = reviewData
    ? {
        reactions: reviewData.reactions,
        commentsCount: reviewData.commentsCount,
        myReaction: reviewData.myReaction,
        createdBy: reviewData.createdBy,
        reviewOwnerId: reviewData.createdBy?.id,
      }
    : undefined;

  return (
    <ReviewApiProvider value={simulationApiHooks}>
      <ReviewDetailsLayout
        reviewId={reviewId}
        isPrivate={isPrivate}
        reviewLogic={reviewLogic}
        metadata={metadata}
        onRefreshReactions={refetchReviewData}
        renderHeader={() =>
          reviewData ? (
            <ReviewTranscriptHeader
              user={reviewData.createdBy}
              scenario={reviewData.scenario}
              scenarioSession={reviewData.scenarioSession}
            />
          ) : null
        }
      />
    </ReviewApiProvider>
  );
};
