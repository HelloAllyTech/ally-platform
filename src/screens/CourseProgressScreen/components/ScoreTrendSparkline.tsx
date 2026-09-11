import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Svg, {Circle, Polyline} from 'react-native-svg';

import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackRoleplaySessionFeedback} from '@/types';

interface ScoreTrendSparklineProps {
  /** Oldest-first, same order the dashboard already returns. */
  sessions: TrackRoleplaySessionFeedback[];
}

const WIDTH = 200;
const HEIGHT = 48;
const PADDING_X = 6;
const PADDING_Y = 8;
const END_DOT_RADIUS = 4;

/**
 * Minimal single-series trend line of compositeScore across evaluated
 * sessions, oldest to latest. Ordinal x-spacing (not time-scaled) — a
 * sparkline showing direction, not a calendar chart. Renders nothing below 2
 * points: one score has no trend to draw (same reasoning as the
 * insufficient_data skill-category threshold elsewhere on this screen).
 */
export const ScoreTrendSparkline: React.FC<ScoreTrendSparklineProps> = ({
  sessions,
}) => {
  const {t} = useTranslate();
  const scores = sessions
    .map(s => s.compositeScore)
    .filter((score): score is number => score !== null);

  if (scores.length < 2) return null;

  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_Y * 2;
  const points = scores.map((score, index) => {
    const x = PADDING_X + (index / (scores.length - 1)) * plotWidth;
    const y = PADDING_Y + (1 - score / 100) * plotHeight;
    return {x, y};
  });
  const last = points[points.length - 1];
  const latest = scores[scores.length - 1];
  const first = scores[0];

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={t('courses.progressDashboard.scoreTrendAlt', {
        first,
        latest,
        count: scores.length,
      })}>
      <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Polyline
          points={points.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={colors.ds.theme.primary}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={last.x}
          cy={last.y}
          r={END_DOT_RADIUS}
          fill={colors.ds.theme.primary}
          stroke={colors.white}
          strokeWidth={2}
        />
      </Svg>
      <Text style={styles.label}>
        {t('courses.progressDashboard.latestScore', {score: latest})}
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
