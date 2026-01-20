import React, {useCallback, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {BadgeIcon, UserIcon} from '@/assets/icons';
import {TabView} from '@/components';
import {DEFAULT_HIT_SLOP, SCREEN_NAMES} from '@/constants';
import {LeaderboardPeriod, RANK_ICON_MAP} from '@/constants/leaderboard';
import {useAppNavigation, useLeaderboard} from '@/hooks';
import {LeaderboardEntryWithCurrentUser} from '@/screens/LeaderboardScreen/mockUtils';
import {colors, fontFamily, typography} from '@/theme';
import {formatMinutesToDuration} from '@/utils';

export const LeaderboardScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();

  const [activePeriod, setActivePeriod] = useState<LeaderboardPeriod>(
    LeaderboardPeriod.LAST_WEEK,
  );

  // Fetch leaderboard data using the hook
  const {leaderboardData, currentUserEntry, isLoading} = useLeaderboard({
    window: activePeriod,
    limit: 50,
    offset: 0,
  });

  const currentScrollOffsetY = useRef(0);
  const currentUserRowTopPosition = useRef(0);
  const flatListViewportHeight = useRef(0);
  const leaderboardRowHeight = useRef(0);

  // Controls visibility of sticky footer showing current user's row
  const [shouldShowStickyFooter, setShouldShowStickyFooter] = useState(true);

  const handleBadgePress = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.ACHIEVEMENTS);
  }, [navigation]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollOffsetY = e.nativeEvent.contentOffset.y;
    currentScrollOffsetY.current = scrollOffsetY;

    // Calculate if current user's row is fully visible in the viewport
    const viewportBottom = scrollOffsetY + flatListViewportHeight.current;
    const isCurrentUserRowFullyVisible =
      currentUserRowTopPosition.current + leaderboardRowHeight.current <=
      viewportBottom;

    setShouldShowStickyFooter(!isCurrentUserRowFullyVisible);
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
    index,
  }: {
    item: LeaderboardEntryWithCurrentUser;
    index: number;
  }) => {
    const isHighlighted = item.isCurrentUser;

    return (
      <View
        onLayout={e => {
          const rowHeight = e.nativeEvent.layout.height;

          // Measure row height once (from first non-highlighted item for consistency)
          if (!leaderboardRowHeight.current && !isHighlighted) {
            leaderboardRowHeight.current = rowHeight;
          }

          // Calculate and store the current user's row position when it's rendered
          if (item.isCurrentUser && leaderboardRowHeight.current > 0) {
            const calculatedTopPosition = index * leaderboardRowHeight.current;
            currentUserRowTopPosition.current = calculatedTopPosition;
          }
        }}
        style={[styles.leaderboardRow, isHighlighted && styles.highlightedRow]}>
        <View
          style={[
            styles.rankColumn,
            isHighlighted && styles.highlightedRankColumn,
          ]}>
          {renderRankBadge(item.rank)}
        </View>
        <View style={styles.userColumn}>
          <View style={styles.avatarContainer}>
            {item.profileImageUrl ? (
              <Image
                source={{uri: item.profileImageUrl}}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <UserIcon width={24} height={24} />
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
    );
  };

  const renderHeader = () => {
    return (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{t('Leaderboard.title')}</Text>
        </View>
        <TouchableOpacity
          style={styles.badgeButton}
          onPress={handleBadgePress}
          hitSlop={DEFAULT_HIT_SLOP}>
          <BadgeIcon width={16} height={16} />
          <Text style={styles.badgeCount}>
            {currentUserEntry?.badgeCount ?? 0} {t('Leaderboard.badges')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderTableHeader = () => {
    return (
      <View style={styles.tableHeader}>
        <View style={styles.rankColumnHeader}>
          <Text style={styles.headerText}>
            {t('Leaderboard.tableHeaders.rank')}
          </Text>
        </View>
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

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      {renderHeader()}
      <View style={styles.listContainer}>
        <View style={styles.tabContainer}>
          <TabView
            tabs={[
              {
                key: LeaderboardPeriod.LAST_WEEK,
                label: `${t('Leaderboard.period.last')} ${t('Leaderboard.period.week')}`,
              },
              {
                key: LeaderboardPeriod.LAST_MONTH,
                label: `${t('Leaderboard.period.last')} ${t('Leaderboard.period.month')}`,
              },
              {
                key: LeaderboardPeriod.LAST_YEAR,
                label: `${t('Leaderboard.period.last')} ${t('Leaderboard.period.year')}`,
              },
              {
                key: LeaderboardPeriod.ALL_TIME,
                label: t('Leaderboard.period.allTime'),
              },
            ]}
            activeTab={activePeriod}
            onTabChange={setActivePeriod}
          />
        </View>
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
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onLayout={e => {
                flatListViewportHeight.current = e.nativeEvent.layout.height;
              }}
            />

            {shouldShowStickyFooter && currentUserEntry && (
              <View style={styles.stickyFooter}>
                {renderLeaderboardItem({
                  item: currentUserEntry,
                  index: currentUserEntry.rank - 1,
                })}
              </View>
            )}
          </>
        )}
      </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
    fontWeight: '400',
  },
  badgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  badgeIcon: {
    width: '20@ms',
    height: '20@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeIconText: {
    fontSize: '16@ms',
  },
  badgeCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.blue[500],
  },
  listContainer: {
    flex: 1,
    marginBottom: '100@ms',
  },
  tabContainer: {
    paddingHorizontal: '21@ms',
    marginBottom: '16@ms',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: '12@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray2,
    marginBottom: '8@ms',
    paddingHorizontal: '21@ms',
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.tiny,
    color: colors.ds.typography.mediumEmphasis,
  },
  listContent: {
    paddingBottom: '100@ms',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '12@ms',
    borderRadius: '8@ms',
  },
  highlightedRow: {
    backgroundColor: colors.ds.blue[50],
    borderWidth: '0.5@ms',
    borderColor: colors.ds.theme.primary,
    marginHorizontal: '8@ms',
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
  },
  rankColumn: {
    width: '38@ms',
    alignItems: 'flex-start',
    marginLeft: '21@ms',
  },
  highlightedRankColumn: {
    marginLeft: '9@ms',
  },
  rankColumnHeader: {
    width: '45@ms',
    alignItems: 'flex-start',
  },
  userColumnHeader: {
    flex: 1,
    minWidth: '160@ms',
  },
  durationColumnHeader: {
    width: '88@ms',
  },
  badgesColumnHeader: {
    width: '60@ms',
  },
  rankBadge: {
    width: '26@ms',
    height: '26@ms',
    borderRadius: '13@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topThreeBadge: {
    width: '30@ms',
    height: '30@ms',
    borderRadius: '15@ms',
  },
  rankText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.label.medium,
    color: colors.ds.typography.highEmphasis,
  },
  topThreeRankText: {
    color: colors.white,
    fontWeight: '600',
  },
  userColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    marginRight: '10@ms',
    minWidth: '160@ms',
  },
  avatarContainer: {
    width: '40@ms',
    height: '40@ms',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: '20@ms',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: '20@ms',
    backgroundColor: colors.lightGray1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
    fontWeight: '600',
  },
  highlightedUserName: {
    color: colors.blue,
    fontWeight: '500',
  },
  durationColumn: {
    width: '95@ms',
  },
  durationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
  },
  badgesColumn: {
    width: '60@ms',
  },
  badgesText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.highEmphasis,
  },
  highlightedText: {
    color: colors.blue,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '40@ms',
  },
});
