import { BadRequestException } from '@nestjs/common';
import { ListConstraintKind, ListFieldType } from '../enum/list.enum';
import type { ListDefinitionView } from '../lists/list-definitions.service';
import {
  CONTAINS_TYPES,
  NUMERIC_TYPES,
  RANGE_TYPES,
  relationTarget,
  selectValues,
} from '../lists/list-fields';
import type {
  ListFilter,
  ListQuery,
  ListRecordView,
  TransitionsConfig,
} from '../lists/list-types';
import type { ChatbotSettingsOverride } from '../type/chatbot.type';
import type { Ability } from './tools';

/**
 * The agent's list tools (chunk 6): for each list the agent may use, up to three tools generated
 * from its definition (`TEMPLATE-DATA-MODEL.md` §6). Nothing here is written per list.
 *
 * Everything in this file is pure: the definitions a run is offered, the input each one accepts and
 * how that input becomes a query or a record. `ListToolsService` reads the lists and runs them.
 */

export type ListToolKind = 'find' | 'create' | 'update';
export const LIST_TOOL_KINDS: readonly ListToolKind[] = [
  'find',
  'create',
  'update',
];

/** At most this many list tools a run, in list order; the rest are named in the run's trace. */
export const MAX_LIST_TOOLS = 12;
/** find filters on the first this-many readable fields, by position. */
export const MAX_FIND_FIELDS = 10;
export const FIND_LIMIT_MAX = 10;
export const FIND_LIMIT_DEFAULT = 5;
/** How many field labels a find description names. */
const DESCRIBED_FILTERS = 4;

/** A JSON Schema property, as ally-ai's step schema needs it: flat, typed, always defaulted. */
export interface ListToolProperty {
  type: 'string' | 'integer';
  description: string;
  default: string | number;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  /**
   * A relation (chunk 6 follow-up): the list it points at, and whether that list is dated. ally-ai
   * checks a dated target's day and time against what the person confirmed before it writes.
   */
  relation?: string;
  dated?: 'date' | 'datetime';
}

export interface ListToolInputSchema {
  type: 'object';
  properties: Record<string, ListToolProperty>;
}

/** One generated tool, as the gateway block sends it to ally-ai. */
export interface ListToolDefinition {
  name: string;
  description: string;
  input_schema: ListToolInputSchema;
  kind: ListToolKind;
}

type ListView = ListDefinitionView;
type FieldView = ListView['fields'][number];

export const listToolName = (kind: ListToolKind, key: string): string =>
  `${kind}_${key}`;

