import { tool } from 'langchain';
import { z } from 'zod';
import { AnalyticsAutomationGithubService } from '../analytics-automation-github.service';

// ESM-only packages jest cannot load; the service builds its client lazily, so
// they are never exercised here (the fake client is injected instead).
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
jest.mock('@langchain/mcp-adapters', () => ({
  MultiServerMCPClient: class {},
}));

const policy = {
  owner: 'Org',
  repo: 'platform',
  base: 'master',
  branchPrefix: 'automation/abcd1234/',
  allowedPrefixes: ['ally-be/src/'],
  maxFiles: 5,
  maxFileBytes: 1000,
};
const BRANCH = 'automation/abcd1234/posthog-events';

/** A fake upstream MCP tool named the way the client names them: `<server>_<tool>`. */
const upstream = (name: string, result: string) => {
  const calls: unknown[] = [];
  const t = tool(
    async (args: Record<string, unknown>) => {
      calls.push(args);
      return result;
    },
    {
      name: `githubWrite_${name}`,
      description: name,
      schema: z.object({}).passthrough(),
    },
  );
  return { tool: t, calls };
};

function build() {
  const fakes = {
    create_branch: upstream('create_branch', '{"ref":"refs/heads/x"}'),
    push_files: upstream('push_files', '{"ok":true}'),
    create_pull_request: upstream(
      'create_pull_request',
      '{"id":"1","url":"https://github.com/Org/platform/pull/42"}',
    ),
    // A tool the agent must NOT be handed, even though the server exposes it.
    merge_pull_request: upstream('merge_pull_request', '{"merged":true}'),
    delete_file: upstream('delete_file', '{}'),
  };
  const service = new AnalyticsAutomationGithubService();
  (service as unknown as { mcp: unknown }).mcp = {
    listTools: async () => Object.values(fakes).map((f) => f.tool),
  };
  return { service, fakes };
}

const run = async (
  tools: Awaited<
    ReturnType<AnalyticsAutomationGithubService['guardedWriteTools']>
  >,
  name: string,
  args: Record<string, unknown>,
) => {
  const t = tools.find((x) => x.name === `githubWrite_${name}`)!;
  return t.invoke(args as never);
};

describe('AnalyticsAutomationGithubService.guardedWriteTools', () => {
  it('hands the agent only branch, push and pull request: never merge or delete', async () => {
    const { service } = build();
    const tools = await service.guardedWriteTools(
      policy,
      async () => undefined,
    );
    expect(tools.map((t) => t.name).sort()).toEqual([
      'githubWrite_create_branch',
      'githubWrite_create_pull_request',
      'githubWrite_push_files',
    ]);
  });

  it('a refused call never reaches GitHub, and the reason comes back to the model', async () => {
    const { service, fakes } = build();
    const tools = await service.guardedWriteTools(
      policy,
      async () => undefined,
    );

    const answer = await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: 'master',
    });

    expect(answer).toMatch(
      /^Refused: .*must start with "automation\/abcd1234\/"/,
    );
    expect(fakes.create_branch.calls).toHaveLength(0);
  });

  it('refuses writing outside the allowed folders even on the right branch', async () => {
    const { service, fakes } = build();
    const tools = await service.guardedWriteTools(
      policy,
      async () => undefined,
    );
    await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });

    const answer = await run(tools, 'push_files', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
      message: 'm',
      files: [{ path: 'ally-be/src/database/migrations/1-X.ts', content: 'x' }],
    });

    expect(answer).toMatch(/^Refused: .*not a file you may change/);
    expect(fakes.push_files.calls).toHaveLength(0);
  });

  it('runs the whole happy path and reports the pull request once', async () => {
    const { service, fakes } = build();
    const opened: { number: number; url: string }[] = [];
    const tools = await service.guardedWriteTools(policy, async (pr) => {
      opened.push(pr);
    });

    await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });
    await run(tools, 'push_files', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
      message: 'm',
      files: [{ path: 'ally-be/src/a.ts', content: 'x' }],
    });
    await run(tools, 'create_pull_request', {
      owner: 'Org',
      repo: 'platform',
      head: BRANCH,
      base: 'master',
      title: 't',
      body: 'b',
    });

    expect(fakes.create_branch.calls).toHaveLength(1);
    expect(fakes.push_files.calls).toHaveLength(1);
    expect(fakes.create_pull_request.calls).toHaveLength(1);
    expect(opened).toEqual([
      { number: 42, url: 'https://github.com/Org/platform/pull/42' },
    ]);

    // A second pull request is refused, and does not report another.
    const again = await run(tools, 'create_pull_request', {
      owner: 'Org',
      repo: 'platform',
      head: BRANCH,
      base: 'master',
      title: 't',
      body: 'b',
    });
    expect(again).toMatch(/already opened/);
    expect(fakes.create_pull_request.calls).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it('keeps separate state per call, so one run’s branch does not unlock another’s', async () => {
    const { service } = build();
    const first = await service.guardedWriteTools(
      policy,
      async () => undefined,
    );
    const second = await service.guardedWriteTools(
      policy,
      async () => undefined,
    );
    await run(first, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });

    const answer = await run(second, 'push_files', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
      message: 'm',
      files: [{ path: 'ally-be/src/a.ts', content: 'x' }],
    });
    expect(answer).toMatch(/create the branch/);
  });
});

