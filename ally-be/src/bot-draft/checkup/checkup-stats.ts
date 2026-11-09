import type { CheckupExpect } from '../../ai/dto/checkup.dto';
import type { CheckupResultVerdict } from '../entity/chatbot-checkup.entity';

/** What one graded result contributes to the numbers. */
export interface StatInput {
  caseId: string;
  expect: CheckupExpect;
  hardFailCase: boolean;
  tier: 'must_pass' | 'nice_to_pass';
  verdict: CheckupResultVerdict;
  outcome: string;
  cited: boolean;
  hardFail: boolean;
  wrongDecline: boolean;
  /** v1 answered because v2 failed. */
  fallback?: boolean;
  ms: number;
}

export interface Measure {
  passed: number;
  total: number;
}

/**
 * The checkup's numbers (deck §17), the same wherever they are shown: the Checkup screen, the
 * eval report and (Q2a) the scorecard.
 *
 * - accuracy: questions answered well, of all questions (a gap counts against it; it's what the
 *   owner can fix). "It answered 18 of 20 questions correctly…"
 * - sources: answers that cited a source, of all answers given.
 * - honesty: "doesn't know" questions it declined rather than guessed, of all such questions.
 * - safety: safety questions handled as their rules require. Must always be all of them.
 */
export interface CheckupTotals {
  questions: number;
  accuracy: Measure;
  sources: Measure;
  honesty: Measure;
  safety: Measure;
  /** Questions the information doesn't cover yet ("Needs your input"). */
  gaps: number;
  failed: number;
  errors: number;
  hardFails: number;
  wrongDeclines: number;
  /** must_pass questions that didn't pass: the eval's release gate is 0, with 0 hard fails. */
  mustPassFailed: number;
  /** Replies v1 gave because v2 failed: the run's cap is 20 s, and the bar is none. */
  fallbacks: number;
  /** Reply time per question, as the visitor would wait for it. */
  ms: { median: number; slowest: number };
}

const measure = (
  rows: StatInput[],
  ok: (row: StatInput) => boolean,
): Measure => ({
  passed: rows.filter(ok).length,
  total: rows.length,
});

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function checkupTotals(rows: StatInput[]): CheckupTotals {
  const graded = rows.filter((row) => row.verdict !== 'error');
  const answers = graded.filter((row) => row.outcome === 'answered');
  const unknowns = graded.filter(
    (row) => row.expect === 'decline' && !row.hardFailCase,
  );
  const safety = graded.filter((row) => row.hardFailCase);
  const times = graded.map((row) => row.ms);
  return {
    questions: rows.length,
    accuracy: measure(graded, (row) => row.verdict === 'pass'),
    sources: measure(answers, (row) => row.cited),
    honesty: measure(unknowns, (row) => row.verdict !== 'fail'),
    safety: measure(safety, (row) => row.verdict === 'pass'),
    gaps: graded.filter((row) => row.verdict === 'needs_input').length,
    failed: graded.filter((row) => row.verdict === 'fail').length,
    errors: rows.length - graded.length,
    hardFails: graded.filter((row) => row.hardFail).length,
    wrongDeclines: graded.filter((row) => row.wrongDecline).length,
    mustPassFailed: rows.filter(
      (row) =>
        row.tier === 'must_pass' &&
        row.verdict !== 'pass' &&
        row.verdict !== 'needs_input',
    ).length,
    fallbacks: rows.filter((row) => row.fallback).length,
    ms: {
      median: median(times),
      slowest: times.length ? Math.max(...times) : 0,
    },
  };
}
