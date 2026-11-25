import { SafetyPackId } from '../../bot-draft/enum/bot-draft.enum';
import { ListFieldType } from '../enum/list.enum';
import type { ReadyMadeList } from '../lists/ready-made-lists';
import { listDefinition } from './template-lists';
import { helplineLines, phonesIn } from '../engine/phone-text';
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
/** A line that says what isn't done ("We never accept cash", "No walk-ins"): a rule. */
const NEGATIVE =
  /^\s*(?:we\s+|they\s+|it\s+)?(?:never|don'?t|do not|does not|doesn'?t|cannot|can'?t|won'?t|will not|are not|aren'?t|is not|isn'?t|not)\b|^\s*no\s+\w|\b(?:never|not)\s+(?:accept|take|allow|offer|do|give|provide)\b|\bnahi\b|\bnahin\b|नहीं/iu;

export const isNegative = (line: string): boolean => NEGATIVE.test(line);

/** Days or times ("Mon–Sat 9:30–5:30", "Tue to Sat 10 am to 4 pm", "daily", "24x7"). */
/** A bare range ("5 to 12") is an age as often as a time: a time needs a colon or am/pm. */
const HOURS =
  /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b|\bdaily\b|\bweekdays?\b|\b24\s*[x/]\s*7\b|\d{1,2}(?::\d{2}\s*(?:am|pm)?|\s*(?:am|pm))\s*(?:[-–—]|to)\s*\d{1,2}|\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}(?::\d{2}|\s*(?:am|pm)\b)/i;
/** A cost said outright ("Free", "No charge", "₹200"). */
const COST =
  /^(?:free(?: of (?:charge|cost))?|no (?:charge|fee|cost)|(?:₹|rs\.?)\s?\d[\d,]*)\b/i;

/**
 * TF1 round 2, N-4 (Sahyog: a place's phone landed in Hours, its Phone empty): a part that is
 * plainly a phone number, days and times, or a cost goes to the detail of that kind, wherever it
 * sits in the line. The first part is always the entry's name.
 */
function kindOf(
  definition: ReadyMadeList,
  part: string,
  taken: Record<string, unknown>,
): { key: string; value: string } | null {
  const free = (key: string) =>
    definition.fields.some((f) => f.key === key) && taken[key] === undefined;
  const phoneField = definition.fields.find(
    (f) => f.type === ListFieldType.PHONE,
  );
  const [phone] = phonesIn(part);
  if (phone && phoneField && taken[phoneField.key] === undefined) {
    const rest = part.replace(phone, '').replace(/[^\p{L}]/gu, '');
    if (rest.length <= 12) return { key: phoneField.key, value: phone };
  }
  if (free('hours') && part.length <= 80 && HOURS.test(part)) {
    return { key: 'hours', value: part };
  }
  if (free('cost') && COST.test(part.trim())) {
    return { key: 'cost', value: part };
  }
  return null;
}

