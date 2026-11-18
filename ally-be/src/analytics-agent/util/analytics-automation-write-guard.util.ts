import { isAllowedPath } from './analytics-automation.util';

/**
 * What an automation agent is allowed to write. The agent holds GitHub's write
 * tools, but every call passes through {@link checkWriteCall} first, so these
 * limits are enforced in code, not asked for in a prompt.
 */
export interface WritePolicy {
  owner: string;
  repo: string;
  /** The default branch: the only base a pull request may target. */
  base: string;
  /** Every branch the agent creates or pushes to starts with this. */
  branchPrefix: string;
  /**
   * When set, the ONE branch the agent may create, push to and open from. The
   * server looks for the agent's work on that name, so a branch named
   * otherwise would be written and then never reviewed or opened.
   */
  branch?: string;
  allowedPrefixes: readonly string[];
  /** Files one run may change, across all its pushes. */
  maxFiles: number;
  maxFileBytes: number;
}

/** What the agent has done so far in this run. */
export interface WriteState {
  branches: Set<string>;
  files: Set<string>;
  /** The latest content pushed for each file, so the branch can be checked in code. */
  contents: Map<string, string>;
  pullRequests: number;
}

export const newWriteState = (): WriteState => ({
  branches: new Set(),
  files: new Set(),
  contents: new Map(),
  pullRequests: 0,
});

/** The only write tools an agent may hold. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_branch',
  'push_files',
  'create_pull_request',
]);

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/**
 * Why a write call must be refused, or null when it is allowed. The reason is
 * handed back to the model as the tool's answer, so it says what to do instead.
 */
export function checkWriteCall(
  tool: string,
  args: Record<string, unknown>,
  policy: WritePolicy,
  state: WriteState,
): string | null {
  if (!WRITE_TOOL_NAMES.has(tool)) return `the tool "${tool}" is not available`;

  if (
    str(args.owner)?.toLowerCase() !== policy.owner.toLowerCase() ||
    str(args.repo)?.toLowerCase() !== policy.repo.toLowerCase()
  ) {
    return `you may only write to ${policy.owner}/${policy.repo}`;
  }

  const named = str(tool === 'create_pull_request' ? args.head : args.branch);
  if (policy.branch && named !== null && named !== policy.branch) {
    return `use exactly the branch "${policy.branch}"`;
  }

  if (tool === 'create_branch') {
    const branch = str(args.branch);
    if (!branch || !branch.startsWith(policy.branchPrefix)) {
      return `the branch name must start with "${policy.branchPrefix}"`;
    }
    const from = str(args.from_branch);
    if (from !== null && from !== policy.base) {
      return `branch from "${policy.base}" (or leave from_branch out)`;
    }
    return null;
  }

  if (tool === 'push_files') {
    const branch = str(args.branch);
    if (!branch || !branch.startsWith(policy.branchPrefix)) {
      return `you may only push to a branch that starts with "${policy.branchPrefix}", never to "${policy.base}"`;
    }
    if (!state.branches.has(branch)) {
      return `create the branch "${branch}" first`;
    }
    const files = args.files;
    if (!Array.isArray(files) || files.length === 0) {
      return 'files must be a non-empty list of { path, content }';
    }
    const touched = new Set(state.files);
    for (const file of files) {
      const path = str((file as { path?: unknown })?.path);
      const content = str((file as { content?: unknown })?.content);
      if (path === null || content === null) {
        return 'every file needs a string path and string content';
      }
      if (!isAllowedPath(path, policy.allowedPrefixes)) {
        return `"${path}" is not a file you may change; allowed folders: ${policy.allowedPrefixes.join(', ')} (never migrations, env files, CI or package files)`;
      }
      if (Buffer.byteLength(content, 'utf8') > policy.maxFileBytes) {
        return `"${path}" is larger than ${policy.maxFileBytes} bytes; keep the change small`;
      }
      touched.add(path);
    }
    if (touched.size > policy.maxFiles) {
      return `a pull request may change at most ${policy.maxFiles} files`;
    }
    return null;
  }

  // create_pull_request
  const head = str(args.head);
  if (!head || !head.startsWith(policy.branchPrefix)) {
    return `head must be your branch, starting with "${policy.branchPrefix}"`;
  }
  if (str(args.base) !== policy.base) {
    return `base must be "${policy.base}"`;
  }
  if (!state.branches.has(head)) {
    return `create and push the branch "${head}" first`;
  }
  if (state.files.size === 0)
    return 'push your changes before opening the pull request';
  if (state.pullRequests >= 1) {
    return 'you have already opened your pull request; do not open another';
  }
  return null;
}

/** Records a write that succeeded, so later checks know what exists. */
export function noteWriteSucceeded(
  tool: string,
  args: Record<string, unknown>,
  state: WriteState,
): void {
  if (tool === 'create_branch' && typeof args.branch === 'string') {
    state.branches.add(args.branch);
  } else if (tool === 'push_files' && Array.isArray(args.files)) {
    for (const file of args.files) {
      const path = (file as { path?: unknown })?.path;
      const content = (file as { content?: unknown })?.content;
      if (typeof path === 'string') {
        state.files.add(path);
        if (typeof content === 'string') state.contents.set(path, content);
      }
    }
  } else if (tool === 'create_pull_request') {
    state.pullRequests += 1;
  }
}

/** The pull request a `create_pull_request` result names (it may hold only `{ id, url }`). */
export function parsePullRequestResult(
  text: string,
): { number: number; url: string } | null {
  let parsed: { number?: unknown; html_url?: unknown; url?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const url = String(parsed.html_url ?? parsed.url ?? '');
  const number =
    Number(parsed.number) || Number(url.match(/\/pull\/(\d+)/)?.[1]);
  return Number.isInteger(number) && number > 0 ? { number, url } : null;
}
