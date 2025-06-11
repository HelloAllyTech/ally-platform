import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DateSelector} from '@/components/DateSelector/DateSelector';
import {LoadingSkeleton} from '@/components/LoadingSkeleton/LoadingSkeleton';
import {CALENDAR_MODES} from '@/constants/analytics';
import {isIOS} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {useGetCounselorStatsQuery} from '@/services/analyticsApi';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {ListeningTalkingDistribution, TabBar} from './components';

interface DateRange {
  startDate: string;
  endDate: string;
}

const useAnalyticsDateRange = (selectedTab: string) => {
  const today = new Date();
  const formattedDate = today.toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: formattedDate,
    endDate: formattedDate,
  });

  useEffect(() => {
    const updateDateRange = () => {
      const endDate = new Date(dateRange.startDate);
      const startDate = new Date(dateRange.startDate);

      switch (selectedTab) {
        case 'W':
          const tempEnd = new Date(dateRange.startDate);
          tempEnd.setDate(tempEnd.getDate() + 6); // 7-day week range

          // Cap to today if it exceeds today
          endDate.setTime(Math.min(tempEnd.getTime(), today.getTime()));
          break;
        case 'M':
          // Set start date to first day of the month
          startDate.setDate(1);

          // Set end date to last day of the month
          endDate.setMonth(endDate.getMonth() + 1);
          endDate.setDate(0); // This gives us the last day of the current month

          // Cap to today if it exceeds today
          endDate.setTime(Math.min(endDate.getTime(), today.getTime()));
          break;
        case 'Y':
          // Set start date to January 1st of the year
          startDate.setMonth(0);
          startDate.setDate(1);

          // Set end date to December 31st of the year
          endDate.setMonth(11);
          endDate.setDate(31);

          // Cap to today if it exceeds today
          endDate.setTime(Math.min(endDate.getTime(), today.getTime()));
          break;
        case 'A': {
          endDate.setTime(today.getTime());
          break;
        }
        default:
          endDate.setDate(endDate.getDate() + 1);
      }

      setDateRange(prevRange => ({
        ...prevRange,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      }));
    };

    updateDateRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab]);

  return {dateRange, setDateRange};
};

export const UserAnalyticsScreen: React.FC = () => {
  const {t} = useTranslate();
  const [selectedTab, setSelectedTab] = useState('D');
  const {dateRange, setDateRange} = useAnalyticsDateRange(selectedTab);

  const {
    data: stats,
    isLoading,
    isFetching,
    error,
  } = useGetCounselorStatsQuery(dateRange);

  const {counselorSharingPercentage} = stats || {};

  const pickerMode = useMemo(() => {
    switch (selectedTab) {
      case 'D':
        return CALENDAR_MODES.D;
      case 'W':
        return CALENDAR_MODES.W;
      case 'M':
        return CALENDAR_MODES.M;
      case 'Y':
        return CALENDAR_MODES.Y;
      case 'A':
        return CALENDAR_MODES.A;
      default:
        return CALENDAR_MODES.D;
    }
  }, [selectedTab]);

  const ListeningTalkingStats = error
    ? {listeningPercent: 0, talkingPercent: 0}
    : {
        listeningPercent: Math.max(0, 100 - (counselorSharingPercentage || 0)),
        talkingPercent: counselorSharingPercentage || 0,
      };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.headerTitle}>
          {t('analytics.header.title')}
          <Text style={styles.headerSubtitle}>
            {` ${t('analytics.header.subtitle')}`}
          </Text>
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <TabBar selectedTab={selectedTab} onTabChange={setSelectedTab} />
        <DateSelector
          pickerMode={pickerMode}
          dateRange={dateRange}
          setDateRange={setDateRange}
        />
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <>
            <ListeningTalkingDistribution
              isLoading={isFetching}
              stats={ListeningTalkingStats}
            />
            {/* <QuestionsUsed /> */}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: '30@s',
    padding: '20@s',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '16@ms',
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    color: colors.darkSlate,
    textAlign: 'left',
    fontWeight: '400',
  },
  headerSubtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
});
