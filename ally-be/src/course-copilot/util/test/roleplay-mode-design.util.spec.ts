import { ExperienceMode } from 'src/learn/type/scenario.type';
import { roleplayDesignForMode } from '../roleplay-mode-design.util';

const PROMPT = 'ally_ai_learn_system_main_agent_prompt_full';

describe('roleplayDesignForMode (scaffolding by mode)', () => {
  it('learning: every support on, narrow bands, the state-aware prompt', () => {
    const design = roleplayDesignForMode('learning', PROMPT);
    expect(design.states?.bandWidth).toBe(50);
    expect(design.states?.rupture.name).toBeTruthy();
    expect(design.settings).toEqual({
      experienceMode: ExperienceMode.FEEDBACK,
      remindersEnabled: true,
      currentState: true,
      supervisorNotesEnabled: true,
      selectedMainPromptCode: PROMPT,
    });
  });

  it('practice: one support faded, wider bands', () => {
    const design = roleplayDesignForMode('practice', PROMPT);
    expect(design.states?.bandWidth).toBe(70);
    expect(design.settings).toMatchObject({
      remindersEnabled: true,
      currentState: true,
      supervisorNotesEnabled: false,
    });
  });

  it.each(['performance', 'pre_assessment', 'post_assessment'] as const)(
    '%s: no supports, experience mode None',
    (mode) => {
      const design = roleplayDesignForMode(mode, PROMPT);
      expect(design.states?.bandWidth).toBe(100);
      expect(design.settings).toMatchObject({
        experienceMode: ExperienceMode.NONE,
        remindersEnabled: false,
        currentState: false,
        supervisorNotesEnabled: false,
      });
    },
  );

  it('without a state-aware prompt: no states, and the default prompt stays', () => {
    const design = roleplayDesignForMode('practice', null);
    expect(design.states).toBeUndefined();
    expect(design.settings).not.toHaveProperty('selectedMainPromptCode');
  });
});
