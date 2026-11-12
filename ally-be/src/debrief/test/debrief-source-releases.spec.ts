import {
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_SEED_BUNDLE,
  DebriefBundle,
} from '../constants/debrief-release.constants';
import { DebriefReleasesService } from '../service/debrief-releases.service';
import { mergeCodeRelease } from '../util/debrief-code-merge.util';

/**
 * One rule for a change from the Skills Store or from code: a new release,
 * live at once, unless it would undo a promoted PM-agent or person-proposed
 * change — then it waits as a draft and people are told.
 */
const WRITER = DEBRIEF_PROMPT_CODES.writer;
const ANALYST = DEBRIEF_PROMPT_CODES.analyst;
const seed = (): DebriefBundle =>
  JSON.parse(JSON.stringify(DEBRIEF_SEED_BUNDLE));

function build() {
  // v1: the seed (Writer at v11, Analyst at v4); v2: an idea pinned the
  // Writer to v12 and went live.
  const v1 = {
    id: 'r1',
    version: 1,
    agentKey: 'debrief',
    authorKind: 'seed',
    status: 'retired',
    bundle: seed(),
    changeSet: { pinnedPrompts: { [WRITER]: 11, [ANALYST]: 4 } } as any,
    notes: null,
  };
  const b2 = seed();
  b2.prompts[WRITER] = 12;
  const v2 = {
    id: 'r2',
    version: 2,
    agentKey: 'debrief',
    authorKind: 'human',
    status: 'ga',
    bundle: b2,
    changeSet: { pinnedPrompts: { [ANALYST]: 4 } } as any,
    notes: 'idea',
  };
  const byId: Record<string, any> = { r1: v1, r2: v2 };
  let made = 2;
  const releases = {
    getGa: jest.fn(async () => v2),
    getById: jest.fn(async (id: string) => byId[id]),
    createDraft: jest.fn(
      async (_k: string, bundle: any, _u: number, notes: string) => {
        made++;
        const r = {
          id: `r${made}`,
          version: made,
          agentKey: 'debrief',
          authorKind: 'human',
          status: 'draft',
          bundle,
          changeSet: null,
          notes,
        };
        byId[r.id] = r;
        return r;
      },
    ),
    makeGa: jest.fn(async (id: string) => ({ ...byId[id], status: 'ga' })),
  };
  const updates: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM agent_release_audit')) {
        return [
          {
            releaseId: 'r1',
            action: 'promoted',
            detail: {},
            createdAt: '2026-11-01T00:00:00Z',
          },
          {
            releaseId: 'r2',
            action: 'promoted',
            detail: { fromReleaseId: 'r1' },
            createdAt: '2026-11-05T00:00:00Z',
          },
        ];
      }
      if (sql.includes('FROM agent_lessons')) {
        return [
          {
            id: 'idea-1',
            text: 'Pin the shorter Writer',
            releaseId: 'r2',
            change: {},
            evidence: {},
          },
        ];
      }
      if (sql.includes('"authorKind" = \'seed\' OR'))
        return [{ bundle: seed(), changeSet: null, authorKind: 'seed' }];
      if (sql.startsWith('UPDATE') || sql.includes('UPDATE agent_releases'))
        updates.push(params ?? []);
      return [];
    }),
  };
  const runner = {
    modelCatalog: jest.fn(async () => undefined),
    pinPrompts: jest.fn(async () => ({})),
  };
  const notifier = {
    owner: jest.fn(async () => 1),
    team: jest.fn(async () => 1),
  };
  const svc = new DebriefReleasesService(
    dataSource as any,
    releases as any,
    runner as any,
    notifier as any,
  );
  return { svc, releases, notifier, updates };
}

describe('releases from the Skills Store and code', () => {
  it('a Skills Store publish becomes a live release with its note', async () => {
    const t = build();
    const out = await t.svc.fromPublish({
      promptId: 'p',
      promptCode: ANALYST,
      version: 5,
      previousVersion: 4,
      createdBy: 9,
      source: 'dashboard',
      note: 'Name the skill in plain words',
    });
    expect(out).toMatchObject({ live: true, conflicts: 0 });
    const draft = t.releases.createDraft.mock.calls[0];
    expect((draft[1] as DebriefBundle).prompts[ANALYST]).toBe(5);
    expect(draft[3]).toBe('Analyst prompt v4 → v5');
    expect(t.releases.makeGa).toHaveBeenCalled();
    const changeSet = JSON.parse(t.updates[0][3] as string);
    expect(changeSet.source).toMatchObject({
      kind: 'skills_store',
      by: 9,
      from: 4,
      to: 5,
      note: 'Name the skill in plain words',
    });
    expect(t.notifier.owner).toHaveBeenCalled();
  });

  it('a publish that would undo a promoted change waits as a draft, and people are told', async () => {
    const t = build();
    const out = await t.svc.fromPublish({
      promptId: 'p',
      promptCode: WRITER,
      version: 13,
      previousVersion: 11,
      createdBy: 9,
      source: 'cli',
      note: null,
    });
    expect(out).toMatchObject({ live: false, conflicts: 1 });
    expect(t.releases.makeGa).not.toHaveBeenCalled();
    const changeSet = JSON.parse(t.updates[0][3] as string);
    expect(changeSet.merge.conflicts[0]).toMatchObject({
      path: `prompts.${WRITER}`,
      live: 12,
      code: 13,
      changedBy: { ideaId: 'idea-1' },
    });
    expect(t.notifier.team).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Pin the shorter Writer'),
      }),
    );
  });

  it('a deploy that changes no release contents makes no release', async () => {
    const t = build();
    expect(await t.svc.fromCodeDefaults(seed())).toBeNull();
    expect(t.releases.createDraft).not.toHaveBeenCalled();
  });

  it('new code defaults go live, carrying a non-overlapping promoted change forward', async () => {
    const t = build();
    const next = seed();
    next.settings.deadlineMs = 160_000;
    const out = await t.svc.fromCodeDefaults(next);
    expect(out).toMatchObject({ live: true });
    const bundle = t.releases.createDraft.mock.calls[0][1] as DebriefBundle;
    expect(bundle.settings.deadlineMs).toBe(160_000);
    expect(bundle.prompts[WRITER]).toBe(12); // the idea's pin stays
  });
});

describe('three-way merge', () => {
  it('takes the source where only it moved, keeps people where only they moved, conflicts where both did', () => {
    const base = seed();
    const live = seed();
    live.recipes.standard.steps.find((s) => s.step === 'writer')!.model =
      'gpt-4.1';
    live.settings.passScore = 8.5;
    const code = seed();
    code.settings.passScore = 9;
    code.settings.deadlineMs = 160_000;
    const m = mergeCodeRelease(base, live, code);
    expect(m.fromCode).toEqual(['settings.deadlineMs']);
    expect(m.keptFromLive).toEqual(['recipes.standard.steps.writer']);
    expect(m.conflicts.map((c) => c.path)).toEqual(['settings.passScore']);
    expect(m.merged.settings.passScore).toBe(9);
    expect(
      m.merged.recipes.standard.steps.find((s) => s.step === 'writer')!.model,
    ).toBe('gpt-4.1');
  });
});
