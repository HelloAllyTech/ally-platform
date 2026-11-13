import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AnalyticsAutomationRunService } from '../analytics-automation-run.service';

// The agents and GitHub pull in LangChain and the MCP client; none of it is
// exercised here, so the real classes are never loaded.
jest.mock('../analytics-automation-backend-review.agent', () => ({
  AnalyticsAutomationBackendReviewAgent: class {},
}));
jest.mock('../analytics-automation-posthog.agent', () => ({
  AnalyticsAutomationPosthogAgent: class {},
}));
jest.mock('../analytics-automation-dbt.agent', () => ({
  AnalyticsAutomationDbtAgent: class {},
}));
jest.mock('../analytics-automation-github.service', () => ({
  AnalyticsAutomationGithubService: class {},
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

function build() {
  const runs = {
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    findOneByOrFail: jest.fn().mockResolvedValue({
      id: 'run1',
      commitShas: {
        platform: { base: null, head: 'h', since: 's' },
        dbt: { head: 'd' },
      },
    }),
  };
  const agentRuns = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneByOrFail: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };
  const findings = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    save: jest.fn(),
    create: jest.fn((x) => x),
  };
  const github = { getPullRequestState: jest.fn() };
  const dbt = {
    analyse: jest.fn().mockResolvedValue({
      summary: 's',
      needsChanges: true,
      items: [{ key: 'k' }],
      findings: [],
    }),
    apply: jest.fn(),
  };
  const service = new AnalyticsAutomationRunService(
    runs as never,
    agentRuns as never,
    findings as never,
    github as never,
    {} as never,
    {} as never,
    dbt as never,
  );
  return { service, runs, agentRuns, findings, github, dbt };
}

const dbtRow = (over: object = {}) => ({
  id: 'dbt1',
  runId: 'run1',
  agent: 'dbt_metrics',
  status: 'waiting',
  note: null,
  prNumber: null,
  decision: null,
  output: {},
  ...over,
});
const posthogRow = (over: object = {}) => ({
  id: 'ph1',
  runId: 'run1',
  agent: 'posthog_events',
  status: 'completed',
  prNumber: null,
  prState: null,
  output: {},
  ...over,
});

const findOneRows =
  (rows: Array<Record<string, unknown>>) =>
  async (opts: { where: { id?: string; agent?: string } }) =>
    rows.find((r) =>
      opts.where.id ? r.id === opts.where.id : r.agent === opts.where.agent,
    ) ?? null;

describe('AnalyticsAutomationRunService.openDbtForApproval', () => {
  it('offers the dbt agent for approval even while the PostHog PR is open, and says it is checked on approve', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'open' }),
    ]);

    await service.openDbtForApproval('run1');

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'waiting' },
      expect.objectContaining({
        status: 'awaiting_approval',
        note: expect.stringContaining('merged or closed'),
      }),
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('runs nothing itself when the PR is merged: it only offers the agent for approval', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'merged' }),
    ]);

    await service.openDbtForApproval('run1');
    await flush();

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'waiting' },
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
    expect(dbt.apply).not.toHaveBeenCalled();
  });

  it('says so when the PR was closed unmerged', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'closed' }),
    ]);

    await service.openDbtForApproval('run1');

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'waiting' },
      expect.objectContaining({
        status: 'awaiting_approval',
        note: expect.stringContaining('closed without merging'),
      }),
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('is approvable when the PostHog agent opened no PR', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([dbtRow(), posthogRow()]);

    await service.openDbtForApproval('run1');

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'waiting' },
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('does nothing for a dbt agent that is no longer waiting', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow({ status: 'awaiting_approval' }),
      posthogRow(),
    ]);

    await service.openDbtForApproval('run1');

    expect(agentRuns.update).not.toHaveBeenCalled();
    expect(dbt.analyse).not.toHaveBeenCalled();
  });
});

