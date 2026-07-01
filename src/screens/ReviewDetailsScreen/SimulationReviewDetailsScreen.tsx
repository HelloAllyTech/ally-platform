import React, {useCallback, useEffect, useMemo} from 'react';

import {ReviewTranscriptHeader} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {
  ReviewApiProvider,
  simulationApiHooks,
} from '@/contexts/ReviewApiContext';
import {useAppNavigation, useUser} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddReviewCommentMutation,
  useGetReviewByIdQuery,
  useLazyGetMessagesQuery,
  useMarkSimulationReviewAsReadMutation,
} from '@/services/reviewsApi';
import {useAppSelector} from '@/store/hooks';
import {ReviewStatus} from '@/types';
import {formatDurationFromSeconds, isMinutesPassed} from '@/utils';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

type Props = RootStackScreenProps<'ReviewDetails'>;

export const SimulationReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId} = route.params || {};
  const navigation = useAppNavigation();
  const {userData} = useUser();

  const permissions = useAppSelector(state => state.user.permissions);
  const canEditReview = permissions.includes(
    USER_PERMISSIONS.EDIT_SIMULATION_REVIEW,
  );
  const canViewThreads = permissions.includes(
    USER_PERMISSIONS.VIEW_SIMULATION_REVIEW_THREADS,
  );
  const canEditThread = permissions.includes(
    USER_PERMISSIONS.EDIT_SIMULATION_REVIEW_THREAD,
  );

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

  const [markSimulationReviewAsRead] = useMarkSimulationReviewAsReadMutation();

  useEffect(() => {
    const timer = setTimeout(() => {
      markSimulationReviewAsRead({reviewId});
    }, 10000);
    return () => clearTimeout(timer);
  }, [reviewId, markSimulationReviewAsRead]);

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
        duration: formatDurationFromSeconds(
          reviewData?.scenarioSession?.duration || 0,
        ),
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
        audioUrl={reviewData?.scenarioSession?.audioUrl}
        reviewLogic={reviewLogic}
        metadata={metadata}
        onRefreshReactions={refetchReviewData}
        onEditNote={
          reviewData &&
          !isMinutesPassed(reviewData.createdAt) &&
          userData?.id === reviewData.createdBy?.id &&
          reviewData.reviewStatus !== ReviewStatus.HIDDEN
            ? handleEditNote
            : undefined
        }
        canEditReview={canEditReview}
        canViewThreads={canViewThreads}
        canEditThread={canEditThread}
        renderHeader={() =>
          reviewData ? (
            <ReviewTranscriptHeader
              reviewType="simulation"
              title={reviewData.scenario?.title || ''}
              user={reviewData.createdBy}
              createdAt={reviewData.scenarioSession?.createdAt}
              duration={reviewData.scenarioSession?.duration}
              sessionDetails={{
                title: reviewData.scenario?.title,
                description: reviewData.scenario?.description,
                coverImageUrl: reviewData.scenario?.coverImageUrl,
                coverVideoUrl: reviewData.scenario?.coverVideoUrl,
              }}
            />
          ) : null
        }
      />
    </ReviewApiProvider>
  );
};
