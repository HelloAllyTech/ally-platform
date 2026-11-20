import { Injectable, Logger } from '@nestjs/common';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { tool } from 'langchain';
import { createAppAuth } from '@octokit/auth-app';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AnalyticsAutomationPrState } from '../entity/analytics-automation-agent-run.entity';
import type { CheckRun } from '../util/analytics-automation.util';
import {
  DBT_BUILD_LABEL,
  resolveAutomationRepos,
} from '../constants/analytics-automation.constants';
import {
  checkWriteCall,
  newWriteState,
  noteWriteSucceeded,
  parsePullRequestResult,
  WriteState,
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
  'create_pull_request',
  // Labels on the dbt pull request (a pull request is an issue to GitHub).
  'issue_read',
  'issue_write',
]);

/** Labels the server may put on a pull request: only the one the dbt build keys on. */
const ALLOWED_LABELS: readonly string[] = [DBT_BUILD_LABEL];
/** Longest comment the server may post on a pull request. */
const MAX_COMMENT_CHARS = 20_000;
/**
 * How long one server's tool list is reused. The list does not change while a
 * run is going, but a long-lived process should still notice a server update.
 */
const TOOL_LIST_TTL_MS = 10 * 60 * 1000;

const TOOLSETS = 'repos,git,pull_requests,issues';
/**
 * The read server also gets `actions`, so the CI fixer can read the logs of a
 * failed job (`get_job_logs`). It is the read-only endpoint, so no tool of that
 * toolset that changes anything is reachable; the write server does not get it.
 */
const READ_TOOLSETS = `${TOOLSETS},actions`;

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
 * A tool's answer as one string: a string as is, the text of every text block
 * of a list joined (a file's text is one such block). Anything else is JSON.
 */
export function flattenToolText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output
      .map((block) =>
        typeof block === 'string'
          ? block
          : (block as { type?: string }).type === 'text'
            ? String((block as { text?: unknown }).text ?? '')
            : '',
      )
      .filter((text) => text.length > 0)
      .join('\n\n');
  }
  return JSON.stringify(output);
}

/**
 * Label names from an `issue_read` `get_labels` answer: a list of labels (or
 * of names), or an object holding one under `labels`. Null for any other shape.
 */
