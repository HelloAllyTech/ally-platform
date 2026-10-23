import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import {
  BUILDER_GITHUB_FILE_MAX_BYTES,
  BUILDER_GITHUB_SEARCH_MAX_RESULTS,
  BUILDER_GITHUB_TREE_MAX_ENTRIES,
} from '../constants/builder.constants';
import {
  BUILDER_WIKI_REPO,
  isBuilderReadableRepo,
} from '../constants/builder-repos.constants';
import {
  isMonorepoService,
  pathWithinService,
  serviceForPath,
} from 'src/github/constants/github-repos.constants';

/**
 * Where a repo's code is read from. Since the 2026-10-23 cutover the five
 * services live as folders of one monorepo and their own repos are archived:
 * frozen, still readable, and wrong for anything current. A service is read
 * from its folder in the monorepo; anything else (the wiki) from its own repo.
 * Paths stay service-relative either way — the agent asks for
 * `ally-be` + `src/main.ts` exactly as before.
 */
interface ReadLocation {
  /** owner/name to address. */
  fullName: string;
  /** The service's folder in the monorepo, or null when the repo is its own. */
  folder: string | null;
}

/** A GitHub 404: the path, or a `ref:folder` tree, does not exist there. */
const isNotFound = (error: unknown): boolean =>
  (error as { response?: { status?: number } })?.response?.status === 404;

/**
 * Read-only GitHub REST access for the interview agent: search code, read a
 * file, list a tree.
 *
 * Deliberately separate from Bug Hunter's GithubActionsService, which is a
 * *write* client (dispatch, cancel). Same plain-axios approach and the same
 * GITHUB_TOKEN, no Octokit — see that file for why. Extracting a shared
 * `src/github/` module once both exist is a worthwhile cleanup, but it is not
 * a prerequisite for this feature.
 *
 * Every method returns a plain object rather than throwing on a bad request:
 * these are LLM tool implementations, and a structured `{ ok: false }` is
 * something the model can recover from, where an exception ends the turn.
 */
@Injectable()
export class BuilderGithubReadService {
  private readonly logger = LoggerService.getInstance(
    BuilderGithubReadService.name,
  );

  constructor(private readonly configService: AppConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.configService.githubToken);
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.configService.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private get org(): string {
    return this.configService.githubOrg;
  }

  private locate(repo: string): ReadLocation {
    const monorepo = this.configService.githubMonorepo;
    return monorepo && isMonorepoService(repo)
      ? { fullName: `${this.org}/${monorepo}`, folder: repo }
      : { fullName: `${this.org}/${repo}`, folder: null };
  }

  /**
   * A service's tree at `ref`, with paths relative to the service.
   *
   * `ref:folder` asks GitHub for the folder's own tree. A ref from before the
   * cutover — the eval's pinned commits — is a commit of the old service repo,
   * which the monorepo kept in its history: there the service IS the root and
   * `ref:folder` is a 404, so the root tree is the answer. Only an explicit
   * ref can be that old; master never is.
   */
  private async serviceTree(
    location: ReadLocation,
    ref: string,
    explicitRef: boolean,
  ): Promise<{ tree: any[]; truncated: boolean }> {
    const get = (treeRef: string) =>
      axios.get(
        `https://api.github.com/repos/${location.fullName}/git/trees/${treeRef}`,
        {
          headers: this.headers,
          params: { recursive: '1' },
          timeout: 30_000,
        },
      );
    let response;
    try {
      response = await get(location.folder ? `${ref}:${location.folder}` : ref);
    } catch (error) {
      if (!location.folder || !explicitRef || !isNotFound(error)) throw error;
      response = await get(ref);
    }
    return {
      tree: response.data?.tree ?? [],
      truncated: Boolean(response.data?.truncated),
    };
  }

