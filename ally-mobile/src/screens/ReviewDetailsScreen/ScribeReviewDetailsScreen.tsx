import React, {useCallback, useEffect, useMemo} from 'react';

import {ReviewTranscriptHeader} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS} from '@/constants';
import {ReviewApiProvider, scribeApiHooks} from '@/contexts/ReviewApiContext';
import {useAppNavigation, useUser} from '@/hooks';
import {useTranslate} from '@/hooks/useTranslate';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddScribeReviewCommentMutation,
  useGetScribeReviewByIdQuery,
  useLazyGetScribeMessagesQuery,
  useMarkScribeReviewAsReadMutation,
  useUpdateScribeReviewStatusMutation,
} from '@/services/scribeReviewsApi';
import {useAppSelector} from '@/store/hooks';
import {ReviewStatus} from '@/types';
import {formatDurationFromSeconds, isMinutesPassed} from '@/utils';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

type Props = RootStackScreenProps<'ScribeReviewDetails'>;

export const ScribeReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId} = route.params || {};
  const {t} = useTranslate();
  const navigation = useAppNavigation();
  const {userData} = useUser();

  const permissions = useAppSelector(state => state.user.permissions);
  const canEditReview = permissions.includes(
    USER_PERMISSIONS.EDIT_SCRIBE_REVIEW,
  );

  const [fetchMessages, messagesState] = useLazyGetScribeMessagesQuery();
  const {data: reviewData, refetch: refetchReviewData} =
    useGetScribeReviewByIdQuery(
      {reviewId},
      {
        refetchOnMountOrArgChange: true,
        refetchOnFocus: true,
        refetchOnReconnect: true,
      },
    );
  const [addReviewComment, {isLoading: isAddingComment}] =
    useAddScribeReviewCommentMutation();

  const [markScribeReviewAsRead] = useMarkScribeReviewAsReadMutation();

  useEffect(() => {
    const timer = setTimeout(() => {
      markScribeReviewAsRead({reviewId});
    }, 10000);
    return () => clearTimeout(timer);
  }, [reviewId, markScribeReviewAsRead]);

  const isPrivate = reviewData?.reviewStatus === ReviewStatus.HIDDEN;

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
    isPrivate,
    api,
    useUpdateReviewStatus: useUpdateScribeReviewStatusMutation,
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
    navigation.navigate(SCREEN_NAMES.SHARE_CALL_LOG, {
      reviewId,
      sessionData: {
        title: reviewData?.summaryName || 'Session Review',
        createdAt: reviewData?.scribeSession?.createdAt || '',
        duration: reviewData?.scribeSession?.duration
          ? formatDurationFromSeconds(reviewData.scribeSession.duration)
          : undefined,
      },
      isEditNote: true,
      note: reviewData?.note,
    });
  }, [reviewId, navigation, reviewData]);

  return (
    <ReviewApiProvider value={scribeApiHooks}>
      <ReviewDetailsLayout
        isScribeReview
        reviewId={reviewId}
        reviewNote={reviewData?.note}
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
        toggleInHeader
        renderHeader={() =>
          reviewData ? (
            <ReviewTranscriptHeader
              reviewType="scribe"
              title={
                reviewData.summaryName ||
                t('review.details.callTitle', {
                  id: reviewData.scribeSession?.id || '',
                })
              }
              user={reviewData.createdBy}
              createdAt={reviewData.scribeSession?.createdAt}
              duration={reviewData.scribeSession?.duration}
              isPrivate={isPrivate}
              onTogglePrivate={
                canEditReview && metadata?.reviewOwnerId === userData?.id
                  ? reviewLogic.handleTogglePrivate
                  : undefined
              }
            />
          ) : null
        }
      />
    </ReviewApiProvider>
  );
};
