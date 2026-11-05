export const STATE_COLORS = {
  active: '#57f646',
  completed: '#57f646',
  inactive: '#3D4045',
};

export enum DifficultyLevel {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export interface ScoreRange {
  min?: number;
  max?: number;
}

export interface StateScoreConfig {
  stateId: string;
  scoreRange: ScoreRange;
}

/** Mirrors ally-web's DIFFICULTY_STATE_SCORE_MAP (libs/ui-shared simulation
 * constants) — keep the two in sync if the scoring bands ever change. */
export const DIFFICULTY_STATE_SCORE_MAP: Record<
  DifficultyLevel,
  StateScoreConfig[]
> = {
  [DifficultyLevel.EASY]: [
    {stateId: '1', scoreRange: {max: -50}},
    {stateId: '2', scoreRange: {min: -50, max: 20}},
    {stateId: '3', scoreRange: {min: 20, max: 70}},
    {stateId: '4', scoreRange: {min: 70}},
  ],
  [DifficultyLevel.MEDIUM]: [
    {stateId: '1', scoreRange: {max: -20}},
    {stateId: '2', scoreRange: {min: -20, max: 50}},
    {stateId: '3', scoreRange: {min: 50, max: 100}},
    {stateId: '4', scoreRange: {min: 100}},
  ],
  [DifficultyLevel.HARD]: [
    {stateId: '1', scoreRange: {max: -10}},
    {stateId: '2', scoreRange: {min: -10, max: 100}},
    {stateId: '3', scoreRange: {min: 100, max: 200}},
    {stateId: '4', scoreRange: {min: 200}},
  ],
};
