import {
  DebriefSkillFramework,
  FOUNDATIONAL_FRAMEWORK,
} from '../constants/debrief-framework.constants';
import { skillKeyOf, skillNamesOf } from './debrief-framework.util';

/**
 * Learner progress in debriefs: the pure half of the progress profile. The
 * repository reads the learner's published debriefs, their review signals,
 * their own words and their Foundational Skills levels; this assembles the
 * `progress_profile` the progress agent reads (ally-ai never reads the
 * database). Evidence is only ever the Analyst's observations; past points are
 * context, and a point an advisor corrected or rejected never counts.
 */

/** The owner settings the profile needs, as the graph reads them. */
export interface ProgressSettings {
  window: number;
  cardEvery: number;
  useFhs: boolean;
  showWorseToLearners: boolean;
}

/** Never look back over more than this many sessions, whatever the setting says. */
export const PROGRESS_MAX_WINDOW = 12;
/** The learner's own words: at most this many, newest first, each cut to this length. */
export const PROGRESS_VOICE_MAX = 6;
export const PROGRESS_VOICE_CHARS = 300;

export type ProgressObservation = 'observed' | 'partial' | 'missed';
export type ProgressVerdict = 'agreed' | 'corrected' | 'rejected';

export interface ProgressSkillObservation {
  run_id: string;
  date: string;
  opportunity: boolean;
  observation: ProgressObservation;
  confidence: 'high' | 'medium' | 'low';
  turn_index: number | null;
  analyst_version: number | null;
  corrected: boolean;
}

export interface ProgressProfile {
  settings: ProgressSettings;
  session_number: number;
  card_due: boolean;
  sessions: Array<{
    session_id: string;
    run_id: string;
    date: string;
    scenario: {
      title: string | null;
      difficulty: 'easy' | 'medium' | 'hard' | null;
      risk: boolean;
    };
    analyst_version: number | null;
    practise_next: {
      scenario_title: string | null;
      done_after: boolean;
      outcome: 'published' | null;
    } | null;
  }>;
  skills: Record<string, ProgressSkillObservation[]>;
  past_points: Array<{
    run_id: string;
    date: string;
    skill: string;
    point: string;
    verdict: ProgressVerdict | null;
    learner_flag: string | null;
    /** The learner's note with their flag, and what Ally decided and why. */
    learner_note?: string | null;
    ally_decision?: 'kept' | 'corrected' | 'removed' | null;
    ally_reason?: string | null;
    /** 'expert' for an expert's comment on the learner's roleplay. */
    source?: 'debrief' | 'expert';
  }>;
  last_report: {
    run_id: string;
    date: string;
    skills: unknown[];
    focus: unknown;
  } | null;
  learner_voice: Array<{
    date: string;
    kind: 'reflection' | 'ask_ally';
    text: string;
  }>;
  fhs: Record<
    string,
    Array<{ date: string; session_id: string; level: number }>
  > | null;
  /**
   * Key → name of every skill that may be trended for this roleplay: its framework's skills and
   * its named competencies (keys `competency:<name>`). The progress agent's allowed keys.
   */
  skill_names?: Record<string, string>;
}

/** One past published debrief in the window, as the repository reads it. */
export interface ProgressWindowRow {
  run_id: string;
  session_id: string;
  created_at: Date | string;
  scenario_title: string | null;
  difficulty: string | null;
  risk: boolean | null;
  analyst_version: number | string | null;
  behaviours: unknown;
  cards: Record<string, any> | null;
  /** `workspace.versions`: corrections in place. */
  versions: unknown;
  pn_scenario_id: number | string | null;
  pn_scenario_title: string | null;
  pn_done: boolean | null;
  pn_published: boolean | null;
}

/** A flag on a card (learner's, then reviewed by the Ally team). */
export interface ProgressFlagRow {
  run_id: string;
  section: string | null;
  status: string;
  reason: string | null;
  user_id: number | string;
  /** The learner's own words with the flag. */
  note?: string | null;
  /** What the Debrief agent decided: kept / corrected / removed, and why. */
  answer_action?: string | null;
  answer_reply?: string | null;
}

