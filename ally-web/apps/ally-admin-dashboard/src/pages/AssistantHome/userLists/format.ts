import type { StatusTone } from "@components/v2";
import type { ListEntry, ListField, ListRule, TransitionsRule, UserList } from "@types";

import { HOME, fill } from "../copy";

const t = () => HOME.userLists;

/** Live details (not removed), by position. */
export const liveFields = (list: UserList): ListField[] =>
  list.fields.filter(f => !f.archived_at).sort((a, b) => a.position - b.position);

export const fieldOf = (list: UserList, key: string): ListField | undefined =>
  list.fields.find(f => f.key === key);

export const labelOf = (list: UserList, key: string): string => fieldOf(list, key)?.label ?? key;

/** A choice value as people read it: "no_show" → "No show". */
export const human = (value: string): string => {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Mid-sentence, a label reads in lower case ("per slot"), as the engine's §26 messages do. */
export const lower = (s: string): string =>
  s && s[0] !== s[0].toLowerCase() && s.slice(1) === s.slice(1).toLowerCase()
    ? s[0].toLowerCase() + s.slice(1)
    : s;

const joinWith = (items: string[], word: string): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
export const joinOr = (items: string[]) => joinWith(items, t().rules.or);
export const joinAnd = (items: string[]) => joinWith(items, "and");

// ---- dates and times, in the business's zone -------------------------------------------------

const yearIn = (iso: string, zone: string): number => {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: zone }).format(new Date(iso)),
    );
  } catch {
    return new Date(iso).getFullYear();
  }
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A wall date as "Thu 19 Nov" (or "Thu 19 Nov 2027"), built by hand: browsers differ on commas. */
const dayLabel = (ymd: string, withYear: boolean): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
};

/** "Thu 19 Nov, 11:00": the year only when it isn't this year. Never ISO. */
export const formatDateTime = (iso: string, zone: string, now = new Date()): string => {
  const [day, time] = wallOf(iso, zone);
  if (!day) return iso;
  const withYear = yearIn(iso, zone) !== yearIn(now.toISOString(), zone);
  return `${dayLabel(day, withYear)}, ${time}`;
};

/** "Thu 19 Nov" for a wall date (`YYYY-MM-DD`). */
export const formatDate = (ymd: string, now = new Date()): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(ymd)
    ? dayLabel(ymd, Number(ymd.slice(0, 4)) !== now.getFullYear())
    : ymd;

/** Today in the zone, as `YYYY-MM-DD`. */
export const todayIn = (zone: string, now = new Date()): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
};

/** The zone's offset at a wall date and time, as "+05:30". */
export const offsetAt = (ymd: string, hm: string, zone: string): string => {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  try {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(guess)
      .find(p => p.type === "timeZoneName")?.value;
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name ?? "");
    if (m) return `${m[1]}:${m[2] ?? "00"}`;
  } catch {
    // fall through
  }
  return "+00:00";
};

/** An ISO instant as the zone's wall date and time: ["2026-11-19", "11:00"]. */
export const wallOf = (iso: string, zone: string): [string, string] => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return ["", ""];
  try {
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => f.find(p => p.type === type)?.value ?? "";
    return [`${get("year")}-${get("month")}-${get("day")}`, `${get("hour")}:${get("minute")}`];
  } catch {
    return [iso.slice(0, 10), iso.slice(11, 16)];
  }
};

/** A wall date and time back to the ISO form the engine takes, with the zone's offset. */
export const isoOf = (ymd: string, hm: string, zone: string): string =>
  `${ymd}T${hm}:00${offsetAt(ymd, hm, zone)}`;

// ---- values ------------------------------------------------------------------------------------

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * How one value reads in the table and on a card. Dates and times are formatted here, in the
 * business's zone (the engine's `display` has the year and is the fallback); a relation shows its
 * entry's title from `display`.
 */
export const showValue = (list: UserList, field: ListField, entry: ListEntry): string => {
  const value = entry.data[field.key];
  const shown = entry.display[field.key];
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "datetime":
      return typeof value === "string" ? formatDateTime(value, list.time_zone) : (shown ?? "");
    case "date":
      return typeof value === "string" ? formatDate(value) : (shown ?? "");
    case "select":
      return human(String(value));
    case "boolean":
      return value ? t().form.yes : t().form.no;
    case "money":
      return typeof value === "number" ? money.format(value) : (shown ?? String(value));
    case "relation":
      return shortTitle(list, shown ?? String(value));
    default:
      return shown ?? String(value);
  }
};

/** A linked entry's title, with this year's "2026" taken out ("Thu 19 Nov 2026, 11:00"). */
export const shortTitle = (_list: UserList, title: string, now = new Date()): string =>
  title.replace(new RegExp(`(\\b\\d{1,2} \\w{3}) ${now.getFullYear()},`), "$1,");

/** An entry's title as people read it. */
export const titleOf = (list: UserList, entry: ListEntry): string => {
  const key = list.settings.title_field;
  const field = key ? fieldOf(list, key) : undefined;
  if (field) {
    const shown = showValue(list, field, entry);
    if (shown) return shown;
  }
  return shortTitle(list, entry.title);
};

