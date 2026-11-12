/**
 * The learner's view of the Debrief agent's debrief for one practice session,
 * as served by `GET /v1/debriefs/sessions/:sessionId`.
 *
 * `not_available` means the learner's organisation isn't switched on for the
 * new debrief — callers must then keep showing the existing debrief unchanged
 * — unless `stopped` is set: the organisation's debriefs were stopped (FR-46),
 * and the tab says "not available" instead.
 *
 * `taking_longer` is a run a person is finishing without a risk cue (plan
 * §10.3): the learner can Check again. With a risk cue it is `on_its_way`.
 *
 * `failed` is never sent by the server: the app sets it when the request
 * itself failed (a 5xx or no connection), so the learner sees "Your debrief
 * didn't load" with Try again rather than the old note (PRD §6.12).
 */
export type LearnerDebriefState =
  | "ready"
  | "working"
  | "taking_longer"
  | "on_its_way"
  | "too_short"
  | "not_available"
  | "failed";

/** The post-launch pulse (PRD §9): two yes/no questions on 1 in 10 debriefs. */
export type DebriefPulseQuestion = "knew_next" | "fair";
export interface DebriefPulse {
  knew_next: boolean | null;
  fair: boolean | null;
}

export type DebriefSkillWord = "strength" | "keep_practising" | "didnt_come_up";

export interface DebriefImportantMoment {
  turn_index: number;
  quote: string;
  handled_well: boolean;
  lead: string;
  body: string;
  /** Every other risk cue in the session, one line each. */
  others?: Array<{ turn_index: number; quote: string; note: string }>;
}

export interface DebriefWhatWorked {
  skill: string;
  turn_index: number;
  quote: string;
  lead: string;
  body: string;
}

export interface DebriefWorkOnThis {
  skill: string;
  turn_index: number;
  quote: string;
  lead: string;
  why: string;
  try_saying: string;
  scenario_id?: number | null;
}

export interface DebriefCardsData {
  opening: string;
  important_moment?: DebriefImportantMoment | null;
  what_worked: DebriefWhatWorked[];
  work_on_this: DebriefWorkOnThis[];
  practise_next?: { skill: string; reason: string; scenario_id?: number | null } | null;
  skill_words: Array<{ skill: string; word: DebriefSkillWord }>;
  reflective_question: string;
  progress_note?: string | null;
}

export type DebriefFlagReason =
  | "didnt_say"
  | "described_wrongly"
  | "advice_doesnt_fit"
  | "something_else";

/** The Ally team's answer to a flag: the card stays (with why) or is taken out. */
export interface DebriefCorrection {
  section: string;
  outcome: "kept" | "removed" | "corrected";
  note: string | null;
  at: string;
}

export interface DebriefMyFlag {
  id: string;
  section: string;
  status: "open" | "kept" | "removed" | "corrected";
  canUndoUntil: string | null;
}

/** A crisis or wellbeing line: the organisation's own, else Tele-MANAS. */
export interface DebriefSupportLine {
  name: string;
  phone: string;
  hours?: string | null;
  url?: string | null;
  isCrisis?: boolean;
}

export interface LearnerDebriefView {
  state: LearnerDebriefState;
  cards?: DebriefCardsData | null;
  language?: string | null;
  steps?: string[];
  /** What the debrief is doing now (v9 FR-27); the app words it. */
  progress?: DebriefProgress | null;
  corrections?: DebriefCorrection[];
  feedback?: { helpful: boolean | null; flags: DebriefMyFlag[] };
  /** The learner stepped out of the role in distress: support comes first. */
  distress?: boolean;
  supportLines?: DebriefSupportLine[];
  /**
   * The safety reading found something in the session. The support lines then
   * show even when the debrief has no important-moment card (a cue the
   * Writer judged ordinary low mood or grief).
   */
  riskCue?: boolean;
  /** Roleplays the cards link to that the learner can still open. */
  practice?: Array<{ id: number; title: string }>;
  /** Present only on a debrief picked for the pulse, with the answers so far. */
  pulse?: DebriefPulse | null;
  /** `not_available` only: an emergency stop (FR-46) — say "not available". */
  stopped?: boolean;
}

/** One of the learner's flags, as a supervisor reads it (v9 FR-26). */
export interface SupervisorDebriefFlag {
  section: string;
  reason: DebriefFlagReason | null;
  note: string | null;
  status: "open" | "escalated" | "kept" | "removed" | "corrected" | "withdrawn";
  resolutionNote: string | null;
}

/** A supervisor's read-only view of a learner's Debrief-agent debrief. */
export interface SupervisorDebriefView {
  state: "ready" | "not_available";
  readOnly: true;
  cards?: DebriefCardsData | null;
  language?: string | null;
  corrections?: DebriefCorrection[];
  flags?: SupervisorDebriefFlag[];
  helpful?: boolean | null;
  thread?: Array<{ role: "learner" | "ally"; content: string; at: string }>;
}

/** A running debrief's current step, as a key the app words in the learner's language. */
export type DebriefProgress =
  | { key: "reading" | "past_sessions" | "writing" | "reviewing" | "care" }
  | { key: "guidance"; topic?: string }
  | { key: "revising"; round: number };
