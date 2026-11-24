import { createHash } from 'crypto';
import { CRISIS_SUITE } from '../../../chatbot/safety/crisis-suite/crisis-suite';
import { isHealthPack, type SafetyPack } from '../safety-packs';

/**
 * Stage 9: the pure rules of a safety-pack release — what a curator may change, the diff between
 * two versions, the content hash a suite result is tied to, and the release gate. No I/O here, so
 * every rule is unit-tested on its own.
 */

export type ReleaseStatus = 'draft' | 'testing' | 'released' | 'rolled_back';

/** One language's suite result (the shape `CrisisSuiteService` returns). */
export interface ReleaseLanguageResult {
  language: string;
  status: 'pass' | 'fail' | 'error';
  passed: number;
  total: number;
  failedCases: string[];
  checkedAt?: string;
}

export interface ReleaseTestResults {
  state: 'running' | 'done' | 'error';
  chatbotId: string;
  contentHash: string;
  suiteVersion: string;
  startedAt: string;
  startedBy: number | null;
  finishedAt?: string;
  languages: ReleaseLanguageResult[];
  allPassed: boolean;
  /** A short reason when the run itself failed (never a provider message). */
  error?: string;
}

/** The list fields a curator edits line by line. */
export const LIST_FIELDS = [
  'rules',
  'always',
  'never',
  'atRisk',
  'probes',
] as const;
/** The text fields a curator edits. */
export const TEXT_FIELDS = [
  'name',
  'industryLabel',
  'builderMessage',
  'disclaimer',
  'summary',
] as const;

type ListField = (typeof LIST_FIELDS)[number];
type TextField = (typeof TEXT_FIELDS)[number];

export type EditablePackContent = Partial<
  Pick<SafetyPack, ListField | TextField | 'requiredSettings'>
>;

export const MAX_LIST_ITEMS = 40;
export const MAX_LINE_CHARS = 1000;
/** A suite run nobody finished (the instance died) may be started again after this. */
export const SUITE_STALE_MS = 15 * 60_000;

/** Every language the crisis suite has curated cases for: a release must pass all of them. */
export function supportedLanguages(): string[] {
  return [...new Set(CRISIS_SUITE.cases.map((c) => c.language))].sort();
}

/** Stable hash of the content a suite ran on: a later edit makes the result stale. */
export function contentHash(pack: SafetyPack): string {
  const keys = Object.keys(pack).sort();
  const stable = JSON.stringify(pack, keys);
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

const cleanList = (list: unknown): string[] =>
  Array.isArray(list)
    ? list
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter(Boolean)
    : [];

export class ReleaseContentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * A draft's content after a curator's change. The pack id, version and strength never change
 * (packs can be raised, never weakened); the crisis classifier floor and a health pack's
 * disclaimer cannot be removed; rules cannot be emptied.
 */
export function applyEdit(
  base: SafetyPack,
  code: SafetyPack,
  change: EditablePackContent,
): SafetyPack {
  const next: SafetyPack = { ...base };
  for (const field of LIST_FIELDS) {
    if (change[field] === undefined) continue;
    const list = cleanList(change[field]);
    if (list.length > MAX_LIST_ITEMS)
      throw new ReleaseContentError('too_many_lines');
    if (list.some((line) => line.length > MAX_LINE_CHARS))
      throw new ReleaseContentError('line_too_long');
    next[field] = list;
  }
  for (const field of TEXT_FIELDS) {
    if (change[field] === undefined) continue;
    const value = change[field];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length > MAX_LINE_CHARS)
      throw new ReleaseContentError('line_too_long');
    if (field === 'disclaimer') next.disclaimer = text || null;
    else if (!text) throw new ReleaseContentError(`${field}_required`);
    else next[field] = text;
  }
  if (change.requiredSettings !== undefined) {
    next.requiredSettings = {
      crisisClassifierEnabled: Boolean(
        change.requiredSettings?.crisisClassifierEnabled,
      ),
    };
  }
  if (!next.rules.length) throw new ReleaseContentError('rules_required');
  if (
    code.requiredSettings.crisisClassifierEnabled &&
    !next.requiredSettings.crisisClassifierEnabled
  ) {
    throw new ReleaseContentError('classifier_floor');
  }
  if (isHealthPack(code.id) && !next.disclaimer) {
    throw new ReleaseContentError('disclaimer_required');
  }
  return { ...next, id: code.id, strength: code.strength };
}

/** A stored release's content as a full pack: missing fields come from code. */
export function materialise(
  code: SafetyPack,
  content: Partial<SafetyPack> | null | undefined,
  version: number,
): SafetyPack {
  return {
    ...code,
    ...(content ?? {}),
    id: code.id,
    strength: code.strength,
    version,
  };
}

