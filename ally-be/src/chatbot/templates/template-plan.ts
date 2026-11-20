import { SafetyPackId } from '../../bot-draft/enum/bot-draft.enum';
import { ListFieldType } from '../enum/list.enum';
import type { ReadyMadeList } from '../lists/ready-made-lists';
import { listDefinition } from './template-lists';
import type {
  SetupQuestion,
  StarterCase,
  TemplateListUse,
  UseCaseTemplate,
} from './templates';

/**
 * What installing a template writes, worked out before anything is written (T1): pure, so every
 * template can be checked without a database. The install service writes it in one transaction.
 */

/** A setup answer: text, a yes or no, or the choices ticked. Left out or empty means skipped. */
export type SetupAnswer = string | boolean | string[];
export type SetupAnswers = Record<string, SetupAnswer | null | undefined>;

export interface PlannedEntry {
  values: Record<string, unknown>;
  /** A neutral example, for the owner to replace. */
  example: boolean;
}

export interface PlannedList {
  use: TemplateListUse;
  definition: ReadyMadeList;
}

/** A starter checkup question, filled in, as the checkup stores it. */
export interface PlannedCase {
  id: string;
  question: string;
  expect: StarterCase['expect'];
  facts: string[];
  mustNot: string[];
  alsoOk: string[];
  hardFail: boolean;
}

export interface InstallPlan {
  lists: PlannedList[];
  /** "Your services" choices, per list and detail. */
  options: Record<string, Record<string, string[]>>;
  entries: Record<string, PlannedEntry[]>;
  /** Lines for the owner's notes: "Question — answer". */
  facts: string[];
  helpline: string | null;
  /** The strictest pack the template and its answers ask for (applied only when stricter). */
  pack: SafetyPackId | null;
  languages: string[] | null;
  channels: string[] | null;
  cases: PlannedCase[];
  /** Setup questions left unanswered. */
  skipped: string[];
}

const LANGUAGE_TAGS: Record<string, string> = {
  English: 'en',
  Hindi: 'hi',
  Hinglish: 'hi-Latn',
};

/** An answer as text, or null when it was skipped. */
export function answerText(
  answer: SetupAnswer | null | undefined,
): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (Array.isArray(answer)) {
    const items = answer.map((a) => a.trim()).filter(Boolean);
    return items.length ? items.join(', ') : null;
  }
  const text = answer.trim();
  return text ? text.slice(0, 2000) : null;
}

/**
 * One item per line. For short choices ("Consultation, Follow-up"), a single line with commas is
 * one item per comma; never for entries, whose details can hold commas ("12 Station Road, Area 1").
 */
export function itemsOf(
  text: string,
  { commas = true }: { commas?: boolean } = {},
): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  if (commas && lines.length === 1 && lines[0].includes(',')) {
    return lines[0]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return lines;
}

