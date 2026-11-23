import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import type { ListDefinitionView } from '../lists/list-definitions.service';

/**
 * How an entry is put into words for the consent question and the card (Q4 G5, Round 7 R5:
 * "Shall I book 0 on Bandra Sunday food drive?", a callback card titled "Booked", no time on a
 * registration card).
 */

/** The day, time and place of the entry an entry points at (a registration's event, a booking's slot). */
export interface RelatedWords {
  when?: string;
  where?: string;
}

const PLACE = /venue|location|place|address|where|centre|center|branch|hub/i;
/** Names that are never a person's: a contact with no name yet, or Try it's test visitor. */
const NOT_A_NAME =
  /^(?:a contact|visitor\b|unknown|someone|try it\b|test visitor)/i;

export function isRealName(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return Boolean(v) && !NOT_A_NAME.test(v);
}

/** The related entry's day and time, and its place, as its list displays them. */
export function relatedWords(
  list: ListDefinitionView,
  display: Record<string, string>,
): RelatedWords {
  const live = list.fields.filter((f) => !f.archived_at && !f.privacy?.masked);
  const time = live.find(
    (f) =>
      (f.type === ListFieldType.DATETIME || f.type === ListFieldType.DATE) &&
      String(display[f.key] ?? '').trim(),
  );
  const place = live.find(
    (f) =>
      (f.type === ListFieldType.TEXT || f.type === ListFieldType.LONG_TEXT) &&
      PLACE.test(`${f.key} ${f.label}`) &&
      String(display[f.key] ?? '').trim(),
  );
  return {
    ...(time ? { when: String(display[time.key]).trim() } : {}),
    ...(place ? { where: String(display[place.key]).trim() } : {}),
  };
}

/** A number field at its default (Guests 0): never said back, never on a card. */
export function atDefault(
  field: ListDefinitionView['fields'][number],
  value: unknown,
): boolean {
  if (field.type !== ListFieldType.NUMBER) return false;
  const n = Number(value);
  const d = Number(field.default ?? 0);
  return !Number.isFinite(n) || n === d || n === 0;
}

/**
 * How many places a booking takes on a list with a capacity rule: one for the person, plus any
 * extra people a number field counts (guests). Null on a list without one.
 */
export function placesFor(
  list: ListDefinitionView,
  data: Record<string, unknown>,
): number | null {
  if (!list.rules?.some((r) => r.kind === ListConstraintKind.CAPACITY)) {
    return null;
  }
  const extra = list.fields
    .filter((f) => !f.archived_at && f.type === ListFieldType.NUMBER)
    .reduce((sum, f) => sum + Math.max(0, Number(data[f.key] ?? 0) || 0), 0);
  return 1 + extra;
}

/** "1 place", "3 places". */
export const placesWords = (n: number): string =>
  `${n} ${n === 1 ? 'place' : 'places'}`;
export const placesWordsHi = (n: number): string => `${n} जगह`;

/** What a card says happened (Q4 G5); the page words it in the person's language. */
export type CardHeadline =
  | 'booked'
  | 'registered'
  | 'callback'
  | 'application'
  | 'order'
  | 'request'
  | 'sent'
  | 'saved'
  | 'changed'
  | 'cancelled';

/**
 * The card's headline, by what the list is for (Q4 G5): never "Booked" for a callback. From the
 * list's own key and name, so a template's lists and an owner's own get the right word.
 */
export function headlineFor(
  list: Pick<ListDefinitionView, 'key' | 'name'>,
  action: 'create' | 'update' | 'cancel',
  booking: boolean,
): CardHeadline {
  if (action === 'cancel') return 'cancelled';
  if (action === 'update') return 'changed';
  const what = `${list.key} ${list.name}`.toLowerCase();
  if (/callback|call.?back/.test(what)) return 'callback';
  if (/registration|sign.?up|signup/.test(what)) return 'registered';
  if (/application/.test(what)) return 'application';
  if (/order/.test(what)) return 'order';
  if (/ticket|complaint|support/.test(what)) return 'request';
  if (/enquir|lead|question|feedback|request/.test(what)) return 'sent';
  return booking ? 'booked' : 'saved';
}
