/**
 * How a roleplay's Debrief treats a risk cue (2026-11-18, simplified from the old
 * author-written "risk-cue options"): one yes/no choice per roleplay.
 *
 * - `standard` (the default): a risk cue the client voices is a safety moment.
 * - `part_of_practice`: handling a risk conversation IS the skill being practised; the Debrief
 *   coaches how the learner assessed and responded. Any cue the Safety reader does not mark as
 *   part of the practice still raises the alarm.
 *
 * The choice is stored as before, `scenarios.metadata.debriefRiskCueOption` (the two seeded keys,
 * so no roleplay needed migrating). Everything else a risk-cue option used to carry is fixed
 * system behaviour: the definition of a risk cue is the one pinned prompt
 * `debrief_risk_cue_definition`, the word list always raises cues and the support lines always
 * show.
 */
export const STANDARD_RISK_CUE_KEY = 'standard';
export const PRACTISED_RISK_CUE_KEY = 'part_of_practice';

export type RiskCueHandling = 'alarm' | 'assessed';

/** What a debrief run applies, snapshotted on the run so a later edit never changes a past debrief. */
export interface ResolvedRiskCue {
  key: string;
  name: string;
  version: number;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  /** Always null: the one pinned `debrief_risk_cue_definition` is the definition. */
  wording: null;
}

export const STANDARD_RISK_CUE: ResolvedRiskCue = {
  key: STANDARD_RISK_CUE_KEY,
  name: 'Standard',
  version: 1,
  handling: 'alarm',
  wordListRaises: true,
  supportLinesOnCue: true,
  wording: null,
};

const PRACTISED_RISK_CUE: ResolvedRiskCue = {
  key: PRACTISED_RISK_CUE_KEY,
  name: 'Part of the practice',
  version: 1,
  handling: 'assessed',
  wordListRaises: true,
  supportLinesOnCue: true,
  wording: null,
};

/**
 * What a run applies for a roleplay's saved choice. Anything but the practised key reads as
 * Standard (the safe one).
 */
export function resolveRiskCue(key?: string | null): ResolvedRiskCue {
  return String(key ?? '').trim() === PRACTISED_RISK_CUE_KEY
    ? PRACTISED_RISK_CUE
    : STANDARD_RISK_CUE;
}
