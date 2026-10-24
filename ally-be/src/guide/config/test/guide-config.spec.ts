import {
  flattenPolicy,
  schemaProblems,
} from 'src/llm-agent/harness/config/policy-schema';
import { GuideMode } from '../../enum/guide.enum';
import {
  GUIDE_DEFAULT_BUNDLE,
  GUIDE_DEFAULT_POLICY,
} from '../../release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from '../../release/policy.schema';
import { epochPolicy, resolveGuidePolicy } from '../guide-config';
import { GuideConfigResolverService } from '../guide-config-resolver.service';

describe('GUIDE_POLICY_SCHEMA', () => {
  it('declares exactly the keys of GuidePolicy', () => {
    expect(Object.keys(GUIDE_POLICY_SCHEMA).sort()).toEqual(
      Object.keys(flattenPolicy(GUIDE_DEFAULT_POLICY)).sort(),
    );
  });

  it('is consistent, and the default release policy validates against it', () => {
    expect(schemaProblems(GUIDE_POLICY_SCHEMA)).toEqual([]);
    const flat = flattenPolicy(GUIDE_DEFAULT_POLICY);
    for (const [key, spec] of Object.entries(GUIDE_POLICY_SCHEMA)) {
      expect({ key, value: flat[key] }).toEqual({ key, value: spec.default });
    }
  });

  it('follows Appendix A on who may override what', () => {
    const by = (key: string) => GUIDE_POLICY_SCHEMA[key].overridableBy;
    expect(by('releaseWindowMaxTurns')).toEqual(['org', 'course']);
    expect(by('steer.l2OffSpineTurns')).toEqual(['org']);
    expect(by('sideQuestCadence.walk')).toEqual(['org', 'course', 'learner']);
    expect(by('fade.start.lay')).toEqual(['org']);
    for (const [key, spec] of Object.entries(GUIDE_POLICY_SCHEMA)) {
      if (key.startsWith('safety.')) expect(spec.pinned).toBe(true);
      if (key.startsWith('limits.')) expect(spec.overridableBy).toEqual([]);
    }
  });
});

/** Deterministic PRNG for the property runs. */
function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

describe('resolveGuidePolicy (property-style)', () => {
  const keys = Object.keys(GUIDE_POLICY_SCHEMA);
  const randomOverrides = (next: () => number) => {
    const values: Record<string, number | null> = {};
    for (const key of keys) {
      if (next() < 0.2) {
        const spec = GUIDE_POLICY_SCHEMA[key];
        values[key] =
          next() < 0.1 && spec.nullable
            ? null
            : spec.type === 'int'
              ? Math.round(
                  (spec.min ?? 0) +
                    next() * ((spec.max ?? 10) - (spec.min ?? 0)),
                )
              : (spec.min ?? 0) + next() * ((spec.max ?? 1) - (spec.min ?? 0));
      }
    }
    return values;
  };

  it('pinned and platform-only keys always keep the release value', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const { policy, resolved } = resolveGuidePolicy({
        releasePolicy: GUIDE_DEFAULT_POLICY,
        epochConfig: {
          org: randomOverrides(next),
          course: randomOverrides(next),
          versions: { org: 1, course: 1 },
        },
        prefs: next() < 0.5 ? { sideQuests: false } : {},
        runtime: { mode: GuideMode.NORMAL, visitor: false },
      });
      const flat = flattenPolicy(policy);
      const release = flattenPolicy(GUIDE_DEFAULT_POLICY);
      for (const [key, spec] of Object.entries(GUIDE_POLICY_SCHEMA)) {
        if (spec.overridableBy.length === 0) {
          expect({ seed, key, value: flat[key] }).toEqual({
            seed,
            key,
            value: release[key],
          });
        }
        // The policy object and the explanation never disagree.
        expect(flat[key]).toEqual(resolved.entries[key].value);
      }
    }
  });

  it('course beats org, and org beats the release', () => {
    const { resolved } = resolveGuidePolicy({
      releasePolicy: GUIDE_DEFAULT_POLICY,
      epochConfig: {
        org: { releaseWindowMaxTurns: 8, 'steer.l3OffSpineTurns': 12 },
        course: { releaseWindowMaxTurns: 3 },
        versions: { org: 1, course: 1 },
      },
      prefs: null,
      runtime: { mode: GuideMode.NORMAL, visitor: false },
    });
    expect(resolved.entries.releaseWindowMaxTurns).toMatchObject({
      value: 3,
      source: 'course',
    });
    expect(
      resolved.entries.releaseWindowMaxTurns.chain.map((c) => c.layer),
    ).toEqual(['release', 'org', 'course']);
    expect(resolved.entries['steer.l3OffSpineTurns'].source).toBe('org');
  });

  it('a hard moment switches side quests off, and says why', () => {
    const { policy, resolved } = resolveGuidePolicy({
      releasePolicy: GUIDE_DEFAULT_POLICY,
      epochConfig: null,
      prefs: null,
      runtime: { mode: GuideMode.CARE, visitor: false },
    });
    expect(policy.sideQuestCadence).toEqual({
      lead: null,
      walk: null,
      drive: null,
    });
    const chain = resolved.entries['sideQuestCadence.walk'].chain;
    const last = chain[chain.length - 1];
    expect(last).toEqual({
      layer: 'runtime',
      value: null,
      reason: 'mode CARE',
    });
  });

  it('epochPolicy without a frozen config is the release policy itself', () => {
    expect(epochPolicy(GUIDE_DEFAULT_POLICY, null)).toBe(GUIDE_DEFAULT_POLICY);
    expect(
      epochPolicy(GUIDE_DEFAULT_POLICY, {
        org: { releaseWindowMaxTurns: 9 },
        course: {},
        versions: { org: 2, course: null },
      }).releaseWindowMaxTurns,
    ).toBe(9);
  });
});

