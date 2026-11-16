import type { CollectionField } from '../entity/collection-field.entity';
import { ListFieldType } from '../enum/list.enum';
import { refuse } from './list-refusals';

/** List keys and field keys: lower case, digits and `_`, at most 40 characters. */
export const KEY_SLUG = /^[a-z0-9_]{1,40}$/;

/** Keys a field can't take: the record's own columns, which CSV and the API use beside the data. */
export const RESERVED_FIELD_KEYS = new Set([
  'id',
  'version',
  'contact_id',
  'created_at',
  'updated_at',
  'created_by',
  'deleted_at',
]);

export const NUMERIC_TYPES = new Set([
  ListFieldType.NUMBER,
  ListFieldType.MONEY,
  ListFieldType.DURATION,
]);
export const RANGE_TYPES = new Set([
  ...NUMERIC_TYPES,
  ListFieldType.DATE,
  ListFieldType.DATETIME,
]);
export const CONTAINS_TYPES = new Set([
  ListFieldType.TEXT,
  ListFieldType.LONG_TEXT,
  ListFieldType.PHONE,
  ListFieldType.EMAIL,
  ListFieldType.URL,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** ISO 8601 with an offset: stored as given, so the wall time the owner meant is kept. */
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const MAX_TEXT = 1_000;
const MAX_LONG_TEXT = 10_000;

/** A relation's target: a contact of the same bot, or another list of the same bot (by key). */
export const relationTarget = (field: Pick<CollectionField, 'options'>) =>
  String((field.options as { to?: unknown }).to ?? '');
export const isContactRelation = (
  field: Pick<CollectionField, 'type' | 'options'>,
): boolean =>
  field.type === ListFieldType.RELATION && relationTarget(field) === 'contact';
export const selectValues = (field: Pick<CollectionField, 'options'>) =>
  ((field.options as { values?: unknown }).values as string[]) ?? [];

function validDate(y: string, m: string, d: string): boolean {
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  return (
    date.getUTCFullYear() === +y &&
    date.getUTCMonth() === +m - 1 &&
    date.getUTCDate() === +d
  );
}

/**
 * A field definition's options, checked and normalised for its type. Throws `invalid_value` with
 * a plain reason.
 */
export function normaliseOptions(
  key: string,
  label: string,
  type: ListFieldType,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const options = raw ?? {};
  switch (type) {
    case ListFieldType.SELECT: {
      const values = options.values;
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > 100 ||
        values.some(
          (v) => typeof v !== 'string' || !v.trim() || v.length > 100,
        ) ||
        new Set(values).size !== values.length
      ) {
        throw refuse.invalidValue(
          key,
          label,
          'a select needs 1 to 100 different values',
        );
      }
      return { values: values.map((v: string) => v.trim()) };
    }
    case ListFieldType.RELATION: {
      const to = options.to;
      if (typeof to !== 'string' || !(to === 'contact' || KEY_SLUG.test(to))) {
        throw refuse.invalidValue(
          key,
          label,
          "a relation points at 'contact' or another list's key",
        );
      }
      return { to };
    }
    case ListFieldType.MONEY: {
      const currency = options.currency ?? 'INR';
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
        throw refuse.invalidValue(
          key,
          label,
          'the currency is a 3-letter code',
        );
      }
      return { currency };
    }
    default:
      return {};
  }
}

/**
 * One value, checked and normalised for its field. Empty (`null`, `undefined`, `''`) is `null`.
 * Strings are accepted for numbers and yes/no, so CSV cells go through the same check. A relation
 * is only checked for shape here; that its target exists and is live is checked in the write.
 */
