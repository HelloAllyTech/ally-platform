import { ExecutionManager } from '../../common/execution/execution-manager';
import { BotDraftStatus } from '../enum/bot-draft.enum';
import {
  CRAWL_FAILURE_CODES,
  CopilotService,
  crawlFailure,
} from '../copilot/copilot.service';
import { stagesSources } from '../crawl/site-crawl.service';

type Row = Record<string, unknown> & {
  source: Record<string, unknown>;
  crawl: Record<string, unknown>;
};

function harness(
  opts: {
    running?: boolean;
    live?: boolean;
    startResult?: Record<string, unknown>;
  } = {},
) {
  let row: Row = {
    id: 'draft-1',
    chatbotId: 'bot-1',
    ownerUserId: 7,
    tenantId: 't',
    status: opts.live ? BotDraftStatus.PUBLISHED : BotDraftStatus.ACTIVE,
    liveAt: opts.live ? new Date() : null,
    source: {},
    crawl: opts.running
      ? { status: 'running', domain: 'first.example' }
      : { status: 'idle' },
  };
  const drafts = {
    touch: jest.fn(async () => undefined),
    findById: jest.fn(async () => row),
    update: jest.fn(async (d: Row, patch: Partial<Row>) => {
      row = { ...d, ...patch } as Row;
      return row;
    }),
    addPendingDocument: jest.fn(async () => undefined),
    attachDocument: jest.fn(async () => undefined),
    addKnowledgeDocument: jest.fn(async () => undefined),
  };
  const crawl = {
    start: jest.fn(async (d: Row) => {
      row = { ...d, crawl: { status: 'running' } };
      return opts.startResult ?? { status: 'running' };
    }),
  };
  const narrations: Record<string, unknown>[] = [];
  const events = {
    publish: jest.fn(async (_id: string, e: Record<string, unknown>) => {
      if (e.type === 'narration') narrations.push(e);
    }),
  };
  const knowledge = {
    createForChatbot: jest.fn(async () => ({ id: 'doc-1', title: 'Fees' })),
  };
  const session = {
    startReading: jest.fn(async () => undefined),
    learnFromDocument: jest.fn(async () => undefined),
  };
  const service = new CopilotService(
    drafts as never,
    crawl as never,
    events as never,
    knowledge as never,
    session as never,
  );
  const ctx = () => ({
    draft: row as never,
    chatbot: { id: 'bot-1' } as never,
    live: Boolean(opts.live),
  });
  return { service, drafts, crawl, narrations, knowledge, ctx, row: () => row };
}

describe('CopilotService', () => {
  beforeEach(() => {
    jest
      .spyOn(ExecutionManager, 'runWithContext')
      .mockImplementation(((fn: () => unknown) => fn()) as never);
    jest.spyOn(ExecutionManager, 'setAuthContext').mockImplementation(() => {
      /* no request context in a unit test */
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('starts reading an address and narrates it', async () => {
    const h = harness();
    const out = await h.service.addSources(h.ctx(), {
      addresses: ['sunrise.example'],
    });
    expect(out.started).toBe('https://sunrise.example/');
    expect(h.crawl.start).toHaveBeenCalledTimes(1);
    expect(h.narrations[0]).toMatchObject({
      stage: 'reading',
      text: 'Reading sunrise.example…',
    });
    expect(h.drafts.touch).toHaveBeenCalledWith('draft-1');
  });

  it('queues a second address while a crawl runs, then starts it when that crawl ends', async () => {
    const h = harness({ running: true });
    const out = await h.service.addSources(h.ctx(), {
      addresses: ['second.example'],
    });
    expect(out.queued).toEqual(['https://second.example/']);
    expect(h.crawl.start).not.toHaveBeenCalled();
    expect(h.row().source.crawlQueue).toEqual(['https://second.example/']);

    await h.service.onCrawlFinished({
      draftId: 'draft-1',
      read: 4,
      domain: 'first.example',
    });
    expect(h.crawl.start).toHaveBeenCalledTimes(1);
    expect(h.row().source.crawlQueue).toEqual([]);
    expect(h.narrations.map((n) => n.stage)).toEqual([
      'queued',
      'read',
      'reading',
    ]);
  });

  it('two addresses at once: the first starts, the second waits', async () => {
    const h = harness();
    const out = await h.service.addSources(h.ctx(), {
      addresses: ['one.example', 'two.example'],
    });
    expect(out.started).toBe('https://one.example/');
    expect(out.queued).toEqual(['https://two.example/']);
  });

  it.each([
    ['daily_limit', 'crawl_daily_limit'],
    ['unreachable', 'crawl_unreachable'],
    ['script_heavy', 'crawl_needs_javascript'],
    ['turned_away', 'crawl_turned_away'],
  ] as const)(
    'a crawl that fails with %s comes back as %s with a plain explanation',
    async (problem, code) => {
      const h = harness({
        startResult: { status: 'failed', problem, domain: 'x.example' },
      });
      const out = await h.service.addSources(h.ctx(), {
        addresses: ['x.example'],
      });
      expect(out.failure).toMatchObject({ errorCode: code });
      expect(out.failure!.message.length).toBeGreaterThan(20);
      expect(out.failure!.message).not.toMatch(/\{domain\}|\{n\}/);
      expect(out.started).toBeNull();
    },
  );

  it('maps every crawl problem to a code', () => {
    for (const problem of Object.keys(CRAWL_FAILURE_CODES)) {
      expect(crawlFailure(problem as never)?.errorCode).toMatch(/^crawl_/);
    }
    expect(crawlFailure(null)).toBeNull();
  });

  it('narrates a failed crawl with its code', async () => {
    const h = harness();
    await h.service.onCrawlFinished({
      draftId: 'draft-1',
      read: 0,
      domain: 'x.example',
      problem: 'unreachable',
    });
    expect(h.narrations[0]).toMatchObject({
      stage: 'failed',
      errorCode: 'crawl_unreachable',
    });
  });

  it('refuses an address that is not one', async () => {
    const h = harness();
    await expect(
      h.service.addSources(h.ctx(), { addresses: ['not a site'] }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'invalid_website' }),
    });
  });

  it('on a live chatbot a new document waits for Apply instead of going on the chatbot', async () => {
    const h = harness({ live: true });
    const out = await h.service.addSources(h.ctx(), {
      documents: [{ fileUrl: 's3://b/k', sourceType: 'pdf' } as never],
    });
    expect(out.staged).toBe(true);
    expect(h.drafts.addPendingDocument).toHaveBeenCalledWith(
      'draft-1',
      'doc-1',
    );
    expect(h.drafts.attachDocument).not.toHaveBeenCalled();
    expect(h.row().source.factsStaged).toBe(true);
  });

  it('before go-live a new document goes on the chatbot at once', async () => {
    const h = harness();
    await h.service.addSources(h.ctx(), {
      documents: [{ fileUrl: 's3://b/k', sourceType: 'pdf' } as never],
    });
    expect(h.drafts.attachDocument).toHaveBeenCalled();
    expect(h.drafts.addPendingDocument).not.toHaveBeenCalled();
  });

  it('stages sources for a published or live draft only', () => {
    expect(
      stagesSources({ status: BotDraftStatus.PUBLISHED, liveAt: null }),
    ).toBe(true);
    expect(
      stagesSources({ status: BotDraftStatus.ACTIVE, liveAt: new Date() }),
    ).toBe(true);
    expect(stagesSources({ status: BotDraftStatus.ACTIVE, liveAt: null })).toBe(
      false,
    );
  });
});
