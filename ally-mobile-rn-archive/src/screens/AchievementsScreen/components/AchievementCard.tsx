import {memo} from 'react';
import {Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {AchievementLockedIcon} from '@/assets/icons';
import {NetworkImage} from '@/components/NetworkImage';
import {LockStatus} from '@/constants/badges';
import {colors, fontFamily} from '@/theme';
import {Badge} from '@/types';

interface AchievementCardProps {
  badge: Badge;
}

export const AchievementCard = memo<AchievementCardProps>(({badge}) => {
  const isLocked = badge.lockStatus === LockStatus.LOCKED;

  return (
    <View style={[styles.achievementCard, isLocked && styles.lockedCard]}>
      <View
        style={[styles.iconContainer, isLocked && styles.lockedIconContainer]}>
        {isLocked ? (
          <AchievementLockedIcon />
        ) : (
          <NetworkImage
            imageUrl={badge.imageUrl}
            style={styles.badgeImage}
            resizeMode="contain"
          />
        )}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.achievementTitle, isLocked && styles.lockedText]}>
          {badge.name}
        </Text>
        <Text
          style={[
            styles.achievementDescription,
            isLocked && styles.lockedDescription,
          ]}>
          {badge.description}
        </Text>
      </View>
    </View>
  );
});

AchievementCard.displayName = 'AchievementCard';

const styles = ScaledSheet.create({
  achievementCard: {
    flexDirection: 'row',
    backgroundColor: colors.ds.neutral.white,
    borderRadius: '12@ms',
    padding: '16@ms',
    marginBottom: '12@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
  },
  lockedCard: {
    borderColor: colors.lightGray2,
  },
  iconContainer: {
    width: '60@ms',
    height: '60@ms',
    borderRadius: '12@ms',
    backgroundColor: colors.lightGray1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '16@ms',
    overflow: 'hidden',
  },
  lockedIconContainer: {
    backgroundColor: 'transparent',
  },
  badgeImage: {
    width: '60@ms',
    height: '60@ms',
    overflow: 'hidden',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  achievementTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: ms(14),
    lineHeight: ms(18),
    letterSpacing: 0,
    fontWeight: '500',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@ms',
  },
  achievementDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(13),
    lineHeight: ms(18),
    letterSpacing: 0,
    color: colors.ds.typography.mediumEmphasis,
  },
  lockedText: {
    color: colors.ds.typography.lowEmphasis,
  },
  lockedDescription: {
    color: colors.ds.typography.lowEmphasis,
  },
});
