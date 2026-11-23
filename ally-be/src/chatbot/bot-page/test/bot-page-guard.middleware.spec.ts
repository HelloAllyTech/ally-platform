import { BotPageGuardMiddleware } from '../bot-page-guard.middleware';

describe('BotPageGuardMiddleware', () => {
  const guard = new BotPageGuardMiddleware({
    botPage: { origin: 'https://chat.example.com' },
    cors: { allowedOrigins: ['https://app.example.com'] },
  } as never);
  const run = (headers: Record<string, string>, body?: unknown) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    const done = guard.use({ headers, body } as never, res as never, next);
    return { res, next, done };
  };

  it('lets the page’s own origin, and requests with no origin, through', () => {
    expect(run({ origin: 'https://chat.example.com' }).next).toHaveBeenCalled();
    expect(run({}).next).toHaveBeenCalled();
  });

  it('lets Ally’s other origins through (the page is also served under app/admin)', () => {
    expect(run({ origin: 'https://app.example.com' }).next).toHaveBeenCalled();
  });

  it('refuses any origin that is not Ally’s own', async () => {
    const { res, next, done } = run({ origin: 'https://evil.example.net' });
    await done;
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses a body over 16 KB', () => {
    expect(
      run({ 'content-length': String(17 * 1024) }).res.status,
    ).toHaveBeenCalledWith(413);
    expect(
      run({}, { message: 'x'.repeat(17 * 1024) }).res.status,
    ).toHaveBeenCalledWith(413);
    expect(
      run({ 'content-length': '200' }, { message: 'hi' }).next,
    ).toHaveBeenCalled();
  });

  describe('a verified custom domain (stage 7)', () => {
    const domains = {
      originAllowedFor: jest.fn(
        async (origin: string, key: string) =>
          origin === 'https://chat.clinic.org' && key === 'k7m2p9qa',
      ),
    };
    const withDomains = new BotPageGuardMiddleware(
      {
        botPage: { origin: 'https://chat.example.com' },
        cors: { allowedOrigins: [] },
      } as never,
      domains as never,
    );
    const call = async (origin: string, url: string) => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await withDomains.use(
        { headers: { origin }, originalUrl: url } as never,
        res as never,
        next,
      );
      return { res, next };
    };

    it('lets the page’s own verified domain through, for that page only', async () => {
      expect(
        (
          await call(
            'https://chat.clinic.org',
            '/api/v1/public/bots/k7m2p9qa/session',
          )
        ).next,
      ).toHaveBeenCalled();
      const other = await call(
        'https://chat.clinic.org',
        '/api/v1/public/bots/otherpg1/session',
      );
      expect(other.next).not.toHaveBeenCalled();
      expect(other.res.status).toHaveBeenCalledWith(403);
    });

    it('fails closed when the check throws', async () => {
      domains.originAllowedFor.mockRejectedValueOnce(new Error('db down'));
      const { next, res } = await call(
        'https://chat.clinic.org',
        '/api/v1/public/bots/k7m2p9qa',
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
