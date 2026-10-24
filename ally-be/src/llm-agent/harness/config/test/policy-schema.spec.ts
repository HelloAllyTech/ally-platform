import {
  POLICY_LAYER_ORDER,
  PolicyLayer,
  PolicyLayerInput,
  PolicySchema,
  PolicyValue,
  PolicyValues,
  applyPolicyValues,
  flattenPolicy,
  overrideRefusal,
  resolvePolicyValues,
  schemaProblems,
} from '../policy-schema';

/** Deterministic PRNG so a failing case can be replayed from its seed. */
function rng(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)],
    bool: (p = 0.5) => next() < p,
  };
}

const OVERRIDE_LAYERS = ['org', 'course', 'learner'] as const;

/** A random schema of int keys with random overridability and pins. */
function randomSchema(r: ReturnType<typeof rng>): PolicySchema {
  const schema: Record<string, any> = {};
  const count = r.int(1, 8);
  for (let i = 0; i < count; i++) {
    const pinned = r.bool(0.25);
    schema[`k${i}`] = {
      group: 'g',
      type: 'int',
      default: 10,
      min: 0,
      max: 100,
      nullable: r.bool(0.3),
      description: `key ${i}`,
      pinned,
      overridableBy: pinned ? [] : OVERRIDE_LAYERS.filter(() => r.bool(0.5)),
    };
  }
  return schema;
}

/** A value that is sometimes illegal (out of range, wrong type, null). */
function randomValue(r: ReturnType<typeof rng>): unknown {
  const roll = r.next();
  if (roll < 0.6) return r.int(0, 100);
  if (roll < 0.7) return r.int(101, 500);
  if (roll < 0.8) return null;
  if (roll < 0.9) return 'seven';
  return 1.5;
}

function randomLayers(
  r: ReturnType<typeof rng>,
  schema: PolicySchema,
): PolicyLayerInput[] {
  const keys = [...Object.keys(schema), 'unknownKey'];
  return POLICY_LAYER_ORDER.filter(() => r.bool(0.8)).map((layer) => {
    const values: Record<string, PolicyValue> = {};
    for (const key of keys) {
      if (r.bool(0.5)) values[key] = randomValue(r) as PolicyValue;
    }
    return { layer, values };
  });
}

/** The rule written out the slow way, independently of the implementation. */
function expected(
  schema: PolicySchema,
  layers: PolicyLayerInput[],
  key: string,
): { value: unknown; source: PolicyLayer } {
  const spec = schema[key];
  let out: { value: unknown; source: PolicyLayer } = {
    value: spec.default,
    source: 'release',
  };
  for (const layer of POLICY_LAYER_ORDER) {
    const input = layers.find((l) => l.layer === layer);
    if (!input || !(key in input.values)) continue;
    const value = input.values[key];
    const legal =
      value === null
        ? Boolean(spec.nullable)
        : typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= (spec.min ?? -Infinity) &&
          value <= (spec.max ?? Infinity);
    if (!legal) continue;
    const allowed =
      layer === 'release' ||
      layer === 'runtime' ||
      (!spec.pinned && spec.overridableBy.includes(layer as never));
    if (allowed) out = { value, source: layer };
  }
  return out;
}

