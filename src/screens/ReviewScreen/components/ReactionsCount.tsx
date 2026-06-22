import {useTranslation} from 'react-i18next';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker';
import {SCREEN_NAMES} from '@/constants';
import type {ReviewType} from '@/contexts/ReviewApiContext';
import {useAppNavigation} from '@/hooks';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  typography,
} from '@/theme';
import {pluralize} from '@/utils';
import {getTopReactions} from '@/utils/reviews';

interface ReactionsCountProps {
  reviewId: string;
  reactions: Record<string, number>;
  totalReactions: number;
  reviewType?: ReviewType;
}
export const ReactionsCount = ({
  reviewId,
  reactions,
  totalReactions = 0,
  reviewType,
}: ReactionsCountProps) => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();

  const renderReactionBubble = (
    reaction_code: string,
    index: number,
    total: number,
  ) => (
    <View
      key={reaction_code}
      style={[
        styles.reactionBubble,
        index < total - 1 && styles.reactionBubbleOverlap,
        {zIndex: total - index},
      ]}>
      <Text>{EMOJI_UNICODE_MAP[reaction_code.toLowerCase()]}</Text>
    </View>
  );

  const handleReactionsCountPress = () => {
    navigation.navigate(SCREEN_NAMES.REACTIONS, {reviewId, reviewType});
  };

  return (
    <TouchableOpacity
      style={styles.reactionCountContainer}
      onPress={handleReactionsCountPress}>
      {reactions && (
        <View style={styles.emojisContainer}>
          {getTopReactions(reactions, 3).map((reaction_code, index, array) =>
            renderReactionBubble(reaction_code, index, array.length),
          )}
        </View>
      )}
      <Text style={styles.reactionText}>
        {pluralize(totalReactions, t('review.feedCard.reactions'))}
      </Text>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
  },
  reactionCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@s',
  },
  reactionBubble: {
    padding: '4@s',
    borderRadius: radius.full,
    borderWidth: 0.5,
    borderColor: stroke.primary,
    backgroundColor: colors.ds.neutral.white,
  },
  reactionBubbleOverlap: {
    marginRight: '-8@s',
  },
  emojisContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
