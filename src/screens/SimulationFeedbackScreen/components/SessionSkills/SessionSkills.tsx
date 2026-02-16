import React, {useMemo} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChartComponent, ProgressBar} from '@/components';
import {useGetSimulationSkillsQuery} from '@/services/simulationSummaryApi';
import {colors, fontFamily, typography} from '@/theme';
import {EmotionalMovement, SkillCoverage} from '@/types/simulationSummary';
import {formatTimeToMMSS} from '@/utils/date';
import {
  getInterpolatedYValues,
  getNormalisedXAxisLabelsMap,
} from '@/utils/simulationSummary';

import {SummaryCard} from '../SummaryCard';

const NUM_X_AXIS_INTERVALS = 5;

/** Raw input dataset with {x, y} data points (before normalisation for the chart). */
export interface EmotionalMovementDataset {
  data: {x: number; y: number}[];
  color?: (opacity: number) => string;
  strokeWidth?: number;
  label?: string;
}

export interface SessionSkillsProps {
  scenarioSessionId: string;
}

const chartConfig = {
  backgroundColor: colors.white,
  backgroundGradientFrom: colors.white,
  backgroundGradientTo: colors.white,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // #6B7280
  labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // #6B7280
  strokeWidth: ms(2),
  barPercentage: 0.5,
  propsForBackgroundLines: {
    strokeDasharray: '3,3', // Dashed grid lines
    stroke: colors.lightGray2,
    strokeWidth: 1,
  },
  propsForDots: {
    r: ms(2),
    strokeWidth: ms(2),
    stroke: colors.ds.green[400],
    fill: colors.white,
  },
  propsForLabels: {
    fontSize: ms(12),
    fontFamily: fontFamily.ROBOTO.REGULAR.fontFamily,
    fill: colors.ds.typography.lowEmphasis,
  },
};

const SKILL_CATEGORY_COLOR_MAP: Record<string, string> = {
  Learning: colors.ds.blue[300],
  Support: colors.ds.green[400],
  Standards: colors.ds.amber[400],
};

const DEFAULT_SKILL_COLOR = colors.ds.blue[300];

export const SessionSkills: React.FC<SessionSkillsProps> = ({
  scenarioSessionId,
}) => {
  // TODO: Remove default data after API is ready

  const defaultSkillCoverage: SkillCoverage[] = [
    {category: 'Learning', percentage: 60},
    {category: 'Support', percentage: 90},
    {category: 'Standards', percentage: 40},
  ];

  const defaultEmotionalMovement: EmotionalMovement[] = [
    {sessionTime: 0, level: 0},
    {sessionTime: 100, level: 4.5},
    {sessionTime: 250, level: 6},
    {sessionTime: 400, level: 8.5},
    {sessionTime: 480, level: 10},
    {sessionTime: 700, level: 7.5},
    {sessionTime: 850, level: 5},
    {sessionTime: 1000, level: 2.5},
    {sessionTime: 1150, level: 4},
    {sessionTime: 1200, level: 6.5},
  ];

  const {data: simulationSkills} = useGetSimulationSkillsQuery(
    {
      scenarioSessionId,
    },
    {
      skip: !scenarioSessionId,
    },
  );

  const skillCoverage = simulationSkills?.skillCoverage ?? defaultSkillCoverage;
  const emotionalMovementRaw =
    simulationSkills?.emotionalMovement ?? defaultEmotionalMovement;

  // Convert EmotionalMovement[] to EmotionalMovementDataset[] for chart utils
  const emotionalMovementDatasets: EmotionalMovementDataset[] = useMemo(
    () =>
      emotionalMovementRaw && emotionalMovementRaw.length > 0
        ? [
            {
              data: emotionalMovementRaw.map(item => ({
                x: item.sessionTime,
                y: item.level,
              })),
            },
          ]
        : [],
    [emotionalMovementRaw],
  );

  // Generate the labels map using the util function.
  const normalisedXAxisLabelsMap = useMemo(
    () =>
      getNormalisedXAxisLabelsMap(
        emotionalMovementDatasets,
        formatTimeToMMSS,
        NUM_X_AXIS_INTERVALS,
      ),
    [emotionalMovementDatasets],
  );

  // Interpolated Y values at each normalised X-axis position (one number[] per dataset).
  const interpolatedYValues = useMemo(
    () =>
      getInterpolatedYValues(emotionalMovementDatasets, NUM_X_AXIS_INTERVALS),
    [emotionalMovementDatasets],
  );

  const renderSkillItem = (skill: SkillCoverage, index: number) => {
    const skillColor =
      SKILL_CATEGORY_COLOR_MAP[skill.category] ?? DEFAULT_SKILL_COLOR;
    return (
      <View key={index} style={styles.skillItem}>
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
        />
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      <SummaryCard title="Skills shown in this session">
        {/* Skill Coverage Card */}
        {skillCoverage.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>Skill Coverage</Text>
            </View>
            <View style={styles.cardContent}>
              {skillCoverage.map(renderSkillItem)}
            </View>
          </View>
        )}

        {/* Client Emotional Movement Card */}
        {emotionalMovementDatasets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>
                Client Emotional Movement
              </Text>
            </View>
            <View style={styles.chartInfoRow}>
              <Text style={styles.chartInfoText}>
                X: Session Timeline(Min) graph
              </Text>
              <Text style={styles.chartInfoText}>Y: Level (1-10)</Text>
            </View>
            <View style={styles.chartWrapper}>
              <ChartComponent
                xAxisLabels={Array.from(normalisedXAxisLabelsMap.values())}
                datasets={emotionalMovementDatasets.map((_dataset, idx) => ({
                  data: interpolatedYValues[idx] || [],
                  color: (_opacity: number) => `rgba(102, 187, 106, 1)`,
                  strokeWidth: 2,
                  label: 'Emotional Movement',
                }))}
                height={ms(250)}
                showLegend={false}
                chartConfig={chartConfig}
              />
            </View>
          </View>
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
  skillItem: {
    gap: '6@vs',
  },
  skillLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skillName: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  skillPercentage: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
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
    paddingBottom: '8@vs',
  },
});
