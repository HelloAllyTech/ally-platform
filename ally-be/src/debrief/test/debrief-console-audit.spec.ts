import { lastValueFrom, of } from 'rxjs';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';

const ctx = (req: Record<string, any>) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

describe('DebriefConsoleAuditInterceptor (v9 FR-38 "every view writes an audit event")', () => {
  it('records who opened which view and which ids, never the response', async () => {
    const audit = { log: jest.fn(async () => undefined) };
    const interceptor = new DebriefConsoleAuditInterceptor(audit as any);
    const body = { cards: { opening: 'transcript words' } };
    const out = await lastValueFrom(
      interceptor.intercept(
        ctx({
          method: 'GET',
          user: { id: 42 },
          route: { path: '/api/v1/debriefs/console/runs/:id' },
          params: { id: 'run-1' },
          query: { status: 'published', search: 'free text' },
        }),
        { handle: () => of(body) },
      ),
    );
    expect(out).toBe(body);
    expect(audit.log).toHaveBeenCalledWith({
      eventType: 'DEBRIEF_CONSOLE_VIEWED',
      userId: 42,
      details: {
        view: '/api/v1/debriefs/console/runs/:id',
        params: { id: 'run-1' },
        query: { status: 'published' },
      },
    });
    expect(
      JSON.stringify((audit.log.mock.calls as any[][])[0][0]),
    ).not.toContain('transcript words');
  });

  it('does not record actions, which keep their own review history', async () => {
    const audit = { log: jest.fn() };
    const interceptor = new DebriefConsoleAuditInterceptor(audit as any);
    await lastValueFrom(
      interceptor.intercept(ctx({ method: 'POST', params: {} }), {
        handle: () => of({}),
      }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
