import { DEBRIEF_HEAVY_ROLEPLAY_SKILL } from './debrief-heavy-roleplay.skill';
import { EXPLAIN_CORE_HELPING_SKILLS_SKILL } from './explain-core-helping-skills.skill';
import { GuideSkill } from './guide-skill';
import { ORG_PROTOCOL_SKILL } from './org-protocol.skill';
import { SUPPORT_AFTER_A_HARD_CALL_SKILL } from './support-after-a-hard-call.skill';
import { VOICE_CONVERSATION_STYLE_SKILL } from './voice-conversation-style.skill';

/** The initial skill set (plan §7.6). Later skills come through releases. */
export const GUIDE_DEFAULT_SKILLS: GuideSkill[] = [
  DEBRIEF_HEAVY_ROLEPLAY_SKILL,
  SUPPORT_AFTER_A_HARD_CALL_SKILL,
  EXPLAIN_CORE_HELPING_SKILLS_SKILL,
  VOICE_CONVERSATION_STYLE_SKILL,
  ORG_PROTOCOL_SKILL,
];

export const GUIDE_SKILL_IDS: string[] = GUIDE_DEFAULT_SKILLS.map(
  (skill) => skill.id,
);

/** What a release freezes of a skill. */
export type GuideSkillDef = Omit<GuideSkill, 'id'>;

export const GUIDE_DEFAULT_SKILL_DEFS: Record<string, GuideSkillDef> =
  Object.fromEntries(GUIDE_DEFAULT_SKILLS.map(({ id, ...def }) => [id, def]));

/**
 * The skills a release enables, with their frozen text. A release written
 * before skills existed enables none; an id enabled without frozen text
 * falls back to the code default, and an unknown id is ignored.
 */
export function enabledSkills(bundle: {
  skills?: Record<string, boolean>;
  skillDefs?: Record<string, GuideSkillDef>;
}): GuideSkill[] {
  const out: GuideSkill[] = [];
  for (const [id, on] of Object.entries(bundle.skills ?? {})) {
    if (!on) continue;
    const def = bundle.skillDefs?.[id] ?? GUIDE_DEFAULT_SKILL_DEFS[id];
    if (def) out.push({ id, ...def });
  }
  return out;
}

/** The skill index for S1: one line per skill. Empty when none is enabled. */
export function skillIndex(skills: GuideSkill[]): string {
  if (!skills.length) return '';
  return [
    '# Skills',
    'Load one with load_skill when the moment matches it, and follow it for that moment. Do not load a skill you already loaded in this conversation; its instructions are still above.',
    ...skills.map((skill) => `- ${skill.id}: ${skill.whenToUse}`),
  ].join('\n');
}
