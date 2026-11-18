import { AnalyticsAutomationDbtAgent } from '../analytics-automation-dbt.agent';
import { runStructuredAgent } from '../analytics-automation-agent.base';
import { AUTOMATION_LIMITS } from '../../constants/analytics-automation.constants';
import { newWriteState } from '../../util/analytics-automation-write-guard.util';

// LangChain and the GitHub MCP client are not exercised here.
jest.mock('../analytics-automation-agent.base', () => ({
  runStructuredAgent: jest.fn(),
  describePlatformPeriod: () => '',
}));
jest.mock('../analytics-automation-github.service', () => ({
  AnalyticsAutomationGithubService: class {},
}));
jest.mock('../analytics-automation-pr-review.agent', () => ({
  AnalyticsAutomationPrReviewAgent: class {},
  renderReview: () => '',
}));

const MAX = AUTOMATION_LIMITS.CI_MAX_FIX_ATTEMPTS;
const run = (
  name: string,
  status: string,
  conclusion: string | null = null,
) => ({
  id: 7,
  name,
  status,
  conclusion,
  url: 'https://github.com/o/r/actions/runs/1/job/7',
});
const green = [run('dbt test', 'completed', 'success')];
const red = [run('dbt test', 'completed', 'failure')];

function build() {
  const github = {
    getCheckRuns: jest.fn(),
    getPullRequestHead: jest.fn(),
    getPullRequestState: jest.fn().mockResolvedValue({ state: 'open' }),
    getBranchHead: jest.fn(),
    commentOnPullRequest: jest.fn().mockResolvedValue(undefined),
    guardedWriteTools: jest.fn().mockResolvedValue([]),
    readTools: jest.fn().mockResolvedValue([]),
  };
  const agent = new AnalyticsAutomationDbtAgent(github as never, {} as never);
  jest.spyOn(agent as never, 'pause').mockResolvedValue(undefined as never);
  const sink = {
    savePullRequest: jest.fn(),
    saveReview: jest.fn(),
    saveCi: jest.fn().mockResolvedValue(undefined),
  };
  const ensureCi = () =>
    (
      agent as unknown as {
        ensureCi(input: unknown): Promise<{
          state: string;
          attempts: number;
          message: string;
          failedChecks: string[];
        }>;
      }
    ).ensureCi({
      ctx: {
        runId: 'run12345-0000',
        platform: { owner: 'O', repo: 'platform', base: 'master' },
        dbt: { owner: 'O', repo: 'dbt', base: 'main' },
        shas: {},
      },
      policy: {},
      state: newWriteState(),
      branch: 'automation/run12345/dbt-changes',
      pr: { number: 5, url: 'https://github.com/O/dbt/pull/5' },
      sink,
      intent: 'the approved changes',
    });
  return { github, sink, ensureCi };
}

const fixer = runStructuredAgent as unknown as jest.Mock;

