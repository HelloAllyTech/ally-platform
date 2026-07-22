import {DIFFICULTY_STATE_SCORE_MAP, DifficultyLevel} from './constants';

/** Mirrors ally-web's getCurrentStateIndex (libs/ui-shared simulation utils). */
export const getCurrentStateIndex = (
  score: number,
  difficultyLevel: string,
): number => {
  const stateConfigs =
    DIFFICULTY_STATE_SCORE_MAP[difficultyLevel as DifficultyLevel];
  if (!stateConfigs) return 0;

  for (let i = stateConfigs.length - 1; i >= 0; i--) {
    const {scoreRange} = stateConfigs[i];
    const meetsMin = scoreRange.min === undefined || score >= scoreRange.min;
    const meetsMax = scoreRange.max === undefined || score < scoreRange.max;
    if (meetsMin && meetsMax) return i;
  }

  return 0;
};
