import { DebriefGuidanceIndexService } from '../service/debrief-guidance-index.service';
import { DebriefGatewayService } from '../service/debrief-gateway.service';
import {
  DEBRIEF_GATEWAY_TOOLS,
  GATEWAY_TOOLS,
} from '../service/debrief-run-token.service';
import {
  DEBRIEF_MODELS,
  DEBRIEF_PROMPT_CODES,
  GUIDANCE_TOOL_NAMES,
  GUIDANCE_TOOL_STEPS,
  PM_AGENT_SETTINGS,
  DEBRIEF_SEED_BUNDLE,
  GUIDANCE_TOOLS_DEFAULT,
  guidanceToolsFor,
  validateDebriefBundle,
} from '../constants/debrief-release.constants';

const T1 = '6b0d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e6f';
const T2 = '0f9d6a3e-4b8f-4a43-9a5a-1f2b3c4d5e70';

const chunk = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  statement: `Statement ${code}.`,
  body: `Body of ${code}. More.`,
  situations: [],
  facets: { kind: 'practice_guideline', level: ['lay'] },
  isGlobal: true,
  tenantIds: [],
  citation: null,
  attributes: {},
  ...over,
});

function build(rows: any[], opts: { fail?: boolean } = {}) {
  const state = { rows, sig: { n: rows.length, m: new Date('2026-11-01') } };
  const repo = {
    query: jest.fn(async () => {
      if (opts.fail) throw new Error('db down');
      return [{ n: String(state.sig.n), m: state.sig.m }];
    }),
    find: jest.fn(async (q: any) => {
      if (opts.fail) throw new Error('db down');
      const codes: string[] | undefined = q.where?.code?._value;
      return state.rows.filter((r) => !codes || codes.includes(r.code));
    }),
  };
  const retrieval = { recordUsage: jest.fn(async () => undefined) };
  const svc = new DebriefGuidanceIndexService(repo as any, retrieval as any);
  return { svc, repo, state, retrieval };
}

describe('guidance_index', () => {
  const rows = [
    chunk('DG-0003', { isGlobal: false, tenantIds: [T2] }),
    chunk('DG-0002', { isGlobal: false, tenantIds: [T1] }),
    chunk('DG-0001', { situations: ['a client goes quiet', 'long silence'] }),
    chunk('DG-0004', { facets: { kind: 'skill_framework' } }),
    chunk('DG-0005', {
      facets: { kind: 'protocol' },
      citation: { title: 'Referral rule' },
      statement: 'x'.repeat(300),
    }),
  ];

  it('shows a tenant global plus its own entries, not another tenant’s, never a skill framework, sorted by code', async () => {
    const { svc } = build(rows);
    const out = await svc.index(T1);
    expect(out.entries.map((e) => e.code)).toEqual([
      'DG-0001',
      'DG-0002',
      'DG-0005',
    ]);
    expect(out.entries[0]).toMatchObject({
      kind: 'practice_guideline',
      level: ['lay'],
      hint: 'a client goes quiet; long silence',
    });
    expect(out.entries[2].title).toBe('ORGANISATION PROTOCOL: Referral rule');
  });

  it('a non-UUID or missing tenant reads global entries only', async () => {
    const { svc } = build(rows);
    for (const t of ['placeholder', null, undefined]) {
      const out = await svc.index(t as any);
      expect(out.entries.map((e) => e.code)).toEqual(['DG-0001', 'DG-0005']);
    }
  });

  it('clips the title to 120 and the hint to 160, hint falls back to the first sentence', async () => {
    const { svc } = build([
      chunk('DG-0009', {
        statement: 'T'.repeat(300),
        body: `${'w '.repeat(200)}.`,
      }),
      chunk('DG-0010', { body: 'First one. Second one.' }),
    ]);
    const out = await svc.index(null);
    expect(out.entries[0].title.length).toBeLessThanOrEqual(120);
    expect(out.entries[0].hint.length).toBeLessThanOrEqual(160);
    expect(out.entries[1].hint).toBe('First one.');
  });

  it('serves the cache while the signature is unchanged and rebuilds when it changes', async () => {
    const { svc, repo, state } = build([chunk('DG-0001')]);
    const a = await svc.index(T1);
    const b = await svc.index(T1);
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(repo.query).toHaveBeenCalledTimes(2);
    expect(b.version).toBe(a.version);
    state.rows = [chunk('DG-0001'), chunk('DG-0002')];
    state.sig = { n: 2, m: new Date('2026-11-02') };
    const c = await svc.index(T1);
    expect(repo.find).toHaveBeenCalledTimes(2);
    expect(c.version).not.toBe(a.version);
    expect(c.entries.map((e) => e.code)).toEqual(['DG-0001', 'DG-0002']);
    // an edit alone (same count, later updatedAt) also invalidates
    state.sig = { n: 2, m: new Date('2026-11-03') };
    await svc.index(T1);
    expect(repo.find).toHaveBeenCalledTimes(3);
  });

  it('never throws', async () => {
    const { svc } = build([], { fail: true });
    expect(await svc.index(T1)).toEqual({
      version: 'unavailable',
      entries: [],
      unavailable: true,
    });
  });
});

