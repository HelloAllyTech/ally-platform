import { AgentBuilderChainInput } from 'src/learn/service/agent-builder-chain.service';
import { ExperienceMode } from 'src/learn/type/scenario.type';
import { RoleplayMode } from '../type/roleplay-brief.type';

/**
 * The main prompts that read authored states (`{state_x_guidelines}`), preferred first. States
 * written for a roleplay only run on one of these; on the default prompt they are dead weight.
 */
export const STATE_AWARE_MAIN_PROMPTS = [
  'ally_ai_learn_system_main_agent_prompt_full',
  'ally_ai_learn_system_main_agent_prompt_working_memory_split',
];

/** Band width per mode: wider bands mean more helpful turns per state, i.e. harder (a manual dial). */
const BAND_BY_MODE: Record<RoleplayMode, number> = {
  learning: 50,
  practice: 70,
  performance: 100,
  pre_assessment: 100,
  post_assessment: 100,
};

const RUPTURE = {
  name: 'Pulling away',
  guidelines:
    'You feel judged, rushed or not listened to. Give shorter answers, change the subject or say ' +
    'you should go. Open up again only if the helper slows down, acknowledges what went wrong ' +
    'and listens.',
};

/**
 * Scaffolding for a roleplay's mode, from the Course Design Manual and the plan's answers:
 * - learning: everything on — reminders, the character's state visible, AI supervisor notes;
 * - practice: one support faded (no supervisor notes), reminders and state still shown;
 * - performance and assessment: no supports, experience mode None.
 * Learning and practice use the Feedback experience mode for now: the Checklist mode lists a
 * roleplay's anchor events, and Copilot does not create events yet, so a checklist would be empty.
 */
export function roleplayDesignForMode(
  mode: RoleplayMode,
  statePromptCode: string | null,
): NonNullable<AgentBuilderChainInput['design']> {
  const supported = mode === 'learning' || mode === 'practice';
  return {
    ...(statePromptCode
      ? { states: { bandWidth: BAND_BY_MODE[mode] ?? 70, rupture: RUPTURE } }
      : {}),
    settings: {
      experienceMode: supported ? ExperienceMode.FEEDBACK : ExperienceMode.NONE,
      remindersEnabled: supported,
      currentState: supported,
      supervisorNotesEnabled: mode === 'learning',
      ...(statePromptCode ? { selectedMainPromptCode: statePromptCode } : {}),
    },
  };
}
