import {TFunction} from 'i18next';
import {ms} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {SkillCoverage} from '@/types';

export enum SimulationSummaryTabKey {
  SUMMARY = 'SUMMARY',
  ASK_AI = 'ASK_AI',
  TRANSCRIPTION = 'TRANSCRIPTION',
  SKILLS = 'SKILLS',
  REFLECTION = 'REFLECTION',
  UP_NEXT = 'UP_NEXT',
}

export const getSimulationSummaryTabs = (
  t: TFunction,
  {
    pathId,
    caseId,
    postSimulationNewTabs,
  }: {pathId?: string; caseId?: string; postSimulationNewTabs?: boolean},
) => {
  const tabs = [
    {
      key: SimulationSummaryTabKey.SUMMARY,
      title: t('SimulationFeedback.tabs.sessionReview'),
      testID: 'tab-0',
    },
    ...(postSimulationNewTabs
      ? [
          {
            key: SimulationSummaryTabKey.ASK_AI,
            title: t('SimulationFeedback.tabs.askAI'),
            testID: 'tab-1',
          },
        ]
      : []),
    {
      key: SimulationSummaryTabKey.TRANSCRIPTION,
      title: t('SimulationFeedback.tabs.annotatedTranscript'),
      testID: 'tab-2',
    },
    ...(postSimulationNewTabs
      ? [
          {
            key: SimulationSummaryTabKey.SKILLS,
            title: t('SimulationFeedback.tabs.skillsDemonstrated'),
            testID: 'tab-3',
          },
          {
            key: SimulationSummaryTabKey.REFLECTION,
            title: t('SimulationFeedback.tabs.deeperReflection'),
            testID: 'tab-4',
          },
        ]
      : []),
  ];

  if (pathId || caseId) {
    tabs.push({
      key: SimulationSummaryTabKey.UP_NEXT,
      title: t('SimulationFeedback.tabs.upNext'),
      testID: 'tab-5',
    });
  }

  return tabs;
};

export const EMOTIONAL_MOVEMENT_CHART_CONFIG = {
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

/**
 * Skill progress bar colors cycling in order per Figma design.
 * Colors are applied by index (index % SKILL_COLORS.length), so any number of
 * skills from the backend will always use one of these three colors.
 */
export const SKILL_COLORS = [
  colors.ds.deepPurple[300],
  colors.ds.green[300],
  colors.ds.orange[300],
] as const;

// SKILL COVERAGE FALLBACK DATA
export const DEFAULT_SKILL_COVERAGE: SkillCoverage[] = [
  {category: 'Learning', percentage: 0, iconUrl: ''},
  {category: 'Support', percentage: 0, iconUrl: ''},
  {category: 'Standards', percentage: 0, iconUrl: ''},
];

// Y axis values are from -5 to 5. This data set is to show when theres no data.
// -6 is given to Y axis values so that the chart is visible but empty.
// Empty charts shows 'NO DATA FOUND' message.
export const DEFAULT_DATA_POINTS = [
  {x: 0, y: -6},
  {x: 120, y: -6},
  {x: 24, y: -6},
  {x: 36, y: -6},
  {x: 48, y: -6},
];

export const NUM_X_AXIS_INTERVALS = 4;

export const NUM_Y_AXIS_INTERVALS = 4;