/** An expert's top-level comment that says a point is wrong, or worth keeping. */
export interface ProgressCommentRow {
  run_id: string;
  anchor_kind: string;
  turn_index: number | string | null;
  section: string | null;
  tag: string | null;
  /** The comment's words (a comment on the roleplay is about the learner). */
  body?: string | null;
}

export interface ProgressVoiceRow {
  session_id: string;
  content: string;
  created_at: Date | string;
  /** The learner's first message in that session's thread. */
  first_in_thread: boolean;
  /** The session recorded a `reflection_answered` event. */
  reflected: boolean;
}

export interface ProgressFhsRow {
  at: Date | string;
  session_id: string;
  levels: Record<string, unknown> | null;
}

// --- Skill keys ---------------------------------------------------------------------

/**
 * The Analyst names skills in free text. Map a name to a skill key of the roleplay's framework
 * (default: the foundational helping skills, `helping-skills-rubric.constants.ts`), or to a named
 * competency of the roleplay, where it is obvious; else `other` (sent, never trended). The words
 * that identify a skill live with the framework (a Context Library entry), narrow skills first.
 */
export function progressSkillKey(
  name: unknown,
  framework: DebriefSkillFramework = FOUNDATIONAL_FRAMEWORK,
  competencies: ReadonlyArray<string> = [],
): string {
  return skillKeyOf(name, framework, competencies);
}

// --- Review signals -----------------------------------------------------------------

const RANK: Record<ProgressVerdict, number> = {
  agreed: 1,
  corrected: 2,
  rejected: 3,
};

function stronger(
  a: ProgressVerdict | null | undefined,
  b: ProgressVerdict,
): ProgressVerdict {
  return a && RANK[a] >= RANK[b] ? a : b;
}

/** `work_on_this[0].why` → `work_on_this[0]`. */
function cardSection(section: string | null | undefined): string | null {
  const m =
    /^(important_moment|practise_next|(?:what_worked|work_on_this)\[\d+\])/.exec(
      String(section ?? ''),
    );
  return m ? m[1] : null;
}

/**
 * Per run, each card's review verdict by section, and the transcript turns an
 * expert said were read wrongly:
 * - a flag the team `removed`, or a comment tagged wrong or unsupported → rejected;
 * - a flag the team `corrected`, or a correction in place → corrected;
 * - a flag the team `kept`, or a comment "good, keep this" → agreed.
 * The strongest wins. Learners' own open flags are kept apart (`learnerFlags`).
 */
export function reviewSignals(
  rows: ProgressWindowRow[],
  flags: ProgressFlagRow[],
  comments: ProgressCommentRow[],
  counselorId: number,
): {
  verdicts: Map<string, Map<string, ProgressVerdict>>;
  wrongTurns: Map<string, Set<number>>;
  learnerFlags: Map<string, Map<string, string>>;
} {
  const verdicts = new Map<string, Map<string, ProgressVerdict>>();
  const wrongTurns = new Map<string, Set<number>>();
  const learnerFlags = new Map<string, Map<string, string>>();
  const put = (runId: string, section: string | null, v: ProgressVerdict) => {
    const key = cardSection(section);
    if (!key) return;
    const m = verdicts.get(runId) ?? new Map<string, ProgressVerdict>();
    m.set(key, stronger(m.get(key), v));
    verdicts.set(runId, m);
  };
  for (const f of flags) {
    if (f.status === 'removed') put(f.run_id, f.section, 'rejected');
    else if (f.status === 'corrected') put(f.run_id, f.section, 'corrected');
    else if (f.status === 'kept') put(f.run_id, f.section, 'agreed');
    const key = cardSection(f.section);
    if (key && Number(f.user_id) === counselorId && f.status !== 'withdrawn') {
      const m = learnerFlags.get(f.run_id) ?? new Map<string, string>();
      if (!m.has(key)) m.set(key, f.reason ?? 'something_else');
      learnerFlags.set(f.run_id, m);
    }
  }
  for (const c of comments) {
    if (c.tag !== 'wrong_or_unsupported' && c.tag !== 'good_keep_this')
      continue;
    const v: ProgressVerdict =
      c.tag === 'wrong_or_unsupported' ? 'rejected' : 'agreed';
    if (c.anchor_kind === 'card') put(c.run_id, c.section, v);
    const t = Number(c.turn_index);
    if (
      c.anchor_kind === 'transcript' &&
      v === 'rejected' &&
      Number.isInteger(t)
    ) {
      const s = wrongTurns.get(c.run_id) ?? new Set<number>();
      s.add(t);
      wrongTurns.set(c.run_id, s);
    }
  }
  for (const r of rows) {
    const versions = Array.isArray(r.versions)
      ? (r.versions as Array<Record<string, unknown>>)
      : [];
    for (const v of versions) {
      // A flag's correction is already counted from the flag itself.
      if (!v?.flagId) put(r.run_id, String(v?.section ?? ''), 'corrected');
    }
  }
  return { verdicts, wrongTurns, learnerFlags };
}

