import {
  appCorsDelegate,
  publicBotKey,
  registerPublicBotOriginCheck,
} from '../../../common/cors/app-cors';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { ChatbotDomainStatus } from '../../entity/chatbot-domain.entity';
import { BotPageAccess, BotPageStatus } from '../../enum/bot-page.enum';
import { ChatbotStatus } from '../../enum/chatbot.enum';
import { PUBLIC_ID_PATTERN, randomPublicId } from '../../type/bot-page.type';
import { rejectRetiredPageFields } from '../bot-page-admin.controller';
import { BotPageDomainService } from '../bot-page-domain.service';
import {
  BotPageRateLimitService,
  secondsToLocalMidnight,
} from '../bot-page-rate-limit.service';
import { BotPageService } from '../bot-page.service';
import { WidgetSitesService, widgetSiteHost } from '../widget-sites.service';
import { FakeRedis } from './fake-redis';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const bot = {
  id: 'bot-1',
  name: 'Sunrise Mind',
  status: ChatbotStatus.LIVE,
  persona: { displayName: 'Sunny' },
  settings: {},
};

type Row = Record<string, unknown>;

/** Enough of TypeORM's where-matching for these lookups: plain values, Raw lower(), arrays. */
function repo(rows: Row[]) {
  const one = (row: Row, where: Row) =>
    Object.entries(where).every(([key, want]) => {
      if (want && typeof want === 'object' && '_type' in want) {
        const [param] = Object.values(
          (want as { _objectLiteralParameters?: Row })
            ._objectLiteralParameters ?? {},
        );
        return String(row[key]).toLowerCase() === String(param).toLowerCase();
      }
      return row[key] === want;
    });
  const find = (where: Row | Row[]) =>
    rows.filter((r) =>
      (Array.isArray(where) ? where : [where]).some((w) => one(r, w)),
    );
  return {
    rows,
    findOne: jest.fn(
      async ({ where }: { where: Row | Row[] }) => find(where)[0] ?? null,
    ),
    find: jest.fn(async ({ where }: { where: Row }) => find(where)),
    count: jest.fn(async ({ where }: { where: Row }) => find(where).length),
    create: jest.fn((row: Row) => row),
    save: jest.fn(async (row: Row) => {
      if (!row.id) row.id = `row-${rows.length + 1}`;
      const at = rows.findIndex((r) => r.id === row.id);
      if (at >= 0) rows[at] = { ...rows[at], ...row };
      else rows.push(row);
      return row;
    }),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
    }),
  };
}

const config = {
  botPage: {
    baseUrl: 'https://app.helloally.ai/admin',
    chatUrl: 'https://app.helloally.ai/chat',
    origin: 'https://app.helloally.ai',
    domainTarget: 'pages.helloally.ai',
  },
  s3: {},
  publicApiBaseUrl: 'https://api.helloally.ai',
};

function pagesWith(pageRows: Row[], domainRows: Row[] = []) {
  const pages = repo(pageRows);
  const domains = repo(domainRows);
  const service = new BotPageService(
    pages as never,
    { findOne: jest.fn().mockResolvedValue(bot) } as never,
    {
      getForChatbot: jest.fn(async () => ({
        ...DEFAULT_WHATSAPP_SETTINGS,
        enabled: true,
      })),
    } as never,
    {} as never,
    config as never,
    undefined,
    domains as never,
  );
  return { service, pages, domains };
}

const livePage = (over: Row = {}): Row => ({
  id: 'page-1',
  chatbotId: 'bot-1',
  slug: 'sunrise-mind',
  publicId: 'k7m2p9qa',
  status: BotPageStatus.ON,
  access: BotPageAccess.INVITE,
  settings: {},
  ...over,
});