// ---- statuses ----------------------------------------------------------------------------------

/** The list's status detail: the choice a "can only move like this" rule governs. */
export const statusRule = (list: UserList): TransitionsRule | null => {
  const rule = list.rules.find(r => r.kind === "transitions");
  return rule ? (rule.config as TransitionsRule) : null;
};

const STOPPED = /cancel|lost|no.?show|not.?joining|expired|closed|rejected/i;

/**
 * A status's colour: where it starts is "new"; one with nowhere left to go is "done", or "stopped"
 * when it's a cancellation or the like; anything between is "active".
 */
export const toneOf = (list: UserList, fieldKey: string, value: string): StatusTone => {
  const rule = statusRule(list);
  if (!rule || rule.field !== fieldKey) return "neutral";
  if (STOPPED.test(value)) return "stopped";
  if (rule.initial.includes(value)) return "new";
  if (!(rule.allowed[value]?.length ?? 0)) return "done";
  return "active";
};

/** The choices a status can take next, from where it is: itself first. */
export const nextValues = (
  list: UserList,
  fieldKey: string,
  current: string | null,
): string[] | null => {
  const rule = statusRule(list);
  if (!rule || rule.field !== fieldKey) return null;
  if (!current) return rule.initial;
  return [current, ...(rule.allowed[current] ?? [])];
};

// ---- rules as sentences ------------------------------------------------------------------------

const notCounting = (
  list: UserList,
  where?: { field: string; in?: string[]; not_in?: string[] },
) => {
  if (!where) return "";
  const field = fieldOf(list, where.field);
  const values =
    where.not_in ?? (field?.options.values ?? []).filter(v => !(where.in ?? []).includes(v));
  if (!values.length) return "";
  return fill(t().rules.notCounting, {
    detail: lower(labelOf(list, where.field)),
    values: joinOr(values.map(v => lower(human(v)))),
  });
};

export interface RuleSentence {
  text: string;
  lines: string[];
  example: string;
}

/** A rule as owners read it, with what it's for underneath. */
export const ruleSentence = (
  list: UserList,
  rule: ListRule,
  lists: UserList[] = [],
): RuleSentence => {
  const r = t().rules;
  switch (rule.kind) {
    case "unique": {
      const detail = joinAnd(rule.config.fields.map(k => lower(labelOf(list, k))));
      return {
        text: fill(r.unique, { detail }),
        lines: [notCounting(list, rule.config.where)].filter(Boolean),
        example: fill(r.exampleUnique, { detail }),
      };
    }
    case "capacity": {
      const field = fieldOf(list, rule.config.field);
      const detail = lower(field?.label ?? rule.config.field);
      const target = lists.find(l => l.key === field?.options.to);
      const text = rule.config.max_from
        ? fill(r.capacityFrom, {
            detail,
            number: lower(target ? labelOf(target, rule.config.max_from) : rule.config.max_from),
          })
        : fill(r.capacity, { n: rule.config.max ?? 0, detail });
      return {
        text,
        lines: [notCounting(list, rule.config.where)].filter(Boolean),
        example: fill(r.exampleCapacity, { detail }),
      };
    }
    case "limit_per_person":
      return {
        text: fill(r.limit, { n: rule.config.max }),
        lines: [notCounting(list, rule.config.where)].filter(Boolean),
        example: fill(r.exampleLimit, { n: rule.config.max }),
      };
    case "transitions": {
      const c = rule.config;
      const moves = Object.entries(c.allowed)
        .filter(([, to]) => to.length)
        .map(([from, to]) =>
          fill(r.move, { from: human(from), to: joinOr(to.map(v => lower(human(v)))) }),
        );
      return {
        text: fill(r.moves, { detail: labelOf(list, c.field) }),
        lines: [
          ...moves,
          fill(r.startsAs, { values: joinOr(c.initial.map(v => lower(human(v)))) }),
        ],
        example: r.exampleMoves,
      };
    }
  }
};

// ---- what the assistant may do ----------------------------------------------------------------

/** Details the assistant could fill in: what decides whether Add and Change show. */
export const fillable = (list: UserList): ListField[] =>
  liveFields(list).filter(
    f =>
      f.agent_write &&
      !f.privacy.never_store &&
      f.key !== list.settings.person_field &&
      !(f.type === "relation" && f.options.to === "contact"),
  );

/** The list this one books into: a linked list that has a date and time (Appointments → Slots). */
export const bookedList = (list: UserList, lists: UserList[]): UserList | null => {
  for (const field of liveFields(list)) {
    if (field.type !== "relation" || !field.options.to || field.options.to === "contact") continue;
    const target = lists.find(l => l.key === field.options.to);
    if (target && liveFields(target).some(f => f.type === "datetime")) return target;
  }
  return null;
};

/** Whether a list holds dates and times people book (Slots): it gets Repeat weekly. */
export const datedField = (list: UserList): ListField | undefined =>
  liveFields(list).find(f => f.type === "datetime");
