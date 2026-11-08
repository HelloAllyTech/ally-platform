import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { BotDraftStep } from '../enum/bot-draft.enum';
import { CRAWL_LIMITS, SiteCrawlService } from '../crawl/site-crawl.service';
import { MAX_ARTICLES } from '../crawl/url-scope';
import type { CrawlState } from '../type/bot-draft.type';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 't1',
    getExecutionId: () => undefined,
    runWithContext: (fn: () => unknown) => fn(),
    setAuthContext: () => undefined,
  },
}));

type Routes = Record<
  string,
  {
    status?: number;
    type?: string;
    body?: string;
    location?: string;
    delayMs?: number;
  }
>;

const page = (title: string, body: string, links: string[] = [], head = '') =>
  `<!doctype html><html><head><title>${title}</title>${head}</head><body><nav>${links
    .map((l) => `<a href="${l}">${l}</a>`)
    .join(
      ' ',
    )}</nav><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const LONG =
  'Sunrise Mind offers individual and couples therapy in Pune with trained counsellors. '.repeat(
    4,
  );

/** A tiny site on 127.0.0.1, which the address guard blocks unless it's on the allow-list. */
async function site(routes: Routes): Promise<{
  url: string;
  server: Server;
  inFlight: { max: number };
  hits: string[];
}> {
  const inFlight = { now: 0, max: 0 };
  const hits: string[] = [];
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      hits.push(req.url ?? '');
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      const route = routes[req.url ?? ''] ?? {
        status: 404,
        body: 'not found',
        type: 'text/plain',
      };
      if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
      res.writeHead(route.status ?? (route.location ? 302 : 200), {
        'content-type': route.type ?? 'text/html; charset=utf-8',
        ...(route.location ? { location: route.location } : {}),
      });
      res.end(route.body ?? '');
      inFlight.now -= 1;
    },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, server, inFlight, hits };
}

function harness(allowHosts: string[] = ['127.0.0.1'], crawlsPerDay = 5) {
  const state: {
    crawl?: CrawlState;
    step: BotDraftStep;
    brand?: unknown;
    docs: string[];
  } = {
    step: BotDraftStep.READING,
    docs: [],
  };
  const draft = (website: string) => ({
    id: 'draft-1',
    ownerUserId: 7,
    tenantId: 't1',
    chatbotId: 'bot-1',
    step: state.step,
    source: { website },
    crawl: state.crawl ?? {
      status: 'idle',
      queue: [],
      seen: [],
      pages: [],
      findings: [],
    },
  });
  let website = '';
  const drafts = {
    saveCrawl: jest.fn(async (_id: string, crawl: CrawlState) => {
      state.crawl = JSON.parse(JSON.stringify(crawl));
    }),
    findById: jest.fn(async () => ({
      ...draft(website),
      crawl: state.crawl,
      step: state.step,
    })),
    applyBrand: jest.fn(async (_id: string, brand: unknown) => {
      state.brand = brand;
    }),
    addKnowledgeDocument: jest.fn(async (_id: string, documentId: string) => {
      state.docs.push(documentId);
    }),
    setStep: jest.fn(async (_d: unknown, step: BotDraftStep) => {
      state.step = step;
    }),
    findStalledCrawls: jest.fn(async () => []),
  };
  const events = { publish: jest.fn() };
  let docCount = 0;
  const knowledge = {
    createForChatbot: jest.fn(async () => ({ id: `doc-${++docCount}` })),
  };
  const insert = {
    insert: () => insert,
    into: () => insert,
    values: () => insert,
    orIgnore: () => insert,
    execute: jest.fn(),
  };
  const counters = new Map<string, number>();
  const redis = {
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => undefined),
    incrWithExpiry: jest.fn(async (key: string) => {
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return { count: counters.get(key)!, ttlSeconds: 100 };
    }),
  };
  const learned: number[] = [];
  const learner = {
    learnFrom: jest.fn(
      async (_id: string, pages: unknown[]) => void learned.push(pages.length),
    ),
  };
  const service = new SiteCrawlService(
    drafts as never,
    events as never,
    knowledge as never,
    { createQueryBuilder: () => insert } as never,
    redis as never,
    { botDraft: { crawlAllowHosts: allowHosts, crawlsPerDay } } as never,
    learner,
  );
  /** Start, then run to the end in the foreground (the test doesn't need the background hop). */
  const crawl = async (url: string) => {
    website = url;
    (service as unknown as { runInBackground: () => void }).runInBackground =
      () => undefined;
    await service.start(draft(url) as never);
    await service.run('draft-1');
    return state.crawl!;
  };
  return {
    service,
    crawl,
    state,
    knowledge,
    events,
    learner,
    learned,
    drafts,
    redis,
  };
}

const read = (crawl: CrawlState) =>
  crawl.pages
    .filter((p) => p.status === 'read')
    .map((p) => new URL(p.url).pathname);

describe('SiteCrawlService', () => {
  const servers: Server[] = [];
  afterAll(() => servers.forEach((s) => s.close()));
  const serve = async (routes: Routes) => {
    const s = await site(routes);
    servers.push(s.server);
    return s;
  };

  it('reads the site into library documents, follows links, skips junk and honours robots.txt', async () => {
    const s = await serve({
      '/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: *\nDisallow: /private',
      },
      '/': {
        body: page('Sunrise Mind', LONG, [
          '/about',
          '/fees?utm_source=x',
          '/private/notes',
          '/login',
          '/logo.png',
          'https://other.example/x',
        ]),
      },
      '/about': { body: page('About', LONG, ['/', '/team']) },
      '/fees': { body: page('Fees', LONG) },
      '/team': { body: page('Team', LONG) },
      '/private/notes': { body: page('Private', LONG) },
    });
    const h = harness();
    const crawl = await h.crawl(s.url);
    expect(crawl.status).toBe('done');
    expect(read(crawl).sort()).toEqual(['/', '/about', '/fees', '/team']);
    expect(s.hits).not.toContain('/private/notes');
    expect(s.hits).not.toContain('/login');
    expect(h.knowledge.createForChatbot).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({
        sourceType: 'paste',
        sourceUrl: `${s.url.slice(0, -1)}/fees`,
        tags: ['onboarding'],
      }),
    );
    expect(h.state.docs).toHaveLength(4);
    expect(h.state.step).toBe(BotDraftStep.LEARNED);
    expect(h.events.publish).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({ type: 'done', n: 4 }),
    );
  });

  it('stops at a start page robots.txt disallows, and says so', async () => {
    const s = await serve({
      '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /' },
      '/': { body: page('Home', LONG) },
    });
    const crawl = await harness().crawl(s.url);
    expect(crawl).toMatchObject({ status: 'failed', problem: 'blocked' });
    expect(s.hits).not.toContain('/');
  });

  it("says unreachable when the start page can't be fetched", async () => {
    const s = await serve({ '/': { status: 500, body: 'oops' } });
    const crawl = await harness().crawl(s.url);
    expect(crawl).toMatchObject({ status: 'failed', problem: 'unreachable' });
  });

  it('refuses private addresses unless allow-listed (the production guard)', async () => {
    const s = await serve({ '/': { body: page('Home', LONG) } });
    const crawl = await harness([]).crawl(s.url);
    expect(crawl).toMatchObject({ status: 'failed', problem: 'unreachable' });
    expect(s.hits).toEqual([]);
  });

  it('does not follow a redirect off the site', async () => {
    const s = await serve({
      '/': { body: page('Home', LONG, ['/go']) },
      '/go': { location: 'https://elsewhere.example/page' },
    });
    const crawl = await harness().crawl(s.url);
    expect(read(crawl)).toEqual(['/']);
  });

  it('honours canonical links, so a page is stored once', async () => {
    const s = await serve({
      '/': { body: page('Home', LONG, ['/fees', '/fees?print=1', '/pricing']) },
      '/fees': { body: page('Fees', LONG) },
      '/pricing': {
        body: page('Fees', LONG, [], '<link rel="canonical" href="/fees">'),
      },
    });
    const crawl = await harness().crawl(s.url);
    expect(read(crawl).sort()).toEqual(['/', '/fees']);
  });

  it('reads the sitemap first, stops at 50 pages and never runs more than 4 at once', async () => {
    const routes: Routes = { '/': { body: page('Home', LONG) } };
    const locs: string[] = [];
    for (let i = 0; i < 70; i++) {
      routes[`/p${i}`] = { body: page(`Page ${i}`, LONG), delayMs: 5 };
      locs.push(`<url><loc>PLACEHOLDER/p${i}</loc></url>`);
    }
    const s = await serve(routes);
    routes['/sitemap.xml'] = {
      type: 'application/xml',
      body: `<urlset>${locs.join('').replace(/PLACEHOLDER/g, s.url.slice(0, -1))}</urlset>`,
    };
    const h = harness();
    const crawl = await h.crawl(s.url);
    expect(read(crawl)).toHaveLength(CRAWL_LIMITS.maxPages);
    expect(s.inFlight.max).toBeLessThanOrEqual(CRAWL_LIMITS.concurrency);
    // The builder learns in batches as pages arrive.
    expect(h.learned.reduce((a, b) => a + b, 0)).toBe(50);
    expect(Math.max(...h.learned)).toBeLessThanOrEqual(CRAWL_LIMITS.learnBatch);
  });

  it('reads blog and news pages last, and at most 10 of them', async () => {
    const posts = Array.from({ length: 15 }, (_, i) => `/blog/post-${i}`);
    const core = ['/fees', '/team', '/contact'];
    const routes: Routes = {
      // The posts are linked first; the business's own pages still come first.
      '/': { body: page('Home', LONG, [...posts, ...core]) },
    };
    for (const path of [...posts, ...core])
      routes[path] = { body: page(path, LONG) };
    const s = await serve(routes);
    const crawl = await harness().crawl(s.url);
    // The order pages were taken in (reading runs 4 at a time, so finishing order varies).
    const taken = crawl.seen.map((url) => new URL(url).pathname);
    expect(taken.slice(0, 4).sort()).toEqual(['/', ...core].sort());
    expect(
      read(crawl).filter((path) => path.startsWith('/blog/')),
    ).toHaveLength(MAX_ARTICLES);
  });

  it('finds the brand: logo, theme colour and favicon', async () => {
    const s = await serve({
      '/': {
        body: page(
          'Home',
          LONG,
          [],
          '<meta name="theme-color" content="#0f766e"><meta property="og:image" content="/og.png"><link rel="icon" href="/fav.ico">',
        ),
      },
    });
    const h = harness();
    const crawl = await h.crawl(s.url);
    expect(crawl.brand).toEqual({
      logoUrl: `${s.url}og.png`,
      accentColour: '#0F766E',
      faviconUrl: `${s.url}fav.ico`,
    });
    expect(h.state.brand).toEqual(crawl.brand);
    expect(crawl.findings).toContain('brand');
  });

  it('resumes a crawl an instance left half done', async () => {
    const s = await serve({
      '/': { body: page('Home', LONG, ['/a', '/b']) },
      '/a': { body: page('A', LONG) },
      '/b': { body: page('B', LONG) },
    });
    const h = harness();
    h.state.crawl = {
      status: 'running',
      website: s.url,
      domain: 'x',
      startedAt: new Date().toISOString(),
      queue: [`${s.url}b`],
      seen: [s.url, `${s.url}a`],
      pages: [
        { url: s.url, title: 'Home', status: 'read', documentId: 'old-1' },
        { url: `${s.url}a`, title: 'A', status: 'read', documentId: 'old-2' },
      ],
      findings: [],
    };
    await h.service.run('draft-1');
    expect(s.hits).toEqual(['/robots.txt', '/b']);
    expect(read(h.state.crawl!)).toHaveLength(3);
    expect(h.state.crawl!.status).toBe('done');
  });

  it("stops at the owner's daily cap", async () => {
    const s = await serve({ '/': { body: page('Home', LONG) } });
    const h = harness(['127.0.0.1'], 1);
    await h.crawl(s.url);
    const second = await h.crawl(s.url);
    expect(second).toMatchObject({ status: 'failed', problem: 'daily_limit' });
  });

  it('logs domains and counts, never page text', async () => {
    const s = await serve({
      '/': {
        body: page(
          'Home',
          `${LONG} Call 98200 12345 or write to asha@example.com.`,
        ),
      },
    });
    const lines: string[] = [];
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk));
        return true;
      });
    try {
      await harness().crawl(s.url);
    } finally {
      spy.mockRestore();
    }
    const logged = lines.join('');
    expect(logged).not.toContain('98200');
    expect(logged).not.toContain('asha@example.com');
  });
});
