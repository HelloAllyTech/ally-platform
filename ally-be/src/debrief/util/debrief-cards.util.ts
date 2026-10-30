/**
 * The cards a debrief is made of (the Writer's output), the rule checks every
 * draft must pass before it can be published, and the plain-text rendering
 * the Evaluator and the independent judge read.
 *
 * The checks are rules, not AI (plan §8.4): they are cheap, they never drift,
 * and they catch the failures a model grading a model is worst at noticing —
 * a quote that is not in the transcript, a card anchored to nothing, a score
 * that slipped in.
 */

export interface TranscriptTurn {
  turn_index: number;
  role: 'client' | 'counselor';
  text: string;
}

export interface ImportantMomentCard {
  turn_index: number;
  quote: string;
  handled_well: boolean;
  lead: string;
  body: string;
  /** Every other risk cue, one line each, so none goes unmentioned. */
  others?: Array<{ turn_index: number; quote: string; note: string }>;
}

export interface WorkedCard {
  skill: string;
  turn_index: number;
  quote: string;
  lead: string;
  body: string;
}

export interface WorkOnThisCard {
  skill: string;
  turn_index: number;
  quote: string;
  lead: string;
  why: string;
  try_saying: string;
}

export interface DebriefCards {
  opening: string;
  important_moment?: ImportantMomentCard | null;
  what_worked: WorkedCard[];
  work_on_this: WorkOnThisCard[];
  practise_next?: { skill: string; reason: string } | null;
  skill_words: Array<{
    skill: string;
    word: 'strength' | 'keep_practising' | 'didnt_come_up';
  }>;
  reflective_question: string;
  progress_note?: string | null;
}

export interface SafetyReading {
  risk_cues: Array<{
    turn_index: number;
    quote: string;
    category: string;
    learner_response: string;
  }>;
  learner_distress: Array<{ turn_index: number; quote: string }>;
}

export enum DebriefCheckCode {
  BROKEN_ANCHOR = 'broken_anchor',
  QUOTE_MISMATCH = 'quote_mismatch',
  WRONG_SPEAKER = 'wrong_speaker',
  STRUCTURE = 'structure',
  TOO_LONG = 'too_long',
  WRONG_LANGUAGE = 'wrong_language',
  SCORE_MENTIONED = 'score_mentioned',
  DIAGNOSES_TRAINEE = 'diagnoses_trainee',
  RISK_CUE_UNCOVERED = 'risk_cue_uncovered',
  NO_TRY_SAYING = 'no_try_saying',
  UNSUPPORTED_PROGRESS = 'unsupported_progress',
  EXCLAMATION = 'exclamation',
  TURN_NUMBER = 'turn_number',
}

export interface DebriefCheckFailure {
  code: DebriefCheckCode;
  section: string;
  detail: string;
}

export const LEAD_MAX_WORDS = 25;
export const BODY_MAX_WORDS = 60;
export const WHY_MAX_WORDS = 40;

/** Whitespace and quote-mark differences are not a different quote; anything else is. */
export function normaliseForQuote(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'.\s]+|["'.\s]+$/g, '')
    .toLowerCase();
}

const wordCount = (s: string | null | undefined) =>
  (s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** The script each supported language is written in; mixed-in English words are fine. */
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = {
  hi: /[ऀ-ॿ]/g,
  mr: /[ऀ-ॿ]/g,
  ta: /[஀-௿]/g,
  kn: /[ಀ-೿]/g,
  en: /[A-Za-z]/g,
};

/**
 * True when the text is mostly in the language's script. Romanised Hindi
 * (Hinglish) is common in sessions; a debrief for a Hindi session written in
 * Latin script still fails, because the session's recorded language decides.
 */
export function inLanguageScript(text: string, language: string): boolean {
  const re = SCRIPT_BY_LANGUAGE[language.slice(0, 2)];
  if (!re) return true; // a language we have no rule for is not blocked
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 20) return true;
  const inScript = (text.match(re) ?? []).length;
  return inScript / letters >= 0.5;
}

const SCORE_RE =
  /(\b\d{1,3}\s*(%|percent\b|\/\s*10\b|out of \d+))|\b(your|a) (score|rating|grade)\b|\bscored\b/i;

