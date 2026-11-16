import {
  DebriefChangeHoldsService,
  normaliseLanguages,
} from '../service/debrief-change-holds.service';

/** V2_AUTONOMY A9 (language pins) and C2 (pauses). */
function build(opts: {
  language?: string | null;
  pin?: Record<string, any> | null;
}) {
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM scenario_sessions')) {
        return opts.language ? [{ language: opts.language }] : [{}];
      }
      return [];
    }),
    transaction: jest.fn(async (fn: any) =>
      fn({
        getRepository: () => ({
          update: jest.fn(),
          create: (x: any) => x,
          save: async (x: any) => x,
        }),
      }),
    ),
  };
  const holds = {
    findOne: jest.fn(async () => opts.pin ?? null),
    find: jest.fn(async () => (opts.pin ? [opts.pin] : [])),
    save: jest.fn(async (x: any) => x),
    create: (x: any) => x,
    update: jest.fn(),
  };
  const releases = {
    getById: jest.fn(async (id: string) => ({ id, agentKey: 'debrief' })),
  };
  return {
    svc: new DebriefChangeHoldsService(
      dataSource as any,
      holds as any,
      releases as any,
    ),
    releases,
  };
}

describe('language pins and pauses', () => {
  it('a pinned language runs on its pinned release; others on the release in force', async () => {
    const pinned = build({
      language: 'hi',
      pin: { language: 'hi', releaseId: 'rel-old', reason: 'undone' },
    });
    expect((await pinned.svc.releaseForSession('s1'))?.id).toBe('rel-old');
    const none = build({ language: 'ta', pin: null });
    expect(await none.svc.releaseForSession('s1')).toBeNull();
    // A session that recorded no language is never pinned.
    const unknown = build({ language: null, pin: null });
    expect(await unknown.svc.releaseForSession('s1')).toBeNull();
  });

  it('a try-out skips pinned languages and languages outside its scope', async () => {
    const pinned = build({ language: 'hi', pin: { language: 'hi' } });
    expect(await pinned.svc.excludesCanary('s1', {})).toBe(true);
    const scoped = build({ language: 'ta', pin: null });
    expect(await scoped.svc.excludesCanary('s1', { languages: ['hi'] })).toBe(
      true,
    );
    expect(await scoped.svc.excludesCanary('s1', { languages: ['ta'] })).toBe(
      false,
    );
    expect(await scoped.svc.excludesCanary('s1', null)).toBe(false);
  });

  it('a change scoped to languages reports them; held ones separately', async () => {
    const { svc } = build({
      pin: { language: 'hi', reason: 'held', ideaId: 'i' },
    });
    expect(
      await svc.languagesFor({ id: 'i', change: { languages: ['ta'] } }),
    ).toEqual({
      languages: ['ta'],
      heldLanguages: ['hi'],
    });
  });

  it('pauses are bounded and only for known kinds', async () => {
    const { svc } = build({});
    const soon = new Date(Date.now() + 3 * 86_400_000);
    await expect(svc.pause('prompts', soon, 1)).resolves.toMatchObject({
      kind: 'pause',
      changeKind: 'prompts',
    });
    await expect(svc.pause('rubric', soon, 1)).rejects.toThrow(/can be paused/);
    await expect(
      svc.pause('code', new Date(Date.now() + 200 * 86_400_000), 1),
    ).rejects.toThrow(/at most 90 days/);
    await expect(
      svc.pause('code', new Date(Date.now() - 1000), 1),
    ).rejects.toThrow(/future/);
  });

  it('language codes are cleaned', () => {
    expect(normaliseLanguages(['hi', ' ta ', 'xx-YY-zz', 7, 'hi'])).toEqual([
      'hi',
      'ta',
    ]);
    expect(normaliseLanguages([])).toBeNull();
    expect(normaliseLanguages(null)).toBeNull();
  });
});
