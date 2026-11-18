import { DebriefAgentService } from '../service/debrief-agent.service';

/** A retried run's first attempt is still counted: its start and its spend are kept. */
describe('retry and cost reconcile keep the first attempt', () => {
  const build = () => {
    const svc = Object.create(DebriefAgentService.prototype) as any;
    const query = jest.fn(async (sql: string) =>
      sql.includes('UPDATE debrief_runs') ? [[{ id: 'run-1' }]] : [],
    );
    Object.assign(svc, {
      dataSource: { query },
      runs: {
        findOne: jest.fn(async () => ({ id: 'run-1' })),
        update: jest.fn(),
      },
      runner: { retry: jest.fn(async (r: any) => r) },
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    });
    return { svc, query };
  };

  it('retryRun stores the first start and adds the attempt’s estimate before starting the next', async () => {
    const { svc, query } = build();
    await svc.retryRun({
      id: 'run-1',
      scenarioSessionId: 's1',
      status: 'failed',
    });
    const sql = String((query.mock.calls as any[][])[0][0]);
    expect(sql).toContain("'{firstStartedAt}'");
    expect(sql).toContain("COALESCE(workspace->>'firstStartedAt'");
    expect(sql).toContain("'{priorEstimatedUsd}'");
    expect(sql).toContain('+ COALESCE("estimatedCostUsd", 0)');
    // The new attempt still starts now.
    expect(sql).toContain('"startedAt" = now()');
  });

  it('the cost reconcile reads llm_usage from the first start of a retried run', async () => {
    const { svc, query } = build();
    await svc.reconcileCosts();
    const sql = String((query.mock.calls as any[][])[0][0]);
    expect(sql).toContain(
      `COALESCE((workspace->>'firstStartedAt')::timestamp, "startedAt") AS "startedAt"`,
    );
  });
});
