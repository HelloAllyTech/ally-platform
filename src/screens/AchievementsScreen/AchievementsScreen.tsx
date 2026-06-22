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
import {useSelector} from 'react-redux';

import {InfoIcon, LeftArrowIcon} from '@/assets';
import {InfoTooltip, TabView} from '@/components';
import {BadgeCategory, LockStatus} from '@/constants';
import {USER_PERMISSIONS} from '@/constants/permissions';
import {useAppNavigation, useHardwareBackPressHandler} from '@/hooks';
import {useGetAvailableBadgesQuery} from '@/services';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme';
import {BadgeCategoryGroup} from '@/types';
import {BADGE_CATEGORY_MAP} from '@/utils';

import {AchievementCard} from './components';
import {styles} from './styles';

enum FilterType {
  ALL = 'all',
  UNLOCKED = 'unlocked',
}

export const AchievementsScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [selectedFilter, setSelectedFilter] = useState<FilterType>(
    FilterType.ALL,
  );
  const [tooltipCategory, setTooltipCategory] = useState<BadgeCategory | null>(
    null,
  );
  const [showBadgesTooltip, setShowBadgesTooltip] = useState(false);

  const permissions = useSelector(
    (state: AppRootState) => state.user.permissions,
  );
  const hasViewBadgesPermission = permissions.includes(
    USER_PERMISSIONS.VIEW_USER_BADGES,
  );

  const {
    data: badgesResponse,
    isLoading,
    error,
  } = useGetAvailableBadgesQuery(undefined, {
    skip: !hasViewBadgesPermission,
  });

  useHardwareBackPressHandler(() => {
    handleGoBack();
    return true;
  });

  // Memoize tab configuration
  const tabs = useMemo(
    () => [
      {key: FilterType.ALL, label: t('achievements.filters.all', 'All')},
      {
        key: FilterType.UNLOCKED,
        label: t('achievements.filters.unlocked', 'Unlocked'),
      },
    ],
    [t],
  );

  const filteredCategories = useMemo(() => {
    if (!badgesResponse) {
      return [];
    }

    if (selectedFilter === FilterType.ALL) {
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

  const toggleInfoTooltip = useCallback((category: string | null) => {
    setTooltipCategory(prev => (prev ? null : (category as BadgeCategory)));
  }, []);

  const handleShowBadgesTooltip = useCallback(() => {
    setShowBadgesTooltip(prev => !prev);
  }, []);

  const renderCategorySection = useCallback(
    (categoryGroup: BadgeCategoryGroup, index: number) => (
      <View key={`${categoryGroup.category}-${index}`} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {t(
              `achievements.badgeTypes.${BADGE_CATEGORY_MAP[categoryGroup.category]}`,
            )}
          </Text>
          <InfoTooltip
            content={
              <Text style={styles.tooltipText}>
                {t(
                  `achievements.badgeTypes.tooltip.${BADGE_CATEGORY_MAP[categoryGroup.category]}`,
                )}
              </Text>
            }
            placement="top"
            isVisible={tooltipCategory === categoryGroup.category}
            onClose={() => toggleInfoTooltip(null)}>
            <TouchableOpacity
              style={styles.tooltipIcon}
              onPress={() => toggleInfoTooltip(categoryGroup.category)}>
              <InfoIcon width={16} height={16} color={colors.ds.icon.default} />
            </TouchableOpacity>
          </InfoTooltip>
          <View style={styles.sectionLine} />
        </View>
        {categoryGroup.badges.map(badge => (
          <AchievementCard key={badge.id} badge={badge} />
        ))}
      </View>
    ),
    [toggleInfoTooltip, tooltipCategory, t],
  );

  const renderEmptyState = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {t('achievements.noAchievements', 'No achievements found')}
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
            {t(
              'achievements.errors.description',
              'Failed to load achievements',
            )}
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
        <Text style={styles.title}>{t('achievements.title')}</Text>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <View style={styles.filterRow}>
          <View style={styles.badgesLabelContainer}>
            <Text style={styles.badgesLabel}>{t('achievements.badges')}</Text>
            <InfoTooltip
              content={
                <Text style={styles.tooltipText}>
                  {t('achievements.badgesTooltip')}
                </Text>
              }
              placement="top"
              isVisible={showBadgesTooltip}
              onClose={handleShowBadgesTooltip}>
              <TouchableOpacity
                style={styles.tooltipIcon}
                onPress={handleShowBadgesTooltip}>
                <InfoIcon
                  width={16}
                  height={16}
                  color={colors.ds.icon.default}
                />
              </TouchableOpacity>
            </InfoTooltip>
          </View>
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
