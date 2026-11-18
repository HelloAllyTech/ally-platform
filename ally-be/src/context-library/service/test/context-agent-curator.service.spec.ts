import {
  ClChunkOrigin,
  ClChunkStatus,
  ClLoopActionType,
} from '../../enum/context-library.enum';
import { BUG_HUNTER_NOTES_PROFILE } from '../../profiles/bug-hunter-notes.profile';
import { ContextAgentCuratorService } from '../context-agent-curator.service';

let seq = 0;
const chunk = (over: Record<string, any> = {}): any => {
  seq += 1;
  return {
    id: `id-${seq}`,
    code: `BN-${String(seq).padStart(4, '0')}`,
    collectionId: 'bug_hunter_notes',
    origin: ClChunkOrigin.AGENT,
    statement: `note ${seq}`,
    body: null,
    facets: { repos: ['ally-be'], tags: [] },
    attributes: {},
    status: ClChunkStatus.ACTIVE,
    pinned: false,
    sourceCount: 1,
    timesApplied: 0,
    timesContradicted: 0,
    createdAt: new Date(),
    ...over,
  };
};

function setup(rows: any[], answer: unknown, options: any = {}) {
  const chunks = {
    find: jest.fn(async ({ where }: any) => {
      const list = rows.filter(
        (r) =>
          (!where.collectionId || r.collectionId === where.collectionId) &&
          (!where.status || r.status === where.status) &&
          (!where.id || where.id._value?.includes(r.id)),
      );
      return list;
    }),
    query: jest.fn(async () => options.usageRows ?? []),
  };
  const collections = {
    findOne: jest.fn(async () => ({
      id: 'bug_hunter_notes',
      status: 'active',
      loopSettings: options.loopSettings ?? null,
    })),
  };
  const llm = {
    agentCurate: options.modelDown
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue({ value: answer }),
  };
  const recorded: any[] = [];
  const actions = {
    record: jest.fn(async (a: any) => recorded.push(a)),
    overruled: jest.fn(async () => new Set<string>(options.overruled ?? [])),
  };
  const chunkService = {
    snapshot: jest.fn(),
    saveChanged: jest.fn(async (c: any) => c),
  };
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(options.locked ?? true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ContextAgentCuratorService(
    chunks as any,
    collections as any,
    llm as any,
    actions as any,
    chunkService as any,
    redis as any,
  );
  return { service, recorded, llm, redis, chunkService };
}

const candidates = (n: number, over: Record<string, any> = {}) =>
  Array.from({ length: n }, () =>
    chunk({ status: ClChunkStatus.CANDIDATE, ...over }),
  );

describe('ContextAgentCuratorService', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('folds an agreeing candidate into the active chunk and counts the agreement', async () => {
    const active = chunk({ facets: { repos: ['ally-be'], tags: ['ci'] } });
    const fresh = candidates(5, {
      facets: { repos: ['ally-web'], tags: ['flaky'] },
      attributes: { runIds: ['run-9'] },
    });
    const { service, recorded } = setup([active, ...fresh], {
      operations: [
        { op: 'AGREE', id: active.code, candidateId: fresh[0].code },
      ],
    });

    const result = await service.curate('bug_hunter_notes');

    expect(result.applied).toBe(1);
    expect(active.sourceCount).toBe(2);
    expect(active.facets.repos).toEqual(['ally-be', 'ally-web']);
    expect(active.facets.tags).toEqual(['ci', 'flaky']);
    expect(active.attributes.runIds).toEqual(['run-9']);
    expect(fresh[0].status).toBe(ClChunkStatus.SUPERSEDED);
    expect(fresh[0].supersededById).toBe(active.id);
    const agree = recorded.find((a) => a.action === ClLoopActionType.AGREE);
    expect(agree.before).toMatchObject({
      keepId: active.id,
      keepSourceCount: 1,
    });
    // Silence is not a decision: the four candidates it did not mention are added.
    expect(fresh.slice(1).every((c) => c.status === ClChunkStatus.ACTIVE)).toBe(
      true,
    );
    expect(
      recorded.filter((a) => a.action === ClLoopActionType.ADD),
    ).toHaveLength(4);
  });

  it('never edits or removes a pinned chunk, or one a person wrote', async () => {
    const pinned = chunk({ pinned: true });
    const written = chunk({ origin: ClChunkOrigin.AUTHORED });
    const fresh = candidates(5);
    const { service, recorded } = setup([pinned, written, ...fresh], {
      operations: [
        { op: 'EDIT', id: pinned.code, text: 'rewritten' },
        { op: 'REMOVE', id: pinned.code },
        { op: 'EDIT', id: written.code, text: 'rewritten' },
        { op: 'REMOVE', id: written.code },
      ],
    });

    await service.curate('bug_hunter_notes');

    expect(pinned.statement).not.toBe('rewritten');
    expect(pinned.status).toBe(ClChunkStatus.ACTIVE);
    expect(written.statement).not.toBe('rewritten');
    expect(written.status).toBe(ClChunkStatus.ACTIVE);
    expect(
      recorded.filter((a) =>
        [ClLoopActionType.EDIT, ClLoopActionType.REMOVE].includes(a.action),
      ),
    ).toEqual([]);
  });

  it('bounds how many active chunks one pass may change', async () => {
    const active = Array.from({ length: 15 }, () => chunk());
    const fresh = candidates(5);
    const budget =
      BUG_HUNTER_NOTES_PROFILE.agentCuration!.maxActiveChangesPerPass;
    const { service, recorded } = setup([...active, ...fresh], {
      operations: active.map((c) => ({ op: 'REMOVE', id: c.code })),
    });

    await service.curate('bug_hunter_notes');

    expect(
      recorded.filter((a) => a.action === ClLoopActionType.REMOVE),
    ).toHaveLength(budget);
    expect(
      active.filter((c) => c.status === ClChunkStatus.ARCHIVED),
    ).toHaveLength(budget);
  });

  it('refuses an edit longer than the collection allows, and one an admin already undid', async () => {
    const a = chunk();
    const b = chunk();
    const fresh = candidates(5);
    const { service } = setup(
      [a, b, ...fresh],
      {
        operations: [
          { op: 'EDIT', id: a.code, text: 'x'.repeat(601) },
          { op: 'EDIT', id: b.code, text: 'fine' },
        ],
      },
      { overruled: [b.id] },
    );

    await service.curate('bug_hunter_notes');

    expect(a.statement).toBe('note 1');
    expect(b.statement).toBe('note 2');
  });

  it('adds every candidate uncurated when the model is unavailable', async () => {
    const fresh = candidates(5);
    const { service, recorded } = setup(fresh, null, { modelDown: true });

    const result = await service.curate('bug_hunter_notes');

    expect(result.skipped).toMatch(/added uncurated/);
    expect(fresh.every((c) => c.status === ClChunkStatus.ACTIVE)).toBe(true);
    expect(recorded.every((a) => /uncurated/.test(a.reason))).toBe(true);
  });

  it('waits for a batch, but never longer than a day', async () => {
    const young = candidates(2);
    const waiting = setup(young, { operations: [] });
    expect((await waiting.service.curate('bug_hunter_notes')).skipped).toBe(
      'below the batch threshold',
    );
    expect(waiting.llm.agentCurate).not.toHaveBeenCalled();

    seq = 0;
    const old = candidates(2, {
      createdAt: new Date(Date.now() - 25 * 3_600_000),
    });
    const due = setup(old, { operations: [] });
    await due.service.curate('bug_hunter_notes');
    expect(due.llm.agentCurate).toHaveBeenCalled();
    expect(old.every((c) => c.status === ClChunkStatus.ACTIVE)).toBe(true);
  });

  it('runs on one pod at a time and respects a paused curator', async () => {
    const locked = setup(candidates(5), {}, { locked: false });
    expect((await locked.service.curate('bug_hunter_notes')).skipped).toBe(
      'another pod is curating',
    );
    const paused = setup(
      candidates(5),
      {},
      {
        loopSettings: { paused: ['curator'] },
      },
    );
    expect((await paused.service.curate('bug_hunter_notes')).skipped).toMatch(
      /paused/,
    );
  });

  it('retires the weakest agent chunks to stay inside the cap, never pinned or written ones', async () => {
    const cap = BUG_HUNTER_NOTES_PROFILE.agentCuration!.activeCap;
    const strong = Array.from({ length: cap - 1 }, () =>
      chunk({ sourceCount: 5 }),
    );
    const weak = chunk({ timesContradicted: 1 });
    const pinnedWeak = chunk({ pinned: true, timesContradicted: 3 });
    const { service, recorded } = setup([...strong, weak, pinnedWeak], {});

    await service.curate('bug_hunter_notes');

    expect(weak.status).toBe(ClChunkStatus.ARCHIVED);
    expect(pinnedWeak.status).toBe(ClChunkStatus.ACTIVE);
    expect(recorded.map((a) => a.action)).toEqual([ClLoopActionType.RETIRE]);
  });

  it('retires by usage: contradicted more than applied, or never applied by reporting runs', async () => {
    const wrong = chunk({ timesContradicted: 3 });
    const ignored = chunk();
    const useful = chunk({ timesApplied: 2 });
    const { service, recorded } = setup(
      [wrong, ignored, useful],
      {},
      {
        usageRows: [
          { id: wrong.id, unused_reports: '0' },
          { id: ignored.id, unused_reports: '30' },
          { id: useful.id, unused_reports: '30' },
        ],
      },
    );

    expect(await service.retireByUsage('bug_hunter_notes')).toBe(2);
    expect(wrong.status).toBe(ClChunkStatus.ARCHIVED);
    expect(ignored.status).toBe(ClChunkStatus.ARCHIVED);
    expect(useful.status).toBe(ClChunkStatus.ACTIVE);
    expect(recorded.map((a) => a.reason)).toEqual([
      expect.stringContaining('Reported wrong 3 times'),
      expect.stringContaining('Never applied'),
    ]);
  });
});
