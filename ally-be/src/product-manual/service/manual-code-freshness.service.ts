import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';

/**
 * Two facts the weekly agent needs from GitHub that Builder's read client does not offer: the
 * master commit it is checking pages against (recorded as `verified_ref`), and when a folder of the
 * monorepo last changed (to queue pages whose code moved since they were written).
 *
 * Read-only, on the same token and plain-axios approach as BuilderGithubReadService. Fail-soft: an
 * unreachable GitHub means "unknown" (null), never a failed run.
 */
@Injectable()
export class ManualCodeFreshnessService {
  private readonly logger = LoggerService.getInstance(
    ManualCodeFreshnessService.name,
  );

  constructor(private readonly config: AppConfigService) {}

  private get configured(): boolean {
    return Boolean(this.config.githubToken);
  }

  private get repoPath(): string {
    return `${this.config.githubOrg}/${this.config.githubMonorepo}`;
  }

  private get headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.config.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /** master's head as a 12-character sha, or null. */
  async masterShortSha(): Promise<string | null> {
    if (!this.configured) return null;
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${this.repoPath}/commits/master`,
        { headers: this.headers, timeout: 10_000 },
      );
      const sha = typeof data?.sha === 'string' ? data.sha : null;
      return sha ? sha.slice(0, 12) : null;
    } catch (error) {
      this.logger.warn(
        `[PRODUCT_MANUAL] master sha unavailable: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  /** When the newest commit on master touching `folder` was made, or null. */
  async lastChangedAt(folder: string): Promise<Date | null> {
    if (!this.configured) return null;
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${this.repoPath}/commits`,
        {
          headers: this.headers,
          params: { sha: 'master', path: folder, per_page: 1 },
          timeout: 10_000,
        },
      );
      const date =
        data?.[0]?.commit?.committer?.date ?? data?.[0]?.commit?.author?.date;
      return date ? new Date(date) : null;
    } catch (error) {
      this.logger.warn(
        `[PRODUCT_MANUAL] last change of ${folder} unavailable: ${(error as Error)?.message}`,
      );
      return null;
    }
  }
}