// --- Assembly -----------------------------------------------------------------------

const day = (v: Date | string) => new Date(v).toISOString().slice(0, 10);
const list = (v: unknown): Array<Record<string, any>> =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const OBSERVATIONS = new Set(['observed', 'partial', 'missed']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

/** The window the settings ask for, kept within 1..PROGRESS_MAX_WINDOW. */
export function progressWindow(settings: Pick<ProgressSettings, 'window'>) {
  const w = Math.round(Number(settings.window) || 0);
  return Math.max(1, Math.min(PROGRESS_MAX_WINDOW, w || 6));
}

/** Card every `cardEvery`th eligible session (every session when 1). */
export function progressCardDue(sessionNumber: number, cardEvery: number) {
  const every = Math.max(1, Math.round(Number(cardEvery) || 1));
  return every === 1 || sessionNumber % every === 0;
}

/**
 * The `progress_profile` from what the repository read. `eligiblePast` is
 * how many published debriefs the learner had before this session (all of
 * them, not only the window); null history is the caller's to decide.
 */
export function assembleProgressProfile(input: {
  settings: ProgressSettings;
  counselorId: number;
  eligiblePast: number;
  /** Newest first. Trimmed to the window here. */
  rows: ProgressWindowRow[];
  flags: ProgressFlagRow[];
  comments: ProgressCommentRow[];
  lastReport: ProgressProfile['last_report'];
  /** Newest first. */
  voice: ProgressVoiceRow[];
  fhs: ProgressFhsRow[] | null;
  /** The roleplay's skill framework; absent means the foundational helping skills. */
  framework?: DebriefSkillFramework;
  /** The roleplay's named competencies, trended alongside the framework's skills. */
  competencies?: ReadonlyArray<string>;
}): ProgressProfile {
  const { settings } = input;
  const framework = input.framework ?? FOUNDATIONAL_FRAMEWORK;
  const competencies = input.competencies ?? [];
  const rows = input.rows.slice(0, progressWindow(settings));
  const sessionNumber = Math.max(0, input.eligiblePast) + 1;
  const { verdicts, wrongTurns, learnerFlags } = reviewSignals(
    rows,
    input.flags,
    input.comments,
    input.counselorId,
  );

  const sessions: ProgressProfile['sessions'] = rows.map((r) => {
    const difficulty = String(r.difficulty ?? '').toLowerCase();
    return {
      session_id: r.session_id,
      run_id: r.run_id,
      date: day(r.created_at),
      scenario: {
        title: r.scenario_title ?? null,
        difficulty:
          difficulty === 'easy' ||
          difficulty === 'medium' ||
          difficulty === 'hard'
            ? difficulty
            : null,
        risk: r.risk === true,
      },
      analyst_version: intOrNull(r.analyst_version),
      practise_next:
        intOrNull(r.pn_scenario_id) != null
          ? {
              scenario_title: r.pn_scenario_title ?? null,
              done_after: r.pn_done === true,
              outcome: r.pn_published === true ? 'published' : null,
            }
          : null,
    };
  });

  // Each observation, oldest session first (the order a trend reads in).
  const skills: ProgressProfile['skills'] = {};
  for (const r of [...rows].reverse()) {
    const runVerdicts = verdicts.get(r.run_id);
    const doubted = new Set<number>(wrongTurns.get(r.run_id) ?? []);
    const doubtedSkills = new Set<string>();
    const cards = r.cards ?? {};
    const cardList: Array<[string, Record<string, any>]> = [
      ...list(cards.what_worked).map(
        (c, i) => [`what_worked[${i}]`, c] as [string, Record<string, any>],
      ),
      ...list(cards.work_on_this).map(
        (c, i) => [`work_on_this[${i}]`, c] as [string, Record<string, any>],
      ),
      ...(cards.important_moment && typeof cards.important_moment === 'object'
        ? [
            ['important_moment', cards.important_moment] as [
              string,
              Record<string, any>,
            ],
          ]
        : []),
    ];
    for (const [section, c] of cardList) {
      const v = runVerdicts?.get(section);
      if (v !== 'corrected' && v !== 'rejected') continue;
      const t = intOrNull(c.turn_index);
      if (t != null) doubted.add(t);
      if (c.skill) doubtedSkills.add(String(c.skill).trim().toLowerCase());
    }
    const version = intOrNull(r.analyst_version);
    for (const b of list(r.behaviours)) {
      const name = String(b.skill ?? '').trim();
      if (!name || !OBSERVATIONS.has(String(b.observation))) continue;
      const key = progressSkillKey(name, framework, competencies);
      const turn = intOrNull(b.turn_index);
      const obs: ProgressSkillObservation = {
        run_id: r.run_id,
        date: day(r.created_at),
        opportunity: b.opportunity === true || b.opportunity === 'true',
        observation: b.observation as ProgressObservation,
        confidence: CONFIDENCES.has(String(b.confidence))
          ? (b.confidence as ProgressSkillObservation['confidence'])
          : 'low',
        turn_index: turn,
        analyst_version: version,
        corrected:
          (turn != null && doubted.has(turn)) ||
          doubtedSkills.has(name.toLowerCase()),
      };
      (skills[key] ??= []).push(obs);
    }
  }

  // The learner's own words with each flag and Ally's decision (Gopi,
  // 2026-11-16): a flag may be wrong, so the decision travels with it.
  const flagWords = new Map<string, Map<string, ProgressFlagRow>>();
  for (const f of input.flags) {
    const key = cardSection(f.section);
    if (!key || Number(f.user_id) !== input.counselorId) continue;
    if (f.status === 'withdrawn') continue;
    const m = flagWords.get(f.run_id) ?? new Map<string, ProgressFlagRow>();
    if (!m.has(key)) m.set(key, f);
    flagWords.set(f.run_id, m);
  }
  const decision = (a: unknown) =>
    a === 'kept' || a === 'corrected' || a === 'removed' ? a : null;
  const pastPoints: ProgressProfile['past_points'] = [];
  for (const r of rows) {
    list(r.cards?.work_on_this).forEach((c, i) => {
      if (!c.lead) return;
      const section = `work_on_this[${i}]`;
      pastPoints.push({
        run_id: r.run_id,
        date: day(r.created_at),
        skill: String(c.skill ?? ''),
        point: String(c.lead),
        verdict: verdicts.get(r.run_id)?.get(section) ?? null,
        learner_flag: learnerFlags.get(r.run_id)?.get(section) ?? null,
        ...(() => {
          const f = flagWords.get(r.run_id)?.get(section);
          return f
            ? {
                learner_note: f.note ? String(f.note).slice(0, 300) : null,
                ally_decision: decision(f.answer_action),
                ally_reason: f.answer_reply
                  ? String(f.answer_reply).slice(0, 300)
                  : null,
              }
            : {};
        })(),
        source: 'debrief' as const,
      });
    });
  }
  // An expert's comment on the learner's roleplay is about what the learner
  // did, so the next debrief may follow it up. Comments on debrief cards are
  // about Ally's writing and go to the PM agent only.
  const runDate = new Map(rows.map((r) => [r.run_id, day(r.created_at)]));
  for (const c of input.comments) {
    const date = runDate.get(c.run_id);
    if (!date || c.anchor_kind !== 'transcript' || !c.body?.trim()) continue;
    const t = Number(c.turn_index);
    pastPoints.push({
      run_id: c.run_id,
      date,
      skill: '',
      point: `${Number.isInteger(t) ? `Turn ${t}: ` : ''}${String(c.body).trim().slice(0, 300)}`,
      verdict: null,
      learner_flag: null,
      source: 'expert',
    });
  }

  const voice = input.voice
    .filter((v) => String(v.content ?? '').trim())
    .slice(0, PROGRESS_VOICE_MAX)
    .map((v) => ({
      date: day(v.created_at),
      kind: (v.reflected && v.first_in_thread ? 'reflection' : 'ask_ally') as
        | 'reflection'
        | 'ask_ally',
      text: String(v.content).trim().slice(0, PROGRESS_VOICE_CHARS),
    }));

  let fhs: ProgressProfile['fhs'] = null;
  // The Foundational Skills levels are the foundational framework's own assessment.
  if (settings.useFhs && framework.foundational && input.fhs?.length) {
    const out: NonNullable<ProgressProfile['fhs']> = {};
    // Oldest cut first, like the skills.
    const cuts = [...input.fhs].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    for (const c of cuts) {
      for (const [key, raw] of Object.entries(c.levels ?? {})) {
        const level = Number(raw);
        if (!Number.isInteger(level) || level < 1 || level > 4) continue;
        (out[key] ??= []).push({
          date: day(c.at),
          session_id: c.session_id,
          level,
        });
      }
    }
    fhs = Object.keys(out).length ? out : null;
  }

  return {
    settings,
    session_number: sessionNumber,
    card_due: progressCardDue(sessionNumber, settings.cardEvery),
    sessions,
    skills,
    past_points: pastPoints,
    last_report: input.lastReport,
    learner_voice: voice,
    fhs,
    skill_names: skillNamesOf(framework, competencies),
  };
}

// --- Console ------------------------------------------------------------------------

/** A stored `debrief_progress_results` row as the Console's session view reads it. */
export interface ProgressResultRow {
  shown_as: string | null;
  window_session_ids: string[] | null;
  skills: unknown;
  followups: unknown;
  focus: unknown;
  vetoes: unknown;
  created_at: Date | string;
}

const textOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

/**
 * The session view's `progress`: the reading after the vetoes, what the
 * learner saw (a blank line means nothing), and each veto. Null when the
 * progress agent did not run for this run.
 */
export function progressConsoleView(row: ProgressResultRow | null | undefined) {
  if (!row) return null;
  const windowSessionIds = Array.isArray(row.window_session_ids)
    ? row.window_session_ids.map(String)
    : [];
  const focus =
    row.focus && typeof row.focus === 'object'
      ? (row.focus as Record<string, any>)
      : null;
  return {
    shownAs:
      row.shown_as === 'card'
        ? 'card'
        : row.shown_as === 'line'
          ? 'line'
          : null,
    // The window and this session.
    sessions: windowSessionIds.length + 1,
    skills: list(row.skills).map((s) => ({
      skill: String(s.skill ?? ''),
      trend: String(s.trend ?? 'too_early'),
      why: textOrNull(s.why),
      evidence: list(s.evidence).map((e) => ({
        run_id: e.run_id != null ? String(e.run_id) : null,
        turn_index: intOrNull(e.turn_index),
      })),
      fhs:
        s.fhs === 'agrees' || s.fhs === 'disagrees' || s.fhs === 'absent'
          ? s.fhs
          : null,
      learnerLine: textOrNull(s.learner_line),
      hiddenFromLearner: s.hidden_from_learner === true,
    })),
    followups: list(row.followups).map((f) => ({
      point: String(f.point ?? ''),
      status: String(f.status ?? 'not_yet'),
      evidence: list(f.evidence).map((e) => ({
        run_id: e.run_id != null ? String(e.run_id) : null,
        turn_index: intOrNull(e.turn_index),
      })),
    })),
    focus: focus
      ? {
          skill: String(focus.skill ?? ''),
          why: textOrNull(focus.why),
          learnerLine: textOrNull(focus.learner_line),
          practiseNext: focus.practise_next === true,
        }
      : null,
    vetoes: list(row.vetoes).map((v) => ({
      skill: String(v.skill ?? ''),
      veto: String(v.veto ?? ''),
      detail: textOrNull(v.detail),
    })),
    windowSessionIds,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