/** "Malviya Nagar centre" → "Malviya Nagar": the place a location's name is for. */
const placeOf = (name: string): string =>
  name
    .replace(/\b(?:centre|center|office|branch|clinic|camp|hub|site)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

function entriesFrom(
  definition: ReadyMadeList,
  columns: string[],
  text: string,
): Record<string, unknown>[] {
  return itemsOf(text, { commas: false })
    .slice(0, 50)
    .map((line) => {
      const all = partsOf(line);
      const values: Record<string, unknown> = {};
      const parts = all.filter((part, i) => {
        if (i === 0) return true;
        const kind = kindOf(definition, part, values);
        if (!kind) return true;
        const value = valueFor(definition, kind.key, kind.value);
        if (value === undefined) return true;
        values[kind.key] = value;
        return false;
      });
      const open = columns.filter((key) => values[key] === undefined);
      open.forEach((key, i) => {
        const part =
          i === open.length - 1 ? parts.slice(i).join(' - ') : parts[i];
        if (!part) return;
        const value = valueFor(definition, key, part);
        if (value !== undefined) values[key] = value;
      });
      // The area a place is in, when its name says it and its address agrees.
      const area = placeOf(String(values.name ?? ''));
      if (
        definition.fields.some((f) => f.key === 'area') &&
        values.area === undefined &&
        area.length >= 4 &&
        String(values.address ?? '')
          .toLowerCase()
          .includes(area.toLowerCase())
      ) {
        values.area = area;
      }
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
        // Q4 G+15 (Uday Foundation's Campaigns setup did nothing; locally a 400 "Date is
        // needed"): an update written in setup is dated today when the answer gives no date.
        if (
          field.required &&
          values[field.key] === undefined &&
          field.type === ListFieldType.DATE
        ) {
          values[field.key] = '@today';
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

const NOT_DISTINCTIVE = new Set(
  'help with from your their this that also only each other services service people'.split(
    ' ',
  ),
);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !NOT_DISTINCTIVE.has(w));

/** Two words are the same word when they share their first six letters ("aid"/"aids" too). */
const sameWord = (a: string, b: string): boolean => {
  const k = Math.min(6, a.length, b.length);
  return a.slice(0, k) === b.slice(0, k);
};

/** Where in `text` the first of `words` appears, or -1. */
function firstOf(text: string, words: string[]): number {
  const found = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .findIndex((w) => w.length >= 3 && words.some((n) => sameWord(w, n)));
  return found;
}

/**
 * TF1 round 2, N-4 (Sahyog: every service's "Documents to bring" held all four services'
 * documents): one answer covering several entries, split per entry. Each line, sentence or
 * clause goes to the entry it names, by a word of its name no other entry's name has (a
 * "Physiotherapy: …" label first, else the first such word in it); a piece naming none is for
 * every entry. Null when no piece names an entry: the whole text is for every entry.
 */
export function splitPerEntry(
  names: string[],
  text: string,
): (string | null)[] | null {
  const words = names.map(wordsOf);
  const distinctive = words.map((own, i) =>
    own.filter(
      (w) =>
        !words.some((other, j) => j !== i && other.some((o) => sameWord(o, w))),
    ),
  );
  const pieces = text
    .split(/\r?\n|(?<=[.!?])\s+(?=\p{Lu})|;\s*/u)
    .map((p) => p.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  const owner = (piece: string): { index: number; text: string } | null => {
    const label = /^([^:]{2,60}):\s*(.+)$/s.exec(piece);
    const tries: [string, string][] = label
      ? [
          [label[1], label[2]],
          [piece, piece],
        ]
      : [[piece, piece]];
    for (const [where, rest] of tries) {
      let best: { index: number; at: number } | null = null;
      distinctive.forEach((own, index) => {
        const at = firstOf(where, own);
        if (at >= 0 && (!best || at < best.at)) best = { index, at };
      });
      if (best) return { index: (best as { index: number }).index, text: rest };
    }
    return null;
  };
  const owned = pieces.map(owner);
  if (!owned.some(Boolean)) return null;
  const sentence = (p: string) => {
    const t = p.trim().replace(/[.;,]+$/, '');
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  };
  return names.map((_, i) => {
    const mine = pieces
      .map((piece, k) =>
        owned[k] === null
          ? piece
          : owned[k]!.index === i
            ? owned[k]!.text
            : null,
      )
      .filter((p): p is string => Boolean(p));
    return mine.length ? mine.map(sentence).join(' ') : null;
  });
}

/**
 * TF1 round 2, N-13: a checkup question reads with a short name ("Is a disability certificate
 * free?", not "Is Help with a disability certificate (UDID card) free?").
 */
export function shortName(name: string): string {
  let short = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*help (?:with|for|in|applying for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (short.split(' ').length > 5) {
    short = short.split(/,|\s[-–—]\s|\s(?:for|to|with)\s/i)[0].trim();
  }
  if (short.split(' ').length > 5) {
    short = short.split(' ').slice(0, 5).join(' ');
  }
  return short || name;
}

/**
 * TF1 round 2, N-13 (Sahyog: "Is Help with a disability certificate (UDID card) free?" failed on
 * a right answer, "Yes, our services are free"): a fact whose detail isn't in the list falls back
 * to "says it doesn't have it", but the assistant's information may well have it. A reply that
 * gives it from the information passes too; the grader still fails anything invented.
 */
function eitherFact(primary: string, fallback: string): string {
  const said = primary.replace(/:?\s*\{[^}]+\}.*$/, '').trim();
  if (!said || said === primary) return fallback;
  const rest = fallback.charAt(0).toLowerCase() + fallback.slice(1);
  // COPY: needs approval (TF1 round 2)
  return `${said} as your information gives it, or ${rest}`;
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
  const perEntry: { list: string; field: string; text: string }[] = [];

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
          // TF1 round 2, S-1: only the numbers, never the sentence around them.
          helpline = helplineLines(text) || null;
          break;
        case 'entries': {
          const definition = installed.get(to.list);
          if (!definition) break;
          // Q4 H10 (demo build: "We never accept cash" under "How can people give?" became a
          // giving method marked tax-exempt): a negative line is a rule the assistant knows,
          // never an entry.
          const lines = itemsOf(text, { commas: false });
          const rules = lines.filter(isNegative);
          for (const rule of rules) facts.push(`${q.ask} ${rule}`);
          const kept = lines.filter((line) => !isNegative(line)).join('\n');
          if (!kept.trim()) break;
          fromAnswers[to.list] = [
            ...(fromAnswers[to.list] ?? []),
            ...entriesFrom(definition, to.columns, kept),
          ];
          break;
        }
        case 'field': {
          const definition = installed.get(to.list);
          if (!definition) break;
          const type = definition.fields.find((f) => f.key === to.field)?.type;
          if (type === ListFieldType.TEXT || type === ListFieldType.LONG_TEXT) {
            // Split per entry once the entries are known (N-4).
            perEntry.push({ list: to.list, field: to.field, text });
          }
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

  // N-4: one answer for every entry ("what to bring"), split per entry when it names them.
  for (const { list, field, text } of perEntry) {
    const rows = fromAnswers[list] ?? [];
    const definition = installed.get(list)!;
    const title = definition.settings?.title_field ?? 'name';
    const names = rows.map((r) => String(r[title] ?? ''));
    const split = rows.length > 1 ? splitPerEntry(names, text) : null;
    if (!split) continue;
    rows.forEach((row, i) => {
      const value = split[i]
        ? valueFor(definition, field, split[i])
        : undefined;
      if (value !== undefined) row[field] = value;
    });
    const same = { ...sameOnEvery[list] };
    delete same[field];
    sameOnEvery[list] = same;
  }
  // N-4: "Physiotherapy - children, Malviya Nagar only": the place an entry names is its Where.
  const places = Object.entries(fromAnswers)
    .filter(([, rows]) => rows.some((r) => r.address !== undefined))
    .flatMap(([, rows]) => rows.map((r) => String(r.name ?? '')))
    .filter((name) => placeOf(name).length >= 4);
  for (const { use, definition } of lists) {
    if (!definition.fields.some((f) => f.key === 'where')) continue;
    for (const row of fromAnswers[use.key] ?? []) {
      if (row.where !== undefined) continue;
      const said = Object.entries(row)
        .filter(([k]) => k !== 'name')
        .map(([, v]) => String(v).toLowerCase())
        .join(' ');
      const named = places.filter((p) =>
        said.includes(placeOf(p).toLowerCase()),
      );
      if (named.length) row.where = named.join(', ').slice(0, 200);
    }
  }

  const entries: InstallPlan['entries'] = {};
  for (const { use } of lists) {
    const own = fromAnswers[use.key] ?? [];
    const rows = own.length
      ? own.map((values) => ({
          values: Object.fromEntries(
            Object.entries(values).map(([k, v]) => [
              k,
              resolveWhen(v, zone, now),
            ]),
          ),
          example: false,
        }))
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

  // N-13: a question names an entry by its short name.
  const asked = (token: string): string | null => {
    const value = lookup(token);
    const [list, key] = token.split('.');
    const title = installed.get(list)?.settings?.title_field ?? 'name';
    return value !== null && key === title ? shortName(value) : value;
  };

  const cases: PlannedCase[] = [];
  for (const c of template.checkups) {
    if (c.needs && !installed.has(c.needs)) continue;
    const question = fill(c.send, asked);
    if (question === null) continue;
    const factsFilled = c.facts.flatMap((f) => {
      const [primary, fallback] = f.split(' || ');
      const done = fill(primary, lookup);
      if (done !== null) return [done];
      return fallback
        ? [eitherFact(primary, fill(fallback, lookup) ?? fallback)]
        : [];
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
