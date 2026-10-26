import { PROMPT_CONTRACTS } from '../../contracts';
import { PINNED_PROMPTS } from '../pinned-prompts.constants';

describe('PINNED_PROMPTS', () => {
  // Plain strings by design (the prompts module reads this file), so a renamed
  // Builder prompt would silently stop being pinned without this check.
  it.each(
    [...PINNED_PROMPTS.keys()].filter((code) => code.startsWith('builder_')),
  )('%s is a declared ally-be prompt', (code) => {
    expect(PROMPT_CONTRACTS[code]).toBeDefined();
  });
});