describe('GuideConfigResolverService.explain', () => {
  const thread = {
    id: 'th1',
    userId: 3,
    tenantId: 'org-1',
    trackId: 'tr1',
    epoch: 2,
    mode: GuideMode.NORMAL,
    epochSnapshot: {
      releaseId: 'rel-1',
      tier: 'premium',
      model: 'claude-opus-5-5',
      startedAt: '2026-10-24T00:00:00.000Z',
      config: {
        org: { releaseWindowMaxTurns: 8 },
        course: {},
        versions: { org: 1, course: null },
      },
    },
  };
  const make = (current: { org?: any; course?: any }) =>
    new GuideConfigResolverService(
      {
        forScopes: jest.fn(async () => ({
          org: null,
          course: null,
          ...current,
        })),
      } as never,
      {
        getById: jest.fn(async () => ({
          id: 'rel-1',
          version: 4,
          bundle: GUIDE_DEFAULT_BUNDLE,
        })),
        getGa: jest.fn(async () => ({
          id: 'rel-1',
          version: 4,
          bundle: GUIDE_DEFAULT_BUNDLE,
        })),
      } as never,
      { findOne: jest.fn(async () => thread) } as never,
      {
        findOne: jest.fn(async () => ({ prefs: { guidance: 'lead' } })),
      } as never,
    );

  it('returns every key with its source and the epoch it applies to', async () => {
    const out = await make({
      org: { values: { releaseWindowMaxTurns: 8 }, version: 1 },
    }).explain('th1');
    expect(out.entries).toHaveLength(Object.keys(GUIDE_POLICY_SCHEMA).length);
    const window = out.entries.find((e) => e.key === 'releaseWindowMaxTurns')!;
    expect(window).toMatchObject({
      value: 8,
      source: 'org',
      releaseValue: 6,
      pending: null,
    });
    expect(out.overridesPending).toBe(false);
    expect(out.runtime).toMatchObject({ guidance: 'lead', tier: 'premium' });
    expect(
      out.entries.find((e) => e.key === 'safety.messageMaxChars'),
    ).toMatchObject({ pinned: true, source: 'release' });
  });

  it('shows a change saved since the epoch began as pending', async () => {
    const out = await make({
      org: { values: { releaseWindowMaxTurns: 8 }, version: 2 },
      course: { values: { releaseWindowMaxTurns: 4 }, version: 1 },
    }).explain('th1');
    expect(out.overridesPending).toBe(true);
    const window = out.entries.find((e) => e.key === 'releaseWindowMaxTurns')!;
    expect(window.value).toBe(8);
    expect(window.pending).toEqual({ value: 4, source: 'course' });
  });
});
