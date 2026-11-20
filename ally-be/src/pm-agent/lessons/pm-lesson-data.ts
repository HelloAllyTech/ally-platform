import { createHash } from 'crypto';
import {
  PmCardCategory,
  PmCardKind,
  PmCardSize,
  PmDecision,
  PmLane,
  PmLessonScope,
  PmRiskLevel,
} from '../enum/pm-agent.enum';
import { PM_DEDUPE } from '../constants/pm-agent-pipeline.constants';
import { looksLikeInjection, neutralise } from '../util/fence.util';
import { scrubForPublic } from '../util/scrub.util';
import { similarity, tokens, tokenSet } from '../util/text-similarity.util';
import { PM_LESSONS } from './pm-lessons.constants';

/**
 * The deterministic half of the weekly lessons job: the anonymised data pack the reflection
 * model reads, the schema check of what it answers, and — the point of the design — the
 * recomputation of every candidate lesson's support from the data. The model proposes; code
 * decides whether the data actually says so, what the lesson's scope is and whether it needs
 * an admin's confirm. Nothing the model claims about support, scope or risk is used.
 */

/** One decided card as the job reads it (internal: ids and payload never reach the model). */
export interface PmLessonDecisionRow {
  cardId: string;
  kind: string;
  category: string;
  lane: string | null;
  size: string | null;
  risk: string | null;
  title: string;
  decision: string;
  reasonChip: string | null;
  feedbackChips: string[];
  decidedAt: Date;
  merged: boolean;
  released: boolean;
  buildFailed: boolean;
  reverted: boolean;
  /** The impact read's verdict when the impact checks have one (absent otherwise). */
  impact: 'improved' | 'flat' | 'worse' | null;
  /** Card payload, for the eval gate's critic replay only. */
  payload: Record<string, any>;
}

export type PmLessonExpectation = 'accept' | 'reject';

/** The structured condition a lesson is about. Every listed dimension must match. */
export interface PmLessonPredicate {
  categories?: string[];
  lanes?: string[];
  sizes?: string[];
  risks?: string[];
  /** Any of these title words (stemmed comparison). */
  words?: string[];
}

export interface PmLessonCandidate {
  text: string;
  expects: PmLessonExpectation;
  predicate: PmLessonPredicate;
}

export interface PmLessonSupport {
  matching: number;
  supporting: number;
  ratio: number;
  supportingCardIds: string[];
}

const ACCEPTED = new Set<string>([PmDecision.ACCEPTED, PmDecision.HANDED_OFF]);
const DECLINED = new Set<string>([PmDecision.REJECTED, PmDecision.FEEDBACK]);
const CATEGORIES = new Set<string>(Object.values(PmCardCategory));
const LANES = new Set<string>(Object.values(PmLane));
const SIZES = new Set<string>(Object.values(PmCardSize));
const RISKS = new Set<string>(Object.values(PmRiskLevel));
const WORD = /^[a-z][a-z0-9-]{2,23}$/;
const CHIP = /^[a-z][a-z_]{1,23}$/;

/** The decisions a lesson may learn from: recommendations someone accepted or declined. */
export function eligibleRows(
  rows: PmLessonDecisionRow[],
): PmLessonDecisionRow[] {
  return rows.filter(
    (row) =>
      row.kind === PmCardKind.RECOMMENDATION &&
      (ACCEPTED.has(row.decision) || DECLINED.has(row.decision)),
  );
}

/** Outcome beats opinion: accepted-then-reverted (or failed, or worse impact) is negative. */
export function isPositive(row: PmLessonDecisionRow): boolean {
  return (
    ACCEPTED.has(row.decision) &&
    !row.buildFailed &&
    !row.reverted &&
    row.impact !== 'worse'
  );
}

export function isNegative(row: PmLessonDecisionRow): boolean {
  return (
    DECLINED.has(row.decision) ||
    (ACCEPTED.has(row.decision) &&
      (row.buildFailed || row.reverted || row.impact === 'worse'))
  );
}

/** Title → a few lower-case content words, scrubbed first (titles are model-written, but cheap). */
export function titleWords(
  title: string,
  tenantNames: string[] = [],
): string[] {
  const clean = scrubForPublic(String(title ?? ''), { tenantNames })
    .toLowerCase()
    .replace(/\[[a-z -]+\]/g, ' ');
  const out: string[] = [];
  for (const word of clean.match(/[a-z][a-z0-9-]{2,23}/g) ?? []) {
    if (!tokens(word).length || out.includes(word)) continue;
    out.push(word);
    if (out.length >= PM_LESSONS.PACK_WORDS_PER_ROW) break;
  }
  return out;
}

/**
 * The compact, anonymised pack: categorical fields, a few title words, decision, reason
 * CHIPS (never the free-text reason), outcome flags and impact verdicts. Cards are named
 * `c1…cN`; the map back to ids stays in code.
 */
