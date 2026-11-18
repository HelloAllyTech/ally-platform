import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AUTOMATION_LIMITS } from '../../constants/analytics-automation.constants';
import { AnalyticsAutomationRunService } from '../analytics-automation-run.service';

// The agents and GitHub pull in LangChain and the MCP client; none of it is
// exercised here, so the real classes are never loaded.
jest.mock('../analytics-automation-posthog.agent', () => ({
  AnalyticsAutomationPosthogAgent: class {},
}));
jest.mock('../analytics-automation-dbt.agent', () => ({
  AnalyticsAutomationDbtAgent: class {},
  // The real rule, kept in step with the agent file: a PostHog-dependent item
  // applies only when the PostHog events were merged.
  itemApplies: (item: { dependsOnPosthog: boolean }, withEvents: boolean) =>
    withEvents || !item.dependsOnPosthog,
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
    dbt as never,
  );
  return { service, runs, agentRuns, findings, github, dbt };
}

const dbtRow = (over: object = {}) => ({
  id: 'dbt1',
  runId: 'run1',
  agent: 'dbt_metrics',
  status: 'analysing',
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

/** What the analysis stores on the dbt row: definition changes and a plan. */
const planOutput = () => ({
  definitionChanges: [
    {
      area: 'database',
      title: 'New column',
      description: 'd',
      sourcePaths: [],
      affectsDbt: true,
    },
  ],
  items: [
    {
      key: 'column:a.b',
      kind: 'new_column',
      steps: [],
      dependsOnPosthog: false,
    },
    { key: 'event:e', kind: 'new_event', steps: [], dependsOnPosthog: true },
  ],
  withEvents: null,
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
      { id: 'dbt1', status: 'analysing' },
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
      { id: 'dbt1', status: 'analysing' },
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
      { id: 'dbt1', status: 'analysing' },
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
      { id: 'dbt1', status: 'analysing' },
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
    expect(dbt.analyse).not.toHaveBeenCalled();
  });

  it('does nothing for a dbt agent that is not analysing', async () => {
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
      output: planOutput(),
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
    // The plan was made before approval: approving only applies it.
    expect(dbt.analyse).not.toHaveBeenCalled();
    expect(dbt.apply).toHaveBeenCalledTimes(1);
    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ status: 'pr_opened' }),
    );
  });

  it('applies the whole plan, events included, when the PostHog PR was merged', async () => {
    const { service, agentRuns, github, dbt } = build();
    const row = dbtRow({ status: 'awaiting_approval', output: planOutput() });
    agentRuns.findOne.mockImplementation(
      findOneRows([
        row,
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    agentRuns.findOneByOrFail.mockResolvedValue({
      ...row,
      output: { ...planOutput(), withEvents: true },
    });
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    github.getPullRequestState.mockResolvedValue({ state: 'merged' });
    dbt.apply.mockResolvedValue({
      summary: 's',
      pr: { number: 3, url: 'u' },
      skipped: [],
    });

    await service.approve('dbt1', 1);
    await flush();

    // The stored plan is kept, with the decision added next to it.
    expect(agentRuns.update).toHaveBeenCalledWith('dbt1', {
      output: expect.objectContaining({
        withEvents: true,
        definitionChanges: [expect.objectContaining({ title: 'New column' })],
      }),
    });
    expect(
      dbt.apply.mock.calls[0][1].map((i: { key: string }) => i.key),
    ).toEqual(['column:a.b', 'event:e']);
  });

  it('leaves the PostHog-dependent items out when the PostHog PR was closed, and says so on them', async () => {
    const { service, agentRuns, findings, github, dbt } = build();
    const row = dbtRow({ status: 'awaiting_approval', output: planOutput() });
    agentRuns.findOne.mockImplementation(
      findOneRows([
        row,
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    agentRuns.findOneByOrFail.mockResolvedValue({
      ...row,
      output: { ...planOutput(), withEvents: false },
    });
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    github.getPullRequestState.mockResolvedValue({ state: 'closed' });
    findings.find.mockResolvedValue([
      { id: 'f1', payload: { key: 'column:a.b' } },
      { id: 'f2', payload: { key: 'event:e' } },
    ]);
    dbt.apply.mockResolvedValue({
      summary: 's',
      pr: { number: 3, url: 'u' },
      skipped: [],
    });

    await service.approve('dbt1', 1);
    await flush();

    expect(
      dbt.apply.mock.calls[0][1].map((i: { key: string }) => i.key),
    ).toEqual(['column:a.b']);
    expect(findings.update).toHaveBeenCalledWith('f1', { status: 'included' });
    expect(findings.update).toHaveBeenCalledWith('f2', {
      status: 'dropped',
      detail: expect.stringContaining('not merged'),
    });
  });

  it('completes without a PR when only PostHog-dependent items were planned and their PR was closed', async () => {
    const { service, agentRuns, findings, github, dbt } = build();
    const eventsOnly = {
      ...planOutput(),
      items: planOutput().items.filter((i) => i.dependsOnPosthog),
    };
    const row = dbtRow({ status: 'awaiting_approval', output: eventsOnly });
    agentRuns.findOne.mockImplementation(
      findOneRows([
        row,
        posthogRow({ prNumber: 7, prState: 'open', prRepo: 'Org/platform' }),
      ]),
    );
    agentRuns.findOneByOrFail.mockResolvedValue({
      ...row,
      output: { ...eventsOnly, withEvents: false },
    });
    agentRuns.createQueryBuilder.mockReturnValue(queryBuilder(1));
    github.getPullRequestState.mockResolvedValue({ state: 'closed' });
    findings.find.mockResolvedValue([
      { id: 'f2', payload: { key: 'event:e' } },
    ]);

    await service.approve('dbt1', 1);
    await flush();

    expect(dbt.apply).not.toHaveBeenCalled();
    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({
        status: 'completed',
        summary: expect.stringContaining('Nothing to change in dbt'),
      }),
    );
  });

  it('a failed apply marks the agent failed instead of throwing out of the background task', async () => {
    const { service, agentRuns, dbt } = build();
    const row = dbtRow({
      status: 'awaiting_approval',
      output: planOutput(),
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
      output: { withEvents: false, applyAttempts: 1 },
    });
    expect(dbt.analyse).not.toHaveBeenCalled();
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

describe('AnalyticsAutomationRunService CI progress', () => {
  const sinkOf = (service: unknown) =>
    (
      service as {
        sinkFor(id: string): {
          saveCi(ci: {
            state: string;
            attempts: number;
            message: string;
            failedChecks: string[];
          }): Promise<void>;
        };
      }
    ).sinkFor('dbt1');

  it('saves CI next to the plan instead of replacing it, and shows it as the note while working', async () => {
    const { service, agentRuns } = build();
    agentRuns.findOneByOrFail.mockResolvedValue({
      output: { items: [{ key: 'k' }], definitionChanges: [] },
    });

    await sinkOf(service).saveCi({
      state: 'fixing',
      attempts: 1,
      message: 'CI failed. Working on a fix.',
      failedChecks: ['dbt test'],
    });

    expect(agentRuns.update).toHaveBeenCalledWith('dbt1', {
      output: {
        items: [{ key: 'k' }],
        definitionChanges: [],
        ci: expect.objectContaining({ state: 'fixing', attempts: 1 }),
      },
      note: 'CI failed. Working on a fix.',
    });
  });

  it('clears the note once CI has an outcome', async () => {
    const { service, agentRuns } = build();
    agentRuns.findOneByOrFail.mockResolvedValue({ output: {} });

    await sinkOf(service).saveCi({
      state: 'green',
      attempts: 0,
      message: 'All checks passed.',
      failedChecks: [],
    });

    expect(agentRuns.update).toHaveBeenCalledWith(
      'dbt1',
      expect.objectContaining({ note: null }),
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
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(
        async (opts: { where: { runId: string } }) =>
          agentsOf[opts.where.runId] ??
          // The run just created: hand back the agent rows saved for it.
          created
            .filter((c) => c.agent)
            .map((c, i) => ({ ...c, id: `agent-${i}` })),
      ),
    };
    const findings = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      save: jest.fn(),
      create: jest.fn((x) => x),
    };
    const github = { getBranchHead: jest.fn().mockResolvedValue('head-now') };
    const posthog = { run: jest.fn() };
    const dbt = { analyse: jest.fn() };
    const service = new AnalyticsAutomationRunService(
      runs as never,
      agentRuns as never,
      findings as never,
      github as never,
      posthog as never,
      dbt as never,
    );
    return { service, created, posthog, dbt, agentRuns, findings };
  }

  const finished = [
    { agent: 'posthog_events', status: 'completed' },
    { agent: 'dbt_metrics', status: 'awaiting_approval' },
  ];

  it('records a completed run with no agent work when the head has not moved', async () => {
    const { service, created, posthog, dbt } = startBuild(
      [settled('prev', 'head-now')],
      { prev: finished },
    );

    const started = await service.startManualRun();
    await started.done;

    expect(started.run.status).toBe('completed');
    const agents = created.filter((c) => c.agent);
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.agent)).toEqual([
      'posthog_events',
      'dbt_metrics',
    ]);
    for (const a of agents) {
      expect(a.status).toBe('completed');
      expect(a.summary).toMatch(/No new commits since the last run/);
    }
    expect(posthog.run).not.toHaveBeenCalled();
    expect(dbt.analyse).not.toHaveBeenCalled();
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
    const { service, posthog } = startBuild(
      [settled('failed-run', 'head-now')],
      {
        'failed-run': [
          { agent: 'posthog_events', status: 'failed' },
          { agent: 'dbt_metrics', status: 'awaiting_approval' },
        ],
      },
    );
    const started = await service.startManualRun();
    await started.done;
    expect(started.run.status).toBe('running');
    expect(posthog.run).toHaveBeenCalled();
  });

  it('after the PostHog agent, analyses dbt BEFORE any approval and offers the plan', async () => {
    const { service, posthog, dbt, agentRuns, findings } = startBuild(
      [settled('prev', 'old-head')],
      { prev: finished },
    );
    const event = { name: 'lesson_completed', properties: [], rationale: 'r' };
    posthog.run.mockResolvedValue({
      summary: 'PR opened',
      output: { events: [event] },
      findings: [],
    });
    agentRuns.update.mockResolvedValue({ affected: 1 });
    agentRuns.findOne.mockResolvedValue({
      prNumber: 7,
      prUrl: 'u',
      prState: 'open',
      output: { events: [event] },
    });
    const items = [
      {
        key: 'event:lesson_completed',
        kind: 'new_event',
        dependsOnPosthog: true,
      },
    ];
    dbt.analyse.mockResolvedValue({
      summary: 'Plan',
      needsChanges: true,
      definitionChanges: [{ title: 'New column' }],
      items,
      findings: [{ title: 'x' }],
    });

    const started = await service.startManualRun();
    await started.done;

    // The analysis is told what the PostHog agent proposed and the state of its PR.
    expect(dbt.analyse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        events: [event],
        posthogPr: { number: 7, url: 'u', state: 'open' },
      }),
    );
    expect(findings.save).toHaveBeenCalled();
    expect(agentRuns.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'analysing' }),
    );
    expect(agentRuns.update).toHaveBeenCalledWith(expect.any(String), {
      summary: 'Plan',
      output: expect.objectContaining({
        definitionChanges: [{ title: 'New column' }],
        items,
      }),
    });
  });

  it('records the dbt analysis as failed, and still closes the run, when it throws', async () => {
    const { service, posthog, dbt, agentRuns } = startBuild(
      [settled('prev', 'old-head')],
      { prev: finished },
    );
    posthog.run.mockResolvedValue({ summary: 's', output: {}, findings: [] });
    agentRuns.update.mockResolvedValue({ affected: 1 });
    agentRuns.findOne.mockResolvedValue(null);
    dbt.analyse.mockRejectedValue(new Error('model down'));

    const started = await service.startManualRun();
    await started.done;

    expect(agentRuns.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', note: 'model down' }),
    );
  });

  it('stamps the waiting dbt row with startedAt, so the stale check never reads the zone-less createdAt', async () => {
    const { service, created } = startBuild([settled('prev', 'old-head')], {
      prev: finished,
    });
    const started = await service.startManualRun();
    await started.done;
    const dbtRowCreated = created.find((c) => c.agent === 'dbt_metrics');
    expect(dbtRowCreated?.status).toBe('waiting');
    expect(dbtRowCreated?.startedAt).toBeInstanceOf(Date);
  });

  it('only fails agent rows by startedAt, and includes waiting ones', async () => {
    const { service, agentRuns } = build();
    (service as unknown as { runs: { update: jest.Mock } }).runs.update = jest
      .fn()
      .mockResolvedValue({ affected: 0 });
    await (service as unknown as { failStale(): Promise<void> }).failStale();
    for (const [where] of agentRuns.update.mock.calls) {
      expect(Object.keys(where)).not.toContain('createdAt');
    }
    const states = agentRuns.update.mock.calls[0][0].status._value;
    expect(states).toEqual(['waiting', 'running', 'analysing']);
    // `applying` includes the wait for CI and its fix attempts, so it is failed
    // later than the others.
    const applying = agentRuns.update.mock.calls.find(
      ([where]: [{ status: unknown }]) => where.status === 'applying',
    );
    expect(applying).toBeDefined();
    const cutoff = (applying![0] as { startedAt: { _value: Date } }).startedAt
      ._value;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(
      AUTOMATION_LIMITS.STALE_AGENT_MS,
    );
  });

  it('does not treat a run whose dbt analysis failed as the baseline', async () => {
    const { service, posthog } = startBuild(
      [settled('failed-run', 'head-now')],
      {
        'failed-run': [
          { agent: 'posthog_events', status: 'completed' },
          { agent: 'dbt_metrics', status: 'failed', decision: null },
        ],
      },
    );
    const started = await service.startManualRun();
    await started.done;
    expect(started.run.status).toBe('running');
    expect(posthog.run).toHaveBeenCalled();
  });

  it('still treats a run whose dbt agent failed AFTER approval as the baseline', async () => {
    const { service, posthog } = startBuild([settled('prev', 'head-now')], {
      prev: [
        { agent: 'posthog_events', status: 'completed' },
        { agent: 'dbt_metrics', status: 'failed', decision: 'approved' },
      ],
    });
    const started = await service.startManualRun();
    await started.done;
    expect(started.run.status).toBe('completed');
    expect(posthog.run).not.toHaveBeenCalled();
  });
});
