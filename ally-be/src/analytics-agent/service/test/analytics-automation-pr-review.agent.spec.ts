import { newWriteState } from '../../util/analytics-automation-write-guard.util';
import type { AnalyticsAutomationGithubService } from '../analytics-automation-github.service';
import { AnalyticsAutomationPrReviewAgent } from '../analytics-automation-pr-review.agent';
import { runStructuredAgent } from '../analytics-automation-agent.base';

// The real GitHub service pulls in ESM-only Octokit packages Jest cannot parse.
jest.mock('../analytics-automation-github.service', () => ({
  AnalyticsAutomationGithubService: class {},
}));
jest.mock('../analytics-automation-agent.base', () => ({
  ...jest.requireActual('../analytics-automation-agent.base'),
  runStructuredAgent: jest.fn(),
}));

describe('AnalyticsAutomationPrReviewAgent', () => {
  const policy = {
    owner: 'Org',
    repo: 'platform',
    base: 'main',
    branchPrefix: 'automation/abcd1234/',
    allowedPrefixes: ['ally-be/src/'],
    maxFiles: 12,
    maxFileBytes: 200_000,
  };
  const github = {
    readTools: jest.fn().mockResolvedValue([]),
    guardedWriteTools: jest.fn().mockResolvedValue([]),
  } as unknown as AnalyticsAutomationGithubService;

  const run = async (contents: Record<string, string>) => {
    const spy = runStructuredAgent as jest.Mock;
    spy.mockResolvedValue({
      verdict: 'approve',
      summary: 's',
      fixed: [],
      remaining: [],
    });
    const state = newWriteState();
    for (const [path, text] of Object.entries(contents)) {
      state.files.add(path);
      state.contents.set(path, text);
    }
    await new AnalyticsAutomationPrReviewAgent(github).review({
      kind: 'posthog',
      policy,
      state,
      branch: 'automation/abcd1234/posthog-events',
      intent: 'Add an event',
    });
    return spy.mock.calls[0][0].input as string;
  };

  beforeEach(() => jest.clearAllMocks());

  it('hands the reviewer the complete text of the files the author pushed', async () => {
    const input = await run({
      'ally-be/src/a.service.ts': 'export const a = 1;\nexport const b = 2;',
    });
    expect(input).toContain('<file path="ally-be/src/a.service.ts">');
    expect(input).toContain('export const a = 1;\nexport const b = 2;');
  });

  it('leaves a file that is too large to the GitHub tool instead of inlining it', async () => {
    const input = await run({
      'ally-be/src/big.ts': 'x'.repeat(61_000),
      'ally-be/src/small.ts': 'ok',
    });
    expect(input).not.toContain('<file path="ally-be/src/big.ts">');
    expect(input).toContain('<file path="ally-be/src/small.ts">');
  });
});