describe('AnalyticsAutomationRunService approve / reject', () => {
  const queryBuilder = (affected: number) => {
    const qb: Record<string, jest.Mock> = {};
    for (const name of ['update', 'set', 'where', 'andWhere']) {
      qb[name] = jest.fn().mockReturnValue(qb);
    }
    qb.execute = jest.fn().mockResolvedValue({ affected });
    return qb;
  };

  it('404s for an agent run that is not the dbt agent', async () => {
    const { service, agentRuns } = build();
    agentRuns.findOne.mockResolvedValue(posthogRow());
    await expect(service.approve('ph1', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.reject('ph1', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s when the proposal is not awaiting approval, so a double click cannot start two PRs', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.findOne.mockResolvedValue(
      dbtRow({ status: 'applying', output: { items: [{ key: 'k' }] } }),
    );
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(0));
    await expect(service.approve('dbt1', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(dbt.apply).not.toHaveBeenCalled();
  });

  it('approving starts the dbt edit in the background and records who decided', async () => {
    const { service, agentRuns, dbt } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: { withEvents: false },
    });
    agentRuns.findOne.mockImplementation(findOneRows([row, posthogRow()]));
    agentRuns.findOneByOrFail.mockResolvedValue(row);
    const qb = queryBuilder(1);
    agentRuns.createQueryBuilder.mockReturnValue(qb);
    dbt.apply.mockResolvedValue({
      summary: 's',
      pr: { number: 3, url: 'u' },
      skipped: [],
    });

    await service.approve('dbt1', 42);
    await flush();

    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'applying',
        decision: 'approved',
        decidedBy: 42,
      }),
    );
    // Approval is what starts the agent: analysis first, then the changes.
    expect(dbt.analyse).toHaveBeenCalledTimes(1);
    expect(dbt.apply).toHaveBeenCalledTimes(1);
    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ status: 'pr_opened' }),
    );
  });

  it('completes without opening a PR when the analysis finds nothing for dbt', async () => {
    const { service, agentRuns, dbt } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: { withEvents: false },
    });
    agentRuns.findOne.mockResolvedValue(row);
    agentRuns.findOneByOrFail.mockResolvedValue(row);
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    dbt.analyse.mockResolvedValue({
      summary: 'Nothing to do.',
      needsChanges: false,
      items: [],
      findings: [],
    });

    await service.approve('dbt1', 1);
    await flush();

    expect(dbt.apply).not.toHaveBeenCalled();
    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({
        status: 'completed',
        summary: 'Nothing to do.',
      }),
    );
  });

  it('a failed apply marks the agent failed instead of throwing out of the background task', async () => {
    const { service, agentRuns, dbt } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: { withEvents: false },
    });
    agentRuns.findOne.mockResolvedValue(row);
    agentRuns.findOneByOrFail.mockResolvedValue(row);
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    dbt.apply.mockRejectedValue(new Error('github down'));

    await service.approve('dbt1', 1);
    await flush();

    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ status: 'failed', note: 'github down' }),
    );
  });

  it('refuses to approve, and starts nothing, while the PostHog PR is still open on GitHub', async () => {
    const { service, agentRuns, github, dbt } = build();
    const row = dbtRow({ status: 'awaiting_approval' });
    agentRuns.findOne.mockImplementation(
      findOneRows([
        row,
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    github.getPullRequestState.mockResolvedValue({ state: 'open' });

    await expect(service.approve('dbt1', 1)).rejects.toThrow(
      /merged or closed/,
    );
    expect(github.getPullRequestState).toHaveBeenCalledWith(
      { owner: 'Org', repo: 'platform' },
      7,
    );
    expect(agentRuns.createQueryBuilder).not.toHaveBeenCalled();
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('judges the PR by what GitHub says now: stored "open" but closed on GitHub approves, without the events', async () => {
    const { service, agentRuns, github, dbt } = build();
    const row = dbtRow({ status: 'awaiting_approval' });
    agentRuns.findOne.mockImplementation(
      findOneRows([
        row,
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    agentRuns.findOneByOrFail.mockResolvedValue(row);
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    github.getPullRequestState.mockResolvedValue({ state: 'closed' });
    dbt.apply.mockResolvedValue({ summary: 's', pr: null, skipped: [] });

    await service.approve('dbt1', 1);
    await flush();

    expect(agentRuns.update).toHaveBeenCalledWith('ph1', { prState: 'closed' });
    expect(agentRuns.update).toHaveBeenCalledWith('dbt1', {
      output: { withEvents: false },
    });
    expect(dbt.analyse).toHaveBeenCalledTimes(1);
  });

  it('502s, and starts nothing, when GitHub cannot be asked', async () => {
    const { service, agentRuns, github, dbt } = build();
    agentRuns.findOne.mockImplementation(
      findOneRows([
        dbtRow({ status: 'awaiting_approval' }),
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    github.getPullRequestState.mockRejectedValue(new Error('rate limited'));

    await expect(service.approve('dbt1', 1)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('rejecting closes the proposal and marks its findings rejected so they are not raised again', async () => {
    const { service, agentRuns, findings } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: { items: [{ key: 'k' }] },
    });
    agentRuns.findOne.mockResolvedValue(row);
    agentRuns.findOneByOrFail.mockResolvedValue({ ...row, status: 'rejected' });

    await service.reject('dbt1', 9);

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'awaiting_approval' },
      expect.objectContaining({
        status: 'rejected',
        decision: 'rejected',
        decidedBy: 9,
      }),
    );
    expect(findings.update).toHaveBeenCalledWith(
      { agentRunId: 'dbt1', status: 'proposed' },
      { status: 'rejected' },
    );
  });

  it('409s rejecting a proposal that is not awaiting approval', async () => {
    const { service, agentRuns } = build();
    agentRuns.findOne.mockResolvedValue(dbtRow({ status: 'pr_opened' }));
    agentRuns.update.mockResolvedValue({ affected: 0 });
    await expect(service.reject('dbt1', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('AnalyticsAutomationRunService starting a run', () => {
  const settled = (id: string, head: string) => ({
    id,
    ranAt: new Date('2026-11-01T00:00:00Z'),
    commitShas: {
      platform: { base: null, head, since: 's' },
      dbt: { head: 'd' },
    },
  });

  function startBuild(
    previousRuns: object[],
    agentsOf: Record<string, object[]>,
  ) {
    const created: Array<Record<string, unknown>> = [];
    const manager = {
      create: (_entity: unknown, data: Record<string, unknown>) => data,
      save: jest.fn(async (x: unknown) => {
        const items = Array.isArray(x) ? x : [x];
        created.push(...(items as Array<Record<string, unknown>>));
        return Array.isArray(x)
          ? x
          : { id: 'new-run-id-0000', ...(x as object) };
      }),
    };
    const runs = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      exists: jest.fn().mockResolvedValue(false),
      find: jest.fn().mockResolvedValue(previousRuns),
      manager: {
        transaction: async (fn: (m: unknown) => unknown) => fn(manager),
      },
    };
    const agentRuns = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn(
        async (opts: { where: { runId: string } }) =>
          agentsOf[opts.where.runId] ??
          // The run just created: hand back the agent rows saved for it.
          created
            .filter((c) => c.agent)
            .map((c, i) => ({ ...c, id: `agent-${i}` })),
      ),
    };
    const github = { getBranchHead: jest.fn().mockResolvedValue('head-now') };
    const backendReview = { run: jest.fn() };
    const posthog = { run: jest.fn() };
    const service = new AnalyticsAutomationRunService(
      runs as never,
      agentRuns as never,
      {} as never,
      github as never,
      backendReview as never,
      posthog as never,
      {} as never,
    );
    return { service, created, backendReview, posthog };
  }

  const finished = [
    { agent: 'backend_review', status: 'completed' },
    { agent: 'posthog_events', status: 'completed' },
  ];

  it('records a completed run with no agent work when the head has not moved', async () => {
    const { service, created, backendReview, posthog } = startBuild(
      [settled('prev', 'head-now')],
      { prev: finished },
    );

    const started = await service.startManualRun();
    await started.done;

    expect(started.run.status).toBe('completed');
    const agents = created.filter((c) => c.agent);
    expect(agents).toHaveLength(3);
    for (const a of agents) {
      expect(a.status).toBe('completed');
      expect(a.summary).toMatch(/No new commits since the last run/);
    }
    expect(backendReview.run).not.toHaveBeenCalled();
    expect(posthog.run).not.toHaveBeenCalled();
  });

  it('runs the agents when the head moved', async () => {
    const { service } = startBuild([settled('prev', 'old-head')], {
      prev: finished,
    });
    const started = await service.startManualRun();
    expect(started.run.status).toBe('running');
    // processRun is in flight in the background; let it settle before the suite ends.
    await started.done;
  });

  it('does not treat a run whose PostHog agent failed as the baseline', async () => {
    // The newest run has the same head but its PostHog agent failed: it reviewed
    // nothing, so this run must still do the work.
    const { service, backendReview } = startBuild(
      [settled('failed-run', 'head-now')],
      {
        'failed-run': [
          { agent: 'backend_review', status: 'completed' },
          { agent: 'posthog_events', status: 'failed' },
        ],
      },
    );
    const started = await service.startManualRun();
    await started.done;
    expect(started.run.status).toBe('running');
    expect(backendReview.run).toHaveBeenCalled();
  });
});