export function buildDataPack(
  rows: PmLessonDecisionRow[],
  now: Date,
  tenantNames: string[] = [],
): { rows: Record<string, unknown>[]; refs: Map<string, string> } {
  const refs = new Map<string, string>();
  const packed = rows.slice(0, PM_LESSONS.PACK_MAX_ROWS).map((row, index) => {
    const ref = `c${index + 1}`;
    refs.set(ref, row.cardId);
    const accepted = ACCEPTED.has(row.decision);
    return {
      ref,
      category: CATEGORIES.has(row.category) ? row.category : 'other',
      lane: row.lane && LANES.has(row.lane) ? row.lane : null,
      size: row.size && SIZES.has(row.size) ? row.size : null,
      risk: row.risk && RISKS.has(row.risk) ? row.risk : null,
      words: titleWords(row.title, tenantNames),
      decision: row.decision,
      reasonChip:
        row.reasonChip && CHIP.test(row.reasonChip) ? row.reasonChip : null,
      feedbackChips: (row.feedbackChips ?? [])
        .filter((chip) => typeof chip === 'string' && CHIP.test(chip))
        .slice(0, 4),
      ...(accepted
        ? {
            outcome: {
              merged: row.merged,
              released: row.released,
              buildFailed: row.buildFailed,
              reverted: row.reverted,
            },
          }
        : {}),
      ...(row.impact ? { impact: row.impact } : {}),
      weeksAgo: Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(row.decidedAt).getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        ),
      ),
    };
  });
  return { rows: packed, refs };
}

/** One JSON line per row, neutralised so nothing in it can close a fence. */
export function renderDataPack(rows: Record<string, unknown>[]): string {
  return neutralise(rows.map((row) => JSON.stringify(row)).join('\n'));
}

const stringList = (
  value: unknown,
  allowed: (item: string) => boolean,
  max: number,
): string[] | 'invalid' | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > max) return 'invalid';
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return 'invalid';
    const clean = item.trim().toLowerCase();
    const normal = allowed(item.trim()) ? item.trim() : clean;
    if (!allowed(normal)) return 'invalid';
    if (!out.includes(normal)) out.push(normal);
  }
  return out.length ? out : undefined;
};

/** Schema check of one submitted lesson: the candidate, or why it is invalid. */
export function validateLessonInput(
  raw: unknown,
  tenantNames: string[] = [],
): { candidate?: PmLessonCandidate; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'each lesson must be an object' };
  }
  const item = raw as Record<string, unknown>;
  const allowedKeys = new Set(['text', 'expects', 'predicate', 'citedRefs']);
  const extra = Object.keys(item).filter((key) => !allowedKeys.has(key));
  if (extra.length) return { error: `unknown field(s): ${extra.join(', ')}` };

  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (text.length < PM_LESSONS.TEXT_MIN || text.length > PM_LESSONS.TEXT_MAX) {
    return {
      error: `text must be ${PM_LESSONS.TEXT_MIN}-${PM_LESSONS.TEXT_MAX} characters`,
    };
  }
  if (looksLikeInjection(text) || /[<>]/.test(text)) {
    return {
      error: 'text must be a plain statement, not instructions or markup',
    };
  }
  if (scrubForPublic(text, { tenantNames }) !== text) {
    return { error: 'text must not name organisations, people, ids or hosts' };
  }
  if (item.expects !== 'accept' && item.expects !== 'reject') {
    return { error: 'expects must be "accept" or "reject"' };
  }
  const p = item.predicate;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { error: 'predicate must be an object' };
  }
  const pred = p as Record<string, unknown>;
  const predKeys = new Set(['categories', 'lanes', 'sizes', 'risks', 'words']);
  const extraPred = Object.keys(pred).filter((key) => !predKeys.has(key));
  if (extraPred.length) {
    return { error: `unknown predicate field(s): ${extraPred.join(', ')}` };
  }
  const predicate: PmLessonPredicate = {};
  const fields: [keyof PmLessonPredicate, (s: string) => boolean, number][] = [
    ['categories', (s) => CATEGORIES.has(s), 3],
    ['lanes', (s) => LANES.has(s), 3],
    ['sizes', (s) => SIZES.has(s), 2],
    ['risks', (s) => RISKS.has(s), 3],
    ['words', (s) => WORD.test(s), 5],
  ];
  for (const [key, allowed, max] of fields) {
    const list = stringList(pred[key], allowed, max);
    if (list === 'invalid') {
      return { error: `predicate.${key} has an unknown or malformed value` };
    }
    if (list) predicate[key] = list;
  }
  if (!Object.keys(predicate).length) {
    return { error: 'predicate must narrow by at least one field' };
  }
  return { candidate: { text, expects: item.expects, predicate } };
}

