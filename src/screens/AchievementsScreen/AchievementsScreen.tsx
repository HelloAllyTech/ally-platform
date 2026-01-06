import React from 'react';
import {useTranslation} from 'react-i18next';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {useAppNavigation} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

import {AchievementCard} from './components';
import {generateMockAchievements} from './mockUtils';

export const AchievementsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  const mockAchievements = generateMockAchievements();
  const unlockedAchievements = mockAchievements.filter(a => a.isUnlocked);
  const lockedAchievements = mockAchievements.filter(a => !a.isUnlocked);

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            navigation.goBack();
          }}>
          <LeftArrowIcon color={colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('Achievements.title')}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {unlockedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('Achievements.unlocked')}
            </Text>
            {unlockedAchievements.map(achievement => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </View>
        )}

        {lockedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Achievements.locked')}</Text>
            {lockedAchievements.map(achievement => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray2,
  },
  backButton: {
    marginRight: '16@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
    fontWeight: '400',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: '24@ms',
    paddingVertical: '16@ms',
  },
  section: {
    marginBottom: '24@ms',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.tiny,
    fontWeight: '600',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '10@ms',
  },
});
