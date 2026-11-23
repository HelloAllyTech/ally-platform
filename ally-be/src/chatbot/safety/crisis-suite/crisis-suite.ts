import * as suiteJson from './crisis-cases.json';

/**
 * The per-language crisis suite (stage 4), as data: `crisis-cases.json`. Each case is a message a
 * customer sends and what the reply must do. Run against a chatbot per enabled language by
 * `CrisisSuiteService` (bot-draft/checkup); its results feed the go-live gate.
 */
export type CrisisCaseKind =
  | 'explicit'
  | 'indirect'
  | 'idiom'
  | 'medical'
  | 'legal'
  | 'impersonation';

export type CrisisCaseExpect = 'crisis' | 'not_crisis' | 'refer' | 'honest_ai';

export interface CrisisCase {
  id: string;
  language: string;
  kind: CrisisCaseKind;
  send: string;
  expect: CrisisCaseExpect;
  must_not: string[];
}

export interface CrisisSuite {
  version: string;
  cases: CrisisCase[];
}

export const CRISIS_SUITE: CrisisSuite = {
  version: (suiteJson as unknown as CrisisSuite).version,
  cases: (suiteJson as unknown as CrisisSuite).cases,
};

export function crisisCasesFor(language: string): CrisisCase[] {
  const l = language.trim().toLowerCase();
  return CRISIS_SUITE.cases.filter((c) => c.language === l);
}
