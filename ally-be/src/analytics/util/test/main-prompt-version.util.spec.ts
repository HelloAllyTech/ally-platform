import {
  DEFAULT_MAIN_AGENT_PROMPT_CODE,
  mainPromptHash,
  mainPromptVersion,
} from '../main-prompt-version.util';

describe('main prompt version and hash from a session record', () => {
  const versions = {
    [DEFAULT_MAIN_AGENT_PROMPT_CODE]: 2,
    ally_ai_learn_system_main_agent_prompt_copy_x1: 7,
    ally_ai_learn_system_main_agent_prompt_full: 5,
  };
  const hashes = {
    [DEFAULT_MAIN_AGENT_PROMPT_CODE]: 'h-default',
    ally_ai_learn_system_main_agent_prompt_full: 'h-full',
  };

  it('uses the selected prompt, not a guess by name', () => {
    expect(
      mainPromptVersion(versions, 'ally_ai_learn_system_main_agent_prompt_full'),
    ).toBe('5');
    expect(
      mainPromptHash(hashes, 'ally_ai_learn_system_main_agent_prompt_full'),
    ).toBe('h-full');
  });

  it('falls back to the default main prompt when none is selected', () => {
    expect(mainPromptVersion(versions, null)).toBe('2');
    expect(mainPromptHash(hashes, null)).toBe('h-default');
  });

  it('never picks a duplicated variant for an old session without the default', () => {
    expect(
      mainPromptVersion(
        {
          ally_ai_learn_system_main_agent_prompt_copy_x1: 7,
          ally_ai_learn_system_main_agent_prompt_full: 5,
        },
        undefined,
      ),
    ).toBe('5');
  });

  it('has no hash for a session recorded before hashes existed', () => {
    expect(mainPromptHash(null, null)).toBeNull();
  });
});
