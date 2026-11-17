import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DebriefAgentsConfigController } from '../controller/debrief-agents-config.controller';
import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { DebriefAgentsConfigService } from '../service/debrief-agents-config.service';
import {
  applyAgentsConfigChanges,
  recipeUsedWhen,
  releaseAuthor,
} from '../util/debrief-agents-config.util';
import { settingRefusal } from '../util/debrief-pm-agent-rules.util';
import { bundleDiff } from '../util/debrief-releases.util';

const APPROVED = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gpt-4.1']);
const bundle = () => JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));
const reasons = (r: any) => r.refusals.map((x: any) => x.reason).join('|');

describe('agents config changes', () => {
  it('accepts a model, a setting and an orchestrator toggle', () => {
    const out: any = applyAgentsConfigChanges(
      bundle(),
      [
        {
          kind: 'model',
          recipe: 'standard',
          step: 'writer',
          model: 'gemini-2.5-pro',
          backupModel: 'gpt-4.1',
        },
        { kind: 'setting', key: 'guidanceAgentMaxCalls', value: 4 },
        {
          kind: 'setting',
          key: 'guidanceTools',
          value: { writer: ['guidance_index'] },
        },
        { kind: 'orchestrator_agent', id: 'guidance_agent', enabled: false },
      ],
      APPROVED,
    );
    const w = out.bundle.recipes.standard.steps.find(
      (s: any) => s.step === 'writer',
    );
    expect(w.model).toBe('gemini-2.5-pro');
    expect(w.backupModel).toBe('gpt-4.1');
    expect(out.bundle.settings.guidanceAgentMaxCalls).toBe(4);
    expect(out.bundle.settings.guidanceTools).toEqual({
      writer: ['guidance_index'],
    });
    expect(
      out.bundle.orchestrator.agents.some(
        (a: any) => a.id === 'guidance_agent',
      ),
    ).toBe(false);
    // The input bundle (the live one) is never touched.
    expect(DEBRIEF_SEED_BUNDLE.settings.guidanceAgentMaxCalls).toBe(3);
  });

  it.each([
    [
      {
        kind: 'model',
        recipe: 'nope',
        step: 'writer',
        model: 'gemini-2.5-pro',
      },
      'not a recipe',
    ],
    [
      {
        kind: 'model',
        recipe: 'standard',
        step: 'nope',
        model: 'gemini-2.5-pro',
      },
      'not a step',
    ],
    [
      {
        kind: 'model',
        recipe: 'standard',
        step: 'checks',
        model: 'gemini-2.5-pro',
      },
      'no model',
    ],
    [
      {
        kind: 'model',
        recipe: 'standard',
        step: 'guidance_lookup',
        model: 'gemini-2.5-pro',
      },
      'no model',
    ],
    [
      { kind: 'model', recipe: 'standard', step: 'writer', model: 'claude-x' },
      'not an approved model',
    ],
    [
      { kind: 'setting', key: 'guidanceTools', value: { writer: ['bogus'] } },
      'guidanceTools must be',
    ],
    [
      { kind: 'setting', key: 'guidanceAgentMaxCalls', value: 9 },
      'between 0 and 5',
    ],
    [
      { kind: 'setting', key: 'monthlyCapUsd', value: 10 },
      'not a setting here',
    ],
    [
      { kind: 'orchestrator_agent', id: 'nope', enabled: true },
      'not a registry agent',
    ],
  ])('refuses %j', (change, why) => {
    const out: any = applyAgentsConfigChanges(bundle(), [change], APPROVED);
    expect(out.bundle).toBeUndefined();
    expect(reasons(out)).toContain(why);
    expect(out.refusals[0].index).toBe(0);
  });

  it('one refusal refuses the whole batch with its index', () => {
    const out: any = applyAgentsConfigChanges(
      bundle(),
      [
        { kind: 'setting', key: 'guidanceAgentMaxCalls', value: 2 },
        { kind: 'setting', key: 'guidanceAgentMaxCalls', value: 99 },
      ],
      APPROVED,
    );
    expect(out.refusals).toEqual([expect.objectContaining({ index: 1 })]);
  });

  it('shares the PM agent setting validation', () => {
    const mine: any = applyAgentsConfigChanges(
      bundle(),
      [{ kind: 'setting', key: 'guidanceAgentMaxCalls', value: 9 }],
      APPROVED,
    );
    expect(mine.refusals[0].reason).toBe(
      settingRefusal('guidanceAgentMaxCalls', 9)!.reason,
    );
  });
});

