/**
 * A roleplay's one Debrief risk-cue choice, saved at `scenarios.metadata.debriefRiskCueOption`:
 * `part_of_practice` (handling a risk conversation is the skill practised) or unset/null (a risk
 * cue is a safety moment). `standard` is accepted as a synonym for unset. Kept here, with the
 * roleplay, so the Debrief and the roleplay's DTOs read one list.
 */
export const STANDARD_RISK_CUE_KEY = 'standard';
export const PRACTISED_RISK_CUE_KEY = 'part_of_practice';
export const RISK_CUE_CHOICE_KEYS: readonly string[] = [
  STANDARD_RISK_CUE_KEY,
  PRACTISED_RISK_CUE_KEY,
];
