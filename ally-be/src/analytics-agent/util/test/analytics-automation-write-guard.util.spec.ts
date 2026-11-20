import {
  checkWriteCall,
  newWriteState,
  noteWriteSucceeded,
  parsePullRequestResult,
  WritePolicy,
} from '../analytics-automation-write-guard.util';

const policy: WritePolicy = {
  owner: 'Org',
  repo: 'platform',
  base: 'master',
  branchPrefix: 'automation/abcd1234/',
  allowedPrefixes: ['ally-be/src/', 'ally-web/apps/'],
  maxFiles: 3,
  maxFileBytes: 100,
};
const target = { owner: 'Org', repo: 'platform' };
const BRANCH = 'automation/abcd1234/posthog-events';

/** A state in which the branch exists, as it does once create_branch succeeded. */
const withBranch = () => {
  const state = newWriteState();
  noteWriteSucceeded('create_branch', { branch: BRANCH }, state);
  return state;
};

describe('checkWriteCall: any write', () => {
  it('refuses a tool that is not a write tool the agent may hold', () => {
    expect(
      checkWriteCall('merge_pull_request', target, policy, newWriteState()),
    ).toMatch(/not available/);
    expect(
      checkWriteCall('delete_file', target, policy, newWriteState()),
    ).toMatch(/not available/);
  });

  it.each([
    ['another repo', { owner: 'Org', repo: 'other' }],
    ['another owner', { owner: 'Evil', repo: 'platform' }],
    ['no repo at all', {}],
  ])('refuses %s', (_label, args) => {
    expect(
      checkWriteCall(
        'create_branch',
        { ...args, branch: BRANCH },
        policy,
        newWriteState(),
      ),
    ).toMatch(/you may only write to Org\/platform/);
  });

  it('compares owner and repo case-insensitively, as GitHub does', () => {
    expect(
      checkWriteCall(
        'create_branch',
        { owner: 'org', repo: 'PLATFORM', branch: BRANCH },
        policy,
        newWriteState(),
      ),
    ).toBeNull();
  });
});

describe('checkWriteCall: create_branch', () => {
  it('allows a branch under the run’s prefix', () => {
    expect(
      checkWriteCall(
        'create_branch',
        { ...target, branch: BRANCH },
        policy,
        newWriteState(),
      ),
    ).toBeNull();
  });

  it.each(['master', 'main', 'automation/other999/x', 'feature/x', ''])(
    'refuses the branch name "%s"',
    (branch) => {
      expect(
        checkWriteCall(
          'create_branch',
          { ...target, branch },
          policy,
          newWriteState(),
        ),
      ).toMatch(/must start with/);
    },
  );

  it('refuses branching from anything but the base', () => {
    expect(
      checkWriteCall(
        'create_branch',
        { ...target, branch: BRANCH, from_branch: 'release' },
        policy,
        newWriteState(),
      ),
    ).toMatch(/master/);
    expect(
      checkWriteCall(
        'create_branch',
        { ...target, branch: BRANCH, from_branch: 'master' },
        policy,
        newWriteState(),
      ),
    ).toBeNull();
  });
});

describe('checkWriteCall: push_files', () => {
  const push = (over: object) => ({
    ...target,
    branch: BRANCH,
    message: 'm',
    files: [{ path: 'ally-be/src/a.ts', content: 'x' }],
    ...over,
  });

  it('allows files under the allowed folders on the run’s branch', () => {
    expect(
      checkWriteCall('push_files', push({}), policy, withBranch()),
    ).toBeNull();
  });

  it('refuses a push to the default branch, whatever else is right', () => {
    expect(
      checkWriteCall(
        'push_files',
        push({ branch: 'master' }),
        policy,
        withBranch(),
      ),
    ).toMatch(/never to "master"/);
  });

  it('refuses a branch the agent has not created', () => {
    expect(
      checkWriteCall('push_files', push({}), policy, newWriteState()),
    ).toMatch(/create the branch/);
  });

  it.each([
    ['outside the allowed folders', 'ally-mobile/src/a.ts'],
    ['a migration', 'ally-be/src/database/migrations/1-X.ts'],
    ['an env file', 'ally-be/src/.env'],
    ['a CI workflow', 'ally-web/apps/.github/workflows/x.yml'],
    ['a traversal', 'ally-be/src/../../.env'],
  ])('refuses a file that is %s', (_label, path) => {
    expect(
      checkWriteCall(
        'push_files',
        push({ files: [{ path, content: 'x' }] }),
        policy,
        withBranch(),
      ),
    ).toMatch(/not a file you may change/);
  });

  it('refuses malformed file lists', () => {
    expect(
      checkWriteCall('push_files', push({ files: [] }), policy, withBranch()),
    ).toMatch(/non-empty/);
    expect(
      checkWriteCall(
        'push_files',
        push({ files: [{ path: 'ally-be/src/a.ts' }] }),
        policy,
        withBranch(),
      ),
    ).toMatch(/string path and string content/);
  });

  it('refuses a file over the size limit', () => {
    expect(
      checkWriteCall(
        'push_files',
        push({
          files: [{ path: 'ally-be/src/a.ts', content: 'x'.repeat(101) }],
        }),
        policy,
        withBranch(),
      ),
    ).toMatch(/larger than 100 bytes/);
  });

  it('counts files across pushes, so several small pushes cannot slip past the cap', () => {
    const state = withBranch();
    const one = (n: number) =>
      push({ files: [{ path: `ally-be/src/f${n}.ts`, content: 'x' }] });
    for (const n of [1, 2, 3]) {
      expect(checkWriteCall('push_files', one(n), policy, state)).toBeNull();
      noteWriteSucceeded('push_files', one(n), state);
    }
    expect(checkWriteCall('push_files', one(4), policy, state)).toMatch(
      /at most 3 files/,
    );
    // Re-pushing a file already in the change is not a new file.
    expect(checkWriteCall('push_files', one(2), policy, state)).toBeNull();
  });
});

