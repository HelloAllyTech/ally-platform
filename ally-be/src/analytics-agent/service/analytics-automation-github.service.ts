import { Injectable, Logger } from '@nestjs/common';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { tool } from 'langchain';
import { createAppAuth } from '@octokit/auth-app';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AnalyticsAutomationPrState } from '../entity/analytics-automation-agent-run.entity';
import { resolveAutomationRepos } from '../constants/analytics-automation.constants';
import {
  checkWriteCall,
  newWriteState,
  noteWriteSucceeded,
  parsePullRequestResult,
  WRITE_TOOL_NAMES,
  WritePolicy,
} from '../util/analytics-automation-write-guard.util';

/** The repository a call is about. */
export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullRequestState {
  state: AnalyticsAutomationPrState;
}

type McpTools = Awaited<ReturnType<MultiServerMCPClient['listTools']>>;

/** Read server: what the LLM agents hold. Cannot write by construction. */
const READ_SERVER = 'githubRead';
/** Write server: its tools reach a model only through the guard below. */
const WRITE_SERVER = 'githubWrite';

/**
 * The only tools this class calls ITSELF on the write server (the write tools a
 * model holds are separate, and guarded; see `guardedWriteTools`).
 */
const ALLOWED_CALLS: ReadonlySet<string> = new Set([
  'list_commits',
  'pull_request_read',
  'add_issue_comment',
]);

const TOOLSETS = 'repos,git,pull_requests,issues';

/** Text of every text block in an MCP tool result, joined. */
function textOf(content: unknown): string {
  if (!Array.isArray(content))
    return typeof content === 'string' ? content : '';
  return content
    .map((block) =>
      (block as { type?: string; text?: string }).type === 'text'
        ? ((block as { text?: string }).text ?? '')
        : '',
    )
    .join('');
}

/**
 * GitHub, through the GitHub MCP server, authenticated as the existing GitHub
 * App (the same installation the Analytics Agent uses to read the dbt repo —
 * it now also carries write permission).
 *
 * Two servers, one purpose each:
 *  - `githubRead` (`/mcp/readonly`): its tools are given to the LLM agents.
 *  - `githubWrite` (`/mcp/`): called only by this class, for branch, commit,
 *    pull request and comment. Models propose file changes as data; the
 *    server validates them and makes these calls.
 *
 * Nothing here runs at import: the client and the App credentials are built on
 * first use, so suites that load the module never need GitHub env vars.
 */
@Injectable()
export class AnalyticsAutomationGithubService {
  private readonly logger = new Logger(AnalyticsAutomationGithubService.name);
  private mcp?: MultiServerMCPClient;
  private writeReady?: Promise<void>;

  private client(): MultiServerMCPClient {
    if (this.mcp) return this.mcp;
    const app = createAppAuth({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(
        /\\n/g,
        '\n',
      ),
      installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
    });
    const authProvider: OAuthClientProvider = {
      get redirectUrl() {
        return undefined;
      },
      get clientMetadata() {
        return { redirect_uris: [] };
      },
      clientInformation: () => undefined,
      tokens: async () => {
        const { token } = await app({ type: 'installation' });
        return { access_token: token, token_type: 'Bearer' };
      },
      saveTokens: () => {},
      redirectToAuthorization: () => {
        throw new Error(
          'Interactive OAuth is not supported; tokens come from the GitHub App',
        );
      },
      saveCodeVerifier: () => {},
      codeVerifier: () => {
        throw new Error(
          'Interactive OAuth is not supported; tokens come from the GitHub App',
        );
      },
    };
    this.mcp = new MultiServerMCPClient({
      servers: {
        [READ_SERVER]: {
          transport: 'http',
          url: 'https://api.githubcopilot.com/mcp/readonly',
          headers: { 'X-MCP-Toolsets': TOOLSETS },
          authProvider,
        },
        [WRITE_SERVER]: {
          transport: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: { 'X-MCP-Toolsets': TOOLSETS },
          authProvider,
        },
      },
    });
    return this.mcp;
  }

  /**
   * The read-only tools a model may be given. `get_file_contents` is wrapped so
   * that a read that names no branch, tag or commit is made on the configured
   * base branch of that repo: without a `ref` GitHub answers from the repo's own
   * default branch, which is not the branch under review when a test branch is
   * configured. A model that names a `ref` (a pull request's branch, say) keeps it.
   */
  async readTools(): Promise<McpTools> {
    const tools = await this.client().listTools(READ_SERVER);
    const repos = resolveAutomationRepos();
    const baseRefs = new Map<string, string>(
      [repos.platform, repos.dbt].map((r) => [
        `${r.owner}/${r.repo}`.toLowerCase(),
        `refs/heads/${r.base}`,
      ]),
    );
    return tools.map((original) => {
      if (
        original.name.replace(`${READ_SERVER}_`, '') !== 'get_file_contents'
      ) {
        return original;
      }
      return tool(
        async (args: Record<string, unknown>) => {
          const baseRef = baseRefs.get(
            `${String(args.owner)}/${String(args.repo)}`.toLowerCase(),
          );
          const pinned =
            baseRef && !args.ref && !args.sha
              ? { ...args, ref: baseRef }
              : args;
          return original.invoke(pinned);
        },
        {
          name: original.name,
          description: original.description,
          schema: original.schema,
        },
      );
    }) as unknown as McpTools;
  }

