/**
 * The harness's configuration plane, generic part (plans/ally-guide/plan.md
 * §7.5). An agent declares each tunable ONCE in a policy schema; admin forms,
 * validation, docs and the "effective config" explainer all read from it.
 *
 * A value resolves through layers, later winning:
 *
 *   release defaults → org → course → learner → runtime
 *
 * A layer may set a key only when the schema lists it in `overridableBy`
 * (release and runtime are the platform's own and need no listing). A
 * `pinned` key is part of the safety or White Hat core: no layer may override
 * it, and the schema refuses to declare one that says otherwise.
 *
 * Everything here is pure, so precedence and `explain` are property-tested
 * without a database.
 */

/** The layers an admin or learner can override. */
export type PolicyOverrideLayer = 'org' | 'course' | 'learner';
/** Every layer a value can come from, in precedence order (lowest first). */
export type PolicyLayer = 'release' | PolicyOverrideLayer | 'runtime';
export const POLICY_LAYER_ORDER: readonly PolicyLayer[] = [
  'release',
  'org',
  'course',
  'learner',
  'runtime',
];

export type PolicyValue = number | boolean | string | null;

export interface PolicyKeySpec {
  type: 'int' | 'number' | 'boolean' | 'enum';
  /** The value in the code's default release; checked against the release in a test. */
  default: PolicyValue;
  min?: number;
  max?: number;
  enum?: readonly string[];
  /** null is a legal value (for example "off"). */
  nullable?: boolean;
  unit?: string;
  /** Admin-facing: what changing it does, in plain words. */
  description: string;
  overridableBy: readonly PolicyOverrideLayer[];
  /** Safety or White Hat core: never overridable, by any layer. */
  pinned?: boolean;
  /** Admin-facing grouping for generated forms. */
  group: string;
  /**
   * The learner's lever when it is a choice between keys rather than a value
   * (the guidance dial picks which of `prose.maxWords.*` applies).
   */
  learnerLever?: string;
}

export type PolicySchema = Readonly<Record<string, PolicyKeySpec>>;

/** A dot path → value map: one layer's contribution. */
export type PolicyValues = Record<string, PolicyValue>;

export interface PolicyLayerInput {
  layer: PolicyLayer;
  values: PolicyValues;
  /** Why this layer set what it set (runtime: "mode CARE"). Shown by explain. */
  reason?: string;
}

export interface PolicyChainLink {
  layer: PolicyLayer;
  value: PolicyValue;
  reason?: string;
}

export interface PolicyIgnored {
  layer: PolicyLayer;
  key: string;
  value: unknown;
  why: string;
}

export interface ResolvedPolicyEntry {
  key: string;
  value: PolicyValue;
  source: PolicyLayer;
  /** Every layer that set this key, lowest first; the last one won. */
  chain: PolicyChainLink[];
}

export interface ResolvedPolicyValues {
  entries: Record<string, ResolvedPolicyEntry>;
  /** Values a layer tried to set and the schema refused (stale rows, bad types). */
  ignored: PolicyIgnored[];
}

/* ------------------------------------------------------------------ *
 * Schema checks
 * ------------------------------------------------------------------ */

/** Why `value` is not legal for `spec`, or null when it is. */
export function invalidValueReason(
  spec: PolicyKeySpec,
  value: unknown,
): string | null {
  if (value === null) return spec.nullable ? null : 'cannot be empty';
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return typeof value === 'string' && (spec.enum ?? []).includes(value)
        ? null
        : `must be one of ${(spec.enum ?? []).join(', ')}`;
    case 'int':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'must be a number';
      }
      if (spec.type === 'int' && !Number.isInteger(value)) {
        return 'must be a whole number';
      }
      if (spec.min !== undefined && value < spec.min) {
        return `must be at least ${spec.min}`;
      }
      if (spec.max !== undefined && value > spec.max) {
        return `must be at most ${spec.max}`;
      }
      return null;
    }
  }
}

/** Contradictions inside the schema itself (a test runs this on every schema). */
export function schemaProblems(schema: PolicySchema): string[] {
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.pinned && spec.overridableBy.length > 0) {
      problems.push(`${key}: pinned but overridable by ${spec.overridableBy}`);
    }
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max)
      problems.push(`${key}: min above max`);
    if (spec.type === 'enum' && !spec.enum?.length)
      problems.push(`${key}: enum without values`);
    const bad = invalidValueReason(spec, spec.default);
    if (bad) problems.push(`${key}: default ${bad}`);
    if (!spec.description.trim()) problems.push(`${key}: no description`);
  }
  return problems;
}