export function matchesPredicate(
  row: PmLessonDecisionRow,
  predicate: PmLessonPredicate,
): boolean {
  if (
    predicate.categories?.length &&
    !predicate.categories.includes(row.category)
  )
    return false;
  if (
    predicate.lanes?.length &&
    !(row.lane && predicate.lanes.includes(row.lane))
  )
    return false;
  if (
    predicate.sizes?.length &&
    !(row.size && predicate.sizes.includes(row.size))
  )
    return false;
  if (
    predicate.risks?.length &&
    !(row.risk && predicate.risks.includes(row.risk))
  )
    return false;
  if (predicate.words?.length) {
    const title = tokenSet(row.title);
    if (!predicate.words.some((word) => tokens(word).some((t) => title.has(t))))
      return false;
  }
  return true;
}

/** Support recomputed from the data; the model's own claims are never read. */
export function computeSupport(
  rows: PmLessonDecisionRow[],
  candidate: Pick<PmLessonCandidate, 'expects' | 'predicate'>,
): PmLessonSupport {
  const matching = rows.filter((row) =>
    matchesPredicate(row, candidate.predicate),
  );
  const agrees = candidate.expects === 'accept' ? isPositive : isNegative;
  const supporting = matching.filter(agrees);
  return {
    matching: matching.length,
    supporting: supporting.length,
    ratio: matching.length ? supporting.length / matching.length : 0,
    supportingCardIds: supporting
      .slice(0, PM_LESSONS.EVIDENCE_MAX)
      .map((row) => row.cardId),
  };
}

export function isSupported(support: PmLessonSupport): boolean {
  return (
    support.supporting >= PM_LESSONS.MIN_SUPPORT &&
    support.ratio >= PM_LESSONS.MIN_CONSISTENCY
  );
}

/** Scope from the predicate, not from what the model said. */
export function deriveScope(predicate: PmLessonPredicate): {
  scope: PmLessonScope;
  category: string | null;
  lane: string | null;
} {
  const cats = predicate.categories ?? [];
  const lanes = predicate.lanes ?? [];
  if (cats.length === 1 && !lanes.length) {
    return { scope: PmLessonScope.CATEGORY, category: cats[0], lane: null };
  }
  if (lanes.length === 1 && !cats.length) {
    return { scope: PmLessonScope.LANE, category: null, lane: lanes[0] };
  }
  return { scope: PmLessonScope.GLOBAL, category: null, lane: null };
}

const CATEGORY_PHRASES =
  /\b(ui|ux|user interface|product|architecture|code[ -]health|infra|infrastructure|costs?|strategy|content)\b/i;
const FORBID =
  /\b(never|don'?t|do not|avoid|stop|forbid|ban|no more|skip|drop|de-?prioriti[sz]e[sd]?|deprioriti[sz]ing|fewer|less often|lower priority|not propose|reject all)\b/i;
const MANDATE =
  /\b(mandate|strategy|strategic|focus|priorit(y|ies|i[sz]e[sd]?))\b/i;
const RISK_SIZE =
  /\b(risk|risks|risky|riskier|size|sized|sizes|large|larger|big|bigger|small|smaller|limit|limits|cap|caps|high-risk|low-risk)\b/i;

/**
 * Deterministic: does this lesson need an admin's confirm before it is active? Yes when it
 * forbids or de-prioritises a whole category (or lane), touches the mandate or strategy, or
 * concerns risk or size limits. Over-asking is the accepted failure mode.
 */
export function classifyRequiresConfirm(candidate: PmLessonCandidate): boolean {
  const { text, expects, predicate } = candidate;
  if (predicate.sizes?.length || predicate.risks?.length) return true;
  if (RISK_SIZE.test(text) || MANDATE.test(text)) return true;
  const wholeScope =
    !predicate.words?.length &&
    Boolean(predicate.categories?.length || predicate.lanes?.length);
  if (expects === 'reject' && wholeScope) return true;
  if (FORBID.test(text) && (wholeScope || CATEGORY_PHRASES.test(text)))
    return true;
  return false;
}

/** Stable identity of "the same condition and direction" for dedupe and the row key. */
export function predicateSignature(
  candidate: Pick<PmLessonCandidate, 'expects' | 'predicate'>,
): string {
  const sorted: Record<string, string[]> = {};
  for (const key of Object.keys(candidate.predicate).sort()) {
    sorted[key] = [
      ...(candidate.predicate[key as keyof PmLessonPredicate] ?? []),
    ].sort();
  }
  return createHash('sha256')
    .update(JSON.stringify({ expects: candidate.expects, predicate: sorted }))
    .digest('hex')
    .slice(0, 24);
}

/** Same idea as an existing text (the dedupe threshold the gate uses). */
export function sameIdea(a: string, b: string): boolean {
  return similarity(a, b) >= PM_DEDUPE.DUPLICATE_THRESHOLD;
}
