import { FHS_RUBRIC } from '../../foundational-skills/constants/helping-skills-rubric.constants';

/**
 * Skill frameworks (spec DEBRIEF_ACROSS_ROLEPLAYS §4): the skills the Debrief assesses on top of a
 * roleplay's own competencies and behaviours. A framework is an entry in the Context Library's
 * Debrief Guidance collection (`facets.kind = skill_framework`); the 14 foundational helping
 * skills are the first entry, the default, and also the built-in fallback below, so a debrief is
 * never blocked by a framework that cannot be read.
 */

/** The Debrief Guidance `kind` that marks a skill framework. */
export const SKILL_FRAMEWORK_KIND = 'skill_framework';

/** The roleplay field value for "no framework": only the roleplay's own competencies. */
export const NO_FRAMEWORK_ID = 'none';

/** The Context Library statement of the built-in framework's entry. */
export const FOUNDATIONAL_FRAMEWORK_NAME = 'Foundational helping skills';

export interface DebriefSkill {
  key: string;
  name: string;
  /** Words that identify the skill when the Analyst names it loosely (matched at word starts). */
  words: string[];
}

export interface DebriefArea {
  name: string;
  description: string;
}

export interface DebriefSkillFramework {
  /** The Context Library code (e.g. `DG-0210`); null for the built-in fallback and "none". */
  id: string | null;
  name: string;
  /** The Foundational Skills levels (a separate assessment) apply to this framework. */
  foundational: boolean;
  skills: DebriefSkill[];
  /** The chart areas a behaviour is tagged with; none means no coverage chart. */
  areas: DebriefArea[];
}

/**
 * Words that identify each foundational skill in a loosely named behaviour. The first skill with a
 * matching word wins, so narrow skills come before the broad "verbal communication".
 */
const FOUNDATIONAL_WORDS: Array<[string, string[]]> = [
  [
    'harm',
    [
      'harm',
      'suicid',
      'self-harm',
      'self harm',
      'risk',
      'safety plan',
      'response plan',
    ],
  ],
  ['confidentiality', ['confidential', 'privacy']],
  ['feelings', ['feeling', 'emotion', 'normalis', 'normaliz', 'validat']],
  ['empathy', ['empath', 'warmth', 'genuine']],
  [
    'rapport',
    [
      'rapport',
      'self-disclos',
      'self disclos',
      'trust-build',
      'trust build',
      'building trust',
    ],
  ],
  [
    'functioning',
    [
      'function',
      'daily life',
      'impact on life',
      'impact on their life',
      'impact on the client',
    ],
  ],
  [
    'explanation',
    [
      'explanation',
      "client's understanding",
      "client's view",
      "client's beliefs",
      "client's own understanding",
    ],
  ],
  [
    'family',
    [
      'family',
      'significant other',
      'loved one',
      'support system',
      'support network',
      'social support',
    ],
  ],
  ['goals', ['goal']],
  ['hope', ['hope', 'optimis']],
  [
    'coping',
    [
      'coping',
      'prior solution',
      'what helped',
      'what has helped',
      'worked before',
    ],
  ],
  [
    'psychoeducation',
    ['psychoeducation', 'psycho-education', 'psycho education'],
  ],
  ['feedback', ['feedback']],
  [
    'verbal',
    [
      'verbal',
      'open-ended',
      'open ended',
      'open question',
      'reflect',
      'paraphras',
      'summar',
      'active listening',
      'listening',
      'clarif',
    ],
  ],
];

/** The three areas today's debrief reports; kept by name so charts continue across the cutover. */
export const FOUNDATIONAL_AREAS: DebriefArea[] = [
  {
    name: 'Listening Engagement',
    description: 'listening and engaging with what the character said',
  },
  {
    name: 'Emotional Attunement',
    description: "recognising and responding to the character's emotions",
  },
  {
    name: 'Supportive Engagement',
    description: 'offering support and a safe, non-judgmental space',
  },
];

/** The built-in framework: the 14 foundational helping skills (the Context Library entry's twin). */
export const FOUNDATIONAL_FRAMEWORK: DebriefSkillFramework = {
  id: null,
  name: FOUNDATIONAL_FRAMEWORK_NAME,
  foundational: true,
  // Matching order: narrow skills first, the broad "verbal communication" last, as the
  // Analyst's loosely named behaviours have always been keyed.
  skills: FOUNDATIONAL_WORDS.flatMap(([key, words]) => {
    const skill = FHS_RUBRIC.find((s) => s.key === key);
    return skill ? [{ key: skill.key, name: skill.name, words }] : [];
  }),
  areas: FOUNDATIONAL_AREAS,
};

/** "None": the Debrief assesses only the roleplay's own competencies and behaviours. */
export const NO_FRAMEWORK: DebriefSkillFramework = {
  id: null,
  name: 'None',
  foundational: false,
  skills: [],
  areas: [],
};
