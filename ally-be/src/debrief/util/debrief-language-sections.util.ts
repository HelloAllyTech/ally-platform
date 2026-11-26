import {
  DebriefCards,
  TranscriptTurn,
  withSkillLabels,
} from './debrief-cards.util';

/** One named block of the debrief's visible text, as the language judge reads it. */
export interface LanguageSection {
  section: string;
  text: string;
}

/**
 * The debrief's visible text, one block per section, exactly what the learner
 * reads: the opening, each card's words, Practise next, the progress lines and
 * the reflective question. Nothing the learner does not see (evidence map,
 * scores, point ids, skill codes) is sent, so the judge cannot be steered by it.
 */
export function languageSections(cards: DebriefCards): LanguageSection[] {
  const out: LanguageSection[] = [];
  const add = (section: string, ...parts: Array<string | null | undefined>) => {
    const text = parts
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join('\n');
    if (text) out.push({ section, text });
  };
  add('opening', cards.opening);
  const m = cards.important_moment;
  if (m) {
    add(
      'important_moment',
      m.lead,
      m.quote && `"${m.quote}"`,
      m.body,
      ...(m.others ?? []).map((o) => `"${o.quote}" ${o.note}`),
    );
  }
  add(
    'what_worked',
    ...(cards.what_worked ?? []).map((c) => `${c.lead} "${c.quote}" ${c.body}`),
  );
  add(
    'work_on_this',
    ...(cards.work_on_this ?? []).map(
      (c) => `${c.lead} "${c.quote}" ${c.why} "${c.try_saying}"`,
    ),
  );
  // The learner reads Practise next's skill by its label in the debrief's
  // language; the stored `skill` is the English key progress matches on, and
  // showing it here made the judge call it "English in a Kannada debrief".
  const p = withSkillLabels(cards).practise_next;
  if (p) {
    add(
      'practise_next',
      `${p.skill}. ${p.reason}`,
      ...(p.try_next ?? []).map((t) => `- ${t}`),
    );
  }
  add('skill_names', ...(cards.skill_labels ?? []).map((l) => l.label));
  if (cards.progress_card) {
    add(
      'progress',
      cards.progress_note,
      ...cards.progress_card.skills.map((s) => s.line),
      cards.progress_card.focus?.line,
    );
  } else {
    add('progress', cards.progress_note);
  }
  add('reflective_question', cards.reflective_question);
  return out;
}

/** The turn numbers the cards cite (their quotes come from these turns). */
export function citedTurnIndexes(cards: DebriefCards): number[] {
  const idx = new Set<number>();
  const add = (n: unknown) => {
    if (typeof n === 'number' && Number.isFinite(n)) idx.add(n);
  };
  const m = cards.important_moment;
  if (m) {
    add(m.turn_index);
    (m.others ?? []).forEach((o) => add(o.turn_index));
  }
  (cards.what_worked ?? []).forEach((c) => add(c.turn_index));
  (cards.work_on_this ?? []).forEach((c) => add(c.turn_index));
  return [...idx].sort((a, b) => a - b);
}

/** Only the cited turns of the transcript, for the judge's quote and meaning checks. */
export function citedTurns(
  cards: DebriefCards,
  transcript: TranscriptTurn[],
): TranscriptTurn[] {
  const want = new Set(citedTurnIndexes(cards));
  return transcript.filter((t) => want.has(t.turn_index));
}

/** English (any variety: en, en-IN, en_US): the language check does not run on it. */
export const isEnglishLanguage = (
  language: string | null | undefined,
): boolean => /^en([-_]|$)/i.test(language || 'en');