const shuffle = <T>(r: ReturnType<typeof rng>, items: T[]): T[] => {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

describe('policy schema resolution (property-style)', () => {
  const RUNS = 400;

  it('every value is the highest permitted, legal layer — else the default', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const layers = randomLayers(r, schema);
      const resolved = resolvePolicyValues(schema, layers);
      for (const key of Object.keys(schema)) {
        const want = expected(schema, layers, key);
        const got = resolved.entries[key];
        if (got.value !== want.value || got.source !== want.source) {
          throw new Error(
            `seed ${seed}, ${key}: got ${got.value}@${got.source}, want ${want.value}@${want.source}`,
          );
        }
      }
    }
  });

  it('does not depend on the order layers are passed in', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const layers = randomLayers(r, schema);
      const a = resolvePolicyValues(schema, layers);
      const b = resolvePolicyValues(schema, shuffle(r, layers));
      expect(b.entries).toEqual(a.entries);
    }
  });

  it('a pinned key never takes an org, course or learner value', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const layers = randomLayers(r, schema);
      const resolved = resolvePolicyValues(schema, layers);
      for (const [key, spec] of Object.entries(schema)) {
        if (!spec.pinned) continue;
        const entry = resolved.entries[key];
        expect(['release', 'runtime']).toContain(entry.source);
        for (const link of entry.chain) {
          expect(['release', 'runtime']).toContain(link.layer);
        }
      }
    }
  });

  it('explain: the chain is in precedence order, ends with the winner, and covers every key', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const layers = randomLayers(r, schema);
      const resolved = resolvePolicyValues(schema, layers);
      expect(Object.keys(resolved.entries).sort()).toEqual(
        Object.keys(schema).sort(),
      );
      for (const entry of Object.values(resolved.entries)) {
        const order = entry.chain.map((link) =>
          POLICY_LAYER_ORDER.indexOf(link.layer),
        );
        expect(order).toEqual([...order].sort((x, y) => x - y));
        if (entry.chain.length) {
          const last = entry.chain[entry.chain.length - 1];
          expect(last.layer).toBe(entry.source);
          expect(last.value).toBe(entry.value);
        } else {
          expect(entry.source).toBe('release');
          expect(entry.value).toBe(schema[entry.key].default);
        }
      }
    }
  });

  it('reports every value it refused, and never applies one', () => {
    for (let seed = 1; seed <= RUNS; seed++) {
      const r = rng(seed);
      const schema = randomSchema(r);
      const layers = randomLayers(r, schema);
      const resolved = resolvePolicyValues(schema, layers);
      const applied = Object.values(resolved.entries).reduce(
        (n, entry) => n + entry.chain.length,
        0,
      );
      const offered = layers.reduce(
        (n, layer) => n + Object.keys(layer.values).length,
        0,
      );
      expect(applied + resolved.ignored.length).toBe(offered);
    }
  });
});

describe('overrideRefusal', () => {
  const schema: PolicySchema = {
    pinnedKey: {
      group: 'g',
      type: 'int',
      default: 1,
      description: 'x',
      overridableBy: [],
      pinned: true,
    },
    platformKey: {
      group: 'g',
      type: 'int',
      default: 1,
      description: 'x',
      overridableBy: [],
    },
    orgKey: {
      group: 'g',
      type: 'int',
      default: 1,
      min: 0,
      max: 5,
      description: 'x',
      overridableBy: ['org'],
    },
  };

  it('names why a write is refused', () => {
    expect(overrideRefusal(schema, 'org', 'pinnedKey', 2)?.code).toBe('pinned');
    expect(overrideRefusal(schema, 'org', 'platformKey', 2)?.code).toBe(
      'layer',
    );
    expect(overrideRefusal(schema, 'course', 'orgKey', 2)?.message).toMatch(
      /only for an organisation/,
    );
    expect(overrideRefusal(schema, 'org', 'orgKey', 9)?.code).toBe('value');
    expect(overrideRefusal(schema, 'org', 'nope', 1)?.code).toBe('unknown');
    expect(overrideRefusal(schema, 'org', 'orgKey', 3)).toBeNull();
  });

  it('a schema that pins and permits the same key is caught', () => {
    expect(
      schemaProblems({
        bad: { ...schema.pinnedKey, overridableBy: ['org'] },
      }),
    ).toEqual([expect.stringMatching(/pinned but overridable/)]);
  });
});

describe('dot paths', () => {
  it('flatten and apply round-trip without touching the original', () => {
    const base = { a: { b: 1, c: { d: null } }, e: 2 };
    const flat = flattenPolicy(base);
    expect(flat).toEqual({ 'a.b': 1, 'a.c.d': null, e: 2 });
    const changed = applyPolicyValues(base, { 'a.c.d': 4, e: 3 });
    expect(changed).toEqual({ a: { b: 1, c: { d: 4 } }, e: 3 });
    expect(base.a.c.d).toBeNull();
    expect(applyPolicyValues(base, flat as PolicyValues)).toEqual(base);
  });
});
