import type { PlanImpactTagId, PlanStage } from "@api";

/** The words on screen (rev 5.2 §B.3). Internal names never appear in the UI. */
export const STAGE_LABEL: Record<PlanStage, string> = {
  idea: "Idea",
  filed: "Filed — needs a lead",
  prd: "Writing the PRD",
  design: "Designing",
  ready: "Ready to build",
  building: "Building",
  launching: "Launching",
  measuring: "Measuring",
  learned: "Outcome known",
  closed: "Not pursuing",
};

/** The steps of the progress bar, in order. Closed is shown as a label, not a step. */
export const PROGRESS_STEPS: { stage: PlanStage; short: string }[] = [
  { stage: "idea", short: "Idea" },
  { stage: "filed", short: "Filed" },
  { stage: "prd", short: "PRD" },
  { stage: "design", short: "Design" },
  { stage: "ready", short: "Ready" },
  { stage: "building", short: "Build" },
  { stage: "launching", short: "Launch" },
  { stage: "measuring", short: "Measure" },
  { stage: "learned", short: "Outcome" },
];

export const TAG_LABEL: Record<PlanImpactTagId, string> = {
  stores_or_moves_personal_data: "Stores or moves personal data",
  sends_user_content_to_llm: "Sends people's words to an AI model",
  learner_or_client_facing_ai: "Changes AI that learners or clients see",
  crisis_or_helpline_path: "Touches crisis or helpline paths",
  recordings_or_transcripts: "Recordings or transcripts",
  minors_possible: "Could involve minors",
  prompt_or_model_change: "Changes a prompt or model",
  ui_change: "Changes screens",
  mobile: "Mobile app",
  cross_tenant: "Crosses organisations",
  export: "Exports data",
};

export const CHECK_LABEL: Record<string, string> = {
  safety: "Safety",
  privacy: "Privacy",
  ai_quality: "AI quality",
};

export const GATE_LABEL: Record<string, string> = {
  pain_or_gain: "Names a real pain or a real gain",
  goal_before_solution: "Leads with the goal, not the build",
  clear_why: "Clear about why it matters",
  who_it_affects: "Names the user group it affects",
  outcome: "Says what changes for them",
};

export const VERDICT_LABEL: Record<string, string> = {
  hit: "Hit",
  partial: "Partial",
  miss: "Miss",
  too_early: "Too early to tell",
  measurement_broken: "Measurement broken",
};

/** The server's refusal message, or a plain fallback. */
export const errorMessage = (error: unknown, fallback: string): string => {
  const data = (error as { data?: { message?: unknown } })?.data;
  const message = Array.isArray(data?.message) ? data?.message.join(" ") : data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

export const formatUsd = (value: number): string =>
  value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
