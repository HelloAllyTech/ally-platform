import { ROADMAP_READINESS_CRITERIA } from '../constants/product-roadmap.constants';
import type { PlanIdeaState } from 'src/product-planning/type/plan-record.type';

/**
 * The five checks in the order the draft page lists them (§4.2: who, the
 * pain, why, goal before solution, how we'd know). The ids are the filing
 * gate's own criteria, so a draft that passes here passes the gate.
 */
export const DRAFT_CHECK_ORDER = [
  'who_it_affects',
  'pain_or_gain',
  'clear_why',
  'goal_before_solution',
  'outcome',
] as const;
export type DraftCheckId = (typeof DRAFT_CHECK_ORDER)[number];

/** "Fill it in yourself" (§4.13): one short field per check. */
export const SELF_CHECK_FIELDS: Record<
  'who' | 'pain' | 'why' | 'goal' | 'outcome',
  { check: DraftCheckId; label: string }
> = {
  who: { check: 'who_it_affects', label: "Who it's for" },
  pain: { check: 'pain_or_gain', label: 'The pain' },
  why: { check: 'clear_why', label: 'Why it matters' },
  goal: { check: 'goal_before_solution', label: 'The goal' },
  outcome: { check: 'outcome', label: "How we'd know it worked" },
};
export const SELF_CHECK_FIELD_MAX = 200;

/** Two failed copilot turns in a row offer Fill it in yourself (§4.13). */
export const SELF_CHECK_AFTER_FAILURES = 2;

export interface DraftCheck {
  id: DraftCheckId;
  label: string;
  hint: string;
  met: boolean;
  source: 'agent' | 'self' | null;
  evidence: {
    quote: string;
    from: 'text' | 'answer';
    messageId?: string;
  } | null;
  note: string | null;
  reopened: boolean;
}

/** An author answer the agent may have quoted. */
export interface QuotableAnswer {
  id: string;
  text: string;
}

/**
 * How two pieces of text are compared for a quote: case, curly quotes,
 * dashes and runs of whitespace don't matter, and trailing punctuation on the
 * quote is ignored. Anything else (a paraphrase, an ellipsis) does not match.
 */
export function normaliseForQuote(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!?]+$/, '');
}

/** Where a quote is found: the idea text first, then the author's answers. */
export function locateQuote(
  quote: string,
  text: string,
  answers: QuotableAnswer[],
): DraftCheck['evidence'] {
  const needle = normaliseForQuote(quote);
  if (needle.length < 3) return null;
  if (normaliseForQuote(text).includes(needle)) return { quote, from: 'text' };
  for (const answer of answers) {
    if (normaliseForQuote(answer.text).includes(needle)) {
      return { quote, from: 'answer', messageId: answer.id };
    }
  }
  return null;
}

/**
 * The five checks as the draft page shows them. Pure.
 *
 * - "Fill it in yourself" wins: each field is its own evidence.
 * - Otherwise the agent's last verdict, unless the author reopened the check.
 * - A check the agent met with a quote stays met only while those words are
 *   still in the idea or the author's answers: editing away the sentence that
 *   met a check reopens it (§4.13 "checks show their evidence"). A met check
 *   whose quote was never found keeps its tick with no highlight.
 */
export function draftChecks(
  idea: PlanIdeaState | undefined,
  text: string,
  answers: QuotableAnswer[],
): DraftCheck[] {
  const criteria = new Map<string, { label: string; hint: string }>(
    ROADMAP_READINESS_CRITERIA.map((c) => [
      c.id,
      { label: c.label, hint: c.hint },
    ]),
  );
  const reopened = new Set(idea?.reopened ?? []);
  const gates = new Map((idea?.gates ?? []).map((g) => [g.id, g]));
  return DRAFT_CHECK_ORDER.map((id) => {
    const base = {
      id,
      label: criteria.get(id)?.label ?? id,
      hint: criteria.get(id)?.hint ?? '',
    };
    // "Fill it in yourself" no longer meets a check (lifecycle 2026-11-18): a draft is finished
    // by its interview, so only the idea agent's verdicts count. Old self-filled answers are
    // ignored, and the agent checks those drafts again on the next turn.
    const gate = gates.get(id);
    if (reopened.has(id)) {
      return {
        ...base,
        met: false,
        source: null,
        evidence: null,
        note: gate?.note ?? null,
        reopened: true,
      };
    }
    if (!gate?.met) {
      return {
        ...base,
        met: false,
        source: null,
        evidence: null,
        note: gate?.note ?? null,
        reopened: false,
      };
    }
    const quote = idea?.evidence?.[id];
    if (!quote) {
      return {
        ...base,
        met: true,
        source: 'agent' as const,
        evidence: null,
        note: gate.note ?? null,
        reopened: false,
      };
    }
    const found = locateQuote(quote, text, answers);
    return found
      ? {
          ...base,
          met: true,
          source: 'agent' as const,
          evidence: found,
          note: gate.note ?? null,
          reopened: false,
        }
      : {
          ...base,
          met: false,
          source: null,
          evidence: null,
          note: 'The words that met this were edited out of the idea.',
          reopened: false,
        };
  });
}

/**
 * The quotes from one copilot turn worth keeping: only those found verbatim
 * now, so a later edit can be told apart from a quote that never matched.
 */
export function verifiedEvidence(
  evidence: Record<string, string>,
  text: string,
  answers: QuotableAnswer[],
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [id, quote] of Object.entries(evidence ?? {})) {
    if (locateQuote(quote, text, answers)) kept[id] = quote;
  }
  return kept;
}

/** The description filed at Submit: the text, plus the self-check fields when used. */
export function composeDescription(
  text: string,
  selfCheck: Record<string, string> | null | undefined,
): string {
  const body = (text ?? '').trim();
  if (!selfCheck) return body;
  const lines = Object.values(SELF_CHECK_FIELDS)
    .map(({ check, label }) => {
      const value = (selfCheck[check] ?? '').replace(/\s+/g, ' ').trim();
      return value ? `${label}: ${value}` : null;
    })
    .filter((line): line is string => !!line);
  return lines.length ? `${body}\n\n${lines.join('\n')}` : body;
}

export function firstLine(text: string): string {
  const line = (text ?? '').trim().split('\n')[0].trim();
  return (line || 'New idea').slice(0, 120);
}
