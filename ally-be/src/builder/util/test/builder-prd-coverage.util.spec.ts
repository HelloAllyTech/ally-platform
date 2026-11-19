import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import { BUILDER_PRD_COVERAGE_KEYS } from '../../constants/builder-prd-coverage.constants';
import {
  coverageRow,
  mobileSettled,
  normaliseCoverage,
} from '../builder-prd-coverage.util';

const allNotApplicable = () =>
  BUILDER_PRD_COVERAGE_KEYS.map((key) => ({
    key,
    status: 'not_applicable' as const,
    note: 'Nothing in this change touches it at all.',
  }));

describe('coverage pass', () => {
  it('blocks a blank PRD and names every item', () => {
    const row = coverageRow(createEmptyPrdDocument());
    expect(row.ok).toBe(false);
    expect(row.hint).toContain('10 of 10 coverage items open');
    expect(row.detail).toContain('record_coverage');
  });

  it('passes when every item has a reason it does not apply', () => {
    const draft = { ...createEmptyPrdDocument(), coverage: allNotApplicable() };
    expect(coverageRow(draft).ok).toBe(true);
  });

  it('does not count a not-applicable without a reason', () => {
    const coverage = allNotApplicable();
    coverage[0] = { ...coverage[0], note: 'n/a' };
    const row = coverageRow({ ...createEmptyPrdDocument(), coverage });
    expect(row.ok).toBe(false);
    expect(row.detail).toContain(
      'admin_web (marked not applicable without a reason)',
    );
  });

  it('counts an answer only when the named section says something', () => {
    const coverage = allNotApplicable();
    coverage[5] = {
      key: 'success_metric',
      status: 'answered',
      note: 'Plans closed per week',
      section: 'goals',
    } as any;
    const empty = { ...createEmptyPrdDocument(), coverage };
    expect(coverageRow(empty).ok).toBe(false);
    expect(coverageRow(empty).detail).toContain(
      'answered in goals, which is empty',
    );
    expect(
      coverageRow({ ...empty, goals: 'Plans closed per week rises.' }).ok,
    ).toBe(true);
  });

  it('keeps an asked item covered only while its question is open', () => {
    const coverage = allNotApplicable();
    coverage[1] = {
      key: 'helpline_web',
      status: 'asked',
      note: 'Does the helpline show this?',
      question: 'Does the helpline show this?',
    } as any;
    const open = {
      ...createEmptyPrdDocument(),
      coverage,
      openQuestions: ['Does the helpline show this?'],
    };
    expect(coverageRow(open).ok).toBe(true);
    const settled = { ...open, openQuestions: [] };
    expect(coverageRow(settled).ok).toBe(false);
    expect(coverageRow(settled).detail).toContain('no longer open');
  });

  it('settles mobile from the coverage answer, not the word "mobile" in Non-goals', () => {
    const mentionsOnly = {
      ...createEmptyPrdDocument(),
      nonGoals: 'We will look at mobile later.',
    };
    expect(mobileSettled(mentionsOnly)).toBe(false);
    expect(
      mobileSettled({
        ...mentionsOnly,
        coverage: [
          {
            key: 'mobile_app',
            status: 'not_applicable',
            note: 'The app has no screen for this yet.',
          },
        ],
      }),
    ).toBe(true);
  });

  it('drops unknown keys and statuses and keeps the last entry per key', () => {
    expect(
      normaliseCoverage([
        { key: 'nope', status: 'answered', note: 'x' },
        { key: 'translations', status: 'maybe', note: 'x' },
        { key: 'translations', status: 'asked', note: 'first' },
        { key: 'translations', status: 'not_applicable', note: 'second one' },
      ]),
    ).toEqual([
      { key: 'translations', status: 'not_applicable', note: 'second one' },
    ]);
  });
});
