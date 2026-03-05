import React, {useCallback, useMemo} from 'react';

import {ReviewTranscriptHeader} from '@/components/ReviewTranscriptHeader/ReviewTranscriptHeader';
import {SCREEN_NAMES} from '@/constants';
import {
  ReviewApiProvider,
  simulationApiHooks,
} from '@/contexts/ReviewApiContext';
import {useAppNavigation} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddReviewCommentMutation,
  useGetReviewByIdQuery,
  useLazyGetMessagesQuery,
} from '@/services/reviewsApi';
import {ReviewStatus} from '@/types';
import {isMinutesPassed} from '@/utils';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

type Props = RootStackScreenProps<'ReviewDetails'>;

export const SimulationReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId} = route.params || {};
  const navigation = useAppNavigation();

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

  const reviewLogic = useReviewDetailsLogic({
    reviewId,
    isPrivate: reviewData?.reviewStatus === ReviewStatus.HIDDEN,
    api,
  });
  const metadata: ReviewMetadata | undefined = reviewData
    ? {
        reactions: reviewData.reactions,
        commentsCount: reviewData.commentsCount,
        myReaction: reviewData.myReaction,
        createdBy: reviewData.createdBy,
        reviewOwnerId: reviewData.createdBy?.id,
        generalCommentsThreadId: reviewData.generalCommentsThreadId,
      }
    : undefined;

  const handleEditNote = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.SHARE_SIMULATION, {
      reviewId,
      scenarioData: {
        coverImageUrl: reviewData?.scenario?.coverImageUrl,
        coverVideoUrl: reviewData?.scenario?.coverVideoUrl,
        title: reviewData?.scenario?.title || '',
        description: reviewData?.scenario?.description || '',
        createdAt: reviewData?.scenarioSession?.createdAt || '',
        duration: reviewData?.scenarioSession?.duration || '',
      },
      isEditNote: true,
      note: reviewData?.note,
    });
  }, [reviewId, navigation, reviewData]);

  return (
    <ReviewApiProvider value={simulationApiHooks}>
      <ReviewDetailsLayout
        reviewId={reviewId}
        reviewNote={reviewData?.note}
        reviewLogic={reviewLogic}
        metadata={metadata}
        onRefreshReactions={refetchReviewData}
        onEditNote={
          reviewData && !isMinutesPassed(reviewData.createdAt)
            ? handleEditNote
            : undefined
        }
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
