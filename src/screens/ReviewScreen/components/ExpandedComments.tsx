import React from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown} from '@/assets';
import {ReviewComment} from '@/components';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {ThreadsResponse} from '@/types/reviews';
import {formatRelativeTime} from '@/utils';
import {getReactionsArray, getTotalReactionCount} from '@/utils/reviews';

interface ExpandedCommentsProps {
  isExpanded: boolean;
  isLoading: boolean;
  threadsData: ThreadsResponse | undefined;
  reviewId: string;
  onCollapsePress: () => void;
  onCommentPress: (reviewId: string) => void;
  t: (key: string) => string;
}

export const ExpandedComments: React.FC<ExpandedCommentsProps> = ({
  isExpanded,
  isLoading,
  threadsData,
  reviewId,
  onCollapsePress,
  onCommentPress,
  t,
}) => {
  if (!isExpanded) return null;

  return (
    <View style={styles.expandedCommentsContainer}>
      <View style={styles.commentsSeparator} />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.ds.theme.primary} />
        </View>
      ) : (
        <>
          {threadsData?.data.map(thread => {
            if (!thread.comments || thread.comments.length === 0) {
              return null;
            }

            const firstComment = thread.comments[0];
            const reactionsArray = getReactionsArray(firstComment.reactions);
            const reactionCount = getTotalReactionCount(firstComment.reactions);

            return (
              <View key={thread.id} style={styles.commentItem}>
                <ReviewComment
                  name={firstComment.createdBy.name}
                  time={
                    firstComment.createdAt
                      ? formatRelativeTime(firstComment.createdAt)
                      : ''
                  }
                  comment={firstComment.content}
                  profileImageUrl={firstComment.createdBy.profileImage}
                  reactions={reactionsArray}
                  reactionCount={reactionCount}
                  replyCount={firstComment.replyCount}
                  showReplyButton={false}
                  showAddReactionButton={false}
                  onCommentPress={() => onCommentPress(reviewId)}
                  hidden={firstComment.hidden}
                />
              </View>
            );
          })}

          {threadsData?.data.length === 0 && (
            <View style={styles.emptyCommentsContainer}>
              <Text style={styles.emptyCommentsText}>
                {t('Review.card.noComments')}
              </Text>
            </View>
          )}
        </>
      )}

      <TouchableOpacity style={styles.collapseButton} onPress={onCollapsePress}>
        <Text style={styles.collapseText}>{t('Review.card.collapse')}</Text>
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
