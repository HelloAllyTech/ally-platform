import {
  RoadmapOpportunity,
  RoadmapOpportunityEffort,
  RoadmapOpportunityStage,
  RoadmapReferenceImage,
} from "@types";

import { sameReferenceImages } from "./referenceImages";

/** The drawer's editable fields, in the shapes its inputs hold (strings, "" for empty). */
export interface DrawerDraft {
  description: string;
  stage: RoadmapOpportunityStage;
  productGoal: string;
  /** "" means unassigned. Holds an Ally user id as a string, matching the dropdown's values. */
  ownerUserId: string;
  prd: string;
  claudePrompt: string;
  /** 'YYYY-MM', or "" for Unscheduled. */
  plannedMonth: string;
  /** A shirt size, or "" for unsized. */
  effort: string;
  referenceImages: RoadmapReferenceImage[];
}

export const EMPTY_DRAFT: DrawerDraft = {
  description: "",
  stage: RoadmapOpportunityStage.NEW,
  productGoal: "",
  ownerUserId: "",
  prd: "",
  claudePrompt: "",
  plannedMonth: "",
  effort: "",
  referenceImages: [],
};

export const draftFromOpportunity = (opportunity: RoadmapOpportunity): DrawerDraft => ({
  description: opportunity.description,
  stage: opportunity.stage,
  productGoal: opportunity.productGoal,
  ownerUserId: opportunity.ownerUserId ? String(opportunity.ownerUserId) : "",
  prd: opportunity.prd ?? "",
  claudePrompt: opportunity.claudePrompt ?? "",
  plannedMonth: opportunity.plannedMonth ?? "",
  effort: opportunity.effort ?? "",
  // `?? []` for a row read from a cache written before the field existed.
  referenceImages: opportunity.referenceImages ?? [],
});

/**
 * ONLY the fields the reader changed, as an API body.
 *
 * The drawer used to PATCH every field on each autosave. If another admin changed the stage or
 * owner while it was open, the next save sent this drawer's stale copy of those fields and quietly
 * reverted them. Comparing against the BASELINE — the values the draft was loaded from, or last
 * saved as — and sending only the difference means a field nobody here touched is never in the
 * request, so it cannot be overwritten.
 *
 * Empty strings become null exactly as the old full-body save did ("" is Unscheduled / Not sized /
 * Unassigned, and would fail the server's validation if sent as-is).
 */
export const diffDraft = (
  draft: DrawerDraft,
  baseline: DrawerDraft,
): Partial<RoadmapOpportunity> => {
  const body: Partial<RoadmapOpportunity> = {};
  // Trimmed on both sides: the save trims, so "text " against the stored "text" is not an edit.
  if (draft.description.trim() !== baseline.description.trim()) {
    body.description = draft.description.trim();
  }
  if (draft.stage !== baseline.stage) body.stage = draft.stage;
  if (draft.productGoal !== baseline.productGoal) body.productGoal = draft.productGoal;
  if (draft.ownerUserId !== baseline.ownerUserId) {
    body.ownerUserId = draft.ownerUserId ? Number(draft.ownerUserId) : null;
  }
  if (draft.prd !== baseline.prd) body.prd = draft.prd || null;
  if (draft.claudePrompt !== baseline.claudePrompt) body.claudePrompt = draft.claudePrompt || null;
  if (draft.plannedMonth !== baseline.plannedMonth) body.plannedMonth = draft.plannedMonth || null;
  if (draft.effort !== baseline.effort) {
    body.effort = (draft.effort || null) as RoadmapOpportunityEffort | null;
  }
  // By value, not identity — every keystroke in a caption rebuilds the array.
  if (!sameReferenceImages(draft.referenceImages, baseline.referenceImages)) {
    body.referenceImages = draft.referenceImages;
  }
  return body;
};

export const isDraftDirty = (draft: DrawerDraft, baseline: DrawerDraft): boolean =>
  Object.keys(diffDraft(draft, baseline)).length > 0;
