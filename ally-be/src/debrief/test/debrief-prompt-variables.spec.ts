import { readFileSync } from 'fs';
import { join } from 'path';
import { PROMPT_CONTRACTS } from '../../prompt/contracts';
import { toStoreContract } from '../../prompt/contracts/define-prompt';
import {
  checkContract,
  placeholdersIn,
} from '../../prompt/util/prompt-contract.util';

/**
 * Step 5 (2026-11-16): each Debrief prompt that gets runtime data declares
 * every `{{name}}` it uses, its default uses exactly those, and the
 * safety-critical ones are required, so the Skills Store refuses a version
 * that drops them (422 SKILLS_STORE_CONTRACT_VIOLATION).
 */
const FILES: Record<string, string> = {
  debrief_safety_reader_system: 'debrief/safety_reader_system.txt',
  debrief_analyst_system: 'debrief/analyst_system.txt',
  debrief_progress_reader_system: 'debrief/progress_reader_system.txt',
  debrief_progress_system: 'debrief/progress_system.txt',
  debrief_writer_system: 'debrief/writer_system.txt',
  debrief_reviser_system: 'debrief/reviser_system.txt',
  debrief_quality_rubric: 'debrief_quality/rubric.txt',
  debrief_evaluator_fix_system: 'debrief/evaluator_fix_system.txt',
  debrief_planner_system: 'debrief/planner_system.txt',
  debrief_protocol_check_system: 'debrief/protocol_check_system.txt',
  debrief_history_deep_system: 'debrief/history_deep_system.txt',
  debrief_language_specialist_system: 'debrief/language_specialist_system.txt',
  debrief_reply_system: 'debrief/reply_system.txt',
};

const REQUIRED: Record<string, string[]> = {
  debrief_safety_reader_system: ['risk_cue_definition', 'transcript'],
  debrief_analyst_system: ['transcript'],
  debrief_writer_system: [
    'risk_cue_definition',
    'risk_cue_turns',
    'safety_reading',
    'transcript',
  ],
  debrief_reviser_system: [
    'risk_cue_definition',
    'risk_cue_turns',
    'transcript',
  ],
  debrief_quality_rubric: ['debrief', 'risk_cue_definition', 'transcript'],
  debrief_protocol_check_system: ['findings_rules', 'transcript'],
  debrief_language_specialist_system: ['findings_rules', 'transcript'],
  debrief_reply_system: ['debrief', 'reply_word_limit', 'transcript'],
};

const read = (f: string) =>
  readFileSync(join(__dirname, '../../prompts', f), 'utf8');

describe('Debrief prompt variables', () => {
  it.each(Object.entries(FILES))(
    '%s: the default uses exactly the declared variables, data last',
    (code, file) => {
      const text = read(file);
      const declared = Object.keys(PROMPT_CONTRACTS[code].variables).sort();
      expect(placeholdersIn(text)).toEqual(declared);
      expect(
        checkContract(text, toStoreContract(PROMPT_CONTRACTS[code])),
      ).toBeNull();
      // The fixed wording first: nothing before the first placeholder is data.
      const first = text.indexOf('{{');
      expect(text.slice(first)).not.toMatch(/\n[A-Z]{2,}[A-Z ]*\. [A-Z]/);
    },
  );

  it.each(Object.entries(REQUIRED))(
    '%s: the safety-critical variables are required',
    (code, required) => {
      const contract = toStoreContract(PROMPT_CONTRACTS[code]);
      expect([...(contract.required ?? [])].sort()).toEqual(
        expect.arrayContaining(required),
      );
      const text = read(FILES[code]);
      for (const name of required) {
        const without = text.split(`{{${name}}}`).join('');
        expect(checkContract(without, contract)?.missing).toEqual([name]);
      }
    },
  );
});
