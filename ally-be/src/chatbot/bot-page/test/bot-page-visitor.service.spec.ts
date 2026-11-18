import { JwtService } from '@nestjs/jwt';
import {
  BOT_PAGE_COOKIE_PATH,
  BotPageVisitorService,
  EMBED_PROBE_COOKIE,
  readCookie,
} from '../bot-page-visitor.service';

const BOT = '11111111-2222-3333-4444-555555555555';

function harness(over: { baseUrl?: string; visitorSecret?: string } = {}) {
  const jwt = new JwtService({});
  const config = {
    botPage: {
      baseUrl: over.baseUrl ?? 'https://chat.example.com',
      visitorSecret: over.visitorSecret ?? '',
    },
    jwt: { accessToken: { secret: 'access-secret' } },
  };
  const service = new BotPageVisitorService(jwt, config as never);
  const cookies: Record<
    string,
    { value: string; options: Record<string, unknown> }
  > = {};
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies[name] = { value, options };
    },
  };
  const req = (value?: string) => ({
    headers:
      value === undefined
        ? {}
        : {
            cookie: `other=1; ${BotPageVisitorService.cookieName(BOT)}=${value}`,
          },
  });
  return { jwt, service, cookies, res, req };
}

describe('BotPageVisitorService', () => {
  it('signs a visitor into an httpOnly, Lax, path-scoped cookie and reads it back', async () => {
    const { service, cookies, res, req } = harness();
    const visitor = service.newVisitor(BOT);
    await service.issue(res as never, visitor);

    const cookie = cookies[BotPageVisitorService.cookieName(BOT)];
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: BOT_PAGE_COOKIE_PATH,
    });
    const read = await service.read(req(cookie.value) as never, BOT);
    expect(read).toMatchObject({
      id: visitor.id,
      chatbotId: BOT,
      verifiedAt: null,
    });
  });

  it('is not Secure on a plain-http local page', async () => {
    const { service, cookies, res } = harness({
      baseUrl: 'http://localhost:8081',
    });
    await service.issue(res as never, service.newVisitor(BOT));
    expect(cookies[BotPageVisitorService.cookieName(BOT)].options.secure).toBe(
      false,
    );
  });

  it('carries the verification time', async () => {
    const { service, cookies, res, req } = harness();
    const verifiedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await service.issue(res as never, {
      ...service.newVisitor(BOT),
      verifiedAt,
    });
    const read = await service.read(
      req(cookies[BotPageVisitorService.cookieName(BOT)].value) as never,
      BOT,
    );
    expect(read?.verifiedAt?.getTime()).toBe(verifiedAt.getTime());
  });

  it('drops a verification older than 30 days', async () => {
    const { service, cookies, res, req } = harness();
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    await service.issue(res as never, {
      ...service.newVisitor(BOT),
      verifiedAt: old,
    });
    const read = await service.read(
      req(cookies[BotPageVisitorService.cookieName(BOT)].value) as never,
      BOT,
    );
    expect(read?.verifiedAt).toBeNull();
  });

  it.each([
    ['no cookie', undefined],
    ['garbage', 'not-a-jwt'],
  ])('reads nothing from %s', async (_label, value) => {
    const { service, req } = harness();
    expect(await service.read(req(value) as never, BOT)).toBeNull();
  });

  it('refuses another bot’s visitor, a user access token, and a token signed with another secret', async () => {
    const { service, jwt, cookies, res, req } = harness();
    await service.issue(
      res as never,
      service.newVisitor('99999999-2222-3333-4444-555555555555'),
    );
    const otherBot = Object.values(cookies)[0].value;
    expect(await service.read(req(otherBot) as never, BOT)).toBeNull();

    const accessToken = await jwt.signAsync(
      { sub: '7', username: 'u', tenantId: 't' },
      { secret: 'access-secret' },
    );
    expect(await service.read(req(accessToken) as never, BOT)).toBeNull();

    const forged = await jwt.signAsync(
      { typ: 'bot_page_visitor', bot: BOT },
      { secret: 'guess', audience: 'bot-page', subject: 'x' },
    );
    expect(await service.read(req(forged) as never, BOT)).toBeNull();
  });

  it('rotates a token older than a day, and leaves a fresh one alone', async () => {
    const { service, res } = harness();
    const issue = jest.spyOn(service, 'issue');
    const visitor = service.newVisitor(BOT);
    await service.rotateIfDue(res as never, visitor);
    expect(issue).not.toHaveBeenCalled();
    await service.rotateIfDue(res as never, {
      ...visitor,
      issuedAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('uses BOT_PAGE_VISITOR_SECRET when set, so tokens signed under the derived secret stop working', async () => {
    const derived = harness();
    await derived.service.issue(
      derived.res as never,
      derived.service.newVisitor(BOT),
    );
    const token = Object.values(derived.cookies)[0].value;
    const dedicated = harness({ visitorSecret: 'dedicated' });
    expect(
      await dedicated.service.read(dedicated.req(token) as never, BOT),
    ).toBeNull();
  });

  it('readCookie picks one cookie out of a header', () => {
    expect(readCookie('a=1; b=two%20words; c=3', 'b')).toBe('two words');
    expect(readCookie('a=1', 'b')).toBeNull();
    expect(readCookie(undefined, 'b')).toBeNull();
  });

  describe('in the website widget (chunk 13)', () => {
    const EMBED = {
      host: 'https://sunrisemind.in',
      page: 'https://sunrisemind.in/fees',
    };
    const embedReq = (cookie?: string, token?: string) => ({
      headers: {
        'x-ally-embed': '1',
        ...(cookie
          ? {
              cookie: `${BotPageVisitorService.cookieName(BOT, true)}=${cookie}`,
            }
          : {}),
        ...(token ? { 'x-ally-visitor': token } : {}),
      },
    });

    it('uses its own cookie: httpOnly, SameSite=None, Secure, Partitioned', async () => {
      const { service, cookies, res } = harness({
        baseUrl: 'http://localhost:8081',
      });
      await service.issue(res as never, {
        ...service.newVisitor(BOT),
        embed: EMBED,
      });
      const cookie = cookies[BotPageVisitorService.cookieName(BOT, true)];
      expect(cookie.options).toMatchObject({
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        partitioned: true,
        path: BOT_PAGE_COOKIE_PATH,
      });
      // The page's own cookie is untouched.
      expect(cookies[BotPageVisitorService.cookieName(BOT)]).toBeUndefined();
    });

    it('reads the host back, and keeps the widget and the page apart', async () => {
      const { service, cookies, res, req } = harness();
      const visitor = { ...service.newVisitor(BOT), embed: EMBED };
      await service.issue(res as never, visitor);
      const token = cookies[BotPageVisitorService.cookieName(BOT, true)].value;
      expect(await service.read(embedReq(token) as never, BOT)).toMatchObject({
        id: visitor.id,
        embed: EMBED,
        via: 'cookie',
      });
      // The widget's token isn't a page visitor, and a page token isn't a widget visitor.
      expect(await service.read(req(token) as never, BOT)).toBeNull();
      await service.issue(res as never, service.newVisitor(BOT));
      const pageToken = cookies[BotPageVisitorService.cookieName(BOT)].value;
      expect(
        await service.read(embedReq(undefined, pageToken) as never, BOT),
      ).toBeNull();
    });

    it('takes the in-memory token in a header only in the widget, and never rotates it', async () => {
      const { service, res, req } = harness();
      const issued = await service.issue(res as never, {
        ...service.newVisitor(BOT),
        embed: EMBED,
      });
      const read = await service.read(
        embedReq(undefined, issued.token) as never,
        BOT,
      );
      expect(read).toMatchObject({ id: issued.id, via: 'header' });
      expect(
        await service.read(
          { headers: { 'x-ally-visitor': issued.token } } as never,
          BOT,
        ),
      ).toBeNull();
      expect(await service.read(req() as never, BOT)).toBeNull();

      const later = { cookie: jest.fn() };
      await service.rotateIfDue(later as never, {
        ...read!,
        issuedAt: new Date(0),
      });
      expect(later.cookie).not.toHaveBeenCalled();
    });

    it('probes with a throwaway cookie set the same way', () => {
      const cookies: Record<string, Record<string, unknown>> = {};
      BotPageVisitorService.setProbe({
        cookie: (
          name: string,
          _v: string,
          options: Record<string, unknown>,
        ) => {
          cookies[name] = options;
        },
      } as never);
      expect(cookies[EMBED_PROBE_COOKIE]).toMatchObject({
        sameSite: 'none',
        secure: true,
        partitioned: true,
      });
      expect(
        BotPageVisitorService.readProbe({
          headers: { cookie: `${EMBED_PROBE_COOKIE}=1` },
        } as never),
      ).toBe(true);
      expect(BotPageVisitorService.readProbe({ headers: {} } as never)).toBe(
        false,
      );
    });
  });
});