describe('who made a release', () => {
  it('maps the PM agent, a person and the system', () => {
    expect(
      releaseAuthor(
        { authorKind: 'system' },
        { change: { ideaKind: 'setting' } },
      ),
    ).toEqual({ kind: 'pm_agent', name: null });
    expect(
      releaseAuthor(
        { authorKind: 'human', createdByName: 'Asha' },
        { change: { ideaKind: 'release' } },
      ),
    ).toEqual({ kind: 'person', name: 'Asha' });
    expect(releaseAuthor({ authorKind: 'seed' }, null)).toEqual({
      kind: 'system',
      name: null,
    });
  });
});

const seedModels = new Set<string>([...APPROVED]);
for (const r of Object.values(DEBRIEF_SEED_BUNDLE.recipes))
  for (const st of r?.steps ?? []) {
    if (st.model) seedModels.add(st.model);
    if (st.backupModel) seedModels.add(st.backupModel);
  }
for (const a of DEBRIEF_SEED_BUNDLE.orchestrator?.agents ?? []) {
  if (a.model) seedModels.add(a.model);
}
if (DEBRIEF_SEED_BUNDLE.orchestrator?.plannerModel)
  seedModels.add(DEBRIEF_SEED_BUNDLE.orchestrator.plannerModel);
const live = { id: 'ga1', version: 7, status: 'ga', bundle: bundle() };

function make(opts: { ask?: any; rows?: any[] } = {}) {
  const created: any[] = [];
  const repo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.status === 'ga' ? live : null,
    ),
  };
  const dataSource: any = {
    getRepository: () => repo,
    query: jest.fn(async (sql: string) => {
      if (sql.includes("r.status = 'draft'"))
        return [
          {
            id: 'd1',
            version: 8,
            status: 'draft',
            notes: 'n',
            authorKind: 'human',
            createdByName: 'Asha',
          },
        ];
      if (sql.includes('FROM agent_lessons'))
        return [{ id: 'i1', change: { ideaKind: 'setting' }, releaseId: 'r2' }];
      if (sql.includes('LIMIT 10')) return opts.rows ?? [];
      if (sql.includes('WHERE r.id = $1'))
        return [
          {
            id: 'd2',
            version: 8,
            status: 'draft',
            notes: 'why',
            authorKind: 'human',
            createdByName: 'Asha',
          },
        ];
      return [];
    }),
  };
  const runner: any = {
    resolveRelease: jest.fn(async (r: any) => ({
      release: r,
      bundle: r.bundle,
    })),
    modelCatalog: jest.fn(async () => ({
      steps: seedModels,
      reply: new Set(APPROVED),
    })),
  };
  const consoleSvc: any = {
    models: jest.fn(async () => ({
      choices: {
        steps: [...APPROVED].map((m) => ({
          model: m,
          label: m.toUpperCase(),
          provider: m.startsWith('gpt') ? 'openai' : 'gemini',
        })),
      },
    })),
  };
  const releases: any = {
    proposeBundle: jest.fn(async (next: any, title: string) => {
      created.push({ next, title });
      return {
        ideaId: 'i',
        releaseId: 'd2',
        version: 8,
        budgetOnly: false,
        diff: bundleDiff(live.bundle, next),
      };
    }),
  };
  const pm: any = {
    liveModels: jest.fn(async () => new Set(['gemini-2.5-flash'])),
  };
  const owner: any = {
    get: jest.fn(async () => ({
      askModels: opts.ask ?? false,
      askLowConfidence: true,
    })),
  };
  const svc = new DebriefAgentsConfigService(
    dataSource,
    runner,
    consoleSvc,
    releases,
    pm,
    owner,
  );
  return { svc, created, releases };
}