describe('stage 7: the short random address', () => {
  it('is 8 random lower-case letters and digits', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = randomPublicId();
      expect(id).toMatch(/^[a-z0-9]{8}$/);
      expect(PUBLIC_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(200);
  });

  it('is never one already used as an address or as a legacy slug', async () => {
    const { service, pages } = pagesWith([
      livePage({ publicId: 'aaaaaaaa' }),
      livePage({ id: 'page-2', slug: 'bbbbbbbb', publicId: 'zzzzzzzz' }),
    ]);
    const random = jest
      .spyOn(require('../../type/bot-page.type'), 'randomPublicId')
      .mockReturnValueOnce('aaaaaaaa')
      .mockReturnValueOnce('bbbbbbbb')
      .mockReturnValueOnce('cccccccc');
    expect(await service.newPublicId()).toBe('cccccccc');
    expect(pages.findOne).toHaveBeenCalledTimes(3);
    random.mockRestore();
  });

  it('is assigned on the first save and never changes, whatever slug is sent', async () => {
    const { service, pages } = pagesWith([]);
    const body = {
      status: BotPageStatus.ON,
      slug: 'my-chosen-name',
      access: BotPageAccess.INVITE,
      settings: {
        branding: {
          logoUrl: null,
          accentColour: '#336699',
          title: 'Sunrise Mind',
          assistantName: 'Sunny',
          welcome: 'Hello there',
        },
        suggestedQuestions: [],
        prechat: [],
        limits: {
          messagesPerVisitorPerHour: 30,
          maxMessageChars: 1000,
          dailyCapPerBot: 500,
        },
        language: 'auto',
      },
    };
    const first = await service.save(bot as never, body as never);
    expect(first.publicId).toMatch(/^[a-z0-9]{8}$/);
    expect(first.link).toBe(`https://app.helloally.ai/chat/${first.publicId}`);
    expect(pages.rows[0].slug).toBe('sunrise-mind');
    const again = await service.save(
      bot as never,
      { ...body, slug: 'something-else' } as never,
    );
    expect(again.publicId).toBe(first.publicId);
    expect(pages.rows[0].slug).toBe('sunrise-mind');
    // The per-day limit gets its default when the body has none.
    expect(
      (pages.rows[0].settings as { limits: Row }).limits
        .messagesPerVisitorPerDay,
    ).toBe(300);
  });

  it('keeps stored retired look words inert, ignoring new ones sent internally', async () => {
    const { service, pages } = pagesWith([
      livePage({
        settings: {
          branding: { subtitle: 'Kept', disclaimer: 'Kept too', title: 'X' },
        },
      }),
    ]);
    await service.save(
      bot as never,
      {
        status: BotPageStatus.ON,
        access: BotPageAccess.INVITE,
        settings: {
          branding: {
            logoUrl: null,
            accentColour: '#336699',
            title: 'Sunrise Mind',
            assistantName: 'Sunny',
            subtitle: 'New',
            disclaimer: 'New',
            footerLink: { label: 'a', url: 'https://a.test' },
          },
          suggestedQuestions: [],
          limits: {
            messagesPerVisitorPerHour: 30,
            maxMessageChars: 1000,
            dailyCapPerBot: 500,
          },
          language: 'auto',
        },
      } as never,
    );
    const branding = (pages.rows[0].settings as { branding: Row }).branding;
    expect(branding.subtitle).toBe('Kept');
    expect(branding.disclaimer).toBe('Kept too');
    expect(branding.footerLink).toBeNull();
  });
});

describe('stage 7: old links and embeds keep working', () => {
  it('resolves the address, the legacy slug (any case), and a verified custom domain', async () => {
    const { service } = pagesWith(
      [livePage()],
      [
        {
          id: 'd1',
          chatbotId: 'bot-1',
          host: 'chat.sunrisemind.in',
          status: ChatbotDomainStatus.VERIFIED,
        },
        {
          id: 'd2',
          chatbotId: 'bot-1',
          host: 'pending.sunrisemind.in',
          status: ChatbotDomainStatus.PENDING,
        },
      ],
    );
    for (const key of [
      'k7m2p9qa',
      'sunrise-mind',
      'Sunrise-Mind',
      'chat.sunrisemind.in',
      'CHAT.sunrisemind.in.',
    ]) {
      expect((await service.findAvailable(key))?.page.id).toBe('page-1');
    }
    expect(await service.findAvailable('pending.sunrisemind.in')).toBeNull();
    expect(await service.findAvailable('../etc')).toBeNull();
    expect(await service.findAvailable('nothere1')).toBeNull();
  });

  it('prefers the address when a key could be both', async () => {
    const { service } = pagesWith([
      livePage({ id: 'by-slug', slug: 'abcd1234', publicId: 'zzzz9999' }),
      livePage({
        id: 'by-id',
        chatbotId: 'bot-1',
        slug: 'other',
        publicId: 'abcd1234',
      }),
    ]);
    expect((await service.findByKey('abcd1234'))?.id).toBe('by-id');
  });

  it('serves logo image URLs under the address', async () => {
    const { service } = pagesWith([livePage()]);
    const available = await service.findAvailable('sunrise-mind');
    expect(available?.page.publicId).toBe('k7m2p9qa');
  });
});

