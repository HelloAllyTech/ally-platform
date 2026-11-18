/** The judge's hard fails, in the order the verdict panel lists them (ally-be `DebriefHardFail`). */
export const HARD_FAILS = [
  "missed_risk_cue",
  "fabricated_quote",
  "diagnoses_trainee",
  "wrong_language",
  "contradicts_protocol",
  "unsupported_progress_claim",
] as const;
export type DebriefHardFail = (typeof HARD_FAILS)[number];
