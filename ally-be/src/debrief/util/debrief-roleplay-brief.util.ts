import {
  ROLEPLAY_FIELDS,
  ROLEPLAY_FIELDS_DEFAULT,
  ROLEPLAY_OPTIONAL_KEYS,
  RoleplayFieldDef,
} from '../constants/debrief-roleplay-fields.constants';

/**
 * The roleplay brief: what the Debrief reads about a roleplay, built from the one registry
 * (`ROLEPLAY_FIELDS`). Reading and building both go through it, so a field is added, renamed or
 * switched on in one place.
 */

/** Each registry field's raw value, by registry key. */
export type RoleplayFieldValues = Record<string, unknown>;

/** The SELECT list for the roleplay's fields, from the registry (`sc` is the scenarios alias). */
export function roleplayFieldSelect(alias = 'sc'): string {
  return ROLEPLAY_FIELDS.map((f) =>
    f.source.kind === 'column'
      ? `${alias}."${f.source.name}" AS "rp_${f.key}"`
      : `${alias}.metadata->'${f.source.name}' AS "rp_${f.key}"`,
  ).join(', ');
}

/** The registry fields out of a row `roleplayFieldSelect` selected. */
export function readRoleplayFields(
  row: Record<string, unknown> | null | undefined,
): RoleplayFieldValues {
  const out: RoleplayFieldValues = {};
  for (const f of ROLEPLAY_FIELDS) {
    const v = row?.[`rp_${f.key}`];
    if (v !== null && v !== undefined) out[f.key] = v;
  }
  return out;
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
};

/** One field's value as the graph reads it, or null when there is nothing worth sending. */
export function cleanRoleplayField(
  def: RoleplayFieldDef,
  raw: unknown,
): string | string[] | null {
  if (def.key === 'stages') {
    const names = (Array.isArray(raw) ? raw : [])
      .map((s) => text((s as { name?: unknown })?.name, def.maxChars))
      .filter((n): n is string => !!n)
      .slice(0, 20);
    return names.length ? names : null;
  }
  const t = text(raw, def.maxChars);
  // The difficulty enum reads best in plain lower case.
  return t && def.key === 'difficulty' ? t.toLowerCase().replace(/_/g, ' ') : t;
}

/**
 * The optional fields a release has on: its `roleplayFields` setting (unknown keys ignored), or
 * the defaults when it names none.
 */
export function enabledRoleplayKeys(setting: unknown): string[] {
  if (!Array.isArray(setting)) return [...ROLEPLAY_FIELDS_DEFAULT];
  return [
    ...new Set(
      setting.filter(
        (k): k is string =>
          typeof k === 'string' && ROLEPLAY_OPTIONAL_KEYS.includes(k),
      ),
    ),
  ];
}

/**
 * The `session.scenario` block: the always-on fields plus the optional ones the release has on,
 * under the graph's keys, empty values left out.
 */
export function roleplayBrief(
  values: RoleplayFieldValues | null | undefined,
  setting?: unknown,
): Record<string, unknown> {
  const on = new Set(enabledRoleplayKeys(setting));
  const out: Record<string, unknown> = {};
  for (const f of ROLEPLAY_FIELDS) {
    if (!f.alwaysOn && !on.has(f.key)) continue;
    const v = cleanRoleplayField(f, values?.[f.key]);
    if (v !== null) out[f.out] = v;
  }
  return out;
}

/** The optional fields in plain words, for whoever proposes a change (the PM agent reads this). */
export function roleplayFieldsCatalogue(): string {
  const lines = ROLEPLAY_FIELDS.filter((f) => !f.alwaysOn).map(
    (f) =>
      `- ${f.key} (${f.defaultOn ? 'on' : 'off'} by default): ${f.label}. ${f.description}`,
  );
  return `The title and description are always read. Optional fields:\n${lines.join('\n')}`;
}

/** A proposed `roleplayFields` value (a list or its JSON text) as a list of known optional keys, or null. */
export function parseRoleplayFields(value: unknown): string[] | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (
    !Array.isArray(v) ||
    v.some((k) => typeof k !== 'string' || !ROLEPLAY_OPTIONAL_KEYS.includes(k))
  ) {
    return null;
  }
  return [...new Set(v as string[])];
}
