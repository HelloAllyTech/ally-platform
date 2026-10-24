/**
 * Pure logic behind the generated configuration forms: reading what a person typed against a key's
 * schema, working out what a save should send, and telling a server refusal from a stale save.
 * Free of React and of the copy barrel, so it tests without a store.
 */

import { AllyGuideConfigLayerField, AllyGuideConfigValue } from "@types";

/** What an input holds while it is being edited: text for numbers and enums, a flag for booleans. */
export type ConfigInput = string | boolean;

/** The sentinel an enum or nullable select uses for "no value" (null on the wire). */
export const NULL_CHOICE = "__null__";

export type ParsedInput =
  | { ok: true; value: AllyGuideConfigValue }
  | { ok: false; error: "required" | "integer" | "number" | "min" | "max" | "choice" };

/** The value a field runs on now: its override when it has one, else the live release's. */
export const effectiveValue = (field: AllyGuideConfigLayerField): AllyGuideConfigValue =>
  field.override ? field.override.value : field.releaseValue;

/** A value as an input shows it. */
export const toInput = (
  field: AllyGuideConfigLayerField,
  value: AllyGuideConfigValue,
): ConfigInput => {
  if (field.type === "boolean") return value === true;
  if (value === null || value === undefined) return field.type === "enum" ? NULL_CHOICE : "";
  return String(value);
};

/**
 * What was typed, read strictly against the schema. An integer is plain digits (an optional minus
 * where the key allows negatives), never "2e1" or "12.5" silently rounded; an empty box is "off"
 * only for a key that allows null, and otherwise asks for a value.
 */
export const parseInput = (field: AllyGuideConfigLayerField, input: ConfigInput): ParsedInput => {
  if (field.type === "boolean") return { ok: true, value: input === true };
  const text = typeof input === "string" ? input.trim() : "";
  if (field.type === "enum") {
    if (text === NULL_CHOICE) {
      return field.nullable ? { ok: true, value: null } : { ok: false, error: "choice" };
    }
    return (field.enum ?? []).includes(text)
      ? { ok: true, value: text }
      : { ok: false, error: "choice" };
  }
  if (text === "")
    return field.nullable ? { ok: true, value: null } : { ok: false, error: "required" };
  const pattern = field.type === "int" ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
  if (!pattern.test(text)) return { ok: false, error: field.type === "int" ? "integer" : "number" };
  const value = Number(text);
  if (field.min !== undefined && value < field.min) return { ok: false, error: "min" };
  if (field.max !== undefined && value > field.max) return { ok: false, error: "max" };
  return { ok: true, value };
};

export interface ConfigChange {
  set: Record<string, AllyGuideConfigValue>;
  clear: string[];
}

/**
 * The save for a set of edits. A key edited back to the release's value is cleared if it was
 * overridden and left alone if it was not, so "set it to what it already is" never writes a row; a
 * key edited to anything else is set unless it already holds that value.
 */
export const buildChange = (
  fields: AllyGuideConfigLayerField[],
  drafts: Record<string, ConfigInput>,
  resets: ReadonlySet<string>,
): ConfigChange => {
  const change: ConfigChange = { set: {}, clear: [] };
  for (const field of fields) {
    if (resets.has(field.key)) {
      if (field.override) change.clear.push(field.key);
      continue;
    }
    if (!(field.key in drafts)) continue;
    const parsed = parseInput(field, drafts[field.key]);
    if (!parsed.ok) continue;
    if (parsed.value === field.releaseValue) {
      if (field.override) change.clear.push(field.key);
      continue;
    }
    if (!field.override || parsed.value !== field.override.value) {
      change.set[field.key] = parsed.value;
    }
  }
  return change;
};

export const isEmptyChange = (change: ConfigChange): boolean =>
  Object.keys(change.set).length === 0 && change.clear.length === 0;

/** How many keys the edits touch, for the Save button. */
export const changeCount = (change: ConfigChange): number =>
  Object.keys(change.set).length + change.clear.length;

export type ConfigSaveFailure =
  | { kind: "refused"; messages: string[] }
  | { kind: "stale" }
  | { kind: "other"; message: string | null };

/**
 * Reads a failed save. 400 `GUIDE_CONFIG_REFUSED` carries one sentence per refused key, each starting
 * with the key (nothing was written); 409 means someone saved after the version this form loaded.
 */
export const readSaveFailure = (error: unknown): ConfigSaveFailure => {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const data =
    error && typeof error === "object" && "data" in error
      ? ((error as { data?: unknown }).data as
          | { message?: unknown; errorCode?: unknown }
          | undefined)
      : undefined;
  if (status === 409) return { kind: "stale" };
  if (
    status === 400 &&
    (data?.errorCode === "GUIDE_CONFIG_REFUSED" || Array.isArray(data?.message))
  ) {
    const raw = data?.message;
    const messages = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string")
      : typeof raw === "string"
        ? [raw]
        : [];
    return { kind: "refused", messages };
  }
  return { kind: "other", message: typeof data?.message === "string" ? data.message : null };
};

/** The refusal sentences that name this key (each starts with it), for showing under its field. */
export const messagesForKey = (messages: string[], key: string): string[] =>
  messages.filter(
    message => message === key || message.startsWith(`${key} `) || message.startsWith(`${key}:`),
  );

/** Groups fields as the server declared them, keeping first-seen group order. */
export const groupFields = <T extends { group: string }>(fields: T[]): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const field of fields) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }
  return [...groups.entries()];
};

/** A value for a read-only table: "off" for null, yes/no for booleans, with its unit. */
export const describeValue = (
  value: unknown,
  unit?: string | null,
  strings: { off: string; yes: string; no: string } = { off: "Off", yes: "Yes", no: "No" },
): string => {
  if (value === null || value === undefined) return strings.off;
  if (typeof value === "boolean") return value ? strings.yes : strings.no;
  return unit ? `${value} ${unit}` : String(value);
};
