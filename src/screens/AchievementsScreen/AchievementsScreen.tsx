import React, {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {TabView} from '@/components';
import {LockStatus} from '@/constants/badges';
import {useAppNavigation} from '@/hooks';
import {useGetAvailableBadgesQuery} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {BadgeCategoryGroup} from '@/types/badges';
import {snakeCaseToTitleCase} from '@/utils/common';

import {AchievementCard} from './components';

type FilterType = 'all' | 'unlocked';

export const AchievementsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('all');

  const {data: badgesResponse, isLoading, error} = useGetAvailableBadgesQuery();

  // Memoize tab configuration
  const tabs = useMemo(
    () => [
      {key: 'all' as FilterType, label: t('Achievements.all', 'All')},
      {
        key: 'unlocked' as FilterType,
        label: t('Achievements.unlocked', 'Unlocked'),
      },
    ],
    [t],
  );

  const filteredCategories = useMemo(() => {
    if (!badgesResponse) {
      return [];
    }

    if (selectedFilter === 'all') {
      return badgesResponse;
    }

    // Filter to show only unlocked badges
    return badgesResponse
      .map(categoryGroup => ({
        ...categoryGroup,
        badges: categoryGroup.badges.filter(
          badge => badge.lockStatus === LockStatus.UNLOCKED,
        ),
      }))
      .filter(categoryGroup => categoryGroup.badges.length > 0);
  }, [badgesResponse, selectedFilter]);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const renderCategorySection = useCallback(
    (categoryGroup: BadgeCategoryGroup, index: number) => (
      <View key={`${categoryGroup.category}-${index}`} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {snakeCaseToTitleCase(categoryGroup.category)}
          </Text>
          <View style={styles.sectionLine} />
        </View>
        {categoryGroup.badges.map(badge => (
          <AchievementCard key={badge.id} badge={badge} />
        ))}
      </View>
    ),
    [],
  );

  const renderEmptyState = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('Achievements.noAchievements', 'No achievements found')}
        </Text>
      </View>
    ),
    [t],
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>
            {t('Achievements.error', 'Failed to load achievements')}
          </Text>
        </View>
      );
    }

    if (filteredCategories.length === 0) {
      return renderEmptyState();
    }

    return filteredCategories.map(renderCategorySection);
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          activeOpacity={0.7}>
          <LeftArrowIcon color={colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('Achievements.title')}</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <View style={styles.filterRow}>
          <Text style={styles.badgesLabel}>{t('Achievements.badges')}</Text>
          <View style={styles.tabViewWrapper}>
            <TabView
              tabs={tabs}
              activeTab={selectedFilter}
              onTabChange={setSelectedFilter}
              tabWidthMode="equal"
            />
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {renderContent()}
      </ScrollView>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
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
  filterContainer: {
    marginHorizontal: '24@ms',
    marginTop: '16@ms',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgesLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
  },
  tabViewWrapper: {
    width: '65%',
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '12@ms',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.lowEmphasis,
    marginRight: '16@ms',
  },
  sectionLine: {
    flex: 1,
    height: '0.5@ms',
    backgroundColor: colors.ds.stroke.primary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingVertical: '48@ms',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '48@ms',
  },
  errorText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.feedback.error,
    textAlign: 'center',
  },
});
