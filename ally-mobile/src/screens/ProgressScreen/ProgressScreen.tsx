import React, {useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {LevelIndicator, TabScreenHeader} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {
  useAppNavigation,
  useProgressSummary,
  useTabBackToHomeHandler,
} from '@/hooks';
import {useGetProgressQuery} from '@/services/progressApi';
import {colors} from '@/theme';

import {styles} from './styles';

interface StatCardProps {
  value: string;
  label: string;
  testID: string;
}

/**
 * One cumulative number. Every stat here only ever goes up — a lost streak or a bad
 * session cannot take any of them away, which is why they sit above the trends.
 */
const StatCard: React.FC<StatCardProps> = ({value, label, testID}) => (
  <View style={styles.statCard} testID={testID}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

export const ProgressScreen: React.FC = () => {
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  useTabBackToHomeHandler();

  const {canViewProgress, isGateLoading} = useProgressSummary();
  const {
    data: progress,
    isLoading,
    isError,
  } = useGetProgressQuery(undefined, {
    skip: !canViewProgress,
    refetchOnMountOrArgChange: true,
  });

  const goToAchievements = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.ACHIEVEMENTS as never);
  }, [navigation]);

  const goToLeaderboard = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.LEADERBOARD as never);
  }, [navigation]);

  const renderHero = () => {
    if (!progress) {
      return null;
    }

    return (
      <View style={styles.hero} testID="progress-hero">
        <View style={styles.heroRow}>
          <LevelIndicator
            level={progress.level}
            progress={progress.progress}
            isMaxLevel={progress.isMaxLevel}
            accessibilityLabel={t('progress.a11y.level', {
              level: progress.level,
              xp: progress.totalXp,
            })}
          />
          <View style={styles.heroTextGroup}>
            <Text style={styles.heroLevel}>
              {t('progress.hero.level', {level: progress.level})}
            </Text>
            {/* At the top of the ladder there is no next target to point at, so the
                line is replaced rather than left rendering a null. */}
            <Text style={styles.heroCaption} testID="progress-next-level">
              {progress.isMaxLevel
                ? t('progress.hero.maxLevel')
                : t('progress.hero.toNextLevel', {
                    count: progress.xpToNextLevel ?? 0,
                    level: progress.level + 1,
                  })}
            </Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {width: `${Math.round(progress.progress * 100)}%`},
            ]}
          />
        </View>
        <Text style={styles.heroTotal}>
          {t('progress.hero.xpTotal', {count: progress.totalXp})}
        </Text>
      </View>
    );
  };

  const renderStats = () => {
    if (!progress) {
      return null;
    }

    return (
      <View style={styles.statsGrid} testID="progress-stats">
        <StatCard
          testID="progress-stat-minutes"
          value={String(progress.lifetimePracticeMinutes)}
          label={t('progress.stats.lifetimeMinutes')}
        />
        <StatCard
          testID="progress-stat-sessions"
          value={String(progress.sessionsCompleted)}
          label={t('progress.stats.sessions')}
        />
        <StatCard
          testID="progress-stat-track-items"
          value={String(progress.trackItemsCompleted)}
          label={t('progress.stats.trackItems')}
        />
      </View>
    );
  };

  const renderContent = () => {
    // Error before empty, so a failed load is never mistaken for "nothing yet".
    if (isError) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>
            {t('progress.errors.description')}
          </Text>
        </View>
      );
    }

    if (isLoading || isGateLoading) {
      return (
        <View style={styles.centerContainer} testID="progress-loading">
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    return (
      <>
        {renderHero()}
        {renderStats()}
        <TouchableOpacity
          style={styles.linkCard}
          onPress={goToLeaderboard}
          testID="progress-leaderboard-link">
          <Text style={styles.linkText}>{t('progress.rank.link')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkCard}
          onPress={goToAchievements}
          testID="progress-badges-link">
          <Text style={styles.linkText}>{t('progress.badges.link')}</Text>
        </TouchableOpacity>
      </>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}
      testID="progress-screen">
      <TabScreenHeader title={t('progress.title')} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {renderContent()}
      </ScrollView>
    </View>
  );
};
