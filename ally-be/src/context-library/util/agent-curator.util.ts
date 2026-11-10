import { CL_AGENT_UNUSED_AFTER_REPORTS } from '../constants/context-library.constants';

/**
 * The agent curator's pure half: reading the model's operations, and the evidence rules that
 * retire an agent-written chunk. The service around it only fetches rows and applies changes.
 */

/** ExpeL's four operations, as the curator model answers them. */
export interface CuratorOperation {
  op: 'AGREE' | 'EDIT' | 'ADD' | 'REMOVE';
  /** The chunk acted on, by code. */
  id?: string;
  /** AGREE only: the candidate folded into `id`. */
  candidateId?: string;
  /** EDIT: the new wording; ADD: an optional tightened wording. */
  text?: string;
  /** A category value, for collections that have one. */
  category?: string;
  tags?: string[];
}

const OPS = new Set(['AGREE', 'EDIT', 'ADD', 'REMOVE']);

const normaliseOperation = (entry: any): CuratorOperation | null => {
  const op = String(entry?.op ?? '').toUpperCase();
  if (!OPS.has(op)) return null;
  // The old curators' prompts named the text `lesson` (Builder) and `body` (Bug Hunter); a
  // Skills Store version still written that way keeps working.
  const text = entry?.text ?? entry?.body ?? entry?.lesson;
  return {
    op: op as CuratorOperation['op'],
    id: entry?.id ? String(entry.id).trim() : undefined,
    candidateId: entry?.candidateId
      ? String(entry.candidateId).trim()
      : undefined,
    text: text ? String(text) : undefined,
    category: entry?.category ? String(entry.category) : undefined,
    tags: Array.isArray(entry?.tags)
      ? normaliseLabels(entry.tags).slice(0, 8)
      : undefined,
  };
};

/**
 * The operations out of the model's answer. Tolerant by design: an object with `operations`, a
 * bare array, or either inside a fence. Anything unreadable means no operations, which the
 * caller turns into "promote the candidates uncurated" rather than a failure — an uncurated
 * lesson still beats a lost one.
 */
export function parseCuratorOperations(answer: unknown): CuratorOperation[] {
  const fromValue = (value: unknown): CuratorOperation[] | null => {
    const list = Array.isArray(value)
      ? value
      : (value as { operations?: unknown })?.operations;
    if (!Array.isArray(list)) return null;
    return list.map(normaliseOperation).filter(Boolean) as CuratorOperation[];
  };
  if (typeof answer !== 'string') return fromValue(answer) ?? [];
  const texts = [
    ...[...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]),
    answer,
  ];
  for (const raw of texts) {
    const trimmed = raw.trim();
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    try {
      const parsed = fromValue(JSON.parse(trimmed.slice(start)));
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }
  return [];
}

/** Lower-case, trimmed, de-duplicated open labels (tags, repos). */
export function normaliseLabels(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((v) =>
          String(v ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter((v) => v.length > 0 && v.length <= 80),
    ),
  ];
}

export function mergeLabels(a: unknown, b: unknown, max = 20): string[] {
  return [...new Set([...normaliseLabels(a), ...normaliseLabels(b)])].slice(
    0,
    max,
  );
}

export interface AgentEvidence {
  sourceCount: number;
  timesApplied: number;
  timesContradicted: number;
}

/**
 * Evidence, not recency: independent sightings plus times applied, penalised for being
 * contradicted. What ranks the always-on lists and decides who leaves when the set is full.
 */
export function agentEvidenceScore(e: AgentEvidence): number {
  return e.sourceCount + e.timesApplied - 2 * e.timesContradicted;
}

export interface AgentRetirementStats extends AgentEvidence {
  pinned: boolean;
  /** Runs that reported what they used, were shown this chunk, and did not apply it. */
  unusedReports: number;
}

/**
 * The usage half of the agent curator (§8: "lessons never applied after N surfacings, or
 * contradicted more often than applied, are retired"). Returns the reason, in words an admin
 * reads in Insights, or null when the chunk stays. Pinned chunks are a person outranking the
 * agent and never retire.
 */
export function agentRetirementDecision(
  s: AgentRetirementStats,
): string | null {
  if (s.pinned) return null;
  // One bad night cannot do it: a fresh chunk has one sighting, so two contradictions are the
  // floor. A pattern can.
  if (s.timesContradicted > s.timesApplied + s.sourceCount) {
    return `Reported wrong ${s.timesContradicted} times against ${s.timesApplied} applied and ${s.sourceCount} independent sighting${s.sourceCount === 1 ? '' : 's'}`;
  }
  if (
    s.timesApplied === 0 &&
    s.unusedReports >= CL_AGENT_UNUSED_AFTER_REPORTS
  ) {
    return `Never applied: shown in ${s.unusedReports} runs that reported what they used, and none applied it`;
  }
  return null;
}

/** A wording that would cut a lesson mid-thought becomes a clipped statement plus the full body. */
export function splitAgentText(
  text: string,
  maxChars: number,
): { statement: string; body: string | null } {
  const flat = text.trim();
  if (flat.length <= maxChars) return { statement: flat, body: null };
  const cut = flat.slice(0, maxChars - 1);
  const atWord = cut.lastIndexOf(' ');
  return {
    statement: `${(atWord > maxChars * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`,
    body: flat,
  };
}