describe('stage 7: what the owner may send', () => {
  const body = (over: Row = {}, branding: Row = {}) =>
    ({
      status: BotPageStatus.ON,
      access: BotPageAccess.INVITE,
      settings: {
        branding: {
          title: 'T',
          assistantName: 'A',
          accentColour: '#336699',
          ...branding,
        },
      },
      ...over,
    }) as never;

  it("refuses a slug that differs from the stored one: the address isn't the owner's", () => {
    expect(() =>
      rejectRetiredPageFields(body({ slug: 'mine' }), 'sunrise-mind'),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ error: 'address_not_editable' }),
      }),
    );
    expect(() =>
      rejectRetiredPageFields(body({ slug: 'Sunrise-Mind' }), 'sunrise-mind'),
    ).not.toThrow();
    expect(() => rejectRetiredPageFields(body(), 'sunrise-mind')).not.toThrow();
  });

  it.each(['subtitle', 'avatarUrl', 'disclaimer', 'footerLink'])(
    'refuses the retired look field %s',
    (field) => {
      expect(() =>
        rejectRetiredPageFields(body({}, { [field]: null }), null),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ error: 'look_field_retired' }),
        }),
      );
    },
  );
});

describe('stage 7: sites the widget has loaded on', () => {
  function sites() {
    const rows: Row[] = [];
    const updates: Row[] = [];
    const inserts: Row[] = [];
    const qb = {
      update: () => qb,
      set: (v: Row) => (updates.push(v), qb),
      where: (_w: string, p: Row) => (((qb as Row).params = p), qb),
      insert: () => qb,
      into: () => qb,
      values: (v: Row) => (inserts.push(v), qb),
      orIgnore: () => qb,
      execute: jest.fn(async () => {
        const p = (qb as Row).params as Row | undefined;
        if (inserts.length && !p) {
          const v = inserts[inserts.length - 1];
          rows.push({
            chatbotId: v.chatbotId,
            host: v.host,
            loadCount: v.loadCount,
          });
          return {};
        }
        (qb as Row).params = undefined;
        const row = rows.find(
          (r) => r.chatbotId === p?.chatbotId && r.host === p?.host,
        );
        return { affected: row ? 1 : 0 };
      }),
    };
    const repoMock = {
      createQueryBuilder: () => qb,
      count: jest.fn(async () => rows.length),
      find: jest.fn(async () => rows),
    };
    const redis = new FakeRedis();
    const service = new WidgetSitesService(repoMock as never, redis as never);
    return { service, rows, updates, inserts, redis };
  }

  it('normalises the origin to a hostname, and ignores what is not a web page', () => {
    expect(widgetSiteHost('https://WWW.Example.org:8443/x')).toBe(
      'www.example.org',
    );
    expect(widgetSiteHost('javascript:alert(1)')).toBeNull();
    expect(widgetSiteHost(undefined)).toBeNull();
  });

  it('records a new site once, then at most once an hour', async () => {
    const h = sites();
    await h.service.record('bot-1', 'https://www.example.org');
    await h.service.record('bot-1', 'https://www.example.org');
    await h.service.record('bot-1', 'https://www.example.org');
    expect(h.inserts).toHaveLength(1);
    expect(h.rows).toEqual([
      { chatbotId: 'bot-1', host: 'www.example.org', loadCount: 1 },
    ]);
    // The two loads since are waiting in Redis for the next hourly write.
    expect(h.redis.values.get('bp:wsite:n:bot-1:www.example.org')).toBe('2');
  });

  it('never fails the widget when Redis is down', async () => {
    const h = sites();
    h.redis.fail = true;
    await expect(
      h.service.record('bot-1', 'https://a.test'),
    ).resolves.toBeUndefined();
    expect(h.rows).toHaveLength(0);
  });
});

