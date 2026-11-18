import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_ACCESS,
  DATA_ITEMS,
  DEBRIEF_DATA_ACCESS,
  PM_AGENT_ACCESS,
} from '../constants/debrief-data-access.constants';

const MIRROR = path.resolve(
  __dirname,
  '../../../../docs/debrief-harness/data-access.json',
);

describe('the declared Debrief data access', () => {
  it('names only data items that exist, and each item is used by someone', () => {
    const keys = new Set(DATA_ITEMS.map((d) => d.key));
    expect(keys.size).toBe(DATA_ITEMS.length);
    const used = new Set<string>();
    for (const a of AGENT_ACCESS) {
      for (const [bodyKey, item] of Object.entries(a.body)) {
        if (item !== null) {
          expect(keys.has(item)).toBe(true);
          used.add(item);
        }
        // A conditional key must be a key the agent really has.
        if (a.when?.[bodyKey]) expect(bodyKey in a.body).toBe(true);
      }
      for (const k of Object.keys(a.when ?? {})) expect(k in a.body).toBe(true);
    }
    for (const k of keys) expect(used.has(k)).toBe(true);
  });

  it('keeps personal and other learners’ data owner-only, never a setting the PM agent can change', () => {
    for (const d of DATA_ITEMS) {
      if (d.group === 'the learner' || d.group === 'other learners') {
        expect(d.control).toBe('owner');
      }
    }
    // Only the roleplay brief is a setting today.
    expect(
      DATA_ITEMS.filter((d) => d.control === 'setting').map((d) => d.key),
    ).toEqual(['roleplay_brief']);
  });

  it('lists the PM agent’s tools once each, and none reads a transcript', () => {
    const names = PM_AGENT_ACCESS.map((t) => t.tool);
    expect(new Set(names).size).toBe(names.length);
    for (const t of PM_AGENT_ACCESS) {
      if (t.kind === 'read')
        expect(t.reads.toLowerCase()).not.toMatch(/^transcript/);
    }
  });

  it('is identical to the JSON mirror ally-ai checks against its wiring (UPDATE_DATA_ACCESS=1 rewrites it)', () => {
    const current = JSON.parse(JSON.stringify(DEBRIEF_DATA_ACCESS));
    if (process.env.UPDATE_DATA_ACCESS === '1') {
      fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
      fs.writeFileSync(MIRROR, JSON.stringify(current, null, 2) + '\n');
    }
    expect(JSON.parse(fs.readFileSync(MIRROR, 'utf8'))).toEqual(current);
  });
});
