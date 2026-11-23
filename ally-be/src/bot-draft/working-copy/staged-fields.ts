import { versionOf } from '../home/home-fields';
import type { BotDraft } from '../type/bot-draft.type';

/**
 * Stage 3, "What Apply covers" (plan section 3): the fields that shape answers. On a chatbot that
 * has gone live they live in the working copy and reach customers only on Apply. Operational
 * controls (access list, people, budgets, status, archive, retention) are never part of the working
 * copy: they change the live chatbot at once through their own routes.
 *
 * Quick replies are staged in the plan too; they are still per-chatbot templates written by their
 * own screen, and move into the working copy with D6 (stage 5).
 */
export const STAGED_FIELDS = [
  'name',
  'assistantName',
  'introduction',
  'tone',
  'instructions',
  'languages',
  'suggestedQuestions',
  'declineText',
  'extraNever',
  'ownerNotes',
] as const;
export type StagedField = (typeof STAGED_FIELDS)[number];

/** The pseudo-field for documents and addresses added to a live chatbot, waiting for Apply. */
export const SOURCES_FIELD = 'sources';

/**
 * "Apply and AI cost": only these change what the assistant may say or how, so only they run the
 * safety check on Apply, and only they are refused at $0. Name, greeting and suggested questions
 * apply with no model call.
 */
export const SAFETY_RELEVANT: ReadonlySet<string> = new Set<string>([
  'assistantName',
  'tone',
  'instructions',
  'languages',
  'declineText',
  'extraNever',
  'ownerNotes',
  SOURCES_FIELD,
]);

/**
 * The working-copy fields an owner may edit one at a time (per-field versions). Everything the
 * owner could already patch on the draft except `access`, which is an operational control.
 */
export const EDITABLE_FIELDS = [
  ...STAGED_FIELDS,
  'topics',
  'prechat',
  'branding',
  'design',
  'purpose',
  'purposeNote',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const isEditableField = (field: string): field is EditableField =>
  (EDITABLE_FIELDS as readonly string[]).includes(field);

/** A field's version: a hash of its value (the same scheme as the assistant home). */
export const fieldVersion = (value: unknown): string => versionOf(value);

/** A staged field's value in the working copy, normalised as the live side reads it. */
export function workingValue(config: BotDraft, field: StagedField): unknown {
  const value = config[field];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return [...value];
  return value ?? null;
}

export function workingValues(config: BotDraft): Record<StagedField, unknown> {
  const out = {} as Record<StagedField, unknown>;
  for (const field of STAGED_FIELDS) out[field] = workingValue(config, field);
  return out;
}

/**
 * The settings hash a test reply carries, so the pane can mark a reply made on older settings
 * without the draft's version: every staged value, the safety pack and the documents it answers
 * from (attached and staged).
 */
export function settingsHash(
  config: BotDraft,
  pendingDocumentIds: string[] = [],
): string {
  return versionOf({
    fields: workingValues(config),
    pack: config.safetyPackId,
    documents: [...(config.knowledgeDocumentIds ?? [])].sort(),
    pending: [...pendingDocumentIds].sort(),
  });
}

/** One row of the pending diff. */
export interface PendingChange {
  field: StagedField | typeof SOURCES_FIELD;
  live: unknown;
  working: unknown;
  liveVersion: string;
  workingVersion: string;
  /** Runs the safety check on Apply, and is refused at $0. */
  safetyRelevant: boolean;
  /** The live value also changed elsewhere since the working copy last agreed with it. */
  liveChangedElsewhere: boolean;
}

/**
 * The three-way merge between the working copy and the live chatbot, per field. `base` is the hash
 * of the live value the working copy last agreed with:
 * - no base yet (an older draft, or a chatbot made by hand): the working copy adopts the live value;
 * - working unchanged since base, live changed elsewhere (the old home screen): adopt live;
 * - working equals live: in step, the base moves to it;
 * - otherwise the field is pending, and Apply writes the working value.
 */
export function mergeWithLive(
  working: Record<StagedField, unknown>,
  live: Record<StagedField, unknown>,
  base: Record<string, string>,
): {
  adopt: Partial<Record<StagedField, unknown>>;
  base: Record<string, string>;
  pending: StagedField[];
  conflicted: StagedField[];
} {
  const adopt: Partial<Record<StagedField, unknown>> = {};
  const nextBase: Record<string, string> = { ...base };
  const pending: StagedField[] = [];
  const conflicted: StagedField[] = [];
  for (const field of STAGED_FIELDS) {
    const w = fieldVersion(working[field]);
    const l = fieldVersion(live[field]);
    const b = base[field];
    if (w === l) {
      nextBase[field] = l;
    } else if (b === undefined || w === b) {
      adopt[field] = live[field];
      nextBase[field] = l;
    } else {
      pending.push(field);
      if (l !== b) conflicted.push(field);
    }
  }
  return { adopt, base: nextBase, pending, conflicted };
}
