import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CommentIcon} from '@/assets';
import {ReactionsCount} from '@/screens/ReviewScreen/components';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  typography,
} from '@/theme';

import {EmojiPicker} from '../EmojiPicker';

interface InteractionsBarProps {
  reviewId: string;
  reactions: Record<string, number>;
  commentsCount: number;
  onCommentPress?: () => void;
}
export const InteractionsBar = ({
  reviewId,
  reactions,
  commentsCount,
  onCommentPress,
}: InteractionsBarProps) => {
  const totalReactions = reactions
    ? Object.values(reactions).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.iconContainer} onPress={onCommentPress}>
        <CommentIcon width={20} height={20} />
        {!!commentsCount && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {commentsCount > 99 ? '99+' : commentsCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconContainer}>
        <EmojiPicker onEmojiSelect={() => {}} />
      </TouchableOpacity>
      {!!totalReactions && (
        <>
          <View style={styles.divider} />
          <ReactionsCount
            reviewId={reviewId}
            reactions={reactions}
            totalReactions={totalReactions}
          />
        </>
      )}
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
    top: 4,
    right: 4,
    backgroundColor: colors.ds.theme.primary,
    borderRadius: radius.full,
    minWidth: '14@s',
    height: '14@s',
    paddingHorizontal: '3@s',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.ds.neutral.white,
    ...typography.body.micro,
    fontWeight: fontWeights.medium,
  },
  divider: {
    width: '0.5@s',
    height: '100%',
    backgroundColor: colors.ds.stroke.primary,
  },
});