export interface PackDiff {
  lists: Record<ListField, { added: string[]; removed: string[] }>;
  text: { field: TextField; from: string | null; to: string | null }[];
  classifier: { from: boolean; to: boolean } | null;
  changed: boolean;
}

/** What changed from `before` to `after`. */
export function diffPacks(before: SafetyPack, after: SafetyPack): PackDiff {
  let changed = false;
  const lists = {} as PackDiff['lists'];
  for (const field of LIST_FIELDS) {
    const a = before[field] ?? [];
    const b = after[field] ?? [];
    const added = b.filter((line) => !a.includes(line));
    const removed = a.filter((line) => !b.includes(line));
    if (added.length || removed.length) changed = true;
    lists[field] = { added, removed };
  }
  const text: PackDiff['text'] = [];
  for (const field of TEXT_FIELDS) {
    const from = (before[field] as string | null) ?? null;
    const to = (after[field] as string | null) ?? null;
    if (from !== to) {
      changed = true;
      text.push({ field, from, to });
    }
  }
  const from = before.requiredSettings.crisisClassifierEnabled;
  const to = after.requiredSettings.crisisClassifierEnabled;
  const classifier = from === to ? null : { from, to };
  if (classifier) changed = true;
  return { lists, text, classifier, changed };
}

/**
 * Why a release may not go out yet; empty means it may. Every supported language must pass, on
 * the exact content being released, with the current suite. There is no override.
 */
export function releaseBlockers(
  release: {
    status: ReleaseStatus;
    testResults: ReleaseTestResults | null;
  },
  pack: SafetyPack,
  languages = supportedLanguages(),
  suiteVersion = CRISIS_SUITE.version,
): string[] {
  if (release.status === 'released' || release.status === 'rolled_back')
    return ['already_released'];
  const results = release.testResults;
  if (!results) return ['not_tested'];
  if (results.state === 'running') return ['suite_running'];
  if (results.state !== 'done') return ['suite_error'];
  const out: string[] = [];
  if (results.contentHash !== contentHash(pack)) out.push('content_changed');
  if (results.suiteVersion !== suiteVersion) out.push('suite_outdated');
  if (!languages.length) out.push('no_languages');
  for (const language of languages) {
    const found = results.languages.find((l) => l.language === language);
    if (!found) out.push(`language_missing:${language}`);
    else if (found.status !== 'pass') out.push(`language_failed:${language}`);
  }
  return out;
}

const OWNER_FACING: ListField[] = ['always', 'never', 'atRisk'];

/**
 * The owner notice (no secrets: section counts and the owner-facing "what this covers" lines
 * only, never the curator's note or anything about other owners).
 */
export function noticeText(input: {
  kind: 'release' | 'rollback';
  packName: string;
  version: number;
  chatbotNames: string[];
  diff: PackDiff;
}): { subject: string; body: string } {
  const names =
    input.chatbotNames.length > 5
      ? `${input.chatbotNames.slice(0, 5).join(', ')} and ${input.chatbotNames.length - 5} more`
      : input.chatbotNames.join(', ');
  const lines: string[] = [];
  const ruleChanges = input.diff.lists.rules;
  if (ruleChanges.added.length || ruleChanges.removed.length) {
    // COPY: needs approval
    lines.push(
      `Rules given to your assistant: ${ruleChanges.added.length} added, ${ruleChanges.removed.length} removed.`,
    );
  }
  for (const field of OWNER_FACING) {
    for (const line of input.diff.lists[field].added.slice(0, 5))
      lines.push(`Added: ${line}`); // COPY: needs approval
    for (const line of input.diff.lists[field].removed.slice(0, 5))
      lines.push(`Removed: ${line}`); // COPY: needs approval
  }
  if (input.diff.text.length) {
    // COPY: needs approval
    lines.push('Some wording shown to you and your customers was updated.');
  }
  if (!lines.length) lines.push('No visible wording changed.'); // COPY: needs approval
  if (input.kind === 'rollback') {
    return {
      // COPY: needs approval
      subject: `Ally restored the earlier ${input.packName} safety rules`,
      // COPY: needs approval
      body: `Ally restored version ${input.version} of the ${input.packName} safety rules used by ${names}. The newer version was withdrawn.\n\n${lines.join('\n')}\n\nYou do not need to do anything.`,
    };
  }
  return {
    // COPY: needs approval
    subject: `Ally updated the ${input.packName} safety rules`,
    // COPY: needs approval
    body: `Ally updated the ${input.packName} safety rules used by ${names} to version ${input.version}. The update passed Ally's crisis check in every supported language before it went out.\n\n${lines.join('\n')}\n\nYou do not need to do anything.`,
  };
}