describe('AnalyticsAutomationDbtAgent CI watching', () => {
  beforeEach(() => fixer.mockReset());

  it('is done at once when CI is green, and fixes nothing', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue(green);

    const result = await ensureCi();

    expect(result).toMatchObject({ state: 'green', attempts: 0 });
    expect(fixer).not.toHaveBeenCalled();
    expect(github.commentOnPullRequest).not.toHaveBeenCalled();
  });

  it('waits while checks are running and then reports the result', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns
      .mockResolvedValueOnce([run('dbt test', 'in_progress')])
      .mockResolvedValueOnce([run('dbt test', 'queued')])
      .mockResolvedValueOnce(green);

    expect((await ensureCi()).state).toBe('green');
    expect(github.getCheckRuns).toHaveBeenCalledTimes(3);
  });

  it('on a red CI: fixes the SAME branch, waits for the new commit, then reports green', async () => {
    const { github, sink, ensureCi } = build();
    github.getCheckRuns
      .mockResolvedValueOnce(red)
      // After the fix: the PR still points at the old commit for a moment, and
      // the old (red) result must not be read as the answer for the new one.
      .mockResolvedValueOnce(green);
    github.getBranchHead
      .mockResolvedValueOnce('aaaaaaa1')
      .mockResolvedValueOnce('bbbbbbb2');
    github.getPullRequestHead
      .mockResolvedValueOnce('aaaaaaa1')
      .mockResolvedValueOnce('bbbbbbb2');
    fixer.mockResolvedValue({
      fixable: true,
      summary: 'Fixed the column name',
      reason: '',
    });

    const result = await ensureCi();

    expect(result).toMatchObject({ state: 'green', attempts: 1 });
    expect(fixer).toHaveBeenCalledTimes(1);
    // The fixer is told which checks failed, by id, for get_job_logs.
    expect(fixer.mock.calls[0][0].input).toContain('id 7: dbt test (failure)');
    expect(fixer.mock.calls[0][0].input).toContain(
      'automation/run12345/dbt-changes',
    );
    // Only the push-only write tool is handed out.
    expect(github.guardedWriteTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['push_files'],
    );
    // CI was read for the old commit only until the PR pointed at the new one.
    expect(github.getCheckRuns).toHaveBeenCalledTimes(2);
    expect(github.commentOnPullRequest).toHaveBeenCalledWith(
      { owner: 'O', repo: 'dbt' },
      5,
      expect.stringContaining('Fix 1 of'),
    );
    expect(sink.saveCi).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'fixing', attempts: 1 }),
    );
  });

  it(`gives up after ${MAX} fix attempts and says CI is still failing`, async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue(red);
    // Every read of the branch is a new commit, so each fix "pushes" something,
    // and the PR points at the latest one.
    let heads = 0;
    github.getBranchHead.mockImplementation(async () => `sha${heads++}000000`);
    github.getPullRequestHead.mockImplementation(
      async () => `sha${heads - 1}000000`,
    );
    fixer.mockResolvedValue({ fixable: true, summary: 'tried', reason: '' });

    const result = await ensureCi();

    expect(result).toMatchObject({ state: 'failed', attempts: MAX });
    expect(result.failedChecks).toEqual(['dbt test']);
    expect(fixer).toHaveBeenCalledTimes(MAX);
  });

  it('stops at once, with the reason, when the fixer changes nothing (e.g. not its failure)', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue(red);
    github.getBranchHead.mockResolvedValue('same0000');
    fixer.mockResolvedValue({
      fixable: false,
      summary: '',
      reason: 'The base branch fails the same test',
    });

    const result = await ensureCi();

    expect(result.state).toBe('failed');
    expect(result.message).toContain('The base branch fails the same test');
    expect(fixer).toHaveBeenCalledTimes(1);
    expect(github.commentOnPullRequest).toHaveBeenCalled();
  });

  it('does not push to a pull request that was merged or closed meanwhile', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue(red);
    github.getPullRequestState.mockResolvedValue({ state: 'merged' });

    expect((await ensureCi()).state).toBe('stopped');
    expect(fixer).not.toHaveBeenCalled();
  });

  it('says there is no CI only after a long silence, not at the first empty answer', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue([]);

    const result = await ensureCi();

    expect(result.state).toBe('none');
    expect(github.getCheckRuns.mock.calls.length).toBeGreaterThan(1);
  });

  it('times out, saying what is still running, when CI never finishes', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockResolvedValue([run('dbt test', 'in_progress')]);

    const result = await ensureCi();

    expect(result.state).toBe('timeout');
    expect(result.message).toContain('dbt test');
  });

  it('reports unreadable instead of throwing when GitHub cannot be asked, and never calls it "green"', async () => {
    const { github, ensureCi } = build();
    github.getCheckRuns.mockRejectedValue(
      new Error('Resource not accessible by integration'),
    );

    const result = await ensureCi();

    expect(result.state).toBe('unreadable');
    expect(result.message).toContain('Resource not accessible');
    expect(fixer).not.toHaveBeenCalled();
  });
});

