import { AgentBuilderChainInput } from 'src/learn/service/agent-builder-chain.service';
import { ExperienceMode } from 'src/learn/type/scenario.type';
import {
  roleplaySettingsForMode,
  stateDesignForMode,
  STATE_AWARE_MAIN_PROMPTS,
} from 'src/learn/util/roleplay-design.util';
import { RoleplayMode } from '../type/roleplay-brief.type';

export { STATE_AWARE_MAIN_PROMPTS };

/**
 * Course Copilot's design for a new roleplay of this mode: the shared mode rules
 * (src/learn/util/roleplay-design.util.ts, also used by Studio's Agent Builder wizard) in the
 * shape AgentBuilderChainService takes. No state-aware main prompt means no states.
 */
export function roleplayDesignForMode(
  mode: RoleplayMode,
  statePromptCode: string | null,
): NonNullable<AgentBuilderChainInput['design']> {
  const settings = roleplaySettingsForMode(mode, statePromptCode);
  return {
    ...(statePromptCode ? { states: stateDesignForMode(mode) } : {}),
    settings: {
      ...settings,
      experienceMode:
        settings.experienceMode === 'FEEDBACK'
          ? ExperienceMode.FEEDBACK
          : ExperienceMode.NONE,
    },
  };
}
