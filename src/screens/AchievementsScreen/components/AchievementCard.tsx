import React from 'react';
import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {AchievementLockedIcon} from '@/assets/icons';
import {colors, fontFamily, typography} from '@/theme';

import {Achievement} from '../mockUtils';

interface AchievementCardProps {
  achievement: Achievement;
}

export const AchievementCard: React.FC<AchievementCardProps> = ({
  achievement,
}) => {
  const {t} = useTranslation();
  const isLocked = !achievement.isUnlocked;

  return (
    <View style={[styles.achievementCard, isLocked && styles.lockedCard]}>
      <View style={styles.iconContainer}>
        {isLocked ? (
          <AchievementLockedIcon width={60} height={60} />
        ) : (
          <Text style={styles.iconEmoji}>{achievement.icon}</Text>
        )}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.achievementTitle, isLocked && styles.lockedText]}>
          {t(achievement.titleKey)}
        </Text>
        <Text
          style={[
            styles.achievementDescription,
            isLocked && styles.lockedDescription,
          ]}>
          {t(achievement.descriptionKey)}
        </Text>
      </View>
    </View>
  );
};

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
  },
  iconEmoji: {
    fontSize: '32@ms',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  achievementTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: '600',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@ms',
  },
  achievementDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  lockedText: {
    color: colors.ds.typography.lowEmphasis,
  },
  lockedDescription: {
    color: colors.ds.typography.lowEmphasis,
  },
});
