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
    },
    ...(postSimulationNewTabs
      ? [
          {
            key: SimulationSummaryTabKey.ASK_AI,
            title: t('SimulationFeedback.tabs.askAI'),
          },
        ]
      : []),
    {
      key: SimulationSummaryTabKey.TRANSCRIPTION,
      title: t('SimulationFeedback.tabs.annotatedTranscript'),
    },
    ...(postSimulationNewTabs
      ? [
          {
            key: SimulationSummaryTabKey.SKILLS,
            title: t('SimulationFeedback.tabs.skillsDemonstrated'),
          },
          {
            key: SimulationSummaryTabKey.REFLECTION,
            title: t('SimulationFeedback.tabs.deeperReflection'),
          },
        ]
      : []),
  ];

  if (pathId || caseId) {
    tabs.push({
      key: SimulationSummaryTabKey.UP_NEXT,
      title: t('SimulationFeedback.tabs.upNext'),
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

export const SKILL_CATEGORY_COLOR_MAP: Record<string, string> = {
  Learning: colors.ds.blue[300],
  Support: colors.ds.green[400],
  Standards: colors.ds.amber[400],
};

export const DEFAULT_SKILL_COLOR = colors.ds.blue[300];

// SKILL COVERAGE FALLBACK DATA
export const DEFAULT_SKILL_COVERAGE: SkillCoverage[] = [
  {category: 'Learning', percentage: 0, iconUrl: ''},
  {category: 'Support', percentage: 0, iconUrl: ''},
  {category: 'Standards', percentage: 0, iconUrl: ''},
];
