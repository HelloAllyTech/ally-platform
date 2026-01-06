import React, {useCallback, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FlatList, Image, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {UserIcon} from '@/assets/icons';
import {TabView} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

import {generateMockLeaderboardData} from './mockUtils';

export enum LeaderboardPeriod {
  LAST_WEEK = 'last_week',
  LAST_MONTH = 'last_month',
  LAST_YEAR = 'last_year',
  ALL_TIME = 'all_time',
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  userName: string;
  avatarUrl?: string;
  totalDuration: string; // e.g., "14 h 32 min"
  badges: number;
  isCurrentUser?: boolean;
}

export const LeaderboardScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const [activePeriod, setActivePeriod] = useState<LeaderboardPeriod>(
    LeaderboardPeriod.LAST_WEEK,
  );

  // Mock current user rank - will come from API
  const currentUserRank = 24;
  const badgeCount = 3;

  const leaderboardData = useMemo(() => {
    return generateMockLeaderboardData(currentUserRank);
  }, [currentUserRank]);

  const handleBadgePress = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.ACHIEVEMENTS);
  }, [navigation]);

  const renderRankBadge = (rank: number) => {
    let badgeColor: string = colors.lightGray2;
    if (rank === 1) badgeColor = '#FFD700'; // Gold
    if (rank === 2) badgeColor = colors.lightGray3; // Silver/Gray
    if (rank === 3) badgeColor = '#CD7F32'; // Bronze

    return (
      <View
        style={[
          styles.rankBadge,
          {backgroundColor: badgeColor},
          rank <= 3 && styles.topThreeBadge,
        ]}>
        <Text style={[styles.rankText, rank <= 3 && styles.topThreeRankText]}>
          {rank}
        </Text>
      </View>
    );
  };

  const renderLeaderboardItem = ({item}: {item: LeaderboardEntry}) => {
    const isHighlighted = item.isCurrentUser;

    return (
      <View
        style={[styles.leaderboardRow, isHighlighted && styles.highlightedRow]}>
        <View style={styles.rankColumn}>{renderRankBadge(item.rank)}</View>
        <View style={styles.userColumn}>
          <View style={styles.avatarContainer}>
            {item.avatarUrl ? (
              <Image
                source={{uri: item.avatarUrl}}
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
            {item.userName}
          </Text>
        </View>
        <View style={styles.durationColumn}>
          <Text
            style={[
              styles.durationText,
              isHighlighted && styles.highlightedText,
            ]}>
            {item.totalDuration}
          </Text>
        </View>
        <View style={styles.badgesColumn}>
          <Text
            style={[
              styles.badgesText,
              isHighlighted && styles.highlightedText,
            ]}>
            {item.badges}
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
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <View style={styles.badgeIcon}>
            <Text style={styles.badgeIconText}>🏆</Text>
          </View>
          <Text style={styles.badgeCount}>
            {badgeCount} {t('Leaderboard.badges')}
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
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      {renderHeader()}
      <View style={styles.content}>
        <View style={styles.tabContainer}>
          <TabView<LeaderboardPeriod>
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
        <FlatList
          data={leaderboardData}
          renderItem={renderLeaderboardItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
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
    color: colors.blue,
  },
  content: {
    flex: 1,
    paddingHorizontal: '21@ms',
  },
  tabContainer: {
    marginBottom: '16@ms',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: '12@ms',
    paddingLeft: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray2,
    marginBottom: '8@ms',
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  listContent: {
    paddingBottom: '100@ms',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '12@ms',
    paddingLeft: 0,
    paddingRight: '4@ms',
    borderRadius: '8@ms',
    marginBottom: '4@ms',
  },
  highlightedRow: {
    backgroundColor: colors.ds.blue[50],
    borderWidth: '0.5@ms',
    borderColor: colors.ds.theme.primary,
  },
  rankColumn: {
    width: '45@ms',
    alignItems: 'flex-start',
    paddingLeft: 0,
  },
  rankColumnHeader: {
    width: '45@ms',
    alignItems: 'flex-start',
    paddingLeft: 0,
  },
  userColumnHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    paddingLeft: '2@ms',
    minWidth: '150@ms',
  },
  durationColumnHeader: {
    width: '95@ms',
    alignItems: 'flex-start',
    paddingLeft: '6@ms',
  },
  badgesColumnHeader: {
    width: '60@ms',
    alignItems: 'flex-start',
    paddingLeft: '2@ms',
    marginRight: '8@ms',
  },
  rankBadge: {
    width: '26@ms',
    height: '26@ms',
    borderRadius: '13@ms',
    backgroundColor: colors.lightGray2,
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
    paddingLeft: '2@ms',
    minWidth: '150@ms',
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
    ...typography.body.medium,
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
    alignItems: 'flex-start',
    paddingLeft: '6@ms',
  },
  durationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
  badgesColumn: {
    width: '60@ms',
    alignItems: 'flex-start',
    paddingLeft: '2@ms',
    marginRight: '8@ms',
  },
  badgesText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
  highlightedText: {
    color: colors.blue,
    fontWeight: '500',
  },
});
