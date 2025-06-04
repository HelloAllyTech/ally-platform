import React, {useMemo, useState} from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {DateSelector} from '@/components/DateSelector/DateSelector';
import {
  ANALYTICS_DUMMY_DATA,
  ANALYTICS_TABS,
  CALENDAR_MODES,
} from '@/constants/analytics';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const UserAnalyticsScreen: React.FC = () => {
  const {t} = useTranslate();
  const [selectedTab, setSelectedTab] = useState('M');
  const [selectedDate, setSelectedDate] = useState('2025-01-05');

  const {listeningPercent, talkingPercent, questionsUsed, questionsTotal} =
    ANALYTICS_DUMMY_DATA;

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
      default:
        return CALENDAR_MODES.D;
    }
  }, [selectedTab]);

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {ANALYTICS_TABS.map(tab => (
        <TouchableOpacity
          key={tab}
          style={[
            styles.tabButton,
            selectedTab === tab && styles.tabButtonActive,
          ]}
          onPress={() => setSelectedTab(tab)}>
          <Text style={styles.tabText}>{tab}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderListeningTalkingDistribution = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {t('analytics.listeningTalking.title')}
      </Text>
      <View style={styles.barContainer}>
        <View style={[styles.barListening, {flex: listeningPercent}]}>
          <Text style={styles.barText}>{listeningPercent}%</Text>
        </View>
        <View style={[styles.barTalking, {flex: talkingPercent}]}>
          <Text style={styles.barTextDark}>{talkingPercent}%</Text>
        </View>
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, styles.legendColorListening]} />
          <Text style={styles.legendLabel}>
            {t('analytics.listeningTalking.listening')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, styles.legendColorTalking]} />
          <Text style={styles.legendLabel}>
            {t('analytics.listeningTalking.talking')}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderQuestionsUsed = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('analytics.questions.title')}</Text>
      <Text style={styles.questionsUsed}>
        <Text style={styles.questionsUsedNum}>{questionsUsed}</Text>
        <Text style={styles.questionsUsedTotal}>/{questionsTotal}</Text>
      </Text>
      <Text style={styles.questionsDesc}>
        {t('analytics.questions.description')}
      </Text>
    </View>
  );

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
        {renderTabBar()}
        <DateSelector
          pickerMode={pickerMode}
          initialDate={selectedDate}
          onChangeDate={setSelectedDate}
        />
        {renderListeningTalkingDistribution()}
        {renderQuestionsUsed()}
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
    marginTop: '4@ms',
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
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '12@s',
    padding: '8@s',
    paddingHorizontal: '10@s',
    width: '100%',
    borderRadius: '4@s',
    gap: '8@s',
    backgroundColor: colors.lightGray9,
  },
  tabButton: {
    paddingVertical: '4@s',
    paddingHorizontal: '18@s',
    borderRadius: '5@s',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    elevation: 2,
  },
  tabButtonActive: {
    backgroundColor: colors.white,
    elevation: 2,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  tabText: {
    fontSize: '12@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
  },
  card: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: '12@s',
    padding: '18@s',
    marginBottom: '18@s',
    borderWidth: 0.5,
    borderColor: colors.lightGray7,
  },
  cardTitle: {
    fontSize: '16@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
    marginBottom: '20@s',
  },
  barContainer: {
    flexDirection: 'row',
    height: '36@s',
    borderRadius: '4@s',
    overflow: 'hidden',
    marginBottom: '16@s',
    marginTop: '4@s',
    backgroundColor: colors.lightGray,
  },
  barListening: {
    backgroundColor: colors.lightBlue3,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: '12@s',
  },
  barTalking: {
    backgroundColor: colors.lightBlue4,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: '12@s',
  },
  barText: {
    color: colors.darkSlate,
    fontSize: '16@s',
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
  },
  barTextDark: {
    color: colors.white,
    fontSize: '16@s',
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
  },
  legendRow: {
    flexDirection: 'row',
    gap: '18@s',
    marginTop: '2@s',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@s',
  },
  legendColor: {
    width: '18@s',
    height: '18@s',
    borderRadius: '4@s',
    marginRight: '2@s',
  },
  legendLabel: {
    fontSize: '12@s',
    color: colors.darkSlate,
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
  },
  questionsUsed: {
    fontSize: '32@s',
    color: colors.darkSlate,
    marginBottom: '4@s',
    fontFamily: fontFamily.REPLAY_PRO.BOLD.fontFamily,
  },
  questionsUsedNum: {
    fontSize: '36@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  questionsUsedTotal: {
    fontSize: '36@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  questionsDesc: {
    fontSize: '14@s',
    color: colors.gray,
    marginTop: '6@s',
    lineHeight: '20@s',
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
  },
  legendColorListening: {
    backgroundColor: colors.lightBlue3,
  },
  legendColorTalking: {
    backgroundColor: colors.lightBlue4,
  },
});
