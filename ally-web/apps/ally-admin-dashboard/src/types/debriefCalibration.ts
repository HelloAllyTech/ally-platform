/**
 * Debrief calibration set — mirrors ally-be
 * `src/analytics/controller/debrief-calibration.controller.ts`.
 */

export type DebriefDimension =
  | "evidence_specificity"
  | "accuracy"
  | "actionability"
  | "prioritisation"
  | "personalisation_progress"
  | "practice_alignment"
  | "tone"
  | "clarity";

export type DebriefHardFail =
  | "fabricated_quote"
  | "missed_risk_cue"
  | "diagnoses_trainee"
  | "wrong_language"
  | "contradicts_protocol"
  | "unsupported_progress_claim";

export interface DebriefCalibrationSampleItem {
  scenarioSessionId: string;
  language: string;
  /** Judge-overall tercile the debrief was drawn from (0 low, 2 high). */
  tercile: number;
  raters: number;
  ratedByMe: boolean;
}

export interface DebriefCalibrationSample {
  population: number;
  target: number;
  items: DebriefCalibrationSampleItem[];
}

export interface DebriefRating {
  scores: Record<DebriefDimension, number>;
  hardFails: DebriefHardFail[];
  note?: string | null;
}

export interface DebriefCalibrationItem {
  scenarioSessionId: string;
  language: string;
  transcript: Array<{ turnIndex: number; speaker: "client" | "learner"; text: string }>;
  debrief: string;
  myRating: DebriefRating | null;
}

export interface DebriefScoreAgreement {
  pairs: number;
  debriefs: number;
  weightedKappa: number | null;
  withinOnePct: number | null;
  meanDifference: number | null;
}

export interface DebriefHardFailAgreement {
  pairs: number;
  debriefs: number;
  kappa: number | null;
  exactAgreementPct: number | null;
}

export interface DebriefAgreementSide {
  dimensions: Record<DebriefDimension, DebriefScoreAgreement>;
  hardFails: Record<DebriefHardFail, DebriefHardFailAgreement>;
}

export interface DebriefCalibrationAgreement {
  rubricVersion: string;
  judge: { judgeModel: string; judgePromptVersion: string };
  target: number;
  coverage: { debriefs: number; ratings: number; raters: number };
  judgeVsHuman: DebriefAgreementSide;
  humanVsHuman: DebriefAgreementSide;
  gate: {
    met: boolean;
    checks: Array<{ measure: string; kappa: number | null; passes: boolean }>;
  };
}
