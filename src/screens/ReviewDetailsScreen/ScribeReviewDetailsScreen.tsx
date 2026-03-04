import React, {useMemo} from 'react';
import {Text} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ReviewApiProvider, scribeApiHooks} from '@/contexts/ReviewApiContext';
import {RootStackScreenProps} from '@/navigation';
import {
  useAddScribeReviewCommentMutation,
  useGetScribeReviewByIdQuery,
  useLazyGetScribeMessagesQuery,
} from '@/services/scribeReviewsApi';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReviewDetailsLayout} from './components/ReviewDetailsLayout';
import {useReviewDetailsLogic} from './hooks/useReviewDetailsLogic';
import {ReviewApiAdapter, ReviewMetadata} from './types';

type Props = RootStackScreenProps<'ScribeReviewDetails'>;

export const ScribeReviewDetailsScreen: React.FC<Props> = ({route}) => {
  const {reviewId, isPrivate} = route.params || {};

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
    <ReviewApiProvider value={scribeApiHooks}>
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
    </ReviewApiProvider>
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