describe('Agents config service', () => {
  it('shows the live GA release with defaults, approved models, the draft and recent changes', async () => {
    const { svc } = make({
      rows: [
        {
          id: 'r2',
          version: 7,
          status: 'ga',
          authorKind: 'system',
          createdAt: new Date('2026-11-16T10:00:00Z'),
          bundle: (() => {
            const b = bundle();
            b.settings.guidanceAgentMaxCalls = 4;
            return b;
          })(),
          parentBundle: bundle(),
          changeSet: null,
          parentChangeSet: null,
        },
      ],
    });
    const v: any = await svc.view(1, true);
    expect(v.release).toEqual({ id: 'ga1', version: 7, status: 'ga' });
    expect(v.canEdit).toBe(true);
    expect(v.canary).toBeNull();
    const writer = v.recipes[0].steps.find((s: any) => s.step === 'writer');
    expect(writer).toMatchObject({
      promptCode: 'debrief_writer_system',
      optional: false,
    });
    expect(
      v.recipes[0].steps.find((s: any) => s.step === 'checks'),
    ).toMatchObject({ model: null, promptCode: null });
    expect(v.settings.guidanceTools).toEqual({
      guidance_agent: ['guidance_index', 'guidance_search', 'guidance_fetch'],
      writer: [],
      reviser: [],
    });
    expect(v.limits.guidanceAgentMaxCalls).toEqual({ min: 0, max: 5 });
    expect(v.models.map((m: any) => m.id).sort()).toEqual([...APPROVED].sort());
    expect(
      v.orchestratorAgents.find((a: any) => a.id === 'guidance_agent'),
    ).toMatchObject({ enabled: true });
    expect(v.pendingDraft).toEqual({
      id: 'd1',
      version: 8,
      status: 'draft',
      note: 'n',
      author: { kind: 'person', name: 'Asha' },
    });
    expect(v.recentChanges[0]).toMatchObject({
      releaseId: 'r2',
      version: 7,
      source: 'pm_agent',
      author: { kind: 'pm_agent', name: null },
      at: '2026-11-16T10:00:00.000Z',
      summary: ['Setting · Guidance agent max calls'],
    });
  });

  it('a person change makes a draft, never the live release', async () => {
    const { svc, created } = make();
    const r = await svc.propose(
      [{ kind: 'setting', key: 'guidanceAgentMaxCalls', value: 2 }],
      'less lookups',
      5,
    );
    expect(r.draft).toMatchObject({
      id: 'd2',
      status: 'draft',
      author: { kind: 'person', name: 'Asha' },
    });
    expect(r.draft.id).not.toBe(live.id);
    expect(r.waitsForPerson).toBe(false);
    expect(created[0].next.settings.guidanceAgentMaxCalls).toBe(2);
    expect(live.bundle.settings.guidanceAgentMaxCalls).toBe(3);
  });

  it('a model new to the system waits for a person when the policy says so', async () => {
    const { svc } = make({ ask: true });
    const r = await svc.propose(
      [
        {
          kind: 'model',
          recipe: 'standard',
          step: 'writer',
          model: 'gpt-4.1',
        },
      ],
      '',
      5,
    );
    expect(r.waitsForPerson).toBe(true);
    expect(r.reason).toContain('gpt-4.1');
  });

  it('a refused batch creates nothing', async () => {
    const { svc, releases } = make();
    await expect(
      svc.propose(
        [
          {
            kind: 'model',
            recipe: 'standard',
            step: 'checks',
            model: 'gemini-2.5-pro',
          },
        ],
        '',
        5,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(releases.proposeBundle).not.toHaveBeenCalled();
  });
});

describe('Agents config controller', () => {
  const ctl = (ownerSettings: boolean) => {
    const agents: any = {
      view: jest.fn(async (_u: any, canEdit: boolean) => ({ canEdit })),
      propose: jest.fn(),
    };
    const view: any = {
      viewer: jest.fn(async () => ({ can: { ownerSettings } })),
    };
    return { c: new DebriefAgentsConfigController(agents, view), agents };
  };
  it('reflects canEdit', async () => {
    expect(await ctl(false).c.get({ user: { id: 1 } })).toEqual({
      canEdit: false,
    });
    expect(await ctl(true).c.get({ user: { id: 1 } })).toEqual({
      canEdit: true,
    });
  });
  it('403 without the edit permission, nothing proposed', async () => {
    const { c, agents } = ctl(false);
    await expect(
      c.change({ user: { id: 1 } }, { changes: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(agents.propose).not.toHaveBeenCalled();
  });
});

describe('recipe descriptions', () => {
  it("say what each recipe is for and which rule picks it, in the runner's order", () => {
    expect(recipeUsedWhen('short', 6)).toMatch(
      /too short to coach.*fewer than 6 times.*checked 1st/,
    );
    expect(recipeUsedWhen('short', 4)).toMatch(/fewer than 4 times/);
    expect(recipeUsedWhen('assessment', 6)).toMatch(
      /assessed attempt.*assessment mode on.*checked 2nd/,
    );
    expect(recipeUsedWhen('case', 6)).toMatch(
      /part of a case.*learning path.*checked 3rd/,
    );
    expect(recipeUsedWhen('standard', 6)).toMatch(
      /^The full debrief for a normal roleplay.*checked last/,
    );
    expect(recipeUsedWhen('unknown', 6)).toBe('');
  });

  it("is part of every recipe in the view, using the release's minimum learner turns", async () => {
    const { svc } = make({ rows: [] });
    const v: any = await svc.view(1, false);
    expect(v.recipes.length).toBeGreaterThan(0);
    for (const r of v.recipes) {
      expect(r.usedWhen).toBe(
        recipeUsedWhen(
          r.key,
          DEBRIEF_SEED_BUNDLE.settings.standardMinLearnerTurns,
        ),
      );
      expect(r.usedWhen.length).toBeGreaterThan(10);
    }
  });
});
