import * as fs from 'fs';
import * as path from 'path';
import { PROMPT_CONTRACTS } from '../prompt-contracts';
import {
  definePrompt,
  missingInputs,
  PromptInputs,
  toStoreContract,
} from '../define-prompt';
import { checkContract } from '../../util/prompt-contract.util';

const PROMPTS_DIR = path.join(__dirname, '../../../prompts');

/** Every default under src/prompts, by the code sync gives it. */
function defaults(): Array<{ code: string; file: string; text: string }> {
  const out: Array<{ code: string; file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '_meta') walk(full);
      } else if (entry.name.endsWith('.txt')) {
        const rel = path.relative(PROMPTS_DIR, full).replace(/\.txt$/, '');
        out.push({
          code: rel.replace(/[/\\]/g, '_'),
          file: `src/prompts/${rel}.txt`,
          text: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(PROMPTS_DIR);
  return out;
}

describe('prompt contracts', () => {
  const files = defaults();

  it('declares a contract for every default in src/prompts, and none for a missing one', () => {
    const codes = new Set(files.map((f) => f.code));
    expect(
      files.filter((f) => !PROMPT_CONTRACTS[f.code]).map((f) => f.file),
    ).toEqual([]);
    expect(Object.keys(PROMPT_CONTRACTS).filter((c) => !codes.has(c))).toEqual(
      [],
    );
  });

  it.each(defaults().map((f) => [f.file, f]))(
    '%s satisfies its contract',
    (_file, f) => {
      const contract = toStoreContract(PROMPT_CONTRACTS[f.code]);
      expect(checkContract(f.text, contract)).toBeNull();
    },
  );
});

describe('definePrompt', () => {
  const GREETING = definePrompt(
    'greeting',
    { name: 'required', mood: 'optional' },
    { open: false, contractVersion: 2 },
  );

  it('gives the call site a typed input: required keys must be passed', () => {
    const ok: PromptInputs<typeof GREETING> = { name: 'Asha' };
    // @ts-expect-error — `name` is required by the contract.
    const missing: PromptInputs<typeof GREETING> = { mood: 'calm' };
    expect(ok.name).toBe('Asha');
    expect(missing.mood).toBe('calm');
  });

  it('produces the contract the store enforces', () => {
    expect(toStoreContract(GREETING)).toEqual({
      variables: ['mood', 'name'],
      required: ['name'],
      contractVersion: 2,
    });
    expect(
      toStoreContract(definePrompt('open_one', { a: 'required' })).variables,
    ).toBeNull();
  });

  it('names required inputs a call site left out', () => {
    expect(missingInputs(GREETING, { mood: 'x' })).toEqual(['name']);
    expect(missingInputs(GREETING, { name: 'A' })).toEqual([]);
  });
});
