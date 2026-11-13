import {
  BadRequestException,
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

describe('AnalyticsAutomationRunService.releaseDbtIfReady', () => {
  it('keeps the dbt agent waiting, and says why, while the PostHog PR is open', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'open' }),
    ]);

    await service.releaseDbtIfReady('run1');

    expect(agentRuns.update).toHaveBeenCalledWith('dbt1', {
      note: 'Waiting for the PostHog events pull request to be merged or closed.',
    });
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('starts the analysis WITH the merged events once the PR is merged', async () => {
    const { service, agentRuns, dbt } = build();
    const events = [
      { name: 'lesson_done', properties: ['lesson_id'], rationale: 'r' },
    ];
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'merged', output: { events } }),
    ]);
    agentRuns.findOneByOrFail.mockResolvedValue(
      dbtRow({ status: 'analysing' }),
    );
    agentRuns.findOne.mockResolvedValue(
      posthogRow({ prNumber: 7, prState: 'merged', output: { events } }),
    );

    await service.releaseDbtIfReady('run1');
    await flush();

    expect(agentRuns.update).toHaveBeenCalledWith(
      { id: 'dbt1', status: 'waiting' },
      expect.objectContaining({ status: 'analysing' }),
    );
    expect(dbt.analyse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ events }),
    );
  });

  it('starts the analysis WITHOUT events when the PR was closed unmerged', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow(),
      posthogRow({ prNumber: 7, prState: 'closed' }),
    ]);
    agentRuns.findOneByOrFail.mockResolvedValue(
      dbtRow({ status: 'analysing' }),
    );
    agentRuns.findOne.mockResolvedValue(
      posthogRow({ prNumber: 7, prState: 'closed' }),
    );

    await service.releaseDbtIfReady('run1');
    await flush();

    expect(dbt.analyse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ events: null }),
    );
  });

  it('starts the analysis when the PostHog agent opened no PR', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([dbtRow(), posthogRow()]);
    agentRuns.findOneByOrFail.mockResolvedValue(
      dbtRow({ status: 'analysing' }),
    );
    agentRuns.findOne.mockResolvedValue(posthogRow());

    await service.releaseDbtIfReady('run1');
    await flush();

    expect(dbt.analyse).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when another caller claimed the analysis first', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([dbtRow(), posthogRow()]);
    agentRuns.update.mockResolvedValue({ affected: 0 });

    await service.releaseDbtIfReady('run1');
    await flush();

    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('does nothing for a dbt agent that is no longer waiting', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([
      dbtRow({ status: 'awaiting_approval' }),
      posthogRow(),
    ]);

    await service.releaseDbtIfReady('run1');

    expect(agentRuns.update).not.toHaveBeenCalled();
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('stops at awaiting_approval after analysis: it edits nothing before a person approves', async () => {
    const { service, agentRuns, dbt } = build();
    agentRuns.find.mockResolvedValue([dbtRow(), posthogRow()]);
    agentRuns.findOneByOrFail.mockResolvedValue(
      dbtRow({ status: 'analysing' }),
    );
    agentRuns.findOne.mockResolvedValue(posthogRow());

    await service.releaseDbtIfReady('run1');
    await flush();

    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(dbt.apply).not.toHaveBeenCalled();
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

  it('400s when there is no proposal to approve', async () => {
    const { service, agentRuns } = build();
    agentRuns.findOne.mockResolvedValue(
      dbtRow({ status: 'completed', output: {} }),
    );
    await expect(service.approve('dbt1', 1)).rejects.toBeInstanceOf(
      BadRequestException,
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
      output: {
        items: [
          {
            key: 'k',
            title: 't',
            description: 'd',
            dbtFiles: [],
            sourcePaths: [],
          },
        ],
      },
    });
    agentRuns.findOne.mockResolvedValue(row);
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
    expect(dbt.apply).toHaveBeenCalledTimes(1);
    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ status: 'pr_opened' }),
    );
  });

  it('a failed apply marks the agent failed instead of throwing out of the background task', async () => {
    const { service, agentRuns, dbt } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: { items: [{ key: 'k' }] },
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

describe('AnalyticsAutomationRunService.pollPullRequests', () => {
  it('records a merged PR, then releases the dbt agent that was waiting on it', async () => {
    const { service, agentRuns, github, dbt } = build();
    const open = posthogRow({
      prNumber: 7,
      prState: 'open',
      prRepo: 'Org/platform',
    });
    agentRuns.find.mockImplementation(
      async (opts: { where: Record<string, unknown> }) => {
        if (opts.where.prState === 'open') return [open];
        if (opts.where.agent === 'dbt_metrics') return [dbtRow()];
        // releaseDbtIfReady's read of the run's agents
        return [dbtRow(), { ...open, prState: 'merged' }];
      },
    );
    agentRuns.findOneByOrFail.mockResolvedValue(
      dbtRow({ status: 'analysing' }),
    );
    agentRuns.findOne.mockResolvedValue({ ...open, prState: 'merged' });
    github.getPullRequestState.mockResolvedValue({ state: 'merged' });

    await service.pollPullRequests();
    await flush();

    expect(github.getPullRequestState).toHaveBeenCalledWith(
      { owner: 'Org', repo: 'platform' },
      7,
    );
    expect(agentRuns.update).toHaveBeenCalledWith('ph1', { prState: 'merged' });
    expect(dbt.analyse).toHaveBeenCalledTimes(1);
  });

  it('survives GitHub failing for one PR', async () => {
    const { service, agentRuns, github } = build();
    agentRuns.find.mockImplementation(
      async (opts: { where: Record<string, unknown> }) =>
        opts.where.prState === 'open'
          ? [
              posthogRow({
                prNumber: 7,
                prState: 'open',
                prRepo: 'Org/platform',
              }),
            ]
          : [],
    );
    github.getPullRequestState.mockRejectedValue(new Error('rate limited'));

    await expect(service.pollPullRequests()).resolves.toBeUndefined();
  });
});
