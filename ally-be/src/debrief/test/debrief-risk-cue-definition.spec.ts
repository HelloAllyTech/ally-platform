import { readFileSync } from 'fs';
import { join } from 'path';
import { PINNED_PROMPTS } from '../../prompt/constants/pinned-prompts.constants';
import { DEBRIEF_RISK_CUE_DEFINITION } from '../../prompt/contracts/prompt-contracts';
import { DEBRIEF_PROMPT_CODES } from '../constants/debrief-release.constants';
import { PINNED_RULE_CODES } from '../util/debrief-console-view.util';
import { promptEditRefusal } from '../util/debrief-pm-agent-rules.util';

/**
 * One editable definition of a clear and a possible risk cue (2026-11-16): a
 * pinned Skills Store prompt the Safety reader, Writer, Reviser, Evaluator and
 * judge all read, so a clinical lead changes it in one place, with sign-off.
 */
describe('debrief_risk_cue_definition', () => {
  const code = DEBRIEF_PROMPT_CODES.riskCueDefinition;

  it('is a declared prompt with a default text', () => {
    expect(code).toBe('debrief_risk_cue_definition');
    expect(DEBRIEF_RISK_CUE_DEFINITION).toBeDefined();
    const seed = readFileSync(
      join(__dirname, '../../prompts/debrief/risk_cue_definition.txt'),
      'utf8',
    );
    expect(seed).toContain('A clear risk cue is');
    expect(seed).toContain('A possible risk cue is');
    expect(seed).toContain('you cannot tell, it is a clear risk cue');
  });

  it('is pinned, a pinned rule in the Console, and on the Debrief PM agent never-list', () => {
    expect(PINNED_PROMPTS.get(code)).toBe('guard');
    expect(PINNED_RULE_CODES.has(code)).toBe(true);
    expect(promptEditRefusal(code, 'a', 'b', 'a')?.neverList).toBe('safety');
  });

  it('the prompts that read it point to it instead of repeating it', () => {
    const read = (f: string) =>
      readFileSync(join(__dirname, '../../prompts', f), 'utf8');
    for (const f of [
      'debrief/writer_system.txt',
      'debrief/reviser_system.txt',
      'debrief/safety_reader_system.txt',
      'debrief_quality/rubric.txt',
    ]) {
      expect(read(f)).toContain('RISK CUE DEFINITION');
    }
    expect(read('debrief/writer_system.txt')).not.toContain(
      'wishing they could disappear',
    );
    expect(read('debrief_quality/rubric.txt')).toContain(
      'missed_risk_cue: the client voiced a clear risk cue',
    );
  });
});
