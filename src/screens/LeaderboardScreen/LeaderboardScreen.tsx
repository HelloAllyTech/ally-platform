import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {BadgeIcon} from '@/assets/icons';
import {CustomDropdown, TabScreenHeader} from '@/components';
import {DEFAULT_HIT_SLOP, SCREEN_NAMES} from '@/constants';
import {
  LEADERBOARD_FETCH_LIMIT,
  LeaderboardPeriod,
  RANK_ICON_MAP,
} from '@/constants/leaderboard';
import {
  LeaderboardEntryWithCurrentUser,
  useAppNavigation,
  useLeaderboard,
} from '@/hooks';
import {colors} from '@/theme';
import {formatMinutesToDuration} from '@/utils';

import {styles} from './styles';

export const LeaderboardScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  const [activePeriod, setActivePeriod] = useState<LeaderboardPeriod>(
    LeaderboardPeriod.LAST_WEEK,
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Fetch leaderboard data using the hook
  const {
    data: leaderboardData,
    currentUserEntry,
    isLoading,
    isRefreshing,
    isLoadingMore,
    badgeCount,
    loadMore,
    refresh,
  } = useLeaderboard({
    window: activePeriod,
    limit: LEADERBOARD_FETCH_LIMIT,
  });

  const showRankColumn = !currentUserEntry?.hideRankInCommunity;

  const currentScrollOffsetY = useRef(0);
  const [flatListViewportHeight, setFlatListViewportHeight] = useState(0);
  const [leaderboardRowHeight, setLeaderboardRowHeight] = useState(0);

  // Controls visibility of sticky footer showing current user's row
  const [shouldShowStickyFooter, setShouldShowStickyFooter] = useState(false);

  // Calculate current user position based on index in the list
  const currentUserPosition = useMemo(() => {
    if (!currentUserEntry || !leaderboardRowHeight) {
      return 0;
    }
    // Find the index of current user in leaderboardData
    const currentUserIndex = leaderboardData.findIndex(
      entry => entry.userId === currentUserEntry.userId,
    );
    if (currentUserIndex === -1) return 0;
    return currentUserIndex * leaderboardRowHeight;
  }, [currentUserEntry, leaderboardData, leaderboardRowHeight]);

  const handleBadgePress = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.ACHIEVEMENTS);
  }, [navigation]);

  // Calculate if sticky footer should be shown based on scroll position
  const calculateStickyFooterVisibility = useCallback(
    (scrollOffsetY: number) => {
      if (
        !currentUserEntry ||
        !leaderboardRowHeight ||
        !flatListViewportHeight
      ) {
        return false;
      }

      const viewportBottom = scrollOffsetY + flatListViewportHeight;
      const currentUserRowTop = currentUserPosition;

      // Show sticky footer ONLY if current user row is below the viewport
      // (not yet scrolled to, still ahead)
      return currentUserRowTop > viewportBottom;
    },
    [
      currentUserEntry,
      currentUserPosition,
      leaderboardRowHeight,
      flatListViewportHeight,
    ],
  );

  // Calculate initial sticky footer visibility when data loads or measurements become ready
  useEffect(() => {
    const isRowBelowViewport = calculateStickyFooterVisibility(
      currentScrollOffsetY.current,
    );
    setShouldShowStickyFooter(isRowBelowViewport);
  }, [calculateStickyFooterVisibility, leaderboardData]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollOffsetY = e.nativeEvent.contentOffset.y;
    currentScrollOffsetY.current = scrollOffsetY;

    const isRowBelowViewport = calculateStickyFooterVisibility(scrollOffsetY);
    setShouldShowStickyFooter(isRowBelowViewport);
  };

  const renderRankBadge = (rank: number) => {
    if (RANK_ICON_MAP[rank]) {
      const RankIcon = RANK_ICON_MAP[rank];
      return <RankIcon />;
    }
    return (
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
    );
  };

  const renderLeaderboardItem = ({
    item,
  }: {
    item: LeaderboardEntryWithCurrentUser;
  }) => {
    const isHighlighted = item.isCurrentUser;

    return (
      <View
        onLayout={e => {
          const rowHeight = e.nativeEvent.layout.height;

          // Measure full row height (including separator) for scroll calculations
          if (!leaderboardRowHeight && !isHighlighted) {
            setLeaderboardRowHeight(rowHeight);
          }
        }}
        style={[styles.leaderboardRow, isHighlighted && styles.highlightedRow]}>
        <View style={styles.rowContent}>
          {showRankColumn && (
            <View
              style={[
                styles.rankColumn,
                isHighlighted && styles.highlightedRankColumn,
              ]}>
              {renderRankBadge(item.rank)}
            </View>
          )}
          <View
            style={[styles.userColumn, !showRankColumn && styles.marginL21]}>
            <View style={styles.avatarContainer}>
              {item.profileImageUrl ? (
                <Image
                  source={{uri: item.profileImageUrl}}
                  style={styles.avatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>
                    {item.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={[
                styles.userName,
                isHighlighted && styles.highlightedUserName,
              ]}
              numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <View style={styles.durationColumn}>
            <Text
              style={[
                styles.durationText,
                isHighlighted && styles.highlightedText,
              ]}>
              {formatMinutesToDuration(item.minutesPlayed)}
            </Text>
          </View>
          <View style={styles.badgesColumn}>
            <Text
              style={[
                styles.badgesText,
                isHighlighted && styles.highlightedText,
              ]}>
              {item.badgeCount}
            </Text>
          </View>
        </View>
        {!isHighlighted && <View style={styles.rowSeparator} />}
      </View>
    );
  };

  // Map period to display label
  const getPeriodLabel = useCallback(
    (period: LeaderboardPeriod): string => {
      switch (period) {
        case LeaderboardPeriod.LAST_WEEK:
          return t('Leaderboard.period.last7Days');
        case LeaderboardPeriod.LAST_MONTH:
          return t('Leaderboard.period.last28Days');
        case LeaderboardPeriod.LAST_YEAR:
          return t('Leaderboard.period.last364Days');
        case LeaderboardPeriod.ALL_TIME:
          return t('Leaderboard.period.allTime');
        default:
          return '';
      }
    },
    [t],
  );

  const periodOptions = useMemo(
    () => [
      LeaderboardPeriod.LAST_WEEK,
      LeaderboardPeriod.LAST_MONTH,
      LeaderboardPeriod.LAST_YEAR,
      LeaderboardPeriod.ALL_TIME,
    ],
    [],
  );

  const handlePeriodSelect = useCallback((value: string) => {
    setActivePeriod(value as LeaderboardPeriod);
  }, []);

  const handleDropdownSelect = useCallback(
    (label: string) => {
      const period = periodOptions.find(p => getPeriodLabel(p) === label);
      if (period) {
        handlePeriodSelect(period);
      }
    },
    [periodOptions, getPeriodLabel, handlePeriodSelect],
  );

  const dropdownOptions = useMemo(
    () => periodOptions.map(getPeriodLabel),
    [periodOptions, getPeriodLabel],
  );

  const renderBadgesButton = () => {
    return (
      <TouchableOpacity
        style={styles.badgeButton}
        onPress={handleBadgePress}
        hitSlop={DEFAULT_HIT_SLOP}>
        <BadgeIcon width={20} height={20} />
        <Text style={styles.badgeCount}>
          {badgeCount} {t('Leaderboard.badges')}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderLeaderboardHeader = () => {
    return (
      <View style={styles.leaderboardHeader}>
        <Text style={styles.title}>{t('Leaderboard.title')}</Text>
        <View style={styles.dropdownWrapper}>
          <CustomDropdown
            value={getPeriodLabel(activePeriod)}
            options={dropdownOptions}
            onSelect={handleDropdownSelect}
            isOpen={isDropdownOpen}
            setIsOpen={setIsDropdownOpen}
            customHeaderStyle={styles.dropdownHeader}
            customTextStyle={styles.dropdownText}
          />
        </View>
      </View>
    );
  };

  const renderTableHeader = () => {
    return (
      <View style={styles.tableHeader}>
        {showRankColumn && (
          <View style={styles.rankColumnHeader}>
            <Text style={styles.headerText}>
              {t('Leaderboard.tableHeaders.rank')}
            </Text>
          </View>
        )}
        <View style={styles.userColumnHeader}>
          <Text style={styles.headerText}>
            {t('Leaderboard.tableHeaders.user')}
          </Text>
        </View>
        <View style={styles.durationColumnHeader}>
          <Text style={styles.headerText}>
            {t('Leaderboard.tableHeaders.totalDuration')}
          </Text>
        </View>
        <View style={styles.badgesColumnHeader}>
          <Text style={styles.headerText}>
            {t('Leaderboard.tableHeaders.badges')}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ds.theme.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyStateContainer}>
        <Text style={styles.emptyStateTitle}>
          {t('Leaderboard.emptyState.title')}
        </Text>
        <Text style={styles.emptyStateDescription}>
          {t('Leaderboard.emptyState.description')}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <TabScreenHeader
        title={t('Common.community')}
        rightContent={renderBadgesButton()}
        isTooltipRequired
        tooltipContent={
          <View>
            <Text style={styles.tooltipText}>
              {t(`BadgeTooltip.Community.title`)}
            </Text>
            <Text style={styles.tooltipText}>
              {t(`BadgeTooltip.Community.description`)}
            </Text>
          </View>
        }
      />
      {renderLeaderboardHeader()}
      <View style={styles.listContainer}>
        {renderTableHeader()}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.ds.theme.primary} />
          </View>
        ) : (
          <>
            <FlatList
              data={leaderboardData}
              renderItem={renderLeaderboardItem}
              keyExtractor={item => item.userId.toString()}
              contentContainerStyle={
                leaderboardData.length === 0
                  ? styles.emptyListContent
                  : styles.listContent
              }
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onLayout={e => {
                setFlatListViewportHeight(e.nativeEvent.layout.height);
              }}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={refresh}
                  tintColor={colors.ds.theme.primary}
                />
              }
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListEmptyComponent={renderEmptyComponent()}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={styles.footerLoader}>
                    <ActivityIndicator
                      size="small"
                      color={colors.ds.theme.primary}
                    />
                  </View>
                ) : null
              }
            />

            {showRankColumn &&
              shouldShowStickyFooter &&
              !!leaderboardData.length &&
              !!currentUserEntry?.rank && (
                <View style={styles.stickyFooter}>
                  {renderLeaderboardItem({
                    item: currentUserEntry,
                  })}
                </View>
              )}
          </>
        )}
      </View>
    </View>
  );
};
