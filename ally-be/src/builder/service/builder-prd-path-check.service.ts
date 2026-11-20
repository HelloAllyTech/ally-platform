import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BUILDER_REPO_NAMES } from '../constants/builder-repos.constants';
import {
  BuilderPrdDocument,
  BuilderReadinessSignals,
} from '../type/builder-prd.type';
import { checkPrdPaths, prdCitedPaths } from '../util/builder-prd-paths.util';
import { BuilderGithubReadService } from './builder-github-read.service';

/** How long a service's tree is trusted. Paths in a PRD rarely race a merge. */
const TREE_TTL_MS = 10 * 60_000;
/**
 * How long a readiness read waits on trees it does not have yet. A fetch that takes longer
 * carries on in the background and fills the cache; this read leaves the row out instead of
 * guessing, and the next one has it.
 */
const WAIT_MS = 6_000;

interface CachedTree {
  files: Set<string> | null;
  at: number;
}

/**
 * The repo half of "every path named exists": the service trees the PRD's paths are looked up
 * in, cached per service so a readiness read costs a GitHub call only every few minutes.
 *
 * Fails soft everywhere. With GitHub unconfigured, or a tree that fails or comes back truncated,
 * that tree is unknown and its paths are left unchecked — never reported missing.
 */
@Injectable()
export class BuilderPrdPathCheckService {
  private readonly logger = LoggerService.getInstance(
    BuilderPrdPathCheckService.name,
  );
  private readonly trees = new Map<string, CachedTree>();
  private readonly loading = new Map<string, Promise<Set<string> | null>>();

  constructor(private readonly githubRead: BuilderGithubReadService) {}

  /**
   * The paths signal for a draft, or undefined when nothing could be checked (GitHub not
   * configured, or the trees not in yet) — which leaves the readiness row out.
   */
  async check(
    draft: BuilderPrdDocument,
    readOk: string[] = [],
  ): Promise<BuilderReadinessSignals['paths']> {
    if (!this.githubRead.isConfigured) return undefined;
    const paths = prdCitedPaths(draft);
    if (!paths.length) return { checked: 0, missing: [] };
    const repos = new Set<string>();
    for (const entry of paths) {
      if (entry.repo) repos.add(entry.repo);
      else BUILDER_REPO_NAMES.forEach((repo) => repos.add(repo));
    }
    const all = Promise.all(
      [...repos].map(async (repo) => [repo, await this.tree(repo)] as const),
    );
    const settled = await Promise.race([
      all,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
    ]);
    if (!settled) return undefined;
    return checkPrdPaths(paths, new Map(settled), readOk);
  }

  private async tree(repo: string): Promise<Set<string> | null> {
    const cached = this.trees.get(repo);
    if (cached && Date.now() - cached.at < TREE_TTL_MS) return cached.files;
    const inFlight = this.loading.get(repo);
    if (inFlight) return inFlight;
    const load = this.githubRead
      .serviceFiles(repo)
      .then((files) => (files ? new Set(files) : null))
      .catch((error: unknown) => {
        this.logger.warn(
          `Repo tree for ${repo} unavailable to the PRD path check: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      })
      .then((files) => {
        // A failure is cached briefly too, so a GitHub outage is not retried on every read.
        this.trees.set(repo, {
          files,
          at: files ? Date.now() : Date.now() - TREE_TTL_MS + 60_000,
        });
        return files;
      })
      .finally(() => this.loading.delete(repo));
    this.loading.set(repo, load);
    return load;
  }
}
