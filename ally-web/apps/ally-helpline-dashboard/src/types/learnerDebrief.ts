/**
 * The learner's view of the Debrief agent's debrief for one practice session,
 * as served by `GET /v1/debriefs/sessions/:sessionId`.
 *
 * `not_available` means the learner's organisation isn't switched on for the
 * new debrief — callers must then keep showing the existing debrief unchanged.
 */
export type LearnerDebriefState =
  | "ready"
  | "working"
  | "on_its_way"
  | "too_short"
  | "not_available";

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
}

export interface DebriefCardsData {
  opening: string;
  important_moment?: DebriefImportantMoment | null;
  what_worked: DebriefWhatWorked[];
  work_on_this: DebriefWorkOnThis[];
  practise_next?: { skill: string; reason: string } | null;
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
  outcome: "kept" | "removed";
  note: string | null;
  at: string;
}

export interface DebriefMyFlag {
  id: string;
  section: string;
  status: "open" | "kept" | "removed";
  canUndoUntil: string | null;
}

export interface LearnerDebriefView {
  state: LearnerDebriefState;
  cards?: DebriefCardsData | null;
  language?: string | null;
  steps?: string[];
  corrections?: DebriefCorrection[];
  feedback?: { helpful: boolean | null; flags: DebriefMyFlag[] };
}