  /** Calls one allowed tool on the write server and returns its content blocks. */
  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!ALLOWED_CALLS.has(name)) {
      throw new Error(`GitHub tool "${name}" is not allowed for automation`);
    }
    const mcp = this.client();
    // Connecting is a side effect of discovering tools; do it once.
    this.writeReady ??= mcp.listTools(WRITE_SERVER).then(() => undefined);
    await this.writeReady;
    const raw = await mcp.getClient(WRITE_SERVER);
    if (!raw) throw new Error('The GitHub MCP write server is not connected');
    const result = await raw.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(
        `GitHub ${name} failed: ${textOf(result.content).slice(0, 500)}`,
      );
    }
    return result.content;
  }

  /** The commit a branch points at right now. */
  async getBranchHead(ref: RepoRef, branch: string): Promise<string> {
    const content = await this.call('list_commits', {
      ...ref,
      sha: branch,
      perPage: 1,
      fields: ['sha'],
    });
    const parsed = JSON.parse(textOf(content)) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const sha = (first as { sha?: unknown } | undefined)?.sha;
    if (typeof sha !== 'string' || sha.length < 7) {
      throw new Error(
        `Could not read the head of ${ref.owner}/${ref.repo}@${branch}`,
      );
    }
    return sha;
  }

  /**
   * The write tools an agent may hold: create a branch, push files to it, open a
   * pull request. Each is the real GitHub MCP tool wrapped so that every call is
   * checked against `policy` BEFORE it reaches GitHub. A refused call is not an
   * error: the reason comes back as the tool's answer so the model can correct
   * itself. `onPullRequest` fires once when the pull request is opened.
   *
   * One call to this method is one run's worth of state (which branches and
   * files it has touched), so build it once per agent run.
   */
  async guardedWriteTools(
    policy: WritePolicy,
    onPullRequest: (pr: { number: number; url: string }) => Promise<void>,
  ): Promise<McpTools> {
    const state = newWriteState();
    const upstream = await this.client().listTools(WRITE_SERVER);
    const bare = (name: string) => name.replace(`${WRITE_SERVER}_`, '');

    return upstream
      .filter((t) => WRITE_TOOL_NAMES.has(bare(t.name)))
      .map((original) => {
        const name = bare(original.name);
        return tool(
          async (args: Record<string, unknown>) => {
            const refusal = checkWriteCall(name, args, policy, state);
            if (refusal) {
              this.logger.warn(`Refused ${name}: ${refusal}`);
              return `Refused: ${refusal}`;
            }
            const result = await original.invoke(args);
            noteWriteSucceeded(name, args, state);
            this.logger.log(this.describeWrite(name, args, policy));
            if (name === 'create_pull_request') {
              const pr = parsePullRequestResult(
                typeof result === 'string' ? result : JSON.stringify(result),
              );
              if (!pr) {
                throw new Error('GitHub did not return a pull request number');
              }
              await onPullRequest(pr);
            }
            return result;
          },
          {
            name: original.name,
            description: original.description,
            schema: original.schema,
          },
        );
      }) as unknown as McpTools;
  }

  /** One log line for a write that reached GitHub (names and counts, never file contents). */
  private describeWrite(
    name: string,
    args: Record<string, unknown>,
    policy: WritePolicy,
  ): string {
    const repo = `${policy.owner}/${policy.repo}`;
    if (name === 'create_branch') {
      return `Created branch ${String(args.branch)} in ${repo}`;
    }
    if (name === 'push_files') {
      const files = Array.isArray(args.files) ? args.files.length : 0;
      return `Pushed ${files} file(s) to ${String(args.branch)} in ${repo}`;
    }
    return `Opened a pull request in ${repo}: ${String(args.head)} -> ${String(args.base)}`;
  }

  /** Whether a pull request is open, merged, or closed without merging. */
  async getPullRequestState(
    repo: RepoRef,
    pullNumber: number,
  ): Promise<PullRequestState> {
    const content = await this.call('pull_request_read', {
      ...repo,
      method: 'get',
      pullNumber,
    });
    const pr = JSON.parse(textOf(content)) as {
      state?: unknown;
      merged?: unknown;
      merged_at?: unknown;
    };
    if (
      pr.merged === true ||
      (pr.merged_at !== undefined && pr.merged_at !== null)
    ) {
      return { state: 'merged' };
    }
    return { state: pr.state === 'closed' ? 'closed' : 'open' };
  }

  async commentOnPullRequest(
    repo: RepoRef,
    pullNumber: number,
    body: string,
  ): Promise<void> {
    await this.call('add_issue_comment', {
      ...repo,
      issue_number: pullNumber,
      body,
    });
  }
}
