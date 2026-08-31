import {TFunction} from 'i18next';
import {ms} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';
import {SkillCoverage} from '@/types';

export enum SimulationSummaryTabKey {
  SUMMARY = 'SUMMARY',
  DEBRIEF = 'DEBRIEF',
  TRANSCRIPTION = 'TRANSCRIPTION',
  SKILLS = 'SKILLS',
  UP_NEXT = 'UP_NEXT',
}

export interface FeedbackTabsConfig {
  debrief: boolean;
  skills: boolean;
  transcript: boolean;
}

/**
 * Which post-session tabs a roleplay shows, when the backend response
 * predates the `feedbackTabs` sub-toggle (or a cached one is in memory) —
 * every tab defaults on, matching ally-web's PostSimulationSummary fallback.
 * A stable module-level constant so it doesn't churn the `tabs` useMemo on
 * every render.
 */
export const DEFAULT_FEEDBACK_TABS: FeedbackTabsConfig = {
  debrief: true,
  skills: true,
  transcript: true,
};

export const getSimulationSummaryTabs = (
  t: TFunction,
  {
    pathId,
    caseId,
    shortSession,
    feedbackTabs = DEFAULT_FEEDBACK_TABS,
  }: {
    pathId?: string;
    caseId?: string;
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
  const skillsTab = {
    key: SimulationSummaryTabKey.SKILLS,
    title: t('postSim.tabs.skillsDemonstrated'),
    testID: 'tab-1',
  };
  const transcriptionTab = {
    key: SimulationSummaryTabKey.TRANSCRIPTION,
    title: t('postSim.tabs.transcript'),
    testID: 'tab-2',
  };

  // Debrief → Skills → Transcript → Up Next, matching ally-web: the note is
  // what the learner came back for, so it leads. Each sub-toggle can
  // independently hide its own tab.
  const tabs = [
    ...(feedbackTabs.debrief ? [debriefTab] : []),
    ...(feedbackTabs.skills ? [skillsTab] : []),
    ...(feedbackTabs.transcript ? [transcriptionTab] : []),
  ];

  if (pathId || caseId) {
    tabs.push({
      key: SimulationSummaryTabKey.UP_NEXT,
      title: t('postSim.tabs.upNext'),
      testID: 'tab-3',
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