/** A line's parts: "Haircut - 300", "Haircut: 300", "Haircut — 300". */
export function partsOf(line: string): string[] {
  return line
    .split(/\s+[-–—|]\s+|:\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** An amount in rupees from "₹1,200", "1200", "85 lakh" or "1.2 crore"; null if none. */
export function moneyOf(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(lakh|lac|l\b|crore|cr\b|k\b)?/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const scale =
    unit === 'crore' || unit === 'cr'
      ? 10_000_000
      : unit === 'lakh' || unit === 'lac' || unit === 'l'
        ? 100_000
        : unit === 'k'
          ? 1_000
          : 1;
  return Math.round(n * scale);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the zone, as y, m, d and the weekday (0 Sunday). */
function todayIn(zone: string, now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: days.indexOf(parts.weekday),
  };
}

/** The zone's offset at an instant, as "+05:30". */
function offsetOf(zone: string, at: Date): string {
  const name =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00';
}

/** `@today` and `@saturday 10:00` (the next Saturday, never today) in the business's zone. */
export function resolveWhen(value: unknown, zone: string, now: Date): unknown {
  if (typeof value !== 'string' || !value.startsWith('@')) return value;
  const today = todayIn(zone, now);
  const base = Date.UTC(today.y, today.m - 1, today.d);
  const ymd = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  if (value === '@today') return ymd(base);
  const m = /^@saturday (\d{2}):(\d{2})$/.exec(value);
  if (!m) return value;
  const ahead = (6 - today.weekday + 7) % 7 || 7;
  const date = ymd(base + ahead * 86_400_000);
  return `${date}T${m[1]}:${m[2]}:00${offsetOf(zone, now)}`;
}

/** A value for a detail from the owner's text: money and numbers parsed, text as it is. */
function valueFor(
  definition: ReadyMadeList,
  key: string,
  text: string,
): unknown {
  const field = definition.fields.find((f) => f.key === key);
  if (!field) return undefined;
  switch (field.type) {
    case ListFieldType.MONEY:
    case ListFieldType.NUMBER:
      return moneyOf(text) ?? undefined;
    case ListFieldType.DURATION: {
      const n = moneyOf(text);
      return n === null ? undefined : n;
    }
    case ListFieldType.LONG_TEXT:
      return text.slice(0, 5000);
    default:
      return text.slice(0, 200);
  }
}

/** Entries from a line-per-entry answer; a required text detail left out repeats the first part. */
function entriesFrom(
  definition: ReadyMadeList,
  columns: string[],
  text: string,
): Record<string, unknown>[] {
  return itemsOf(text, { commas: false })
    .slice(0, 50)
    .map((line) => {
      const parts = partsOf(line);
      const values: Record<string, unknown> = {};
      columns.forEach((key, i) => {
        const part =
          i === columns.length - 1 ? parts.slice(i).join(' - ') : parts[i];
        if (!part) return;
        const value = valueFor(definition, key, part);
        if (value !== undefined) values[key] = value;
      });
      for (const field of definition.fields) {
        if (
          field.required &&
          values[field.key] === undefined &&
          (field.type === ListFieldType.TEXT ||
            field.type === ListFieldType.LONG_TEXT) &&
          columns.includes(field.key)
        ) {
          values[field.key] = parts[0];
        }
      }
      return values;
    })
    .filter((values) => Object.keys(values).length > 0);
}

/** A list's first entry's value, for a checkup question: money as rupees. */
function shown(
  definition: ReadyMadeList | undefined,
  key: string,
  value: unknown,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  const field = definition?.fields.find((f) => f.key === key);
  if (field?.type === ListFieldType.MONEY && typeof value === 'number') {
    return `₹${value.toLocaleString('en-IN')}`;
  }
  return String(value);
}

/** Fills `{q:key}` and `{list.field}`; null when something can't be filled. */
function fill(
  text: string,
  lookup: (token: string) => string | null,
): string | null {
  let missing = false;
  const out = text.replace(/\{([a-z_]+(?::|\.)[a-z_]+)\}/g, (_, token) => {
    const value = lookup(token);
    if (value === null) missing = true;
    return value ?? '';
  });
  return missing ? null : out;
}

/** Packs a template can ask for, strictest first, for picking the strictest asked. */
const PACK_ORDER: SafetyPackId[] = [
  SafetyPackId.MENTAL_HEALTH,
  SafetyPackId.MEDICAL,
  SafetyPackId.PHARMACY,
  SafetyPackId.MINORS,
  SafetyPackId.LEGAL_FINANCIAL,
  SafetyPackId.STANDARD,
];

export function planInstall(
  template: UseCaseTemplate,
  answers: SetupAnswers,
  { zone, now = new Date() }: { zone: string; now?: Date },
): InstallPlan {
  const answered = (q: SetupQuestion) => answerText(answers[q.key]);
  const yes = (key: string) => answers[key] === true;

  const lists: PlannedList[] = template.lists
    .filter((use) => !use.only_if || yes(use.only_if))
    .map((use) => {
      const definition = listDefinition(use.key);
      if (!definition) {
        throw new Error(`Template ${template.id}: no list called ${use.key}`);
      }
      return { use, definition };
    });
  const installed = new Map(lists.map((l) => [l.use.key, l.definition]));

  const options: InstallPlan['options'] = {};
  const fromAnswers: Record<string, Record<string, unknown>[]> = {};
  const sameOnEvery: Record<string, Record<string, unknown>> = {};
  const facts: string[] = [];
  let helpline: string | null = null;
  const packs = new Set<SafetyPackId>(template.pack ? [template.pack] : []);
  let languages: string[] | null = null;
  let channels: string[] | null = null;
  const skipped: string[] = [];

  for (const q of template.setup) {
    const text = answered(q);
    if (text === null) {
      skipped.push(q.key);
      continue;
    }
    for (const to of q.fills) {
      switch (to.to) {
        case 'fact':
          facts.push(`${q.ask} ${text}`);
          break;
        case 'helpline':
          helpline = text.slice(0, 200);
          break;
        case 'entries': {
          const definition = installed.get(to.list);
          if (!definition) break;
          fromAnswers[to.list] = [
            ...(fromAnswers[to.list] ?? []),
            ...entriesFrom(definition, to.columns, text),
          ];
          break;
        }
        case 'field': {
          const definition = installed.get(to.list);
          if (!definition) break;
          const value = valueFor(definition, to.field, text);
          if (value !== undefined) {
            sameOnEvery[to.list] = {
              ...sameOnEvery[to.list],
              [to.field]: value,
            };
          }
          break;
        }
        case 'options': {
          if (!installed.has(to.list)) break;
          const values = [
            ...new Set(
              itemsOf(text)
                .map((item) => partsOf(item)[0]?.slice(0, 100))
                .filter(Boolean),
            ),
          ].slice(0, 30);
          if (values.length) {
            options[to.list] = { ...options[to.list], [to.field]: values };
          }
          break;
        }
        case 'pack':
          if (yes(q.key)) packs.add(to.pack);
          break;
        case 'languages': {
          const picked = (
            Array.isArray(answers[q.key])
              ? (answers[q.key] as string[])
              : [text]
          )
            .map((l) => LANGUAGE_TAGS[l.trim()])
            .filter(Boolean);
          if (picked.length) languages = [...new Set(picked)];
          break;
        }
        case 'channel':
          channels = Array.isArray(answers[q.key])
            ? (answers[q.key] as string[])
            : [text];
          break;
        case 'list':
          break;
      }
    }
  }

  const entries: InstallPlan['entries'] = {};
  for (const { use } of lists) {
    const own = fromAnswers[use.key] ?? [];
    const rows = own.length
      ? own.map((values) => ({ values, example: false }))
      : (use.examples ?? []).map((values) => ({
          values: Object.fromEntries(
            Object.entries(values).map(([k, v]) => [
              k,
              resolveWhen(v, zone, now),
            ]),
          ),
          example: true,
        }));
    if (!rows.length) continue;
    entries[use.key] = rows.map((row) => ({
      ...row,
      values: { ...row.values, ...sameOnEvery[use.key] },
    }));
  }

  const lookup = (token: string): string | null => {
    if (token.startsWith('q:')) {
      const q = template.setup.find((s) => s.key === token.slice(2));
      return q ? answered(q) : null;
    }
    const [list, key] = token.split('.');
    const first = entries[list]?.[0]?.values;
    return first ? shown(installed.get(list), key, first[key]) : null;
  };

  const cases: PlannedCase[] = [];
  for (const c of template.checkups) {
    if (c.needs && !installed.has(c.needs)) continue;
    const question = fill(c.send, lookup);
    if (question === null) continue;
    const factsFilled = c.facts.flatMap((f) => {
      const [primary, fallback] = f.split(' || ');
      const done = fill(primary, lookup);
      if (done !== null) return [done];
      return fallback ? [fill(fallback, lookup) ?? fallback] : [];
    });
    cases.push({
      id: c.id,
      question: question.slice(0, 500),
      expect: c.expect,
      facts: factsFilled,
      mustNot: c.must_not ?? [],
      alsoOk: c.also_ok ?? [],
      hardFail: Boolean(c.hard_fail),
    });
  }

  const pack = PACK_ORDER.find((p) => packs.has(p)) ?? null;
  return {
    lists,
    options,
    entries,
    facts,
    helpline,
    pack,
    languages,
    channels,
    cases,
    skipped,
  };
}
