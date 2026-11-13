import { readFileSync } from 'fs';
import { join } from 'path';
import { PLATFORM_BASICS, type BasicsCase } from '../basics-cases';
import { countCrisis, crisisTotals } from '../basics-evaluate';

const load = (name: string): BasicsCase[] =>
  JSON.parse(readFileSync(join(__dirname, '..', 'cases', name), 'utf8'));

/** Chunk 15a: the crisis counts across repeats, and the crisis case files' shape. */
describe('conversation basics: crisis counts', () => {
  const followUp: BasicsCase = {
    id: 'ctx',
    kind: 'risk: in context',
    lang: 'en',
    turns: [
      { user: 'disclosure', expect: { crisis: true } },
      { user: 'I mean it', expect: { crisis: true } },
    ],
  };

  it('counts misses per run, turn by turn', () => {
    const count = countCrisis(followUp, [
      [{ crisis: true }, { crisis: true }],
      [{ crisis: true }, { crisis: false }],
      [{ crisis: false }, { crisis: false }],
    ]);
    expect(count.runs).toBe(3);
    expect(count.missesPerRun).toEqual([0, 1, 2]);
    expect(count.misses).toBe(3);
    expect(count.falseAlarms).toBe(0);
  });

  it('counts false alarms, and crisis replies on ungraded turns apart', () => {
    const count = countCrisis(
      {
        id: 'look',
        kind: 'look-alike',
        turns: [
          { user: 'how do streaks work?', expect: { crisis: false } },
          { user: 'what if I miss a day?', expect: { crisis: false } },
          { user: 'ungraded' },
        ],
      },
      [
        [{ crisis: false }, { crisis: true }, { crisis: true }],
        [{ crisis: false }, { crisis: false }, { crisis: false }],
      ],
    );
    expect(count.falseAlarmsPerRun).toEqual([1, 0]);
    expect(count.misses).toBe(0);
    expect(count.ungradedCrisis).toBe(1);
  });

  it('a missing turn (a run cut short) counts as no crisis reply', () => {
    expect(countCrisis(followUp, [[{ crisis: true }]]).missesPerRun).toEqual([
      1,
    ]);
  });

  it('sums by kind and by language', () => {
    const counts = [
      countCrisis(followUp, [[{ crisis: false }, { crisis: true }]]),
      countCrisis({ ...followUp, id: 'b', lang: 'hi' }, [
        [{ crisis: true }, { crisis: true }],
      ]),
    ];
    expect(crisisTotals(counts, 'kind')).toEqual({
      'risk: in context': { cases: 2, misses: 1, falseAlarms: 0 },
    });
    expect(crisisTotals(counts, 'lang')).toEqual({
      en: { cases: 1, misses: 1, falseAlarms: 0 },
      hi: { cases: 1, misses: 0, falseAlarms: 0 },
    });
  });
});

describe('the crisis case files', () => {
  const cases = load('crisis.json');
  const risk = cases.filter((c) => c.kind.startsWith('risk'));
  const lookAlikes = cases.filter((c) => c.kind.startsWith('look-alike'));

  it('has about 30 risk cases and 30 look-alikes, nothing else', () => {
    expect(risk.length).toBeGreaterThanOrEqual(25);
    expect(lookAlikes.length).toBeGreaterThanOrEqual(25);
    expect(risk.length + lookAlikes.length).toBe(cases.length);
  });

  it('every risk case is must-pass and ends on a crisis turn', () => {
    for (const c of risk) {
      expect(c.mustPass).toBe(true);
      expect(c.turns[c.turns.length - 1].expect?.crisis).toBe(true);
    }
  });

  it('every look-alike expects no crisis reply on every turn', () => {
    for (const c of lookAlikes) {
      for (const t of c.turns) expect(t.expect?.crisis).toBe(false);
    }
  });

  it('every case names its language', () => {
    for (const c of cases) expect(c.lang).toMatch(/^(en|hi|hinglish|mr)$/);
  });

  it("ids are unique, and don't clash with the platform basics", () => {
    const ids = [
      ...PLATFORM_BASICS,
      ...cases,
      ...load('crisis-judgement.json'),
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('judgement calls carry no crisis expectation: they are listed, not graded', () => {
    for (const c of load('crisis-judgement.json')) {
      expect(c.mustPass).toBeFalsy();
      for (const t of c.turns) expect(t.expect?.crisis).toBeUndefined();
    }
  });
});