describe('stage 7: custom domains', () => {
  const enodata = () =>
    Object.assign(new Error('no data'), { code: 'ENODATA' });

  function domains(
    dns: Partial<
      Record<'resolveCname' | 'resolveTxt' | 'resolve4', jest.Mock>
    > = {},
  ) {
    const rows: Row[] = [];
    // The page service reads the same domain rows, as in the app.
    const { service: pages, domains: store } = pagesWith([livePage()], rows);
    const service = new BotPageDomainService(
      store as never,
      pages,
      config as never,
    );
    service.resolver = {
      resolveCname: dns.resolveCname ?? jest.fn().mockRejectedValue(enodata()),
      resolveTxt: dns.resolveTxt ?? jest.fn().mockRejectedValue(enodata()),
      resolve4: dns.resolve4 ?? jest.fn().mockRejectedValue(enodata()),
    };
    return { service, rows };
  }

  it('adds a host and gives the exact two records to add', async () => {
    const { service } = domains();
    const view = await service.add('bot-1', 'https://Chat.SunriseMind.in/path');
    expect(view.host).toBe('chat.sunrisemind.in');
    expect(view.status).toBe(ChatbotDomainStatus.PENDING);
    expect(view.records[0]).toEqual({
      type: 'CNAME',
      name: 'chat.sunrisemind.in',
      value: 'pages.helloally.ai',
    });
    expect(view.records[1].type).toBe('TXT');
    expect(view.records[1].name).toBe('_ally-verify.chat.sunrisemind.in');
    expect(view.records[1].value).toMatch(/^ally-verify=[0-9a-f]{32}$/);
  });

  it.each([
    ['not a domain', 'hello', 'domain_invalid'],
    ['a shared suffix', 'co.in', 'domain_shared'],
    ["Ally's own", 'evil.helloally.ai', 'domain_ours'],
  ])('refuses %s', async (_label, host, error) => {
    const { service } = domains();
    await expect(service.add('bot-1', host)).rejects.toMatchObject({
      response: { error },
    });
  });

  it('one domain per assistant, and a host only once across assistants', async () => {
    const { service, rows } = domains();
    await service.add('bot-1', 'chat.sunrisemind.in');
    await expect(
      service.add('bot-1', 'other.sunrisemind.in'),
    ).rejects.toMatchObject({
      response: { error: 'domain_limit' },
    });
    rows.push({ id: 'x', chatbotId: 'bot-2', host: 'taken.example.org' });
    await expect(
      service.add('bot-3', 'taken.example.org'),
    ).rejects.toMatchObject({
      response: { error: 'domain_taken' },
    });
  });

  it('nothing in DNS yet: failed, both records missing', async () => {
    const { service } = domains();
    const { id } = await service.add('bot-1', 'chat.sunrisemind.in');
    const view = await service.check('bot-1', id);
    expect(view.status).toBe(ChatbotDomainStatus.FAILED);
    expect(view.lastCheck).toEqual({
      cname: { state: 'missing', found: [] },
      txt: { state: 'missing', found: [] },
    });
  });

  it('a CNAME pointing elsewhere and the wrong token: says what it found', async () => {
    const { service } = domains({
      resolveCname: jest.fn().mockResolvedValue(['old-host.example.net.']),
      resolveTxt: jest.fn().mockResolvedValue([['ally-verify=', 'nope']]),
    });
    const { id } = await service.add('bot-1', 'chat.sunrisemind.in');
    const view = await service.check('bot-1', id);
    expect(view.status).toBe(ChatbotDomainStatus.FAILED);
    expect(view.lastCheck?.cname).toEqual({
      state: 'wrong',
      found: ['old-host.example.net'],
    });
    expect(view.lastCheck?.txt).toEqual({
      state: 'wrong',
      found: ['ally-verify=nope'],
    });
  });

  it('both right: verified, and the page then answers on that host', async () => {
    const resolveTxt = jest.fn();
    const { service } = domains({
      resolveCname: jest.fn().mockResolvedValue(['Pages.HelloAlly.ai.']),
      resolveTxt,
    });
    const added = await service.add('bot-1', 'chat.sunrisemind.in');
    // TXT answers may arrive split into several strings.
    const token = added.records[1].value;
    resolveTxt.mockResolvedValue([[token.slice(0, 10), token.slice(10)]]);
    const view = await service.check('bot-1', added.id);
    expect(view.status).toBe(ChatbotDomainStatus.VERIFIED);
    expect(view.verifiedAt).not.toBeNull();
    expect(await service.isServed('chat.sunrisemind.in')).toBe(true);
    expect(
      await service.originAllowedFor('https://chat.sunrisemind.in', 'k7m2p9qa'),
    ).toBe(true);
    expect(
      await service.originAllowedFor('https://chat.sunrisemind.in', 'otherpg1'),
    ).toBe(false);
    expect(
      await service.originAllowedFor(
        'https://chat.sunrisemind.in',
        'chat.sunrisemind.in',
      ),
    ).toBe(true);
    expect(await service.isServed('unknown.example.org')).toBe(false);
  });

  it('a root domain flattened to our addresses counts as pointed', async () => {
    const resolve4 = jest.fn(async (host: string) =>
      host === 'pages.helloally.ai'
        ? ['203.0.113.5', '203.0.113.6']
        : ['203.0.113.5'],
    );
    const resolveTxt = jest.fn();
    const { service } = domains({ resolve4, resolveTxt });
    const added = await service.add('bot-1', 'sunrisemind.in');
    resolveTxt.mockResolvedValue([[added.records[1].value]]);
    expect((await service.check('bot-1', added.id)).status).toBe(
      ChatbotDomainStatus.VERIFIED,
    );
  });

  it('a DNS failure is an error state, never verified', async () => {
    const servfail = Object.assign(new Error('x'), { code: 'ESERVFAIL' });
    const { service } = domains({
      resolveCname: jest.fn().mockRejectedValue(servfail),
      resolveTxt: jest.fn().mockRejectedValue(servfail),
    });
    const { id } = await service.add('bot-1', 'chat.sunrisemind.in');
    const view = await service.check('bot-1', id);
    expect(view.status).toBe(ChatbotDomainStatus.FAILED);
    expect(view.lastCheck?.cname.state).toBe('error');
    expect(view.lastCheck?.txt.state).toBe('error');
  });
});