  /**
   * Code search across the org (or one repo). Returns paths and repo names
   * only — GitHub's fragments are noisy and the agent should follow up with
   * readFile on the two or three that look right.
   */
  async searchCode(query: string, repo?: string): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (repo && !isBuilderReadableRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    const location = repo ? this.locate(repo) : null;
    const scope = location
      ? `repo:${location.fullName}${location.folder ? ` path:${location.folder}/` : ''}`
      : `org:${this.org}`;
    try {
      const response = await axios.get('https://api.github.com/search/code', {
        headers: this.headers,
        params: {
          q: `${query} ${scope}`,
          per_page: BUILDER_GITHUB_SEARCH_MAX_RESULTS,
        },
        timeout: 20_000,
      });
      const items: any[] = response.data?.items ?? [];
      const seen = new Set<string>();
      const results = items
        .map((item) =>
          this.asReadable(String(item?.repository?.name ?? ''), item?.path),
        )
        .filter((hit): hit is { repo: string; path: string } => {
          if (!hit) return false;
          const key = `${hit.repo}:${hit.path}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return {
        ok: true,
        totalCount: response.data?.total_count ?? items.length,
        results,
      };
    } catch (error) {
      return this.failure('search_failed', error);
    }
  }

  /**
   * One file's contents at a ref. Truncated at a hard byte cap — a 6000-line
   * service read in full would crowd out the reasoning the interview needs,
   * and the agent can always ask for a narrower path.
   */
  async readFile(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (!isBuilderReadableRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    try {
      const location = this.locate(repo);
      const get = (contentPath: string) =>
        axios.get(
          `https://api.github.com/repos/${location.fullName}/contents/${contentPath}`,
          {
            headers: this.headers,
            params: ref ? { ref } : undefined,
            timeout: 20_000,
          },
        );
      let response;
      try {
        response = await get(
          location.folder ? `${location.folder}/${path}` : path,
        );
      } catch (error) {
        // A pinned ref from before the cutover is a commit of the old service
        // repo, where the service is the root (see serviceTree).
        if (!location.folder || !ref || !isNotFound(error)) throw error;
        response = await get(path);
      }
      const data = response.data;
      if (Array.isArray(data)) {
        return {
          ok: false,
          error: 'path_is_directory',
          message: `"${path}" is a directory — use github_repo_tree instead.`,
        };
      }
      if (data?.encoding !== 'base64' || typeof data?.content !== 'string') {
        return { ok: false, error: 'unreadable_file', path };
      }
      const decoded = Buffer.from(data.content, 'base64').toString('utf8');
      const truncated = decoded.length > BUILDER_GITHUB_FILE_MAX_BYTES;
      return {
        ok: true,
        repo,
        path,
        size: data.size,
        truncated,
        content: truncated
          ? decoded.slice(0, BUILDER_GITHUB_FILE_MAX_BYTES)
          : decoded,
        ...(truncated
          ? {
              note: `Truncated at ${BUILDER_GITHUB_FILE_MAX_BYTES} bytes. Read a narrower path if you need the rest.`,
            }
          : {}),
      };
    } catch (error) {
      return this.failure('read_failed', error);
    }
  }

  /**
   * Repo file tree, optionally filtered to a subpath. Capped in entry count
   * for the same reason readFile is capped in bytes.
   */
  async repoTree(
    repo: string,
    path?: string,
    requestedRef?: string,
  ): Promise<Record<string, any>> {
    const explicitRef = Boolean(requestedRef);
    const ref = requestedRef || 'master';
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (!isBuilderReadableRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    try {
      const { tree: all, truncated: githubTruncated } = await this.serviceTree(
        this.locate(repo),
        ref,
        explicitRef,
      );
      const prefix = path?.replace(/^\/+|\/+$/g, '');
      const filtered = all
        .filter((entry) => entry?.type === 'blob')
        .map((entry) => entry.path as string)
        .filter((entryPath) => !prefix || entryPath.startsWith(`${prefix}/`));
      const truncated = filtered.length > BUILDER_GITHUB_TREE_MAX_ENTRIES;
      return {
        ok: true,
        repo,
        ref,
        ...(prefix ? { path: prefix } : {}),
        totalCount: filtered.length,
        truncated,
        // GitHub's own truncation flag matters too: a huge repo's tree comes
        // back partial, and a confident "this file does not exist" drawn from
        // a partial tree is worse than no answer.
        githubTruncated,
        files: filtered.slice(0, BUILDER_GITHUB_TREE_MAX_ENTRIES),
      };
    } catch (error) {
      return this.failure('tree_failed', error);
    }
  }

  /**
   * The written documentation in one repo: markdown at its root and anywhere under `docs/`,
   * as paths only.
   *
   * An index rather than a search — the roadmap copilot lists these so it knows which page
   * explains an area before it spends a read on one. Filtered BEFORE the entry cap, unlike
   * `repoTree`: ally-be holds ~3,700 files, and a cap applied first would cut its docs/
   * folder off before a single page was listed. CHANGELOG.md is left out; it is a release
   * log, not a description of anything.
   */
  async listDocs(repo: string, ref = 'master'): Promise<Record<string, any>> {
    if (!this.isConfigured) {
      return this.notConfigured();
    }
    if (!isBuilderReadableRepo(repo)) {
      return { ok: false, error: 'unknown_repo', repo };
    }
    try {
      const { tree: all, truncated: githubTruncated } = await this.serviceTree(
        this.locate(repo),
        ref,
        ref !== 'master',
      );
      const docs = all
        .filter((entry) => entry?.type === 'blob')
        .map((entry) => entry.path as string)
        .filter(
          (entryPath) =>
            /\.md$/i.test(entryPath) &&
            (/^[^/]+$/.test(entryPath) || entryPath.startsWith('docs/')) &&
            !/^CHANGELOG\.md$/i.test(entryPath),
        );
      return {
        ok: true,
        repo,
        ref,
        totalCount: docs.length,
        truncated: docs.length > BUILDER_GITHUB_TREE_MAX_ENTRIES,
        githubTruncated,
        files: docs.slice(0, BUILDER_GITHUB_TREE_MAX_ENTRIES),
      };
    } catch (error) {
      return this.failure('docs_failed', error);
    }
  }

  /**
   * A code-search hit as the agent addresses it: a service plus a
   * service-relative path, the way every other tool here takes them.
   *
   * A monorepo hit becomes the service whose folder holds it (and the wiki's
   * folder becomes the wiki repo, which mirrors it). A hit in an archived
   * service repo is dropped: GitHub still indexes those repos, and their copy
   * of a file is the one frozen at the cutover — the current one is in the
   * monorepo. Root files of the monorepo belong to no readable repo and are
   * dropped too, since nothing could read them back.
   */
  private asReadable(
    repoName: string,
    path: unknown,
  ): { repo: string; path: string } | null {
    if (typeof path !== 'string' || !repoName) return null;
    const monorepo = this.configService.githubMonorepo;
    if (monorepo && repoName === monorepo) {
      const service = serviceForPath(path);
      if (service) return { repo: service, path: pathWithinService(path) };
      if (path.startsWith(`${BUILDER_WIKI_REPO}/`)) {
        return {
          repo: BUILDER_WIKI_REPO,
          path: path.slice(BUILDER_WIKI_REPO.length + 1),
        };
      }
      return null;
    }
    if (monorepo && isMonorepoService(repoName)) return null;
    return { repo: repoName, path };
  }

  private notConfigured(): Record<string, any> {
    return {
      ok: false,
      error: 'github_not_configured',
      message:
        'GITHUB_TOKEN is not set on this environment, so codebase lookups are unavailable. ' +
        'Say so plainly and continue the interview from the repo maps and the admin’s answers.',
    };
  }

  private failure(code: string, error: unknown): Record<string, any> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Builder GitHub ${code}: ${message}`);
    return { ok: false, error: code, message };
  }
}
