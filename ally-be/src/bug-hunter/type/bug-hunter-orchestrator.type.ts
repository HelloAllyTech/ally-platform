/** The eight orchestration points. D1–D3 are the Finder's, D4–D8 the orchestrator's. */
export type DecisionPoint =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8';

export type DecisionOwner = 'rule' | 'model';

export const BUG_HUNTER_DECISION_POINT_QUESTIONS: Record<
  DecisionPoint,
  string
> = {
  D1: 'senses',
  D2: 'model',
  D3: 'triage',
  D4: 'verifier',
  D5: 'fix_now',
  D6: 'approach',
  D7: 'next_move',
  D8: 'merge',
};
