import React, {memo} from 'react';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EMOJI_UNICODE_MAP} from '@/components/EmojiPicker/utils';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ReactionListItemProps} from '../types';

export const ReactionListItem: React.FC<ReactionListItemProps> = memo(
  ({item}) => {
    const emoji =
      EMOJI_UNICODE_MAP[item.reaction.toLowerCase()] || item.reaction;
    const initials = item.createdBy.name.charAt(0).toUpperCase();

    return (
      <View style={styles.container}>
        <View style={styles.avatarWrapper}>
          <View style={styles.avatarContainer}>
            {item.createdBy.profileImage ? (
              <Image
                source={{uri: item.createdBy.profileImage}}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarPlaceholderText}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.reactionBubble}>
            <Text style={styles.reactionBubbleEmoji}>{emoji}</Text>
          </View>
        </View>
        <View style={styles.info}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.createdBy.name}
          </Text>
        </View>
      </View>
    );
  },
);

ReactionListItem.displayName = 'ReactionListItem';

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '12@ms',
    paddingHorizontal: '20@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: '12@ms',
  },
  avatarContainer: {
    width: '40@ms',
    height: '40@ms',
    borderRadius: '20@ms',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.ds.grey[200],
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPlaceholderText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  reactionBubble: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: '20@ms',
    height: '20@ms',
    borderRadius: '10@ms',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  reactionBubbleEmoji: {
    fontSize: '12@ms',
  },
  info: {
    flex: 1,
  },
  userName: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
});
