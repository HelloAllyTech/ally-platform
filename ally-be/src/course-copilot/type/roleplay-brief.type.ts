/**
 * The structured roleplay brief: one roleplay slot written out the way the
 * Ally Course Design Manual's roleplay brief template asks (Chapter 6), so
 * every later step of the roleplay agent — states, events, scaffolding, the
 * validator, the test run — reads the same facts instead of re-deriving them
 * from free text.
 *
 * Fields the code can work out (mode, gate, difficulty, length) are set in
 * code, never by the model, so they cannot drift from the blueprint.
 */
export type RoleplayMode =
  | 'learning'
  | 'practice'
  | 'performance'
  | 'pre_assessment'
  | 'post_assessment';

export const ROLEPLAY_MODES: readonly RoleplayMode[] = [
  'learning',
  'practice',
  'performance',
  'pre_assessment',
  'post_assessment',
];

export type RoleplayDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface StructuredRoleplayBrief {
  mode: RoleplayMode;
  /** The course outcome(s) this roleplay serves. */
  outcomes: string[];
  competencies: string[];
  /** Behaviours the learner should show, and habits the character invites. */
  behaviours: { helpful: string[]; unhelpful: string[] };
  /**
   * Moments the character must create so the learner can show the target
   * behaviours: "mentions not sleeping, then hints at not wanting to wake
   * up". Empty when the live prompt predates this field.
   */
  opportunities: string[];
  /** The learner's goal in this conversation, in plain words. */
  learnerGoal?: string;
  /** Where and when the conversation happens. */
  setting?: string;
  condition: {
    /** The trainer's simplifying condition: "cooperative caller, one concern". */
    taskClass?: string;
    difficulty: RoleplayDifficulty;
  };
  character: {
    /** A Character Library character, when the slot reuses one. */
    characterId?: string;
    /** Who the client is, when the slot generates a persona. */
    personaBrief?: string;
  };
  gate: { minScore?: number };
  lengthMinutes: number;
}

/** The fit check's verdict on a library character for one brief. */
export interface RoleplayFitCheck {
  characterId: string;
  fits: boolean;
  /** Why the character does or does not fit, in one or two sentences. */
  reason: string;
  /** Better-fitting library characters, best first (at most two). */
  alternatives: { characterId: string; name: string }[];
}

/** What casting decided for a roleplay slot. */
export interface RoleplayCasting {
  characterId?: string;
  fitCheck?: RoleplayFitCheck;
  /**
   * Set when the chosen character did not fit and an alternative was used
   * instead. The trainer sees it as an assumption to check.
   */
  swapped?: {
    fromCharacterId: string;
    fromName: string;
    toCharacterId: string;
    toName: string;
    reason: string;
  };
}
