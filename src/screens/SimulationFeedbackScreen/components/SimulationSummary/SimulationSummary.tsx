import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, KeyEventsIcon, LightBulbIcon, ThumbUpIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, stroke, typography} from '@/theme';
import {SimulationSummaryData} from '@/types';

import {
  formatSimulationKeyEvents,
  FormattedEvent,
} from '../../utils/simulationSummary';

interface SimulationSummaryProps {
  data: SimulationSummaryData | null;
}

const MetricCard: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({label, children}) => (
  <View style={styles.metricCard}>
    <Text style={styles.metricLabel}>{label}</Text>
    {children}
  </View>
);

export const SimulationSummary: React.FC<SimulationSummaryProps> = ({data}) => {
  const MAX_SUMMARY_SCORE = 50;
  const {t} = useTranslate();

  const [expandedSections, setExpandedSections] = useState({
    keyEvents: false,
    whatWentWell: false,
    areasForImprovement: false,
  });

  const getDuration = (startedAt?: string, endedAt?: string) => {
    if (!startedAt || !endedAt) return '-';
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);
    const duration = endedAtDate.getTime() - startedAtDate.getTime();
    const minutes = Math.floor(duration / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    return `${minutes} mins ${seconds} secs`;
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderEventItem = (item: FormattedEvent, index: number) => (
    <View key={index} style={styles.eventItem}>
      <View style={styles.bulletPointEvents} />
      <View style={styles.eventHeader}>
        <Text style={styles.eventTimestamp}>{item.time}</Text>
        <View style={styles.dot} />
        <Text style={styles.eventScore}>
          {item.score !== null && item.score !== undefined && item.score >= 0
            ? '+'
            : ''}
          {item.score !== null && item.score !== undefined ? item.score : ''}
        </Text>
      </View>
      <Text style={styles.eventDescription}>{item.event}</Text>
    </View>
  );

  const renderFeedbackItem = (item: string, index: number) => (
    <View key={index} style={styles.feedbackItem}>
      <View style={styles.bulletPoint} />
      <Text style={styles.feedbackText}>{item}</Text>
    </View>
  );

  const renderExpandableSection = <T,>(
    title: string,
    icon: React.ReactNode,
    items: T[] = [],
    sectionKey: keyof typeof expandedSections,
    renderItem: (item: T, index: number) => React.ReactNode,
  ) => {
    const isExpanded = expandedSections[sectionKey];
    const displayItems = isExpanded ? items : items?.slice(0, 3);

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleContainer}>
            {icon}
            <Text style={styles.sectionTitle}>{title}</Text>
          </View>
        </View>
        <View style={styles.sectionContent}>
          {displayItems?.length > 0 ? (
            displayItems?.map(renderItem)
          ) : (
            <Text style={styles.noItemsText}>
              {t('SimulationFeedback.noDataAvailable')}
            </Text>
          )}
          {items.length > 3 && (
            <TouchableOpacity
              style={styles.viewMoreButton}
              onPress={() => toggleSection(sectionKey)}>
              <Text style={styles.viewMoreText}>
                {isExpanded ? t('Common.viewLess') : t('Common.viewMore')}
              </Text>
              <ArrowDown
                width={10}
                height={10}
                color={colors.black}
                style={[isExpanded && styles.arrowIconRotated]}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const positives =
    data?.details?.summary?.feedback?.positives || data?.whatWentWell || [];
  const improvements =
    data?.details?.summary?.feedback?.improvements ||
    data?.areasForImprovement ||
    [];

  const events: FormattedEvent[] = formatSimulationKeyEvents(data);

  return (
    <View style={styles.container}>
      {data?.scenario?.title && (
        <Text style={styles.scenarioName}>{data?.scenario.title}</Text>
      )}
      <View style={styles.metricsContainer}>
        <MetricCard label={t('SimulationFeedback.sessionDuration')}>
          <Text style={styles.metricValue}>
            {getDuration(data?.startedAt, data?.endedAt)}
          </Text>
        </MetricCard>
        <MetricCard label={t('SimulationFeedback.totalScore')}>
          <View style={styles.metricValueContainer}>
            <Text style={styles.metricValue}>
              {`${data?.score ?? '0'} `}
              <Text style={styles.metricBenchmark}>
                {t('SimulationFeedback.benchmark', {
                  benchmark: MAX_SUMMARY_SCORE,
                })}
              </Text>
            </Text>
          </View>
        </MetricCard>
      </View>
      {renderExpandableSection(
        t('SimulationFeedback.keyEvents'),
        <KeyEventsIcon width={20} height={20} style={styles.sectionIcon} />,
        events,
        'keyEvents',
        renderEventItem,
      )}
      {renderExpandableSection(
        t('SimulationFeedback.whatWentWell'),
        <ThumbUpIcon width={20} height={20} style={styles.sectionIcon} />,
        positives,
        'whatWentWell',
        renderFeedbackItem,
      )}
      {renderExpandableSection(
        t('SimulationFeedback.areasForImprovement'),
        <LightBulbIcon width={20} height={20} style={styles.sectionIcon} />,
        improvements,
        'areasForImprovement',
        renderFeedbackItem,
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  metricsContainer: {
    flexDirection: 'row',
    gap: '6@ms',
    marginBottom: '16@vs',
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: '10@ms',
    borderWidth: '0.5@ms',
    borderColor: stroke.primary,
  },
  metricLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '4@vs',
  },
  metricValue: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '14@ms',
  },
  metricValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginTop: '2@ms',
  },
  metricBenchmark: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    paddingTop: '4@ms',
    color: colors.ds.typography.highEmphasis,
  },
  section: {
    paddingBottom: '12@vs',
    marginBottom: '16@vs',
    borderBottomWidth: '0.4@ms',
    borderColor: colors.lightGray4,
  },
  sectionHeader: {
    marginBottom: '12@vs',
  },
  scenarioName: {
    ...fontFamily.REPLAY_PRO.BOLD,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
    marginTop: '16@vs',
    marginBottom: '24@vs',
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    marginRight: '8@ms',
    color: colors.darkGray2,
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sectionContent: {
    gap: '12@vs',
  },
  eventItem: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '4@vs',
  },
  eventTimestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  eventScore: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  eventDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  feedbackItem: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
  },
  feedbackText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  viewMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  arrowIconRotated: {
    transform: [{rotate: '180deg'}],
  },
  dot: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.lowEmphasis,
    borderRadius: '2@ms',
    marginTop: '3@ms',
  },
  bulletPoint: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.mediumEmphasis,
    borderRadius: '50%',
    position: 'absolute',
    left: '4@ms',
    top: '12@ms',
  },
  bulletPointEvents: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.mediumEmphasis,
    borderRadius: '50%',
    position: 'absolute',
    left: '4@ms',
    top: '35@ms',
  },
  noItemsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },
});
