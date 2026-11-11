import { lastValueFrom, of } from 'rxjs';
import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { DebriefConsoleAuditInterceptor } from '../interceptor/debrief-console-audit.interceptor';
import { DebriefConsoleService } from '../service/debrief-console.service';

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

describe('DebriefConsoleService.stepUsage (v9 FR-38 registry)', () => {
  it('lists every recipe step with its model and its use, steps that never ran included', async () => {
    const ds = {
      query: jest.fn(async () => [
        {
          step: 'writer',
          done: 40,
          failed: 2,
          skipped: 0,
          median_ms: 12000.4,
          usd: 0.81234,
          models: ['gemini-3-flash-preview'],
        },
      ]),
    };
    const runner = {
      resolveRelease: async () => ({ bundle: DEBRIEF_SEED_BUNDLE }),
    };
    const svc = new DebriefConsoleService(
      ds as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      runner as any,
    );
    const rows = await svc.stepUsage(30);
    const writer = rows.find((r) => r.step === 'writer')!;
    expect(writer).toMatchObject({
      done: 40,
      failed: 2,
      medianMs: 12000,
      estimatedUsd: 0.8123,
    });
    expect(writer.inRecipes).toEqual(
      expect.arrayContaining(['standard', 'short']),
    );
    const safety = rows.find((r) => r.step === 'safety_reader');
    expect(safety).toMatchObject({ done: 0, medianMs: null, estimatedUsd: 0 });
    expect((ds.query.mock.calls as any[][])[0][1]).toEqual([30]);
  });
});