describe('checkWriteCall: create_pull_request', () => {
  const open = (over: object = {}) => ({
    ...target,
    head: BRANCH,
    base: 'master',
    title: 't',
    body: 'b',
    ...over,
  });
  const pushed = () => {
    const state = withBranch();
    noteWriteSucceeded(
      'push_files',
      { files: [{ path: 'ally-be/src/a.ts' }] },
      state,
    );
    return state;
  };

  it('allows one pull request from the run’s branch to the base', () => {
    expect(
      checkWriteCall('create_pull_request', open(), policy, pushed()),
    ).toBeNull();
  });

  it('refuses a pull request into any other base', () => {
    expect(
      checkWriteCall(
        'create_pull_request',
        open({ base: 'release' }),
        policy,
        pushed(),
      ),
    ).toMatch(/base must be "master"/);
  });

  it('refuses a head that is not the run’s branch', () => {
    expect(
      checkWriteCall(
        'create_pull_request',
        open({ head: 'someone/else' }),
        policy,
        pushed(),
      ),
    ).toMatch(/head must be your branch/);
  });

  it('refuses a pull request before anything was pushed', () => {
    expect(
      checkWriteCall('create_pull_request', open(), policy, withBranch()),
    ).toMatch(/push your changes/);
  });

  it('refuses a second pull request', () => {
    const state = pushed();
    noteWriteSucceeded('create_pull_request', {}, state);
    expect(
      checkWriteCall('create_pull_request', open(), policy, state),
    ).toMatch(/already opened/);
  });
});

describe('parsePullRequestResult', () => {
  it('reads the number from a full response', () => {
    expect(
      parsePullRequestResult(
        '{"number":12,"html_url":"https://github.com/o/r/pull/12"}',
      ),
    ).toEqual({
      number: 12,
      url: 'https://github.com/o/r/pull/12',
    });
  });

  it('reads the number from the URL when the server returns only { id, url }', () => {
    expect(
      parsePullRequestResult(
        '{"id":"99","url":"https://github.com/o/r/pull/7"}',
      ),
    ).toEqual({
      number: 7,
      url: 'https://github.com/o/r/pull/7',
    });
  });

  it('is null when there is no usable number', () => {
    expect(parsePullRequestResult('not json')).toBeNull();
    expect(
      parsePullRequestResult('{"url":"https://github.com/o/r"}'),
    ).toBeNull();
  });
});

describe('noteWriteSucceeded keeps what was pushed', () => {
  it('records the latest content per file, so a later push (the reviewer’s fix) replaces an earlier one', () => {
    const state = newWriteState();
    noteWriteSucceeded(
      'push_files',
      { files: [{ path: 'ally-be/src/a.ts', content: 'v1' }] },
      state,
    );
    noteWriteSucceeded(
      'push_files',
      { files: [{ path: 'ally-be/src/a.ts', content: 'v2' }] },
      state,
    );
    expect(state.files.size).toBe(1);
    expect(state.contents.get('ally-be/src/a.ts')).toBe('v2');
  });
});

describe('checkWriteCall with an exact branch', () => {
  const exact = { ...policy, branch: BRANCH };
  it('refuses any other branch under the prefix', () => {
    expect(
      checkWriteCall(
        'create_branch',
        { owner: policy.owner, repo: policy.repo, branch: `${BRANCH}-2` },
        exact,
        newWriteState(),
      ),
    ).toMatch(/use exactly the branch/);
  });
  it('allows the assigned branch', () => {
    expect(
      checkWriteCall(
        'create_branch',
        { owner: policy.owner, repo: policy.repo, branch: BRANCH },
        exact,
        newWriteState(),
      ),
    ).toBeNull();
  });
});
