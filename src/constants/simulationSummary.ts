import {TFunction} from 'i18next';
import {ms} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {SkillCoverage} from '@/types';

export enum SimulationSummaryTabKey {
  SUMMARY = 'SUMMARY',
  DEBRIEF = 'DEBRIEF',
  TRANSCRIPTION = 'TRANSCRIPTION',
}

export interface FeedbackTabsConfig {
  debrief: boolean;
  transcript: boolean;
}

/**
 * Which post-session tabs a roleplay shows, when the backend response predates
 * the `feedbackTabs` toggles (or a cached one is in memory) — both default on,
 * matching the backend resolver and ally-web's fallback. A stable module-level
 * constant so it doesn't churn the `tabs` useMemo on every render.
 *
 * This used to carry `skills: true`, which disagreed with both the backend and
 * ally-web (each defaulted it off) — so a roleplay with no stored config, 31 of
 * 58 in the local seed, showed a Skills tab here and not on the web. The tab
 * was retired outright on 2026-08-31, which settles it.
 */
export const DEFAULT_FEEDBACK_TABS: FeedbackTabsConfig = {
  debrief: true,
  transcript: true,
};

export const getSimulationSummaryTabs = (
  t: TFunction,
  {
    shortSession,
    feedbackTabs = DEFAULT_FEEDBACK_TABS,
  }: {
    shortSession?: boolean;
    feedbackTabs?: FeedbackTabsConfig;
  },
) => {
  // Short sessions keep their own single-tab surface (Session Review, which
  // falls straight through to ShortSessionUI) — untouched by the Debrief
  // rework below.
  if (shortSession) {
    return [
      {
        key: SimulationSummaryTabKey.SUMMARY,
        title: t('postSim.tabs.sessionReview'),
        testID: 'tab-0',
      },
    ];
  }

  const debriefTab = {
    key: SimulationSummaryTabKey.DEBRIEF,
    title: t('postSim.tabs.debrief'),
    testID: 'tab-0',
  };
  const transcriptionTab = {
    key: SimulationSummaryTabKey.TRANSCRIPTION,
    title: t('postSim.tabs.transcript'),
    testID: 'tab-2',
  };

  // Exactly two tabs, one per toggle, matching ally-web. Skills Demonstrated
  // and the legacy "Up next" tab were both retired on 2026-08-31 — Skills had
  // been off platform-wide since 2026-08-24, and Up next only ever appeared
  // for legacy pathway/case sessions.
  const tabs = [
    ...(feedbackTabs.debrief ? [debriefTab] : []),
    ...(feedbackTabs.transcript ? [transcriptionTab] : []),
  ];

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