/** `find_slots` → find, slots. Anything else (hand_over, a typo) → null. */
export function parseListToolName(
  name: string,
): { kind: ListToolKind; key: string } | null {
  for (const kind of LIST_TOOL_KINDS) {
    const prefix = `${kind}_`;
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return { kind, key: name.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * A tool's ability on this bot, from its OWN stored settings (3b's map, keyed by tool name).
 * Unset: `find_*` reads, so it's on; anything that writes or acts (`create_*`, `update_*`,
 * `hand_over`) is off until a platform admin sets it to `do_it`.
 */
export function abilityFor(
  stored: ChatbotSettingsOverride | null | undefined,
  tool: string,
): Ability {
  const set = stored?.abilities?.[tool];
  if (set === 'do_it' || set === 'never') return set;
  return parseListToolName(tool)?.kind === 'find' ? 'do_it' : 'never';
}

// ---- which fields each tool uses ------------------------------------------------------------

const live = (list: ListView): FieldView[] =>
  list.fields
    .filter((f) => !f.archived_at)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

const isContact = (f: FieldView): boolean =>
  f.type === ListFieldType.RELATION && relationTarget(f) === 'contact';

/** What the agent may see: the engine's rule (list read, field read, not never_store). */
export const readableFields = (list: ListView): FieldView[] =>
  list.agent_read
    ? live(list).filter((f) => f.agent_read && !f.privacy?.never_store)
    : [];

/**
 * What the agent may write: the engine's rule, minus relations to a contact. The person field is
 * always the person in the chat, and another contact is never the agent's to name.
 */
export const writableFields = (list: ListView): FieldView[] =>
  list.agent_write
    ? live(list).filter(
        (f) =>
          f.agent_write &&
          !f.privacy?.never_store &&
          f.key !== list.settings?.person_field &&
          !isContact(f),
      )
    : [];

/** What find can filter and sort on: readable, unmasked (a filter on a masked field guesses it). */
const filterableFields = (list: ListView): FieldView[] =>
  readableFields(list)
    .filter((f) => !f.privacy?.masked && !isContact(f))
    .slice(0, MAX_FIND_FIELDS);

const hasPersonField = (list: ListView): boolean =>
  Boolean(list.settings?.person_field);

// ---- schemas ------------------------------------------------------------------------------------

const RESERVED_FIND_KEYS = new Set(['sort', 'limit', 'aggregate']);
const YES_NO = ['yes', 'no'];

/** A value's format, as a field description says it. */
function valueHint(f: FieldView): string {
  switch (f.type) {
    case ListFieldType.DATE:
      return 'a date like 2026-11-20';
    case ListFieldType.DATETIME:
      return 'a date and time like 2026-11-20T11:15:00+05:30';
    case ListFieldType.NUMBER:
    case ListFieldType.MONEY:
      return 'a number, like 8500000';
    case ListFieldType.DURATION:
      return 'a number of minutes, like 50';
    case ListFieldType.RELATION:
      return `the id of a ${relationTarget(f)} entry from find_${relationTarget(f)}`;
    case ListFieldType.PHONE:
      return 'a phone number';
    case ListFieldType.EMAIL:
      return 'an email address';
    case ListFieldType.URL:
      return 'a web address';
    default:
      return 'text';
  }
}

const text = (description: string): ListToolProperty => ({
  type: 'string',
  description,
  default: '',
});
/** An enum always has "" first: any (find), or leave it as it is (update). */
const choice = (description: string, values: string[]): ListToolProperty => ({
  type: 'string',
  description,
  default: '',
  enum: ['', ...values],
});

/** A value property for create and update: one per writable field. */
function valueProperty(
  f: FieldView,
  update: boolean,
  dated: Map<string, 'date' | 'datetime'>,
): ListToolProperty {
  const blank = update ? 'empty leaves it as it is' : 'empty if not given';
  if (f.type === ListFieldType.RELATION) {
    const to = relationTarget(f);
    const when = dated.get(to);
    return {
      ...text(`${f.label}: ${valueHint(f)}; ${blank}`),
      relation: to,
      ...(when ? { dated: when } : {}),
    };
  }
  if (f.type === ListFieldType.SELECT) {
    return choice(`${f.label}; ${blank}`, selectValues(f));
  }
  if (f.type === ListFieldType.BOOLEAN) {
    return choice(`${f.label}; ${blank}`, YES_NO);
  }
  return text(`${f.label}: ${valueHint(f)}; ${blank}`);
}

function findSchema(list: ListView): ListToolInputSchema {
  const properties: Record<string, ListToolProperty> = {};
  const put = (key: string, property: ListToolProperty) => {
    // A field key that clashes with sort, limit, aggregate or another filter is left out.
    if (!RESERVED_FIND_KEYS.has(key) && !(key in properties)) {
      properties[key] = property;
    }
  };
  const fields = filterableFields(list);
  for (const f of fields) {
    if (f.type === ListFieldType.SELECT) {
      put(f.key, choice(`${f.label} is; empty for any`, selectValues(f)));
    } else if (f.type === ListFieldType.BOOLEAN) {
      put(f.key, choice(`${f.label}; empty for any`, YES_NO));
    } else if (f.type === ListFieldType.RELATION) {
      put(f.key, text(`${f.label} is: ${valueHint(f)}; empty for any`));
    } else if (CONTAINS_TYPES.has(f.type)) {
      put(
        `${f.key}_contains`,
        text(`${f.label} contains this text; empty for any`),
      );
    } else if (RANGE_TYPES.has(f.type)) {
      if (f.type === ListFieldType.DATETIME) {
        // Exactly the time the person named (chunk 6 follow-up), beside the ranges.
        put(`${f.key}_at`, text(`${f.label} is exactly: ${valueHint(f)}`));
      }
      put(`${f.key}_from`, text(`${f.label} from: ${valueHint(f)}`));
      put(`${f.key}_to`, text(`${f.label} up to: ${valueHint(f)}`));
    }
  }
  const sortable = readableFields(list)
    .filter((f) => !f.privacy?.masked)
    .map((f) => f.key);
  properties.sort = choice(
    'Sort by this field; a leading - sorts high to low, latest first. Empty for the usual order',
    sortable.flatMap((key) => [key, `-${key}`]),
  );
  properties.limit = {
    type: 'integer',
    description: `How many entries to return, 1 to ${FIND_LIMIT_MAX}`,
    default: FIND_LIMIT_DEFAULT,
    minimum: 1,
    maximum: FIND_LIMIT_MAX,
  };
  const sums = fields
    .filter((f) => NUMERIC_TYPES.has(f.type))
    .map((f) => `sum_${f.key}`);
  properties.aggregate = choice(
    'count: how many entries match; sum_<field>: their total. Empty to list entries',
    ['count', ...sums],
  );
  return { type: 'object', properties };
}

function writeSchema(
  list: ListView,
  update: boolean,
  dated: Map<string, 'date' | 'datetime'>,
): ListToolInputSchema {
  const properties: Record<string, ListToolProperty> = {};
  if (update) {
    properties.id = text(
      `The id of the entry to change, from find_${list.key}`,
    );
  }
  for (const f of writableFields(list)) {
    if (!(f.key in properties)) {
      properties[f.key] = valueProperty(f, update, dated);
    }
  }
  return { type: 'object', properties };
}

// ---- descriptions -------------------------------------------------------------------------------

const lower = (s: string): string =>
  s && s[0] !== s[0].toLowerCase() && s.slice(1) === s.slice(1).toLowerCase()
    ? s[0].toLowerCase() + s.slice(1)
    : s;

const joinOr = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

const joinAnd = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const human = (value: string): string => value.replace(/_/g, ' ');

const labelOf = (list: ListView, key: string): string =>
  list.fields.find((f) => f.key === key)?.label ?? key;

/** The sentences a list's rules add to a create or update description. */
function ruleSentences(
  list: ListView,
  names: Map<string, string>,
  kind: 'create' | 'update',
): string[] {
  const out: string[] = [];
  for (const rule of list.rules) {
    const config = rule.config as Record<string, unknown>;
    switch (rule.kind) {
      case ListConstraintKind.UNIQUE: {
        const fields = (config.fields as string[]) ?? [];
        out.push(
          `Fails with a reason if that ${joinAnd(
            fields.map((key) => lower(labelOf(list, key))),
          )} is already taken.`,
        );
        break;
      }
      case ListConstraintKind.CAPACITY: {
        const field = list.fields.find((f) => f.key === config.field);
        const target = field
          ? (names.get(relationTarget(field)) ?? field.label)
          : '';
        out.push(
          `Fails if the ${lower(target || 'entry')} is full.`.replace(
            /\s+/g,
            ' ',
          ),
        );
        break;
      }
      case ListConstraintKind.LIMIT_PER_PERSON:
        out.push(
          `Fails if the person already has ${String(config.max)} ${lower(list.name)}.`,
        );
        break;
      case ListConstraintKind.TRANSITIONS: {
        if (kind !== 'update') break;
        const t = config as unknown as TransitionsConfig;
        const moves = Object.entries(t.allowed ?? {})
          .filter(([, to]) => to?.length)
          .map(
            ([from, to]) => `from ${human(from)} to ${joinOr(to.map(human))}`,
          );
        if (moves.length) {
          out.push(`${labelOf(list, t.field)} can change ${moves.join('; ')}.`);
        }
        break;
      }
    }
  }
  return out;
}

function findDescription(list: ListView): string {
  const fields = filterableFields(list);
  const labels = fields.slice(0, DESCRIBED_FILTERS).map((f) => lower(f.label));
  const summable = fields.find((f) => NUMERIC_TYPES.has(f.type));
  const exact = fields.find((f) => f.type === ListFieldType.DATETIME);
  const filter = labels.length ? ` Filter by ${joinAnd(labels)};` : '';
  return (
    `Look up entries in ${list.name}.${filter} returns up to ${FIND_LIMIT_MAX} ` +
    `matches as passages to cite, with the total. Use aggregate to count` +
    (summable ? ` or to add up ${lower(summable.label)}.` : '.') +
    (exact
      ? ` When the person named a time, use ${exact.key}_at to find exactly that time.`
      : '')
  ).replace(/\.\s+returns/, '. Returns');
}

function createDescription(list: ListView, names: Map<string, string>): string {
  const person = hasPersonField(list) ? ' for the person in this chat' : '';
  const required = writableFields(list)
    .filter((f) => f.required)
    .map((f) => lower(f.label));
  return [
    `Add an entry to ${list.name}${person}, only after they've confirmed it.`,
    required.length ? `Needs ${joinAnd(required)}.` : '',
    ...ruleSentences(list, names, 'create'),
  ]
    .filter(Boolean)
    .join(' ');
}

function updateDescription(list: ListView, names: Map<string, string>): string {
  const whose = hasPersonField(list)
    ? ' that belongs to the person in this chat'
    : '';
  return [
    `Change an entry in ${list.name}${whose}; id comes from find_${list.key}.`,
    ...ruleSentences(list, names, 'update'),
  ]
    .filter(Boolean)
    .join(' ');
}

// ---- which tools a list has, and which a run gets -------------------------------------------

/**
 * The tools one list generates, whatever the bot's abilities: find when the agent may read it,
 * create and update when it may write it and at least one field is writable.
 */
/** Each list's date or date-time, as the engine's alternatives read it: its first such field. */
export function datedLists(
  lists: ListView[],
): Map<string, 'date' | 'datetime'> {
  const out = new Map<string, 'date' | 'datetime'>();
  for (const list of lists) {
    const field = live(list).find(
      (f) => f.type === ListFieldType.DATE || f.type === ListFieldType.DATETIME,
    );
    if (field) {
      out.set(
        list.key,
        field.type === ListFieldType.DATE ? 'date' : 'datetime',
      );
    }
  }
  return out;
}

export function listToolDefinitions(
  list: ListView,
  names: Map<string, string> = new Map(),
  dated: Map<string, 'date' | 'datetime'> = new Map(),
): ListToolDefinition[] {
  const out: ListToolDefinition[] = [];
  if (list.deleted_at) return out;
  if (list.agent_read) {
    out.push({
      name: listToolName('find', list.key),
      description: findDescription(list),
      input_schema: findSchema(list),
      kind: 'find',
    });
  }
  if (writableFields(list).length) {
    out.push({
      name: listToolName('create', list.key),
      description: createDescription(list, names),
      input_schema: writeSchema(list, false, dated),
      kind: 'create',
    });
    out.push({
      name: listToolName('update', list.key),
      description: updateDescription(list, names),
      input_schema: writeSchema(list, true, dated),
      kind: 'update',
    });
  }
  return out;
}

export interface OfferedListTools {
  definitions: ListToolDefinition[];
  /** Tools the bot has on but that didn't fit under the cap. */
  omitted: string[];
}

/**
 * The list tools a run is offered: each live list's tools whose ability is `do_it`, in list order,
 * at most 12. `knowsPerson` false (WhatsApp before its contact is known): lists with a person field
 * are left out, since their tools could only find nothing and refuse every write.
 */
export function offeredListTools(
  lists: ListView[],
  stored: ChatbotSettingsOverride | null | undefined,
  { knowsPerson }: { knowsPerson: boolean },
): OfferedListTools {
  const names = new Map(lists.map((l) => [l.key, l.name]));
  const dated = datedLists(lists);
  const on = lists
    .filter((list) => knowsPerson || !hasPersonField(list))
    .flatMap((list) => listToolDefinitions(list, names, dated))
    .filter((def) => abilityFor(stored, def.name) === 'do_it');
  return {
    definitions: on.slice(0, MAX_LIST_TOOLS),
    omitted: on.slice(MAX_LIST_TOOLS).map((def) => def.name),
  };
}

// ---- input ---------------------------------------------------------------------------------------

/**
 * A call's input, checked against the tool's schema: only its properties, strings where it says
 * string, an enum value where it has one, a whole limit in range. Empty values are dropped: an
 * empty default means "not given".
 */
export function parseListToolInput(
  def: ListToolDefinition,
  input: Record<string, unknown>,
): Record<string, string | number> {
  const { properties } = def.input_schema;
  const unknown = Object.keys(input).filter((key) => !(key in properties));
  if (unknown.length) {
    throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
  }
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    const property = properties[key];
    if (value === null || value === undefined || value === '') continue;
    if (property.type === 'integer') {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < (property.minimum ?? -Infinity) ||
        value > (property.maximum ?? Infinity)
      ) {
        throw new BadRequestException(
          `${key} must be a whole number from ${property.minimum} to ${property.maximum}`,
        );
      }
      out[key] = value;
      continue;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${key} must be text`);
    }
    if (property.enum && !property.enum.includes(value)) {
      throw new BadRequestException(`${key} must be one of the listed values`);
    }
    out[key] = value.trim();
    if (out[key] === '') delete out[key];
  }
  return out;
}

/** A number as the model sent it ("85,00,000", " 50 "), or the text as it was if it isn't one. */
function numberOr(value: string): number | string {
  const n = Number(value.replace(/[,\s_]/g, ''));
  return value.trim() !== '' && Number.isFinite(n) ? n : value;
}

/** A value for one field, from the model's text: numbers and yes/no become their type. */
function fieldValue(f: FieldView, value: string): unknown {
  if (NUMERIC_TYPES.has(f.type)) return numberOr(value);
  if (f.type === ListFieldType.BOOLEAN) {
    return value === 'yes' ? true : value === 'no' ? false : value;
  }
  return value;
}

/** find's input as a query for the engine. */
export function toListQuery(
  list: ListView,
  input: Record<string, string | number>,
): ListQuery {
  const filters: ListFilter[] = [];
  for (const f of filterableFields(list)) {
    const eq = input[f.key];
    if (
      eq !== undefined &&
      (f.type === ListFieldType.SELECT ||
        f.type === ListFieldType.BOOLEAN ||
        f.type === ListFieldType.RELATION)
    ) {
      filters.push({
        field: f.key,
        op: 'eq',
        value: fieldValue(f, String(eq)),
      });
    }
    const contains = input[`${f.key}_contains`];
    if (contains !== undefined && CONTAINS_TYPES.has(f.type)) {
      filters.push({ field: f.key, op: 'contains', value: String(contains) });
    }
    const at = input[`${f.key}_at`];
    if (at !== undefined && f.type === ListFieldType.DATETIME) {
      // Exactly that instant, whatever its written form: from and to the same time.
      const value = fieldValue(f, String(at));
      filters.push({ field: f.key, op: 'from', value });
      filters.push({ field: f.key, op: 'to', value });
    }
    for (const op of ['from', 'to'] as const) {
      const bound = input[`${f.key}_${op}`];
      if (bound !== undefined && RANGE_TYPES.has(f.type)) {
        filters.push({ field: f.key, op, value: fieldValue(f, String(bound)) });
      }
    }
  }
  const aggregate = input.aggregate as string | undefined;
  return {
    filters,
    ...(input.sort ? { sort: String(input.sort) } : {}),
    limit: (input.limit as number | undefined) ?? FIND_LIMIT_DEFAULT,
    ...(aggregate
      ? {
          aggregate:
            aggregate === 'count'
              ? 'count'
              : `sum:${aggregate.slice('sum_'.length)}`,
        }
      : {}),
  };
}

/** create's or update's input as record data (update's `id` taken out). */
export function toListData(
  list: ListView,
  input: Record<string, string | number>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of writableFields(list)) {
    const value = input[f.key];
    if (value !== undefined) data[f.key] = fieldValue(f, String(value));
  }
  return data;
}

// ---- results ------------------------------------------------------------------------------------

/**
 * One record as the agent reads it: a passage titled "{list}: {record title}", its id (which the
 * agent passes to update or a relation) and its readable fields as "label: value" lines, masked
 * where the definition says so (the engine already masked them). Cited like a document passage.
 */
export interface RecordPassage {
  record_id: string;
  list: string;
  title: string;
  record_title: string;
  text: string;
}

export function recordPassage(
  list: ListView,
  record: ListRecordView,
): RecordPassage {
  const lines = [`id: ${record.id}`];
  for (const f of readableFields(list)) {
    const value = record.display?.[f.key];
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`${f.label}: ${value}`);
    }
  }
  return {
    record_id: record.id,
    list: list.name,
    title: `${list.name}: ${record.title}`,
    record_title: record.title,
    text: lines.join('\n'),
  };
}

/** Where a business is, until bots have a time zone setting: the pilots are in India. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/**
 * Today where the business is, for the lists section (chunk 6): "Saturday 14 Nov 2026, 11:58
 * (Asia/Kolkata, UTC+05:30)". The agent works out "Thursday" or "tomorrow" from it, and writes
 * date-times with the offset. An unknown time zone falls back to the default.
 */
export function todayFor(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
  } catch {
    zone = DEFAULT_TIME_ZONE;
  }
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options }).format(
      now,
    );
  const date = part({
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).replace(',', '');
  const time = part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const offset =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', 'UTC') || 'UTC';
  return `${date}, ${time} (${zone}, ${offset === 'UTC' ? 'UTC+00:00' : offset})`;
}

/** Copy deck §26: what a reply says when a run fails after a list write was done. */
export const listDoneLine = (recordTitle: string, list: string): string =>
  `Done: ${recordTitle} in ${list}.`;
