/**
 * The learner's view of the Debrief agent's debrief for one practice session,
 * as served by `GET /v1/debriefs/sessions/:sessionId`.
 *
 * `not_available` means the learner's organisation isn't switched on for the
 * new debrief — callers must then keep showing the existing debrief unchanged.
 */
export type LearnerDebriefState =
  | 'ready'
  | 'working'
  | 'on_its_way'
  | 'too_short'
  | 'not_available';

export type DebriefSkillWord = 'strength' | 'keep_practising' | 'didnt_come_up';

export interface DebriefImportantMoment {
  turn_index: number;
  quote: string;
  handled_well: boolean;
  lead: string;
  body: string;
  /** Every other risk cue in the session, one line each. */
  others?: Array<{turn_index: number; quote: string; note: string}>;
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
  /** The roleplay that practises this skill, when one is linked. */
  scenario_id?: number | null;
}

export interface DebriefCardsData {
  opening: string;
  important_moment?: DebriefImportantMoment | null;
  what_worked: DebriefWhatWorked[];
  work_on_this: DebriefWorkOnThis[];
  practise_next?: {
    skill: string;
    reason: string;
    scenario_id?: number | null;
  } | null;
  skill_words: Array<{skill: string; word: DebriefSkillWord}>;
  reflective_question: string;
  progress_note?: string | null;
}

export type DebriefFlagReason =
  | 'didnt_say'
  | 'described_wrongly'
  | 'advice_doesnt_fit'
  | 'something_else';

/**
 * The Ally team's answer to a flag: the card stays (with why), is taken out,
 * or is reworded (`corrected` — the card already shows the new words).
 */
export interface DebriefCorrection {
  section: string;
  outcome: 'kept' | 'removed' | 'corrected';
  note: string | null;
  at: string;
}

export interface DebriefMyFlag {
  id: string;
  section: string;
  status: 'open' | 'kept' | 'removed' | 'corrected';
  canUndoUntil: string | null;
}

/** A running debrief's current step, as a key the app words in the learner's language. */
export type DebriefProgress =
  | {key: 'reading' | 'past_sessions' | 'writing' | 'reviewing' | 'care'}
  | {key: 'guidance'; topic?: string}
  | {key: 'revising'; round: number};

/** One of the organisation's support lines, shown with the debrief. */
export interface DebriefSupportLine {
  name: string;
  phone: string;
  hours?: string;
  url?: string;
  isCrisis?: boolean;
}

/** A roleplay the learner can still open, for "Practise this". */
export interface DebriefPractice {
  id: number;
  title: string;
}

export interface LearnerDebriefView {
  state: LearnerDebriefState;
  cards?: DebriefCardsData | null;
  language?: string | null;
  steps?: string[];
  /** What the debrief is doing now; takes precedence over `steps`. */
  progress?: DebriefProgress | null;
  corrections?: DebriefCorrection[];
  feedback?: {helpful: boolean | null; flags: DebriefMyFlag[]};
  /** The learner stepped out of the role in distress: care before coaching. */
  distress?: boolean;
  supportLines?: DebriefSupportLine[];
  /** Roleplays the learner can open; a card's `scenario_id` must be in here. */
  practice?: DebriefPractice[];
}
