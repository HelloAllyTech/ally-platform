import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import {
  normalisePrincipleMarks,
  principleMarksRow,
  principlesSummary,
} from '../builder-prd-principles.util';

const signal = { enabled: true, inBrief: ['FP-0142', 'BL-0036'], retrieved: 2 };

describe('principle marks', () => {
  it('blocks until every principle in the brief is marked', () => {
    const row = principleMarksRow(createEmptyPrdDocument(), signal);
    expect(row.ok).toBe(false);
    expect(row.hint).toContain('FP-0142, BL-0036');
  });

  it('counts an applied mark only where the section cites the code', () => {
    const marks = [
      { code: 'FP-0142', mark: 'applied', section: 'goals' },
      {
        code: 'BL-0036',
        mark: 'not_relevant',
        reason: 'No requirements change here.',
      },
    ];
    const uncited = {
      ...createEmptyPrdDocument(),
      goals: 'Ship it.',
      principleMarks: marks as any,
    };
    expect(principleMarksRow(uncited, signal).ok).toBe(false);
    expect(principlesSummary(uncited, signal).unmarked).toEqual(['FP-0142']);
    const cited = {
      ...uncited,
      goals: 'Name every platform first [FP-0142, FP-0001].',
    };
    expect(principleMarksRow(cited, signal).ok).toBe(true);
  });

  it('passes when principles are off, or the brief is empty', () => {
    expect(
      principleMarksRow(createEmptyPrdDocument(), { ...signal, enabled: false })
        .ok,
    ).toBe(true);
    expect(
      principleMarksRow(createEmptyPrdDocument(), {
        enabled: true,
        inBrief: [],
        retrieved: 0,
      }).ok,
    ).toBe(true);
  });

  it('normalises codes and drops invalid marks', () => {
    expect(
      normalisePrincipleMarks([
        { code: '[fp-0142]', mark: 'not_relevant', reason: 'x' },
        { code: 'nonsense', mark: 'applied' },
        { code: 'FP-0002', mark: 'maybe' },
      ]),
    ).toEqual([{ code: 'FP-0142', mark: 'not_relevant', reason: 'x' }]);
  });
});
