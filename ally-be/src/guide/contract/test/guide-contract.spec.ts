import { execFileSync } from 'child_process';
import { join } from 'path';
import {
  GUIDE_CONTRACT_VERSION,
  GUIDE_EVENT_TYPES,
  GUIDE_ITEM_TYPE_VALUES,
} from '../generated/guide-contract';
import { TrackItemType } from 'src/track/type/track.type';

/**
 * Contract tests for the Ally guide wire format (plans/ally-guide/plan.md §9).
 * The schema is the source of truth; these keep the three generated copies
 * (ally-be, ally-web, ally-ai-learn) and the fixtures honest.
 */
const SCRIPT = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'guide-contract',
  'codegen.mjs',
);

const run = (flag: string): string =>
  execFileSync(process.execPath, [SCRIPT, flag], { encoding: 'utf8' });

describe('guide wire contract', () => {
  it('has generated files that match the schema in all three apps', () => {
    expect(() => run('--check')).not.toThrow();
  });

  it('accepts every valid fixture and rejects every invalid one', () => {
    expect(() => run('--validate-fixtures')).not.toThrow();
  });

  it('is version 1', () => {
    expect(GUIDE_CONTRACT_VERSION).toBe(1);
  });

  it('mirrors every Track 2.0 item type exactly', () => {
    expect([...GUIDE_ITEM_TYPE_VALUES].sort()).toEqual(
      Object.values(TrackItemType).sort(),
    );
  });

  it('names each event type once', () => {
    expect(new Set(GUIDE_EVENT_TYPES).size).toBe(GUIDE_EVENT_TYPES.length);
  });
});
