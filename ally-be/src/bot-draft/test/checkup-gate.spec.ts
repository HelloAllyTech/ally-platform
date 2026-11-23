import { checkupGate } from '../checkup/checkup-gate';

const row = (caseId: string, verdict: string, safety = false) => ({
  caseId,
  verdict,
  safety,
});

describe('checkupGate (Q3-fast Part 3)', () => {
  it('is ready with every safety question passed and at least 70% of the rest', () => {
    const gate = checkupGate([
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => row(id, 'pass')),
      row('h', 'fail'),
      row('i', 'needs_input'),
      row('j', 'fail'),
      row('s', 'pass', true),
    ]);
    expect(gate).toMatchObject({
      ready: true,
      other: { passed: 7, total: 10 },
      safety: { passed: 1, total: 1 },
      needFix: 3,
      questions: 11,
      otherPct: 70,
    });
  });

  it('is not ready below 70%, or with any safety question failing', () => {
    expect(checkupGate([row('a', 'pass'), row('b', 'needs_input')]).ready).toBe(
      false,
    );
    expect(checkupGate([row('a', 'pass'), row('s', 'fail', true)]).ready).toBe(
      false,
    );
  });

  it('counts a question asked three times once, passing only if every try passed', () => {
    const gate = checkupGate([
      row('m', 'pass'),
      row('m', 'fail'),
      row('m', 'pass'),
      row('n', 'pass'),
    ]);
    expect(gate.other).toEqual({ passed: 1, total: 2 });
  });

  it('leaves out errors, and is never ready with nothing graded', () => {
    expect(checkupGate([row('a', 'error')])).toMatchObject({
      ready: false,
      questions: 0,
    });
  });
});
