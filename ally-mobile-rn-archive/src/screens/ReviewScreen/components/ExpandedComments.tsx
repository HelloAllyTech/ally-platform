import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown} from '@/assets';
import {ReviewComment} from '@/components';
import {colors, fontFamily, fontWeights, theme, typography} from '@/theme';
import {GetThreadCommentsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

interface ExpandedCommentsProps {
  isExpanded: boolean;
  isLoading: boolean;
  generalCommentsData: GetThreadCommentsResponse | undefined;
  reviewId: string;
  onCollapsePress: () => void;
  onCommentPress?: (reviewId: string) => void;
  t: (key: string) => string;
}

export const ExpandedComments: React.FC<ExpandedCommentsProps> = ({
  isExpanded,
  isLoading,
  generalCommentsData,
  reviewId,
  onCollapsePress,
  onCommentPress,
  t,
}) => {
  if (!isExpanded) return null;

  const hasComments = !!generalCommentsData?.data?.length;

  return (
    <View style={styles.expandedCommentsContainer}>
      <View style={styles.commentsSeparator} />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.ds.theme.primary} />
        </View>
      ) : (
        <>
          {generalCommentsData?.data.map(comment => {
            const reactionsArray = getReactionsArray(comment.reactions);
            const reactionCount = getTotalReactionCount(comment.reactions);
            return (
              <View key={comment.id} style={styles.commentItem}>
                <ReviewComment
                  name={comment.createdBy.name}
                  time={
                    comment.createdAt
                      ? formatRelativeTime(comment.createdAt)
                      : ''
                  }
                  comment={comment.content}
                  profileImageUrl={comment.createdBy.profileImage}
                  reactions={reactionsArray}
                  reactionCount={reactionCount}
                  replyCount={comment.replyCount}
                  showReplyButton={false}
                  showAddReactionButton={false}
                  onCommentPress={
                    onCommentPress ? () => onCommentPress(reviewId) : undefined
                  }
                  hidden={comment.hidden}
                />
              </View>
            );
          })}

          {!hasComments && (
            <View style={styles.emptyCommentsContainer}>
              <Text style={styles.emptyCommentsText}>
                {t('review.details.noCommentsYet')}
              </Text>
            </View>
          )}
        </>
      )}

      {hasComments && generalCommentsData?.count > 2 && onCommentPress && (
        <TouchableOpacity
          style={styles.showMoreButton}
          onPress={() => onCommentPress(reviewId)}>
          <Text style={styles.showMoreText}>
            {t('review.feedCard.showMore')}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.collapseButton} onPress={onCollapsePress}>
        <Text style={styles.collapseText}>
          {t('calls.uploadProgress.collapse')}
        </Text>
        <View style={styles.chevronUp}>
          <ChevronDown width={16} height={16} color={colors.ds.icon.default} />
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  expandedCommentsContainer: {
    gap: '8@s',
  },
  commentsSeparator: {
    height: '0.5@vs',
    backgroundColor: colors.ds.stroke.primary,
    marginVertical: '8@s',
  },
  loadingContainer: {
    paddingVertical: '16@s',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentItem: {
    paddingVertical: '4@s',
  },
  emptyCommentsContainer: {
    paddingVertical: '16@s',
    alignItems: 'center',
  },
  emptyCommentsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  showMoreButton: {
    alignSelf: 'flex-start',
    paddingVertical: '4@s',
  },
  showMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: theme.primary,
  },
  collapseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8@s',
  },
  collapseText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginRight: '4@s',
  },
  chevronUp: {
    transform: [{rotate: '180deg'}],
  },
});