describe('guidance_fetch', () => {
  const rows = [
    chunk('DG-0001'),
    chunk('DG-0002', { isGlobal: false, tenantIds: [T2] }),
    chunk('DG-0003', { facets: { kind: 'skill_framework' } }),
    ...[4, 5, 6, 7].map((n) => chunk(`DG-000${n}`)),
  ];

  it('returns visible passages, not_found for other tenants’, frameworks and unknown codes; codes are case-insensitive and trimmed', async () => {
    const { svc, retrieval } = build(rows);
    const out = await svc.fetch(
      T1,
      [' dg-0001 ', 'DG-0002', 'DG-0003', 'DG-9999'],
      's1',
    );
    expect(out.passages).toHaveLength(1);
    expect(out.passages[0]).toMatchObject({
      id: 'id-DG-0001',
      code: 'DG-0001',
      band: 'direct',
      citation: 'Statement DG-0001.',
      text: 'Body of DG-0001. More.',
    });
    expect(out.not_found).toEqual(['DG-0002', 'DG-0003', 'DG-9999']);
    expect(retrieval.recordUsage).toHaveBeenCalledWith(
      expect.anything(),
      { ids: ['id-DG-0001'] },
      'read',
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('reads at most five codes', async () => {
    const { svc } = build(rows);
    const out = await svc.fetch(T1, [
      'DG-0001',
      'DG-0004',
      'DG-0005',
      'DG-0006',
      'DG-0007',
      'DG-0002',
    ]);
    expect(out.passages.map((p) => p.code)).toEqual([
      'DG-0001',
      'DG-0004',
      'DG-0005',
      'DG-0006',
      'DG-0007',
    ]);
    expect(out.not_found).toEqual([]);
  });

  it('never throws', async () => {
    const { svc } = build([], { fail: true });
    expect(await svc.fetch(T1, ['DG-0001'])).toEqual({
      passages: [],
      not_found: ['DG-0001'],
      unavailable: true,
    });
  });
});

describe('per-step enforcement', () => {
  const g = new DebriefGatewayService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const claims = (guidanceTools?: Record<string, string[]>) =>
    ({ runId: 'r', sessionId: 's', tools: [], exp: 0, guidanceTools }) as any;

  it('defaults a missing step to the guidance agent for index and fetch, and lets a plain search through', () => {
    expect(g.guidanceStep(claims(), 'guidance_index', {})).toBe(
      'guidance_agent',
    );
    expect(
      g.guidanceStep(claims(), 'guidance_fetch', { step: 'guidance_agent' }),
    ).toBe('guidance_agent');
    expect(g.guidanceStep(claims(), 'guidance_search', {})).toBe(
      'guidance_lookup',
    );
  });

  it('refuses a step the release did not enable, and allows one it did', () => {
    expect(() =>
      g.guidanceStep(claims(), 'guidance_fetch', { step: 'writer' }),
    ).toThrow(/not enabled/);
    const c = claims({ writer: ['guidance_fetch'] });
    expect(g.guidanceStep(c, 'guidance_fetch', { step: 'writer' })).toBe(
      'writer',
    );
    expect(() =>
      g.guidanceStep(c, 'guidance_index', { step: 'writer' }),
    ).toThrow();
    expect(() =>
      g.guidanceStep(c, 'guidance_fetch', { step: 'Bad Step!' }),
    ).toThrow();
  });

  it('does not apply to Ask Ally’s reply token', () => {
    expect(
      g.guidanceStep({ scope: 'reply' } as any, 'guidance_search', {}),
    ).toBe('ask_ally');
  });
});

describe('gateway wiring', () => {
  it('serves both tools in a debrief run’s token', () => {
    expect(DEBRIEF_GATEWAY_TOOLS).toEqual(
      expect.arrayContaining(['guidance_index', 'guidance_fetch']),
    );
    expect(GATEWAY_TOOLS).toEqual(
      expect.arrayContaining(['guidance_index', 'guidance_fetch']),
    );
  });

  it('uses the run’s tenant and falls back to unavailable without the service', async () => {
    const idx = {
      logCall: jest.fn(),
      index: jest.fn(async () => ({ version: 'v', entries: [] })),
      fetch: jest.fn(async () => ({ passages: [], not_found: [] })),
    };
    const ctx = {
      loadSession: jest.fn(async () => ({ tenantId: 'from-session' })),
    };
    const g = new DebriefGatewayService(
      {} as any,
      ctx as any,
      {} as any,
      {} as any,
      undefined,
      idx as any,
    );
    await g.guidanceIndexTool({ tenantId: T1, scenarioSessionId: 's' } as any);
    expect(idx.index).toHaveBeenCalledWith(T1);
    await g.guidanceFetchTool(
      { tenantId: null, scenarioSessionId: 's' } as any,
      { codes: ['DG-1'] },
    );
    expect(idx.fetch).toHaveBeenCalledWith(
      'from-session',
      ['DG-1'],
      's',
      'guidance_agent',
    );
    const bare = new DebriefGatewayService(
      {} as any,
      ctx as any,
      {} as any,
      {} as any,
    );
    expect(
      await bare.guidanceFetchTool({} as any, { codes: ['DG-1'] }),
    ).toEqual({
      passages: [],
      not_found: ['DG-1'],
      unavailable: true,
    });
  });
});

describe('guidance agent settings', () => {
  const bundle = (settings: Record<string, unknown>) => ({
    ...(DEBRIEF_SEED_BUNDLE as any),
    settings: { ...(DEBRIEF_SEED_BUNDLE as any).settings, ...settings },
  });
  const guidanceProblems = (settings: Record<string, unknown>) =>
    validateDebriefBundle(bundle(settings)).filter((p) => /guidance/.test(p));

  it('new releases default to 3 calls', () => {
    const s = (DEBRIEF_SEED_BUNDLE as any).settings;
    expect(s.guidanceAgentMaxCalls).toBe(3);
    expect(s.guidanceTools.guidance_agent).toEqual([...GUIDANCE_TOOL_NAMES]);
    expect(guidanceProblems({})).toEqual([]);
  });

  it('is bounded 0 to 5, whole numbers, and optional for old releases', () => {
    expect(PM_AGENT_SETTINGS.guidanceAgentMaxCalls).toEqual({ min: 0, max: 5 });
    expect(guidanceProblems({ guidanceAgentMaxCalls: 0 })).toEqual([]);
    expect(guidanceProblems({ guidanceAgentMaxCalls: 5 })).toEqual([]);
    expect(guidanceProblems({ guidanceAgentMaxCalls: undefined })).toEqual([]);
    expect(guidanceProblems({ guidanceAgentMaxCalls: 6 })).toHaveLength(1);
    expect(guidanceProblems({ guidanceAgentMaxCalls: -1 })).toHaveLength(1);
    expect(guidanceProblems({ guidanceAgentMaxCalls: 2.5 })).toHaveLength(1);
  });

  it('guidanceTools is keyed by step, each a subset of the three tools', () => {
    expect(
      guidanceProblems({
        guidanceTools: { guidance_agent: ['guidance_search'] },
      }),
    ).toEqual([]);
    expect(guidanceProblems({ guidanceTools: {} })).toEqual([]);
    expect(
      guidanceProblems({ guidanceTools: { reviser: ['guidance_fetch'] } }),
    ).toEqual([]);
    expect(
      guidanceProblems({ guidanceTools: { analyst: ['guidance_fetch'] } }),
    ).toHaveLength(1);
    expect(
      guidanceProblems({
        guidanceTools: { guidance_agent: ['guidance_drop'] },
      }),
    ).toHaveLength(1);
    expect(
      guidanceProblems({ guidanceTools: { nobody: ['guidance_fetch'] } }),
    ).toHaveLength(1);
    expect(
      guidanceProblems({ guidanceTools: ['guidance_fetch'] }),
    ).toHaveLength(1);
  });

  it('absent setting: only the guidance agent has all three; other steps have none', () => {
    expect(guidanceToolsFor(undefined, 'guidance_agent')).toHaveLength(3);
    expect(guidanceToolsFor(undefined, 'writer')).toEqual([]);
    expect(guidanceToolsFor(GUIDANCE_TOOLS_DEFAULT, 'reviser')).toEqual([]);
    const seed = (DEBRIEF_SEED_BUNDLE as any).settings.guidanceTools;
    expect(Object.keys(seed)).toEqual([...GUIDANCE_TOOL_STEPS]);
    expect(guidanceToolsFor(seed, 'guidance_agent')).toHaveLength(3);
    expect(guidanceToolsFor(seed, 'writer')).toEqual([]);
    expect(guidanceToolsFor(seed, 'reviser')).toEqual([]);
  });

  it('names the model and prompt code', () => {
    expect(DEBRIEF_MODELS.guidanceAgent).toBe('gemini-2.5-flash');
    expect(DEBRIEF_PROMPT_CODES.guidanceAgent).toBe(
      'debrief_guidance_agent_system',
    );
  });
});

describe('the PM agent and guidanceTools', () => {
  const rules = require('../util/debrief-pm-agent-rules.util');
  const { bundleDiff: diffBundles } = require('../util/debrief-releases.util');
  const { changeKindLabel } = require('../util/debrief-changes.util');

  it('may propose a per-step map of known tools, as an object or JSON text', () => {
    const ok = {
      guidance_agent: ['guidance_search'],
      writer: ['guidance_index', 'guidance_fetch'],
    };
    expect(rules.settingRefusal('guidanceTools', ok)).toBeNull();
    expect(
      rules.settingRefusal('guidanceTools', JSON.stringify(ok)),
    ).toBeNull();
    expect(rules.settingRefusal('guidanceTools', {})).toBeNull();
  });

  it.each([
    ['not an object', 'guidance_fetch'],
    ['an array', ['guidance_fetch']],
    ['an unknown step', { analyst: ['guidance_fetch'] }],
    ['an unknown tool', { writer: ['run_checks'] }],
    ['a non-list value', { writer: 'guidance_fetch' }],
    ['bad JSON', '{nope'],
  ])('refuses %s with a reason', (_n, value) => {
    expect(rules.settingRefusal('guidanceTools', value)?.reason).toMatch(
      /guidanceTools must be an object/,
    );
  });

  it('guidanceAgentMaxCalls follows its 0-5 range', () => {
    expect(rules.settingRefusal('guidanceAgentMaxCalls', 5)).toBeNull();
    expect(rules.settingRefusal('guidanceAgentMaxCalls', 0)).toBeNull();
    expect(rules.settingRefusal('guidanceAgentMaxCalls', 6)?.reason).toMatch(
      /between 0 and 5/,
    );
    expect(rules.settingRefusal('guidanceAgentMaxCalls', 1.5)?.reason).toMatch(
      /whole number/,
    );
  });

  it('stores the map as JSON text and reads it back as the bundle holds it; numbers stay numbers', () => {
    const text = rules.settingValueText('guidanceTools', {
      writer: ['guidance_fetch', 'guidance_fetch'],
    });
    expect(text).toBe('{"writer":["guidance_fetch"]}');
    expect(rules.settingValueOf('guidanceTools', text)).toEqual({
      writer: ['guidance_fetch'],
    });
    expect(rules.settingValueText('guidanceAgentMaxCalls', 4)).toBe('4');
    expect(rules.settingValueOf('guidanceAgentMaxCalls', '4')).toBe(4);
  });

  it('is diffed as a setting change and labelled', () => {
    const before = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    const after = JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
    after.settings.guidanceTools.writer = ['guidance_fetch'];
    const d = diffBundles(before, after);
    expect(d.settings.map((x: any) => x.key)).toEqual(['guidanceTools']);
    expect(
      changeKindLabel({
        change: { ideaKind: 'setting', settingKey: 'guidanceTools' },
      }),
    ).toBe('Setting · Guidance tools');
  });
});
