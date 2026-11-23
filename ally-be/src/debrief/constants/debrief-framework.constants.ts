/**
 * Skill frameworks (spec DEBRIEF_ACROSS_ROLEPLAYS §4): the skills the Debrief assesses on top of a
 * roleplay's own competencies and behaviours. A framework is only ever an entry in the Context
 * Library's Debrief Guidance collection (`facets.kind = skill_framework`); nothing about any
 * framework, including the foundational helping skills, is hardcoded here, so a person can edit or
 * delete an entry with no deploy.
 */

/** The Debrief Guidance `kind` that marks a skill framework. */
export const SKILL_FRAMEWORK_KIND = 'skill_framework';

export interface DebriefSkill {
  key: string;
  name: string;
}

export interface DebriefArea {
  name: string;
  description: string;
}

export interface DebriefSkillFramework {
  /** The Context Library code when exactly one entry applies; null for none or several. */
  id: string | null;
  /** Every Context Library code the framework was merged from. */
  ids: string[];
  name: string;
  /** The Foundational Skills levels (a separate assessment) apply to this framework. */
  foundational: boolean;
  skills: DebriefSkill[];
  /** The chart areas a behaviour is tagged with; none means no coverage chart. */
  areas: DebriefArea[];
}

/** No framework: only the roleplay's own competencies and behaviours are assessed. */
export const emptyFramework = (): DebriefSkillFramework => ({
  id: null,
  ids: [],
  name: '',
  foundational: false,
  skills: [],
  areas: [],
});