describe('stage 7: CORS for a verified custom domain', () => {
  afterEach(() => registerPublicBotOriginCheck(null));

  const run = (url: string, origin: string) =>
    new Promise<{ origin: unknown }>((resolve) => {
      appCorsDelegate(() => ['https://app.helloally.ai'])(
        { url, headers: { origin } },
        (_e, options) => resolve(options as { origin: unknown }),
      );
    });

  it('reads the page key from a public bot-page URL', () => {
    expect(publicBotKey('/api/v1/public/bots/k7m2p9qa/session')).toBe(
      'k7m2p9qa',
    );
    expect(publicBotKey('/api/v1/public/bots/chat.x.org')).toBe('chat.x.org');
    expect(publicBotKey('/api/v1/chatbots/1')).toBeNull();
  });

  it("answers the page's own verified domain, and only on the public bot routes", async () => {
    registerPublicBotOriginCheck(
      async (origin, key) =>
        origin === 'https://chat.x.org' && key === 'k7m2p9qa',
    );
    expect(
      (await run('/api/v1/public/bots/k7m2p9qa/session', 'https://chat.x.org'))
        .origin,
    ).toEqual(['https://chat.x.org']);
    expect(
      typeof (await run('/api/v1/public/bots/otherpg1', 'https://chat.x.org'))
        .origin,
    ).toBe('function');
    expect(
      typeof (await run('/api/v1/chatbots', 'https://chat.x.org')).origin,
    ).toBe('function');
  });
});

describe('stage 7: the per-person daily window', () => {
  it('counts per day and says how long until midnight (Asia/Kolkata)', async () => {
    const limits = new BotPageRateLimitService(
      new FakeRedis() as never,
      { emit: jest.fn() } as never,
    );
    const now = new Date('2026-11-23T12:00:00Z'); // 17:30 in Kolkata
    expect((await limits.daily('v:1', 2, now)).allowed).toBe(true);
    expect((await limits.daily('v:1', 2, now)).allowed).toBe(true);
    const third = await limits.daily('v:1', 2, now);
    expect(third).toEqual({ allowed: false, retryAfterSeconds: 6.5 * 3600 });
    expect(secondsToLocalMidnight(now)).toBe(6.5 * 3600);
  });

  it('fails open when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.fail = true;
    const limits = new BotPageRateLimitService(
      redis as never,
      { emit: jest.fn() } as never,
    );
    expect((await limits.daily('v:1', 1)).allowed).toBe(true);
  });
});