/**
 * Why `layer` may not set `key`, or null when it may. Used both to refuse an
 * admin's write and to ignore a stale stored override at resolve time.
 */
export function overrideRefusal(
  schema: PolicySchema,
  layer: PolicyOverrideLayer,
  key: string,
  value: unknown,
): { code: 'unknown' | 'pinned' | 'layer' | 'value'; message: string } | null {
  const spec = schema[key];
  if (!spec) return { code: 'unknown', message: `${key} is not a setting` };
  if (spec.pinned) {
    return {
      code: 'pinned',
      message: `${key} is fixed: it is part of Ally's safety and fairness core, so no organisation, course or learner can change it`,
    };
  }
  if (!spec.overridableBy.includes(layer)) {
    const who = spec.overridableBy.length
      ? `only for ${spec.overridableBy.map(layerNoun).join(' or ')}`
      : 'only in a new release';
    return {
      code: 'layer',
      message: `${key} can't be set for ${layerNoun(layer)}; it can be changed ${who}`,
    };
  }
  const bad = invalidValueReason(spec, value);
  if (bad) return { code: 'value', message: `${key} ${bad}` };
  return null;
}

const layerNoun = (layer: PolicyOverrideLayer): string =>
  layer === 'org'
    ? 'an organisation'
    : layer === 'course'
      ? 'a course'
      : 'a learner';

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve every schema key through the layers in precedence order. Layers may
 * arrive in any order; they are sorted by POLICY_LAYER_ORDER. A key the
 * layer is not allowed to set, or a value the schema rejects, is skipped and
 * reported in `ignored` — a stale row never breaks a turn.
 *
 * `release` must cover every key; a missing release value falls back to the
 * schema default (an older release, written before the key existed).
 */
export function resolvePolicyValues(
  schema: PolicySchema,
  layers: PolicyLayerInput[],
): ResolvedPolicyValues {
  const ordered = [...layers].sort(
    (a, b) =>
      POLICY_LAYER_ORDER.indexOf(a.layer) - POLICY_LAYER_ORDER.indexOf(b.layer),
  );
  const entries: Record<string, ResolvedPolicyEntry> = {};
  const ignored: PolicyIgnored[] = [];

  for (const [key, spec] of Object.entries(schema)) {
    entries[key] = {
      key,
      value: spec.default,
      source: 'release',
      chain: [],
    };
  }

  for (const input of ordered) {
    for (const [key, value] of Object.entries(input.values)) {
      const spec = schema[key];
      if (!spec) {
        ignored.push({ layer: input.layer, key, value, why: 'unknown key' });
        continue;
      }
      if (input.layer === 'release' || input.layer === 'runtime') {
        // The platform's own layers: any key, but still a legal value.
        const bad = invalidValueReason(spec, value);
        if (bad) {
          ignored.push({ layer: input.layer, key, value, why: bad });
          continue;
        }
      } else {
        const refusal = overrideRefusal(schema, input.layer, key, value);
        if (refusal) {
          ignored.push({
            layer: input.layer,
            key,
            value,
            why: refusal.message,
          });
          continue;
        }
      }
      const entry = entries[key];
      entry.value = value;
      entry.source = input.layer;
      entry.chain.push({
        layer: input.layer,
        value,
        ...(input.reason ? { reason: input.reason } : {}),
      });
    }
  }
  return { entries, ignored };
}

/* ------------------------------------------------------------------ *
 * Dot paths over a nested policy object
 * ------------------------------------------------------------------ */

/** Every leaf of a nested object as `a.b.c → value` (arrays are leaves). */
export function flattenPolicy(
  value: unknown,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenPolicy(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    out[prefix] = value;
  }
  return out;
}

/** A deep copy of `base` with each `path → value` written in. */
export function applyPolicyValues<T>(base: T, values: PolicyValues): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split('.');
    let node: Record<string, unknown> = copy;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (next === null || typeof next !== 'object') {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  return copy as T;
}

/** Only the entries some layer above `release` decided. */
export function nonReleaseValues(
  resolved: ResolvedPolicyValues,
): Record<string, { value: PolicyValue; source: PolicyLayer }> {
  const out: Record<string, { value: PolicyValue; source: PolicyLayer }> = {};
  for (const entry of Object.values(resolved.entries)) {
    if (entry.source !== 'release') {
      out[entry.key] = { value: entry.value, source: entry.source };
    }
  }
  return out;
}