export function normaliseValue(
  field: Pick<CollectionField, 'key' | 'label' | 'type' | 'options'>,
  raw: unknown,
): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const bad = (why: string) => refuse.invalidValue(field.key, field.label, why);
  const text = typeof raw === 'string' ? raw.trim() : null;

  switch (field.type) {
    case ListFieldType.TEXT:
    case ListFieldType.LONG_TEXT: {
      if (typeof raw !== 'string') throw bad('it should be text');
      const max = field.type === ListFieldType.TEXT ? MAX_TEXT : MAX_LONG_TEXT;
      if (raw.length > max) throw bad(`it's longer than ${max} characters`);
      return field.type === ListFieldType.TEXT ? raw.trim() : raw;
    }
    case ListFieldType.NUMBER:
    case ListFieldType.MONEY:
    case ListFieldType.DURATION: {
      const n =
        typeof raw === 'number' ? raw : text !== null ? Number(text) : NaN;
      if (!Number.isFinite(n)) throw bad('it should be a number');
      if (field.type === ListFieldType.DURATION) {
        if (!Number.isInteger(n) || n < 0) {
          throw bad('it should be a whole number of minutes');
        }
      }
      if (field.type === ListFieldType.MONEY) {
        return Math.round(n * 100) / 100;
      }
      return n;
    }
    case ListFieldType.DATE: {
      const m = text !== null ? DATE.exec(text) : null;
      if (!m || !validDate(m[1], m[2], m[3])) {
        throw bad('it should be a date like 2026-11-20');
      }
      return text;
    }
    case ListFieldType.DATETIME: {
      const m = text !== null ? DATETIME.exec(text) : null;
      if (
        !m ||
        !validDate(m[1], m[2], m[3]) ||
        +m[4] > 23 ||
        +m[5] > 59 ||
        (m[6] !== undefined && +m[6] > 59) ||
        Number.isNaN(Date.parse(text!))
      ) {
        throw bad(
          'it should be a date and time with its offset, like 2026-11-20T11:15:00+05:30',
        );
      }
      return text;
    }
    case ListFieldType.SELECT: {
      const values = selectValues(field);
      if (text === null || !values.includes(text)) {
        throw bad(`it should be one of ${values.join(', ')}`);
      }
      return text;
    }
    case ListFieldType.BOOLEAN: {
      if (typeof raw === 'boolean') return raw;
      const t = text?.toLowerCase();
      if (t === 'true' || t === 'yes') return true;
      if (t === 'false' || t === 'no') return false;
      throw bad('it should be yes or no');
    }
    case ListFieldType.PHONE: {
      const phone = text?.replace(/[\s().-]/g, '') ?? '';
      if (!PHONE.test(phone)) throw bad("it isn't a phone number");
      return phone;
    }
    case ListFieldType.EMAIL: {
      if (text === null || text.length > 254 || !EMAIL.test(text)) {
        throw bad("it isn't an email address");
      }
      return text;
    }
    case ListFieldType.URL: {
      let url: URL | null = null;
      try {
        url = text !== null && text.length <= 2_000 ? new URL(text) : null;
      } catch {
        url = null;
      }
      if (!url || !['http:', 'https:'].includes(url.protocol)) {
        throw bad("it isn't a web address");
      }
      return text;
    }
    case ListFieldType.RELATION: {
      if (text === null || !UUID.test(text)) {
        throw bad("it should be an entry's id");
      }
      return text.toLowerCase();
    }
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Thu 13 Nov 2026", from the date's own parts (no time zone involved). */
function showDate(y: string, m: string, d: string): string {
  const weekday = new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${+d} ${MONTHS[+m - 1]} ${y}`;
}

/**
 * A value for people to read. Dates and times show the wall time they were stored with: the
 * owner's own time. A relation's title is resolved by the caller.
 */
export function displayValue(
  field: Pick<CollectionField, 'type' | 'options'>,
  value: unknown,
): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case ListFieldType.DATE: {
      const m = DATE.exec(String(value));
      return m ? showDate(m[1], m[2], m[3]) : String(value);
    }
    case ListFieldType.DATETIME: {
      const m = DATETIME.exec(String(value));
      return m
        ? `${showDate(m[1], m[2], m[3])}, ${m[4]}:${m[5]}`
        : String(value);
    }
    case ListFieldType.BOOLEAN:
      return value ? 'Yes' : 'No';
    case ListFieldType.MONEY:
      return `${String((field.options as { currency?: string }).currency ?? 'INR')} ${value}`;
    case ListFieldType.DURATION:
      return `${value} min`;
    default:
      return String(value);
  }
}

/** The agent's view of a masked value: its last 4 characters. */
export function maskValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > 4 ? `••••${s.slice(-4)}` : '••••';
}