describe('AnalyticsAutomationGithubService.readTools', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      AUTOMATION_PLATFORM_REPO: 'Org/platform',
      AUTOMATION_PLATFORM_BASE_BRANCH: 'test/branch',
      AUTOMATION_DBT_REPO: 'Org/dbt',
      AUTOMATION_DBT_BASE_BRANCH: 'dbt-test',
    };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  function buildRead() {
    const calls: Record<string, unknown>[] = [];
    const files = tool(
      async (args: Record<string, unknown>) => {
        calls.push(args);
        return 'file';
      },
      {
        name: 'githubRead_get_file_contents',
        description: 'files',
        schema: z.object({}).passthrough(),
      },
    );
    const other = tool(async () => 'x', {
      name: 'githubRead_list_commits',
      description: 'commits',
      schema: z.object({}).passthrough(),
    });
    const service = new AnalyticsAutomationGithubService();
    (service as unknown as { mcp: unknown }).mcp = {
      listTools: async () => [files, other],
    };
    return { service, calls };
  }

  const read = async (
    service: AnalyticsAutomationGithubService,
    args: Record<string, unknown>,
  ) => {
    const tools = await service.readTools();
    await tools
      .find((t) => t.name === 'githubRead_get_file_contents')!
      .invoke(args as never);
  };

  it('reads on the configured base branch of each repo when no ref is given', async () => {
    const { service, calls } = buildRead();
    await read(service, { owner: 'Org', repo: 'platform', path: 'a.ts' });
    await read(service, { owner: 'Org', repo: 'dbt', path: 'm.sql' });
    expect(calls[0].ref).toBe('refs/heads/test/branch');
    expect(calls[1].ref).toBe('refs/heads/dbt-test');
  });

  it('keeps a ref or sha the model names, and leaves other repos alone', async () => {
    const { service, calls } = buildRead();
    await read(service, {
      owner: 'Org',
      repo: 'platform',
      path: 'a.ts',
      ref: 'refs/heads/automation/x/y',
    });
    await read(service, { owner: 'Org', repo: 'platform', sha: 'abc1234' });
    await read(service, { owner: 'Other', repo: 'repo', path: 'a' });
    expect(calls[0].ref).toBe('refs/heads/automation/x/y');
    expect(calls[1].ref).toBeUndefined();
    expect(calls[2].ref).toBeUndefined();
  });

  it('passes every other read tool through untouched', async () => {
    const { service } = buildRead();
    const tools = await service.readTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'githubRead_get_file_contents',
      'githubRead_list_commits',
    ]);
  });
});
