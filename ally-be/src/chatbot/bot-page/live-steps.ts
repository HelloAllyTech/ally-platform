import type {
  AgentActivity,
  AgentActivityKind,
} from '../../ai/dto/knowledge.dto';
import type { CardHeadline } from '../agent-tools/entry-words';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import type { ChatbotDecision } from '../engine/chatbot-engine.types';

/**
 * The live steps a visitor sees on the bot page and in the bubble (chunk 6b, section E): what the
 * assistant is doing while it works, and what it did once it has replied. Built only from ally-ai's
 * `activity` (a kind, a list's name and a record's title), through a whitelist: never a tool or
 * field name, an id, a search query, memory text or a refusal's code. The page words each kind.
 */

/** One step as the page gets it. `label` is the list's name, or the day and time a write is for. */
export interface PublicStep {
  kind: Exclude<AgentActivityKind, 'writing'> | 'writing';
  label?: string;
}

/** A booking or change made in this reply, from the stored record (never the model's words). */
export interface PublicConfirmation {
  /** What changed: booked, changed or cancelled. */
  action: 'create' | 'update' | 'cancel';
  /** The list, as the owner named it. */
  list: string;
  /** The record's title: the day and time for a booking. */
  title: string;
  /** Up to four other details the person may see (when, where, service, status). */
  details: { label: string; value: string }[];
  /** What happened, by what the list is for (Q4 G5): the page words it. */
  headline?: CardHeadline;
}

const KINDS = new Set<AgentActivityKind>([
  'search',
  'find',
  'create',
  'update',
  'cancel',
  'hand_over',
  'writing',
]);
const MAX_LABEL = 80;
const ID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}|\b[0-9a-f]{12,}\b/i;
// A title shown only when it reads as a day or a time ("Thu 19 Nov 2026, 11:00"): a write's other
// titles (a lead's name, a reason) stay off the page.
const WHEN =
  /\b\d{1,2}[:.]\d{2}\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

const clean = (value: unknown): string | undefined => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL);
  return text && !ID_LIKE.test(text) ? text : undefined;
};

/** One activity as a visitor may see it, or null for anything outside the whitelist. */
export function publicStep(activity: AgentActivity): PublicStep | null {
  if (!activity || !KINDS.has(activity.kind)) return null;
  const kind = activity.kind;
  let label: string | undefined;
  if (kind === 'find') {
    label = clean(activity.list);
  } else if (kind === 'create' || kind === 'update' || kind === 'cancel') {
    const title = clean(activity.title);
    label = title && WHEN.test(title) ? title : undefined;
  }
  return label ? { kind, label } : { kind };
}

/** Replies after which the page shows what the assistant did: its own answers, never a crisis or
 * Safety reply, a template, the consent gate or a team member's. */
const SHOWS_STEPS = new Set<string>([
  WaHandledBy.RAG,
  WaHandledBy.CLARIFIED,
  WaHandledBy.DECLINED,
  WaHandledBy.HANDOVER,
]);

/** What the run did, for the "what I did" line: empty for a v1 or crisis reply. */
export function doneSteps(decision: ChatbotDecision): PublicStep[] {
  const agent = decision.agent;
  if (!agent || agent.runtime !== AgentRuntimeUsed.V2) return [];
  if (!SHOWS_STEPS.has(decision.handledBy)) return [];
  return (agent.activity ?? [])
    .filter((a) => a.kind !== 'writing')
    .map(publicStep)
    .filter((s): s is PublicStep => s !== null);
}

/** The write a confirmation card is for: the last booking, change or cancel with its record. */
export function confirmedWrite(
  decision: ChatbotDecision,
): (AgentActivity & { record_id: string }) | null {
  const agent = decision.agent;
  if (!agent || agent.runtime !== AgentRuntimeUsed.V2) return null;
  if (!SHOWS_STEPS.has(decision.handledBy)) return null;
  const writes = (agent.activity ?? []).filter(
    (a): a is AgentActivity & { record_id: string } =>
      ['create', 'update', 'cancel'].includes(a.kind) && Boolean(a.record_id),
  );
  return writes[writes.length - 1] ?? null;
}
