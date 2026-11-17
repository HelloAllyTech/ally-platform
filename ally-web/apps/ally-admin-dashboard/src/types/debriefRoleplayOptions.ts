/** Debrief choices a roleplay author makes in the simulation editor (ally-be `/v1/debriefs/roleplay-options`). */

export interface DebriefSkillFrameworkOption {
  /** "none" is the option that assesses no framework skills. */
  id: string;
  name: string;
  skills?: string[];
  isDefault: boolean;
}

export type RiskCueHandling = "alarm" | "assessed";
export type RiskCueStatus = "draft" | "awaiting_approval" | "approved" | "retired";

export interface RiskCueTestRep {
  rep: number;
  missed: string[];
  false_clear: string[];
}

export interface RiskCueTestResult {
  passed: boolean;
  reps: RiskCueTestRep[];
  cueExamples: number;
  nonCueExamples: number;
  version: number;
  at: string;
}

export interface RiskCueOption {
  id: string;
  key: string;
  name: string;
  description: string;
  /** null = the standard definition. */
  wording: string | null;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  examples: { cues: string[]; nonCues: string[] };
  status: RiskCueStatus;
  version: number;
  testResult: RiskCueTestResult | null;
  reviewNote: string | null;
  approvedAt: string | null;
  mine: boolean;
}

export interface RiskCueOptionInput {
  name: string;
  description?: string;
  wording: string;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  examples: { cues: string[]; nonCues: string[] };
}