export function parseLabelNames(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { labels?: unknown } | null)?.labels;
  if (!Array.isArray(list)) return null;
  const names = list.map((item) =>
    typeof item === 'string'
      ? item
      : typeof (item as { name?: unknown })?.name === 'string'
        ? (item as { name: string }).name
        : null,
  );
  return names.every((n): n is string => n !== null) ? names : null;
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
  private readonly toolLists = new Map<
    string,
    { at: number; tools: Promise<McpTools> }
  >();

  /**
   * One server's tools, listed once and reused for {@link TOOL_LIST_TTL_MS}: a
   * run asks for them several times (every agent, every CI-fix retry). A failed
   * listing is dropped at once, so a transient blip is retried by the next call
   * instead of being cached for the life of the process.
   */
  private listTools(server: string): Promise<McpTools> {
    const cached = this.toolLists.get(server);
    if (cached && Date.now() - cached.at < TOOL_LIST_TTL_MS) {
      return cached.tools;
    }
    const tools = this.client().listTools(server);
    this.toolLists.set(server, { at: Date.now(), tools });
    tools.catch(() => {
      if (this.toolLists.get(server)?.tools === tools) {
        this.toolLists.delete(server);
      }
    });
    return tools;
  }

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
          headers: { 'X-MCP-Toolsets': READ_TOOLSETS },
          authProvider,
          // `get_file_contents` answers with the file as an embedded RESOURCE
          // block. The adapter's default puts resources in the artifact, which
          // the model never sees: it got only "successfully downloaded text
          // file" and could not edit any file it had not seen in a diff.
          outputHandling: { resource: 'content' },
        },
        [WRITE_SERVER]: {
          transport: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: { 'X-MCP-Toolsets': TOOLSETS },
          authProvider,
          outputHandling: { resource: 'content' },
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
    const tools = await this.listTools(READ_SERVER);
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
          // One plain string: the status line and the file's full text, so
          // nothing depends on how the model provider renders content blocks.
          return flattenToolText(await original.invoke(pinned));
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
    // Connecting is a side effect of discovering tools; the cached listing does it once.
    await this.listTools(WRITE_SERVER);
    const raw = await this.client().getClient(WRITE_SERVER);
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
   * The write tools an agent may hold, chosen by name from create a branch and
   * push files (`allow`). Opening the pull request is never a model's tool: the
   * server does it with {@link openPullRequest} once the review is done. Each
   * tool is the real GitHub MCP tool wrapped so that every call is checked
   * against `policy` BEFORE it reaches GitHub. A refused call is not an error:
   * the reason comes back as the tool's answer so the model can correct itself.
   *
   * `state` records which branches and files the run has touched. The author and
   * the reviewer of one pull request share one `state`, so the file limit and
   * "the branch exists" hold across both.
   */
  async guardedWriteTools(
    policy: WritePolicy,
    state: WriteState,
    allow: readonly ('create_branch' | 'push_files')[],
  ): Promise<McpTools> {
    const upstream = await this.listTools(WRITE_SERVER);
    const bare = (name: string) => name.replace(`${WRITE_SERVER}_`, '');

    return upstream
      .filter((t) => (allow as readonly string[]).includes(bare(t.name)))
      .map((original) => {
        const name = bare(original.name);
        return tool(
          async (given: Record<string, unknown>) => {
            // Without `from_branch` GitHub branches from the repo's own default
            // branch, which is not the configured base when a test base is set:
            // the pull request would then carry unrelated commits. Always branch
            // from the base the files were read on and the pull request targets.
            const args =
              name === 'create_branch' && !given.from_branch
                ? { ...given, from_branch: policy.base }
                : given;
            const refusal = checkWriteCall(name, args, policy, state);
            if (refusal) {
              this.logger.warn(`Refused ${name}: ${refusal}`);
              return `Refused: ${refusal}`;
            }
            const result = await original.invoke(args);
            noteWriteSucceeded(name, args, state);
            this.logger.log(this.describeWrite(name, args, policy));
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

  /**
   * Opens the pull request for the branch the agents wrote to. The same guard
   * as for the tools applies (right repo, branch prefix and base, branch and
   * files exist, one pull request per run), and a refusal throws.
   */
  async openPullRequest(
    policy: WritePolicy,
    state: WriteState,
    input: { head: string; title: string; body: string },
  ): Promise<{ number: number; url: string }> {
    const args = {
      owner: policy.owner,
      repo: policy.repo,
      head: input.head,
      base: policy.base,
      title: input.title,
      body: input.body,
    };
    const refusal = checkWriteCall('create_pull_request', args, policy, state);
    if (refusal) throw new Error(`Pull request not opened: ${refusal}`);
    const content = await this.call('create_pull_request', args);
    const pr = parsePullRequestResult(textOf(content));
    if (!pr) throw new Error('GitHub did not return a pull request number');
    noteWriteSucceeded('create_pull_request', args, state);
    this.logger.log(this.describeWrite('create_pull_request', args, policy));
    return pr;
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

  /**
   * The CI checks on a pull request's current head commit. Throws when GitHub
   * cannot be asked or answers in a shape this does not know (including when the
   * GitHub App is not allowed to read checks), so a caller never mistakes
   * "could not read" for "no checks".
   */
  async getCheckRuns(repo: RepoRef, pullNumber: number): Promise<CheckRun[]> {
    const content = await this.call('pull_request_read', {
      ...repo,
      method: 'get_check_runs',
      pullNumber,
      perPage: 100,
    });
    const parsed = JSON.parse(textOf(content)) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { check_runs?: unknown } | null)?.check_runs;
    if (!Array.isArray(list)) {
      throw new Error('GitHub did not return a list of check runs');
    }
    return list.map((raw) => {
      const run = raw as Record<string, unknown>;
      return {
        id: Number(run.id),
        name: String(run.name ?? 'check'),
        status: String(run.status ?? ''),
        conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
        url: typeof run.html_url === 'string' ? run.html_url : null,
      };
    });
  }

  /** The commit a pull request's head is at right now. */
  async getPullRequestHead(repo: RepoRef, pullNumber: number): Promise<string> {
    const content = await this.call('pull_request_read', {
      ...repo,
      method: 'get',
      pullNumber,
    });
    const pr = JSON.parse(textOf(content)) as { head?: { sha?: unknown } };
    const sha = pr.head?.sha;
    if (typeof sha !== 'string' || sha.length < 7) {
      throw new Error(
        `Could not read the head of ${repo.owner}/${repo.repo}#${pullNumber}`,
      );
    }
    return sha;
  }

  /**
   * Refuses a label or comment the write guard does not allow. These writes go
   * through {@link checkWriteCall} like every other: the repository must be one
   * of the two configured ones, the label one of {@link ALLOWED_LABELS}, and a
   * comment within {@link MAX_COMMENT_CHARS}.
   */
  private checkPullRequestNote(
    tool: 'add_label' | 'add_issue_comment',
    repo: RepoRef,
    args: Record<string, unknown>,
  ): void {
    const repos = resolveAutomationRepos();
    const same = (r: RepoRef) =>
      r.owner.toLowerCase() === repo.owner.toLowerCase() &&
      r.repo.toLowerCase() === repo.repo.toLowerCase();
    const target = [repos.dbt, repos.platform].find(same) ?? repos.dbt;
    const policy: WritePolicy = {
      ...target,
      branchPrefix: '',
      allowedPrefixes: [],
      maxFiles: 0,
      maxFileBytes: 0,
      allowedLabels: ALLOWED_LABELS,
      maxCommentChars: MAX_COMMENT_CHARS,
    };
    const refusal = checkWriteCall(
      tool,
      { ...repo, ...args },
      policy,
      newWriteState(),
    );
    if (refusal) throw new Error(`GitHub write refused: ${refusal}`);
  }

  /**
   * Adds one label to a pull request, keeping the labels it already has
   * (`issue_write` replaces the whole list). `fresh` means the server opened
   * the pull request moments ago, so when GitHub refuses to list its labels it
   * has none to lose; otherwise a failed read throws rather than wipe a
   * person's labels. An answer that is not a label list throws either way:
   * writing then would replace labels that may be there.
   */
  async addPullRequestLabel(
    repo: RepoRef,
    pullNumber: number,
    label: string,
    opts: { fresh?: boolean } = {},
  ): Promise<void> {
    this.checkPullRequestNote('add_label', repo, { label });
    let existing: string[] = [];
    let content: unknown;
    try {
      content = await this.call('issue_read', {
        ...repo,
        issue_number: pullNumber,
        method: 'get_labels',
      });
    } catch (err) {
      if (!opts.fresh) throw err;
    }
    if (content !== undefined) {
      const parsed = parseLabelNames(textOf(content));
      if (parsed === null) {
        throw new Error('GitHub did not return the pull request labels');
      }
      existing = parsed;
    }
    if (existing.includes(label)) return;
    await this.call('issue_write', {
      ...repo,
      method: 'update',
      issue_number: pullNumber,
      labels: [...new Set([...existing, label])],
    });
    this.logger.log(
      `Labelled ${repo.owner}/${repo.repo}#${pullNumber} "${label}"`,
    );
  }

  async commentOnPullRequest(
    repo: RepoRef,
    pullNumber: number,
    body: string,
  ): Promise<void> {
    this.checkPullRequestNote('add_issue_comment', repo, { body });
    await this.call('add_issue_comment', {
      ...repo,
      issue_number: pullNumber,
      body,
    });
  }
}
