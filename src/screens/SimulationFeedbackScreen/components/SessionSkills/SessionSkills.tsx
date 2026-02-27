import React, {useMemo} from 'react';
import {Dimensions, ScrollView, StyleSheet, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {BulbIcon} from '@/assets';
import {
  CircularProgress,
  CustomLineChart,
  NetworkImage,
  ProgressBar,
} from '@/components';
import {
  DEFAULT_DATA_POINTS,
  DEFAULT_SKILL_COLOR,
  DEFAULT_SKILL_COVERAGE,
  NUM_X_AXIS_INTERVALS,
  NUM_Y_AXIS_INTERVALS,
  SKILL_CATEGORY_COLOR_MAP,
} from '@/constants';
import {useTranslate} from '@/hooks';
import {useGetSimulationSkillsQuery} from '@/services/simulationSummaryApi';
import {colors, fontFamily, radius, typography} from '@/theme';
import {ExperienceMode, SimulationSummaryData, SkillCoverage} from '@/types';
import {calculateAverageForObjectArray, formatSecondsToMMSS} from '@/utils';

import {ExpandableFeedbackSection} from '../ExpandableFeedbackSection';
import {SummaryCard} from '../SummaryCard';

export interface SessionSkillsProps {
  scenarioSessionId: string;
  simulationDetails?: SimulationSummaryData | null;
}

export const SessionSkills: React.FC<SessionSkillsProps> = ({
  scenarioSessionId,
  simulationDetails,
}) => {
  const {t} = useTranslate();

  const {data: simulationSkills} = useGetSimulationSkillsQuery(
    {
      scenarioSessionId,
    },
    {
      skip: !scenarioSessionId,
    },
  );

  const skillCoverage = simulationSkills?.skillCoverage?.length
    ? simulationSkills.skillCoverage
    : DEFAULT_SKILL_COVERAGE;

  const emotionalMovementData = useMemo(
    () => simulationSkills?.emotionalMovement || [],
    [simulationSkills?.emotionalMovement],
  );
  const hasEmotionalData =
    !!emotionalMovementData && emotionalMovementData.length > 0;

  const chartData = useMemo(() => {
    if (!hasEmotionalData) return DEFAULT_DATA_POINTS;
    return emotionalMovementData.map(item => ({
      x: item.startTime,
      y: item.level,
    }));
  }, [hasEmotionalData, emotionalMovementData]);

  const renderSkillItem = (skill: SkillCoverage, index: number) => {
    const skillColor =
      SKILL_CATEGORY_COLOR_MAP[skill.category] ?? DEFAULT_SKILL_COLOR;
    return (
      <View key={index} style={styles.skillItemContent}>
        <View style={styles.skillIconContainer}>
          {skill.iconUrl ? (
            <NetworkImage
              imageUrl={skill.iconUrl}
              style={styles.skillIconContainer}
              height={20}
              width={20}
            />
          ) : (
            <BulbIcon width={20} height={20} />
          )}
        </View>
        <View style={styles.skillItem}>
          <View style={styles.skillLabelRow}>
            <Text style={styles.skillName}>{skill.category}</Text>
            <Text style={styles.skillPercentage}>{skill.percentage}%</Text>
          </View>
          <ProgressBar
            current={skill.percentage}
            total={100}
            inProgressColor={skillColor}
            completedColor={skillColor}
            height={ms(8)}
            isProgressTextVisible={false}
          />
        </View>
      </View>
    );
  };

  const overallScore = useMemo(() => {
    return calculateAverageForObjectArray(skillCoverage, 'percentage');
  }, [skillCoverage]);

  const isChecklistMode =
    simulationDetails?.scenario?.metadata?.experienceMode ===
    ExperienceMode.CHECKLIST;
  const positives =
    simulationDetails?.details?.summary?.feedback?.positives ?? [];
  const improvements =
    simulationDetails?.details?.summary?.feedback?.improvements ?? [];

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <SummaryCard title={t('SimulationFeedback.sessionSkills.sectionTitle')}>
        <View style={styles.overallScoreContainer}>
          <CircularProgress
            progress={overallScore}
            max={100}
            size={ms(200)}
            strokeWidth={10}
            progressColor={colors.blue}
            trackColor={colors.lightGray2}>
            <Text style={styles.overallScorePercentage}>
              {`${overallScore}%`}
            </Text>
            <Text style={styles.overallScoreLabel}>
              {t('SimulationFeedback.sessionSkills.overallScore')}
            </Text>
          </CircularProgress>
        </View>
        {/* Skill Coverage Card */}
        {skillCoverage.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>
                {t('SimulationFeedback.sessionSkills.skillCoverage')}
              </Text>
            </View>
            <View style={styles.cardContent}>
              {skillCoverage.map(renderSkillItem)}
            </View>
          </View>
        )}

        {/* Client Emotional Movement Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderText}>
              {t('SimulationFeedback.sessionSkills.clientEmotionalMovement')}
            </Text>
          </View>
          <View style={styles.chartInfoRow}>
            <Text style={styles.chartInfoText}>
              {t('SimulationFeedback.sessionSkills.chartXAxisLabel')}
            </Text>
            <Text style={styles.chartInfoText}>
              {t('SimulationFeedback.sessionSkills.chartYAxisLabel')}
            </Text>
          </View>
          <View style={styles.chartWrapper}>
            <CustomLineChart
              width={Dimensions.get('window').width - ms(65)}
              height={220}
              data={chartData}
              formatXLabel={formatSecondsToMMSS}
              xAxisSplitNumber={NUM_X_AXIS_INTERVALS}
              yAxisSplitNumber={NUM_Y_AXIS_INTERVALS}
            />
            {!hasEmotionalData && (
              <View style={styles.noDataOverlay}>
                <Text style={styles.noDataText}>
                  {t('SimulationFeedback.sessionSkills.noDataFound')}
                </Text>
              </View>
            )}
          </View>
        </View>
        {isChecklistMode && (
          <>
            <ExpandableFeedbackSection
              title={t('SimulationFeedback.strengthsAndSkills')}
              items={positives}
            />
            <ExpandableFeedbackSection
              title={t('SimulationFeedback.areasOfGrowth')}
              items={improvements}
            />
          </>
        )}
      </SummaryCard>
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: '40@vs',
  },
  card: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.deepPurple[300],
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    marginBottom: '16@vs',
    overflow: 'hidden',
  },
  cardHeader: {
    backgroundColor: colors.ds.deepPurpleAlpha[50],
    paddingHorizontal: '16@ms',
    paddingVertical: '10@vs',
  },
  cardHeaderText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  cardContent: {
    padding: '16@ms',
    gap: '16@vs',
  },
  skillItemContent: {
    gap: '8@ms',
    borderWidth: '1@ms',
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.md,
    padding: '16@ms',
    flexDirection: 'row',
    alignItems: 'center',
  },
  skillItem: {
    gap: '6@vs',
    flex: 1,
  },
  skillIconContainer: {
    width: '40@ms',
    height: '40@ms',
    borderRadius: radius.md,
    borderWidth: '1@ms',
    borderColor: colors.ds.stroke.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skillLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8@ms',
  },
  skillName: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  skillPercentage: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
  chartInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: '16@ms',
    paddingTop: '12@vs',
    gap: '16@ms',
  },
  chartInfoText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  chartWrapper: {
    paddingHorizontal: '8@ms',
    position: 'relative',
  },
  noDataOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  overallScoreContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '24@vs',
  },
  overallScorePercentage: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.large,
    color: colors.ds.typography.mediumEmphasis,
  },
  overallScoreLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