describe('AnalyticsAutomationDbtAgent dbt-build label', () => {
  const ctx = {
    runId: 'run12345-0000',
    platform: { owner: 'O', repo: 'platform', base: 'master' },
    dbt: { owner: 'O', repo: 'dbt', base: 'main' },
    shas: {},
  };
  const item = {
    key: 'column:x.y',
    kind: 'new_column' as const,
    title: 't',
    description: 'd',
    steps: [],
    dbtFiles: [],
    sourcePaths: [],
    dependsOnPosthog: false,
  };

  /** The author "writes" `files` to its branch; review approves; CI is green. */
  function setup(files: string[], needsBuild: boolean) {
    const github = {
      readTools: jest.fn().mockResolvedValue([]),
      guardedWriteTools: jest.fn(),
      openPullRequest: jest
        .fn()
        .mockResolvedValue({
          number: 9,
          url: 'https://github.com/O/dbt/pull/9',
        }),
      addPullRequestLabel: jest.fn().mockResolvedValue(undefined),
      getCheckRuns: jest.fn().mockResolvedValue(green),
      commentOnPullRequest: jest.fn().mockResolvedValue(undefined),
    };
    let state: { branches: Set<string>; files: Set<string> } | undefined;
    github.guardedWriteTools.mockImplementation(async (_p, s) => {
      state = s;
      return [];
    });
    const reviewer = {
      review: jest.fn().mockResolvedValue({
        verdict: 'approve',
        summary: 's',
        fixed: [],
        remaining: [],
      }),
    };
    const agent = new AnalyticsAutomationDbtAgent(
      github as never,
      reviewer as never,
    );
    jest.spyOn(agent as never, 'pause').mockResolvedValue(undefined as never);
    fixer.mockReset().mockImplementation(async () => {
      state!.branches.add('automation/run12345/dbt-changes');
      files.forEach((f) => state!.files.add(f));
      return {
        summary: 'done',
        prTitle: 'dbt: add y',
        skipped: [],
        needsBuild,
        buildReason: needsBuild ? 'model SQL changed' : 'docs only',
      };
    });
    const sink = {
      savePullRequest: jest.fn(),
      saveReview: jest.fn(),
      saveCi: jest.fn().mockResolvedValue(undefined),
    };
    return { github, run: () => agent.apply(ctx as never, [item], sink) };
  }

  it('labels the pull request dbt-build when a model SQL changed, even if the author says no', async () => {
    const { github, run } = setup(['models/staging/stg_x.sql'], false);
    const result = await run();
    expect(github.addPullRequestLabel).toHaveBeenCalledWith(
      { owner: 'O', repo: 'dbt' },
      9,
      'dbt-build',
      { fresh: true },
    );
    expect(result.summary).toContain('labelled `dbt-build`');
  });

  it('labels it when the author says a yml config change needs a build', async () => {
    const { github, run } = setup(['models/staging/stg_x.yml'], true);
    await run();
    expect(github.addPullRequestLabel).toHaveBeenCalledTimes(1);
  });

  it('does not label a docs-only change', async () => {
    const { github, run } = setup(['models/staging/stg_x.yml'], false);
    const result = await run();
    expect(github.addPullRequestLabel).not.toHaveBeenCalled();
    expect(result.summary).toContain('not needed');
  });

  it('asks a person to add the label when GitHub refuses it, and still finishes', async () => {
    const { github, run } = setup(['seeds/posthog_event_catalog.csv'], true);
    github.addPullRequestLabel.mockRejectedValue(new Error('403'));
    const result = await run();
    expect(result.pr).toMatchObject({ number: 9 });
    expect(github.commentOnPullRequest).toHaveBeenCalledWith(
      { owner: 'O', repo: 'dbt' },
      9,
      expect.stringContaining('dbt-build'),
    );
    expect(result.summary).toContain('Add it by hand');
  });
});
