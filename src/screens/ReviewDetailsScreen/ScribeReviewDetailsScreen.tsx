import React, {useMemo} from 'react';
import {Text} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {RootStackScreenProps} from '@/navigation';
import {
  useAddReviewCommentMutation,
  useGetReviewByIdQuery,
  useLazyGetMessagesQuery,
} from '@/services/reviewsApi';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

// TODO: Replace with scribe-specific API hooks when endpoints are ready
// import { useGetScribeReviewByIdQuery, ... } from '@/services/scribeReviewsApi';

type Props = RootStackScreenProps<'ScribeReviewDetails'>;

export const ScribeReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId, isPrivate} = route.params || {};

  // TODO: Swap these with scribe-specific API hooks when available
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
    <ReviewDetailsLayout
      reviewId={reviewId}
      isPrivate={isPrivate}
      reviewLogic={reviewLogic}
      metadata={metadata}
      onRefreshReactions={refetchReviewData}
      renderHeader={() =>
        reviewData ? (
          // TODO: Replace with ScribeTranscriptHeader when designed
          <Text style={scribeStyles.headerTitle} numberOfLines={1}>
            Session Review
          </Text>
        ) : null
      }
    />
  );
};

const scribeStyles = ScaledSheet.create({
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    paddingHorizontal: '8@s',
  },
});
