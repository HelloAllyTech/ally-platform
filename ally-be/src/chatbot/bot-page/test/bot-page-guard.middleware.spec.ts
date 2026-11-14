import { BotPageGuardMiddleware } from '../bot-page-guard.middleware';

describe('BotPageGuardMiddleware', () => {
  const guard = new BotPageGuardMiddleware({
    botPage: { origin: 'https://chat.example.com' },
    cors: { allowedOrigins: ['https://app.example.com'] },
  } as never);
  const run = (headers: Record<string, string>, body?: unknown) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    guard.use({ headers, body } as never, res as never, next);
    return { res, next };
  };

  it('lets the page’s own origin, and requests with no origin, through', () => {
    expect(run({ origin: 'https://chat.example.com' }).next).toHaveBeenCalled();
    expect(run({}).next).toHaveBeenCalled();
  });

  it('lets Ally’s other origins through (the page is also served under app/admin)', () => {
    expect(run({ origin: 'https://app.example.com' }).next).toHaveBeenCalled();
  });

  it('refuses any origin that is not Ally’s own', () => {
    const { res, next } = run({ origin: 'https://evil.example.net' });
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
});
