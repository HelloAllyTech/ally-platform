import { tool } from 'langchain';
import { z } from 'zod';
import { newWriteState } from '../../util/analytics-automation-write-guard.util';
import {
  AnalyticsAutomationGithubService,
  flattenToolText,
  parseLabelNames,
} from '../analytics-automation-github.service';

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
    // What the server itself calls on the write server (opening the pull request).
    getClient: async () => ({
      callTool: async ({
        name,
        arguments: args,
      }: {
        name: string;
        arguments: Record<string, unknown>;
      }) => {
        const fake = fakes[name as keyof typeof fakes];
        return {
          content: [
            { type: 'text', text: await fake.tool.invoke(args as never) },
          ],
        };
      },
    }),
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

const AUTHOR = ['create_branch', 'push_files'] as const;
const writeFile = (branch = BRANCH) => ({
  owner: 'Org',
  repo: 'platform',
  branch,
  message: 'm',
  files: [{ path: 'ally-be/src/a.ts', content: 'x' }],
});
const prArgs = {
  head: BRANCH,
  title: 't',
  body: 'b',
};

describe('AnalyticsAutomationGithubService.guardedWriteTools', () => {
  it('hands a model only branch and push: never a pull request, merge or delete', async () => {
    const { service } = build();
    const tools = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
    );
    expect(tools.map((t) => t.name).sort()).toEqual([
      'githubWrite_create_branch',
      'githubWrite_push_files',
    ]);
  });

  it('gives the reviewer push only, so it cannot create branches', async () => {
    const { service } = build();
    const tools = await service.guardedWriteTools(policy, newWriteState(), [
      'push_files',
    ]);
    expect(tools.map((t) => t.name)).toEqual(['githubWrite_push_files']);
  });

  it('a refused call never reaches GitHub, and the reason comes back to the model', async () => {
    const { service, fakes } = build();
    const tools = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
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

  it('branches from the configured base when the model names no from_branch', async () => {
    const { service, fakes } = build();
    const tools = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
    );
    await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });
    expect(fakes.create_branch.calls[0]).toMatchObject({
      branch: BRANCH,
      from_branch: policy.base,
    });
  });

  it('refuses writing outside the allowed folders even on the right branch', async () => {
    const { service, fakes } = build();
    const tools = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
    );
    await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });

    const answer = await run(tools, 'push_files', {
      ...writeFile(),
      files: [{ path: 'ally-be/src/database/migrations/1-X.ts', content: 'x' }],
    });

    expect(answer).toMatch(/^Refused: .*not a file you may change/);
    expect(fakes.push_files.calls).toHaveLength(0);
  });

  it('keeps separate state per run, so one run’s branch does not unlock another’s', async () => {
    const { service } = build();
    const first = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
    );
    const second = await service.guardedWriteTools(
      policy,
      newWriteState(),
      AUTHOR,
    );
    await run(first, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });

    const answer = await run(second, 'push_files', writeFile());
    expect(answer).toMatch(/create the branch/);
  });

  it('lets the reviewer push to the author’s branch because they share one state', async () => {
    const { service, fakes } = build();
    const state = newWriteState();
    const author = await service.guardedWriteTools(policy, state, AUTHOR);
    const reviewer = await service.guardedWriteTools(policy, state, [
      'push_files',
    ]);
    await run(author, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });
    await run(author, 'push_files', writeFile());

    const fix = await run(reviewer, 'push_files', writeFile());
    expect(fix).not.toMatch(/^Refused/);
    expect(fakes.push_files.calls).toHaveLength(2);

    // ...but not to any other branch, nor to the base.
    const elsewhere = await run(
      reviewer,
      'push_files',
      writeFile('automation/abcd1234/other'),
    );
    expect(elsewhere).toMatch(/^Refused: .*create the branch/);
    const onBase = await run(reviewer, 'push_files', writeFile('master'));
    expect(onBase).toMatch(/^Refused: .*never to "master"/);
  });
});

describe('AnalyticsAutomationGithubService.openPullRequest', () => {
  it('opens the pull request once, after the branch and files are written', async () => {
    const { service, fakes } = build();
    const state = newWriteState();
    const tools = await service.guardedWriteTools(policy, state, AUTHOR);
    await run(tools, 'create_branch', {
      owner: 'Org',
      repo: 'platform',
      branch: BRANCH,
    });
    await run(tools, 'push_files', writeFile());

    const pr = await service.openPullRequest(policy, state, prArgs);

    expect(pr).toEqual({
      number: 42,
      url: 'https://github.com/Org/platform/pull/42',
    });
    expect(fakes.create_pull_request.calls).toEqual([
      {
        owner: 'Org',
        repo: 'platform',
        head: BRANCH,
        base: 'master',
        title: 't',
        body: 'b',
      },
    ]);
    await expect(
      service.openPullRequest(policy, state, prArgs),
    ).rejects.toThrow(/already opened/);
    expect(fakes.create_pull_request.calls).toHaveLength(1);
  });

  it('refuses when nothing was written, and never reaches GitHub', async () => {
    const { service, fakes } = build();
    await expect(
      service.openPullRequest(policy, newWriteState(), prArgs),
    ).rejects.toThrow(/Pull request not opened/);
    expect(fakes.create_pull_request.calls).toHaveLength(0);
  });

  it('refuses a head outside the run’s branch prefix', async () => {
    const { service, fakes } = build();
    const state = newWriteState();
    state.branches.add('feature/x');
    state.files.add('ally-be/src/a.ts');
    await expect(
      service.openPullRequest(policy, state, { ...prArgs, head: 'feature/x' }),
    ).rejects.toThrow(/head must be your branch/);
    expect(fakes.create_pull_request.calls).toHaveLength(0);
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

describe('flattenToolText', () => {
  it('keeps the file text that get_file_contents sends as a resource block', () => {
    expect(
      flattenToolText([
        { type: 'text', text: 'successfully downloaded text file (SHA: abc)' },
        {
          type: 'text',
          text: 'version: 2\nsources: []',
          metadata: { uri: 'x' },
        },
      ]),
    ).toBe(
      'successfully downloaded text file (SHA: abc)\n\nversion: 2\nsources: []',
    );
    expect(flattenToolText('plain')).toBe('plain');
  });
});

describe('parseLabelNames', () => {
  it('reads a list of labels, of names, or an object holding one', () => {
    expect(parseLabelNames('[{"name":"a"},{"name":"b"}]')).toEqual(['a', 'b']);
    expect(parseLabelNames('{"labels":["a"]}')).toEqual(['a']);
    expect(parseLabelNames('not json')).toBeNull();
  });
});
