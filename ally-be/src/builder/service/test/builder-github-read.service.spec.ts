import axios from 'axios';
import { BuilderGithubReadService } from '../builder-github-read.service';
import { BUILDER_GITHUB_TREE_MAX_ENTRIES } from '../../constants/builder.constants';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

describe('BuilderGithubReadService.listDocs', () => {
  const build = (githubToken: string | undefined = 'ghp_x') =>
    new BuilderGithubReadService({
      githubToken,
      githubOrg: 'helloallytech',
    } as never);

  const tree = (paths: string[], extra: Record<string, any> = {}) =>
    ({
      data: {
        tree: paths.map((path) => ({
          path,
          type: path.endsWith('/') ? 'tree' : 'blob',
        })),
        ...extra,
      },
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('lists root markdown and everything under docs/, and nothing else', async () => {
    mockedGet.mockResolvedValue(
      tree([
        'README.md',
        'CLAUDE.md',
        'CHANGELOG.md',
        'package.json',
        'docs/ai-task-registry.md',
        'docs/adr/0001-queues.md',
        'docs/diagram.png',
        'src/prompts/README.md',
        'scripts/builder/review/common.md',
      ]),
    );

    const result = await build().listDocs('ally-be');

    expect(mockedGet.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/helloallytech/ally-be/git/trees/master',
    );
    expect(result).toMatchObject({ ok: true, repo: 'ally-be' });
    expect(result.files).toEqual([
      'README.md',
      'CLAUDE.md',
      'docs/ai-task-registry.md',
      'docs/adr/0001-queues.md',
    ]);
  });

  /**
   * The reason this is not `repoTree(repo, 'docs')` plus a root listing: `repoTree` caps the
   * whole repo before a caller can filter it, and in a 3,700-file repo the docs go first.
   */
  it('filters before it caps, so a large repo still lists its docs', async () => {
    const noise = Array.from(
      { length: BUILDER_GITHUB_TREE_MAX_ENTRIES + 50 },
      (_, i) => `src/module-${i}/index.ts`,
    );
    mockedGet.mockResolvedValue(tree([...noise, 'docs/late-page.md']));

    const result = await build().listDocs('ally-be');

    expect(result.files).toEqual(['docs/late-page.md']);
    expect(result.truncated).toBe(false);
  });

  it('reads the wiki repo too', async () => {
    mockedGet.mockResolvedValue(tree(['README.md']));

    const result = await build().listDocs('helloallytech.github.io');

    expect(result.ok).toBe(true);
  });

  it('refuses a repo outside the readable set without calling GitHub', async () => {
    const result = await build().listDocs('infra');

    expect(result).toEqual({ ok: false, error: 'unknown_repo', repo: 'infra' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('says plainly when there is no token, rather than returning an empty list', async () => {
    const result = await build('').listDocs('ally-be');

    expect(result).toMatchObject({ ok: false, error: 'github_not_configured' });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('returns a failure the caller can read when GitHub errors', async () => {
    mockedGet.mockRejectedValue(new Error('Request failed with status 403'));

    const result = await build().listDocs('ally-web');

    expect(result).toMatchObject({
      ok: false,
      error: 'docs_failed',
      message: 'Request failed with status 403',
    });
  });
});

/**
 * Reading code after the 2026-10-23 cutover: a service lives as a folder of
 * the monorepo and its own repo is archived (frozen at the move). The agent
 * still asks for `ally-be` + `src/main.ts`; the reader finds it in
 * `ally-platform/ally-be/`, and hands back service-relative paths.
 */
describe('BuilderGithubReadService in the monorepo', () => {
  const service = new BuilderGithubReadService({
    githubToken: 'ghp_x',
    githubOrg: 'helloallytech',
    githubMonorepo: 'ally-platform',
  } as never);
  const API = 'https://api.github.com/repos/helloallytech';
  const notFound = Object.assign(new Error('Not Found'), {
    response: { status: 404 },
  });
  const file = (text: string) =>
    ({
      data: {
        encoding: 'base64',
        content: Buffer.from(text).toString('base64'),
        size: text.length,
      },
    }) as never;
  const tree = (paths: string[]) =>
    ({
      data: { tree: paths.map((path) => ({ path, type: 'blob' })) },
    }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('reads a service file from its folder of the monorepo', async () => {
    mockedGet.mockResolvedValueOnce(file('export {}'));

    const result = await service.readFile('ally-be', 'src/main.ts');

    expect(mockedGet).toHaveBeenCalledWith(
      `${API}/ally-platform/contents/ally-be/src/main.ts`,
      expect.anything(),
    );
    expect(result).toMatchObject({
      ok: true,
      repo: 'ally-be',
      path: 'src/main.ts',
    });
  });

  /** The eval pins commits from before the move, where the service is the root. */
  it('reads a pinned pre-move commit from the root of its tree', async () => {
    mockedGet
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(file('export {}'));

    const result = await service.readFile('ally-be', 'src/main.ts', 'b5b8160');

    expect(mockedGet).toHaveBeenLastCalledWith(
      `${API}/ally-platform/contents/src/main.ts`,
      expect.objectContaining({ params: { ref: 'b5b8160' } }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('does not guess a root path for a file missing on master', async () => {
    mockedGet.mockRejectedValueOnce(notFound);

    const result = await service.readFile('ally-be', 'src/gone.ts');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, error: 'read_failed' });
  });

  it("lists a service's tree as that folder alone", async () => {
    mockedGet.mockResolvedValueOnce(tree(['apps/a.ts', 'libs/b.ts']));

    const result = await service.repoTree('ally-web', 'apps');

    expect(mockedGet).toHaveBeenCalledWith(
      `${API}/ally-platform/git/trees/master:ally-web`,
      expect.anything(),
    );
    expect(result).toMatchObject({ ok: true, files: ['apps/a.ts'] });
  });

  it('falls back to the root tree for a pinned pre-move commit', async () => {
    mockedGet
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(tree(['src/main.ts']));

    const result = await service.repoTree('ally-be', undefined, 'b5b8160');

    expect(mockedGet).toHaveBeenLastCalledWith(
      `${API}/ally-platform/git/trees/b5b8160`,
      expect.anything(),
    );
    expect(result).toMatchObject({ ok: true, files: ['src/main.ts'] });
  });

  it('searches one service inside its folder of the monorepo', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        total_count: 1,
        items: [
          { repository: { name: 'ally-platform' }, path: 'ally-be/src/a.ts' },
        ],
      },
    } as never);

    const result = await service.searchCode('prUrl', 'ally-be');

    expect(mockedGet).toHaveBeenCalledWith(
      'https://api.github.com/search/code',
      expect.objectContaining({
        params: expect.objectContaining({
          q: 'prUrl repo:helloallytech/ally-platform path:ally-be/',
        }),
      }),
    );
    expect(result.results).toEqual([{ repo: 'ally-be', path: 'src/a.ts' }]);
  });

  /**
   * GitHub still indexes the archived repos, whose copy of every file is the
   * one frozen at the move; the current one is in the monorepo.
   */
  it('maps org-wide hits to services and drops the archived and unreadable ones', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        total_count: 6,
        items: [
          { repository: { name: 'ally-platform' }, path: 'ally-be/src/a.ts' },
          { repository: { name: 'ally-be' }, path: 'src/a.ts' },
          {
            repository: { name: 'ally-platform' },
            path: 'helloallytech.github.io/wiki/memory.md',
          },
          {
            repository: { name: 'helloallytech.github.io' },
            path: 'wiki/memory.md',
          },
          { repository: { name: 'ally-platform' }, path: '.docs-map.yml' },
          { repository: { name: 'infra' }, path: 'README.md' },
        ],
      },
    } as never);

    const result = await service.searchCode('memory');

    expect(result.results).toEqual([
      { repo: 'ally-be', path: 'src/a.ts' },
      { repo: 'helloallytech.github.io', path: 'wiki/memory.md' },
      { repo: 'infra', path: 'README.md' },
    ]);
  });
});
