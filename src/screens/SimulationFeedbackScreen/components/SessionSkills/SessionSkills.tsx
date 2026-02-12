import React, {useMemo} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChartComponent, ProgressBar} from '@/components';
import {colors, fontFamily, typography} from '@/theme';
import {formatTimeToMMSS} from '@/utils/date';

import {SummaryCard} from '../SummaryCard';

const NUM_X_AXIS_INTERVALS = 5;

/** Raw input dataset with {x, y} data points (before normalisation for the chart). */
export interface EmotionalMovementDataset {
  data: {x: number; y: number}[];
  color?: (opacity: number) => string;
  strokeWidth?: number;
  label?: string;
}

export interface SkillCoverageItem {
  /** Skill name (e.g., "Learning", "Support", "Standards") */
  name: string;
  /** Percentage value (0-100) */
  percentage: number;
  /** Color for the progress bar */
  color: string;
}

export interface SessionSkillsProps {
  /** Array of skill coverage items to display in the bar chart */
  skillCoverage?: SkillCoverageItem[];
  /** Chart datasets for the emotional movement line chart */
  emotionalMovementDatasets?: EmotionalMovementDataset[];
  /** X-axis labels for the emotional movement chart */
  emotionalMovementXLabels?: string[];
}

/**
 * Utility function to generate a Map of uniformly spaced x-axis labels (in ms + formatted string)
 * for emotional movement datasets.
 */
function getNormalisedXAxisLabelsMap(
  datasets: EmotionalMovementDataset[] = [],
  formatFn: (ms: number) => string = formatTimeToMMSS,
): Map<number, string> {
  if (!datasets.length) return new Map();

  const allTimes = datasets
    .flatMap(d => d.data)
    .filter(x => typeof x === 'object' && 'x' in x && typeof x.x === 'number');
  if (!allTimes.length) return new Map();

  const minTime = Math.min(...allTimes.map(x => x.x));
  const maxTime = Math.max(...allTimes.map(x => x.x));

  const interval = (maxTime - minTime) / NUM_X_AXIS_INTERVALS;

  return new Map(
    Array.from({length: NUM_X_AXIS_INTERVALS + 1}, (_, idx) => [
      Math.round((minTime + idx * interval) * 1000),
      formatFn(Math.round((minTime + idx * interval) * 1000)),
    ]),
  );
}

/**
 * Linearly interpolate the Y value at `targetX` from a **sorted** (by x) array of {x, y} points.
 * If targetX falls outside the data range the nearest endpoint's y is returned.
 */
function interpolateY(
  sortedData: {x: number; y: number}[],
  targetX: number,
): number {
  if (!sortedData.length) return 0;
  if (targetX <= sortedData[0].x) return sortedData[0].y;
  if (targetX >= sortedData[sortedData.length - 1].x)
    return sortedData[sortedData.length - 1].y;

  for (let i = 0; i < sortedData.length - 1; i++) {
    const p1 = sortedData[i];
    const p2 = sortedData[i + 1];
    if (targetX >= p1.x && targetX <= p2.x) {
      const t = (targetX - p1.x) / (p2.x - p1.x);
      return p1.y + t * (p2.y - p1.y);
    }
  }

  return sortedData[sortedData.length - 1].y;
}

/**
 * For each dataset, compute the interpolated Y values at the normalised
 * (uniformly-spaced) X-axis positions so that dots appear exactly on the
 * X-axis gridlines.
 */
function getInterpolatedYValues(
  datasets: EmotionalMovementDataset[],
  numIntervals: number = NUM_X_AXIS_INTERVALS,
): number[][] {
  if (!datasets.length) return [];

  const allPoints = datasets
    .flatMap(d => d.data)
    .filter(
      (pt): pt is {x: number; y: number} =>
        typeof pt === 'object' && 'x' in pt && typeof pt.x === 'number',
    );
  if (!allPoints.length) return datasets.map(() => []);

  const minTime = Math.min(...allPoints.map(pt => pt.x));
  const maxTime = Math.max(...allPoints.map(pt => pt.x));
  const interval = (maxTime - minTime) / numIntervals;

  // The same uniformly-spaced x positions used by getNormalisedXAxisLabelsMap
  const normalisedXPositions = Array.from(
    {length: numIntervals + 1},
    (_, idx) => minTime + idx * interval,
  );

  return datasets.map(dataset => {
    const sorted = [...dataset.data]
      .filter(
        (pt): pt is {x: number; y: number} =>
          typeof pt === 'object' && 'x' in pt && typeof pt.x === 'number',
      )
      .sort((a, b) => a.x - b.x);

    return normalisedXPositions.map(
      x => Math.round(interpolateY(sorted, x) * 1000) / 1000,
    );
  });
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

export const SessionSkills: React.FC<SessionSkillsProps> = ({
  skillCoverage = [],
  emotionalMovementDatasets = [],
}) => {
  // Generate the labels map using the util function.
  const normalisedXAxisLabelsMap = useMemo(
    () =>
      getNormalisedXAxisLabelsMap(emotionalMovementDatasets, formatTimeToMMSS),
    [emotionalMovementDatasets],
  );

  // Interpolated Y values at each normalised X-axis position (one number[] per dataset).
  const interpolatedYValues = useMemo(
    () => getInterpolatedYValues(emotionalMovementDatasets),
    [emotionalMovementDatasets],
  );

  const renderSkillItem = (skill: SkillCoverageItem, index: number) => (
    <View key={index} style={styles.skillItem}>
      <View style={styles.skillLabelRow}>
        <Text style={styles.skillName}>{skill.name}</Text>
        <Text style={styles.skillPercentage}>{skill.percentage}%</Text>
      </View>
      <ProgressBar
        current={skill.percentage}
        total={100}
        inProgressColor={skill.color}
        completedColor={skill.color}
        height={ms(8)}
      />
    </View>
  );

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
                datasets={emotionalMovementDatasets.map((dataset, idx) => ({
                  ...dataset,
                  data: interpolatedYValues[idx] || [],
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
    paddingHorizontal: '10@ms',
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
