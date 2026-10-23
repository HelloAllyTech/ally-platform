import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CommentIcon} from '@/assets';
import {useReviewApiHooks} from '@/contexts/ReviewApiContext';
import {useTranslate} from '@/hooks';
import {ReactionsCount} from '@/screens/ReviewScreen/components';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  typography,
} from '@/theme';
import {getReactionAction} from '@/utils/reviews';

import {CustomSwitch} from '../CustomSwitch';
import {EmojiPicker} from '../EmojiPicker';

interface InteractionsBarProps {
  reviewId: string;
  reactions: Record<string, number>;
  commentsCount: number;
  myReaction?: string | null;
  onCommentPress?: () => void;
  refreshReactions?: () => void;
  isPrivate?: boolean;
  onTogglePrivate?: (isEnabled: boolean) => void;
}
export const InteractionsBar = ({
  reviewId,
  reactions,
  commentsCount,
  myReaction,
  onCommentPress,
  refreshReactions,
  isPrivate = false,
  onTogglePrivate,
}: InteractionsBarProps) => {
  const {useAddReactionToReview, reviewType} = useReviewApiHooks();

  const {t} = useTranslate();
  const totalReactions = reactions
    ? Object.values(reactions).reduce((sum, count) => sum + count, 0)
    : 0;

  const [addReactionToReview, {isLoading: isAddingReaction}] =
    useAddReactionToReview();

  const handleAddReactionToReview = async (
    currentEmoji: string | null,
    unicode: string,
  ) => {
    try {
      await addReactionToReview({
        id: reviewId,
        reaction: unicode,
        action: getReactionAction(currentEmoji, unicode),
      }).unwrap();
      refreshReactions?.();
    } catch (error) {
      console.error('Failed to add reaction:', error);
    }
  };

  return (
    <View style={styles.container}>
      {onTogglePrivate && (
        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>{t('learn.scenario.share')}</Text>
          <CustomSwitch
            value={!isPrivate}
            onToggle={onTogglePrivate}
            color={colors.ds.green[200]}
          />
        </View>
      )}
      <TouchableOpacity style={styles.iconContainer} onPress={onCommentPress}>
        <CommentIcon width={20} height={20} />
        {!!commentsCount && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {commentsCount > 99 ? '99+' : `${commentsCount}`}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      <View style={styles.iconContainer}>
        <EmojiPicker
          onEmojiSelect={handleAddReactionToReview}
          selectedEmoji={myReaction}
          disabled={isAddingReaction || isPrivate}
        />
      </View>

      <React.Fragment>
        <View style={styles.divider} />
        <ReactionsCount
          reviewId={reviewId}
          reactions={reactions}
          totalReactions={totalReactions}
          reviewType={reviewType}
        />
      </React.Fragment>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.ds.neutral.white,
    borderRadius: radius.full,
    borderWidth: 0.5,
    borderColor: stroke.primary,
    paddingVertical: '8@s',
    paddingLeft: '8@s',
    paddingRight: '16@s',
    gap: '8@s',
    shadowColor: colors.black,
    shadowOffset: {
      width: 8,
      height: 11,
    },
    shadowOpacity: 0.09,
    shadowRadius: 14.2,

    // Android
    elevation: 10,
  },
  iconContainer: {
    position: 'relative',
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.full,
    padding: '8@ms',
    height: '36@ms',
    width: '36@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },

  badge: {
    position: 'absolute',
    top: '3@s',
    right: '3@s',
    backgroundColor: colors.ds.theme.primary,
    borderRadius: radius.full,
    minWidth: '16@s',
    height: '16@s',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.ds.neutral.white,
    ...typography.body.nano,
    fontWeight: fontWeights.medium,
  },
  divider: {
    width: '0.5@s',
    height: '100%',
    backgroundColor: colors.ds.stroke.primary,
  },
  switchLabel: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.lowEmphasis,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
});