const DIAGNOSIS_RE =
  /\byou (are|seem|sound|might be|may be) (anxious|depressed|insecure|avoidant|narcissistic|codependent|traumati[sz]ed)\b|\byou (have|suffer from) (anxiety|depression|ptsd|adhd|a disorder)\b|\b(personality|attachment) (disorder|style)\b/i;

/** Learners never see turn numbers; quotes are what point at the moment. */
const TURN_NUMBER_RE = /\b(turns?|टर्न|ಟರ್ನ್|டர்ன்)\s*\d+/i;

const PROGRESS_CLAIM_RE =
  /\b(than last time|since last time|compared (with|to) (last|your last|previous)|you('ve| have) (improved|got better|gotten better)|getting better at|more consistent)\b/i;

/** Every section of the cards as plain text, with its path, for the text-wide rules. */
export function cardTexts(
  cards: DebriefCards,
): Array<{ section: string; text: string; ownWords: boolean }> {
  const out: Array<{ section: string; text: string; ownWords: boolean }> = [];
  const push = (section: string, text?: string | null, ownWords = true) => {
    if (text && text.trim()) out.push({ section, text, ownWords });
  };
  push('opening', cards.opening);
  if (cards.important_moment) {
    push('important_moment', cards.important_moment.lead);
    push('important_moment', cards.important_moment.body);
    cards.important_moment.others?.forEach((o, i) =>
      push(`important_moment.others[${i}]`, o.note),
    );
  }
  cards.what_worked?.forEach((c, i) => {
    push(`what_worked[${i}]`, c.lead);
    push(`what_worked[${i}]`, c.body);
  });
  cards.work_on_this?.forEach((c, i) => {
    push(`work_on_this[${i}]`, c.lead);
    push(`work_on_this[${i}]`, c.why);
    // A "try saying" line is in the learner's voice and may be in the
    // language the session was actually spoken in.
    push(`work_on_this[${i}]`, c.try_saying, false);
  });
  if (cards.practise_next) push('practise_next', cards.practise_next.reason);
  push('reflective_question', cards.reflective_question);
  push('progress_note', cards.progress_note);
  return out;
}

export function runDebriefChecks(input: {
  cards: DebriefCards;
  transcript: TranscriptTurn[];
  safety: SafetyReading;
  language: string;
  shortForm: boolean;
  hasProgress: boolean;
}): DebriefCheckFailure[] {
  const { cards, transcript, safety, language, shortForm, hasProgress } = input;
  const fails: DebriefCheckFailure[] = [];
  const turns = new Map(transcript.map((t) => [t.turn_index, t]));
  const fail = (code: DebriefCheckCode, section: string, detail: string) =>
    fails.push({ code, section, detail });

  const checkAnchor = (
    section: string,
    turnIndex: number,
    quote: string,
    speaker: 'client' | 'counselor' | null,
  ) => {
    const turn = turns.get(turnIndex);
    if (!turn) {
      fail(
        DebriefCheckCode.BROKEN_ANCHOR,
        section,
        `turn ${turnIndex} does not exist`,
      );
      return;
    }
    if (speaker && turn.role !== speaker) {
      fail(
        DebriefCheckCode.WRONG_SPEAKER,
        section,
        `turn ${turnIndex} is the ${turn.role === 'client' ? 'client' : 'counsellor'}'s`,
      );
    }
    // Speech-to-text often splits one spoken turn across consecutive
    // messages, so a quote may run across neighbouring turns by the same
    // speaker. It may never reach into the other speaker's words.
    let from = turnIndex;
    let to = turnIndex;
    while (turns.get(from - 1)?.role === turn.role) from--;
    while (turns.get(to + 1)?.role === turn.role) to++;
    const span: string[] = [];
    for (let i = from; i <= to; i++) span.push(turns.get(i)?.text ?? '');
    const q = normaliseForQuote(quote);
    if (!q || !normaliseForQuote(span.join(' ')).includes(q)) {
      fail(
        DebriefCheckCode.QUOTE_MISMATCH,
        section,
        `the quote is not in turn ${turnIndex}`,
      );
    }
  };

  // Structure.
  if (!cards.opening?.trim()) {
    fail(DebriefCheckCode.STRUCTURE, 'opening', 'no opening');
  }
  const wot = cards.work_on_this ?? [];
  const worked = cards.what_worked ?? [];
  if (wot.length < 1 || wot.length > 3) {
    fail(
      DebriefCheckCode.STRUCTURE,
      'work_on_this',
      `${wot.length} work-on-this cards; 1 to 3 are needed`,
    );
  }
  if (worked.length > 3) {
    fail(DebriefCheckCode.STRUCTURE, 'what_worked', 'more than 3 strengths');
  }
  if (!shortForm) {
    if (worked.length < 1) {
      fail(DebriefCheckCode.STRUCTURE, 'what_worked', 'no strengths');
    }
    if (!cards.reflective_question?.trim()) {
      fail(
        DebriefCheckCode.STRUCTURE,
        'reflective_question',
        'no reflective question',
      );
    }
  }
  const cardCount =
    (cards.important_moment ? 1 : 0) + worked.length + wot.length;
  if (cardCount > 7) {
    fail(DebriefCheckCode.STRUCTURE, 'cards', `${cardCount} cards; at most 7`);
  }

  // Anchors and quotes.
  if (cards.important_moment) {
    const m = cards.important_moment;
    checkAnchor('important_moment', m.turn_index, m.quote, 'client');
    (m.others ?? []).forEach((o, i) =>
      checkAnchor(
        `important_moment.others[${i}]`,
        o.turn_index,
        o.quote,
        'client',
      ),
    );
  }
  worked.forEach((c, i) =>
    checkAnchor(`what_worked[${i}]`, c.turn_index, c.quote, 'counselor'),
  );
  wot.forEach((c, i) => {
    checkAnchor(`work_on_this[${i}]`, c.turn_index, c.quote, null);
    if (!c.try_saying?.trim()) {
      fail(
        DebriefCheckCode.NO_TRY_SAYING,
        `work_on_this[${i}]`,
        'no "try saying" line',
      );
    }
    if (wordCount(c.why) > WHY_MAX_WORDS) {
      fail(
        DebriefCheckCode.TOO_LONG,
        `work_on_this[${i}]`,
        `why is ${wordCount(c.why)} words`,
      );
    }
  });

  // Lengths.
  const leads: Array<[string, string]> = [
    ...(cards.important_moment
      ? [['important_moment', cards.important_moment.lead] as [string, string]]
      : []),
    ...worked.map((c, i) => [`what_worked[${i}]`, c.lead] as [string, string]),
    ...wot.map((c, i) => [`work_on_this[${i}]`, c.lead] as [string, string]),
  ];
  for (const [section, lead] of leads) {
    if (wordCount(lead) > LEAD_MAX_WORDS) {
      fail(
        DebriefCheckCode.TOO_LONG,
        section,
        `lead is ${wordCount(lead)} words`,
      );
    }
  }
  const bodies: Array<[string, string]> = [
    ...(cards.important_moment
      ? [['important_moment', cards.important_moment.body] as [string, string]]
      : []),
    ...worked.map((c, i) => [`what_worked[${i}]`, c.body] as [string, string]),
  ];
  (cards.important_moment?.others ?? []).forEach((o, i) => {
    if (wordCount(o.note) > 30) {
      fail(
        DebriefCheckCode.TOO_LONG,
        `important_moment.others[${i}]`,
        `note is ${wordCount(o.note)} words`,
      );
    }
  });
  for (const [section, body] of bodies) {
    if (wordCount(body) > BODY_MAX_WORDS) {
      fail(
        DebriefCheckCode.TOO_LONG,
        section,
        `body is ${wordCount(body)} words`,
      );
    }
  }

  // Every client risk cue is covered: the most serious one by the important
  // moment, each other one by a line in its `others`. A cue left out is the
  // worst failure a debrief can have, so a single uncovered turn fails.
  const cueTurns = [...new Set(safety.risk_cues.map((c) => c.turn_index))];
  if (cueTurns.length > 0) {
    if (!cards.important_moment) {
      fail(
        DebriefCheckCode.RISK_CUE_UNCOVERED,
        'important_moment',
        `${cueTurns.length} risk cue(s) and no important-moment card`,
      );
    } else {
      const covered = new Set([
        cards.important_moment.turn_index,
        ...(cards.important_moment.others ?? []).map((o) => o.turn_index),
      ]);
      const missing = cueTurns.filter((t) => !covered.has(t));
      if (missing.length) {
        fail(
          DebriefCheckCode.RISK_CUE_UNCOVERED,
          'important_moment.others',
          `the risk cue(s) at turn ${missing.join(', ')} are not covered`,
        );
      }
    }
  }

  // Text-wide rules.
  const texts = cardTexts(cards);
  const ownWords = texts
    .filter((t) => t.ownWords)
    .map((t) => t.text)
    .join('\n');
  if (!inLanguageScript(ownWords, language)) {
    fail(
      DebriefCheckCode.WRONG_LANGUAGE,
      'cards',
      `not written in the session's language (${language})`,
    );
  }
  for (const t of texts) {
    if (SCORE_RE.test(t.text)) {
      fail(DebriefCheckCode.SCORE_MENTIONED, t.section, 'mentions a score');
    }
    if (DIAGNOSIS_RE.test(t.text)) {
      fail(
        DebriefCheckCode.DIAGNOSES_TRAINEE,
        t.section,
        'labels or diagnoses the trainee',
      );
    }
    if (TURN_NUMBER_RE.test(t.text)) {
      fail(
        DebriefCheckCode.TURN_NUMBER,
        t.section,
        'mentions a turn number the learner cannot see',
      );
    }
    if (t.ownWords && t.text.includes('!')) {
      fail(DebriefCheckCode.EXCLAMATION, t.section, 'uses an exclamation mark');
    }
    if (!hasProgress && PROGRESS_CLAIM_RE.test(t.text)) {
      fail(
        DebriefCheckCode.UNSUPPORTED_PROGRESS,
        t.section,
        'claims progress without history',
      );
    }
  }
  if (!hasProgress && cards.progress_note?.trim()) {
    fail(
      DebriefCheckCode.UNSUPPORTED_PROGRESS,
      'progress_note',
      'a progress note without a progress reading',
    );
  }
  return fails;
}

/** Fewer failures is a better draft; safety-relevant ones count most. */
export function checkWeight(fails: DebriefCheckFailure[]): number {
  return fails.reduce(
    (n, f) =>
      n +
      (f.code === DebriefCheckCode.RISK_CUE_UNCOVERED ||
      f.code === DebriefCheckCode.QUOTE_MISMATCH ||
      f.code === DebriefCheckCode.DIAGNOSES_TRAINEE
        ? 10
        : 1),
    0,
  );
}

/**
 * The debrief as text, the way the learner reads it, with every quote's turn
 * written as "(turn N)" — the same shape the judge already reads for today's
 * debriefs, so both are scored on equal terms.
 */
export function renderCards(cards: DebriefCards): string {
  const lines: string[] = [];
  lines.push((cards.opening ?? '').trim(), '');
  if (cards.important_moment) {
    const m = cards.important_moment;
    lines.push(
      'An important moment:',
      `${m.lead} "${m.quote}" (turn ${m.turn_index})`,
      m.body,
    );
    if (m.others?.length) {
      lines.push('Other moments like this:');
      for (const o of m.others) {
        lines.push(`- "${o.quote}" (turn ${o.turn_index}) ${o.note}`);
      }
    }
    lines.push('');
  }
  if (cards.what_worked?.length) {
    lines.push('What worked:');
    for (const c of cards.what_worked) {
      lines.push(`- ${c.lead} "${c.quote}" (turn ${c.turn_index}) ${c.body}`);
    }
    lines.push('');
  }
  if (cards.work_on_this?.length) {
    lines.push('Work on this:');
    for (const c of cards.work_on_this) {
      lines.push(
        `- ${c.lead} "${c.quote}" (turn ${c.turn_index}) ${c.why} Try saying: "${c.try_saying}"`,
      );
    }
    lines.push('');
  }
  if (cards.practise_next) {
    lines.push(
      `Practise this next: ${cards.practise_next.skill}. ${cards.practise_next.reason}`,
      '',
    );
  }
  if (cards.progress_note?.trim()) lines.push(cards.progress_note.trim(), '');
  if (cards.reflective_question?.trim()) {
    lines.push(`One question to think about: ${cards.reflective_question}`);
  }
  return lines.join('\n').trim();
}
