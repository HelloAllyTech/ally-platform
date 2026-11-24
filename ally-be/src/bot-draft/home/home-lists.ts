import { versionOf } from './home-fields';

/**
 * The home's lists (chunk 20d-2), each changed one entry at a time with the version of the list
 * the change was based on. Pure: the service in `home-lists.service.ts` reads and writes them.
 */
export const HOME_LISTS = [
  'pageAccess',
  'audience',
  'team',
  'documents',
  'quickReplies',
] as const;

export type HomeListName = (typeof HOME_LISTS)[number];

/** One entry as the home shows it; every list's entries have an `id`. */
export type HomeListItem = { id: string } & Record<string, unknown>;

export interface ListChange {
  op: 'add' | 'edit' | 'remove' | 'reorder';
  /** The entry an edit or remove is about. */
  id?: string;
  /** What to add, or the edited fields. */
  item?: Record<string, unknown>;
  /** Quick replies only: the new order. */
  ids?: string[];
  version: string;
}

/** The list's version: a hash of its entries in order (an order change is a change). */
export function listVersion(items: HomeListItem[]): string {
  return versionOf(items);
}

/** A quick reply as the home shows it: the bot's own, or one of Ally's defaults (reworded or not). */
export function quickReplyOf(template: {
  id: string;
  kind: string;
  name: string;
  patterns: string[];
  responseText: string;
  active: boolean;
  mandatory: boolean;
  state?: string;
  overridesTemplateId?: string | null;
  defaultResponseText?: string;
  /** Stage 5 (D6): a chatbot's copy of a required reply; its wording is Ally's. */
  locked?: boolean;
  /** Regional numbers added to a locked reply. */
  extraNumbers?: string[] | null;
}): HomeListItem {
  return {
    id: template.id,
    kind: template.kind,
    name: template.name,
    patterns: template.patterns ?? [],
    responseText: template.responseText,
    active: template.active,
    required: Boolean(template.mandatory),
    state: template.state ?? 'own',
    defaultId: template.overridesTemplateId ?? null,
    defaultResponseText: template.defaultResponseText ?? null,
    // A required reply (crisis, STOP, START, consent) is locked whether or not the bot has its copy
    // yet: its wording can't be changed here, only regional numbers added.
    locked: Boolean(template.locked || template.mandatory),
    extraNumbers: template.extraNumbers ?? [],
  };
}
