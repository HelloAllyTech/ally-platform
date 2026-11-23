import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AppConfigService } from 'src/config/config.service';
import { repoName } from 'src/github/constants/github-repos.constants';
import {
  CommitFiles,
  GithubActionsService,
} from 'src/github/service/github-actions.service';
import { FrontendApp } from 'src/release/constants/release-services.constants';

import {
  COMMIT_FILE_CACHE_SIZE,
  COMMIT_FILE_READS_PER_PASS,
  RELEASE_POLICY_SERVICES,
  PolicyServiceKey,
} from '../constants/release-policy.constants';
import { ItemLinkedPr } from '../entity/item-linked-pr.entity';
import {
  RangeClassification,
  ServiceReleasePlan,
  classifyRange,
  compileHeldRules,
  mergeRangeClassifications,
} from '../util/release-policy.util';
import {
  HeadKey,
  ItemReleaseService,
  ReleaseHead,
} from './item-release.service';

/** One pass's plans, with the reads they were built from. */
export interface ReleasePlans {
  /** The master commit every plan was computed against; null when unreadable. */
  masterSha: string | null;
  plans: Map<PolicyServiceKey, ServiceReleasePlan>;
  heads: Map<HeadKey, ReleaseHead | null>;
}

const EMPTY_CLASSIFICATION: RangeClassification = {
  commits: [],
  heldReasons: [],
  apps: null,
  prNumbers: [],
  lastChangeAt: null,
  serviceHeadSha: null,
  unknown: null,
};

/**
 * What each service's next production release would ship (plan §5.5.1):
 * `lastSuccessfulProdTag...master`, every commit in it classified, the held
 * reasons, and the ideas linked to those commits. Reads GitHub; the rules are
 * in `release-policy.util`. Writes nothing.
 *
 * The base is the newest SUCCESSFUL release, as release tracking reads it
 * (`ItemReleaseService.releaseHeads`): a failed run still burns its tag, so
 * the newest tag is not what is live.
 */
@Injectable()
export class ReleasePlanService {
  /** A commit's files never change, so each is read once per process. */
  private readonly fileCache = new Map<string, CommitFiles>();

  constructor(
    private readonly github: GithubActionsService,
    private readonly itemReleaseService: ItemReleaseService,
    private readonly configService: AppConfigService,
    @InjectRepository(ItemLinkedPr)
    private readonly linkRepository: Repository<ItemLinkedPr>,
  ) {}

  /** Every policy service's plan against one read of master. */
  async buildPlans(heldPaths: readonly string[]): Promise<ReleasePlans> {
    const repo = this.monorepo();
    const masterSha = await this.github.getBranchSha(repo, 'master');
    const heads = await this.itemReleaseService.releaseHeads(
      RELEASE_POLICY_SERVICES,
    );
    const rules = compileHeldRules(heldPaths);
    const budget = { reads: COMMIT_FILE_READS_PER_PASS };
    const plans = new Map<PolicyServiceKey, ServiceReleasePlan>();

    for (const service of RELEASE_POLICY_SERVICES) {
      let classification: RangeClassification;
      let baseRef: string | null = null;
      let baseTag: string | null = null;

      if (service === 'frontend') {
        const admin = heads.get('frontend:admin') ?? null;
        const helpline = heads.get('frontend:helpline') ?? null;
        baseRef = admin?.ref ?? helpline?.ref ?? null;
        baseTag = admin?.tag ?? helpline?.tag ?? null;
        const [a, h] = [
          await this.classify(
            service,
            admin,
            masterSha,
            rules,
            budget,
            'admin',
          ),
          await this.classify(
            service,
            helpline,
            masterSha,
            rules,
            budget,
            'helpline',
          ),
        ];
        classification = mergeRangeClassifications(a, h);
      } else {
        const head = heads.get(service) ?? null;
        baseRef = head?.ref ?? null;
        baseTag = head?.tag ?? null;
        classification = await this.classify(
          service,
          head,
          masterSha,
          rules,
          budget,
        );
      }

      plans.set(service, {
        ...classification,
        service,
        baseRef,
        baseTag,
        headSha: masterSha,
        opportunityIds: await this.opportunitiesOf(classification),
      });
    }
    return { masterSha, plans, heads };
  }

  /**
   * How many commits touching `service` lie between two master commits, in
   * either direction. The cutover check uses it: a human release "matches"
   * the policy when it carries exactly the service commits the policy saw.
   * Null when it cannot be read this pass.
   */
  async serviceCommitsBetween(
    service: PolicyServiceKey,
    fromSha: string,
    toSha: string,
    app?: FrontendApp,
  ): Promise<number | null> {
    if (fromSha === toSha) return 0;
    const repo = this.monorepo();
    let graph = await this.github.compareCommitGraph(repo, fromSha, toSha);
    if (graph?.status === 'behind') {
      graph = await this.github.compareCommitGraph(repo, toSha, fromSha);
    }
    if (!graph || graph.truncated || graph.status === 'diverged') return null;
    const budget = { reads: COMMIT_FILE_READS_PER_PASS };
    if (!(await this.loadFiles(graph.commits, budget))) return null;
    const result = classifyRange({
      service,
      app,
      commits: graph.commits,
      filesOf: (sha) => this.fileCache.get(sha),
      rules: [],
      rangeTruncated: false,
    });
    return result.unknown
      ? null
      : result.commits.filter((c) => !c.merge).length;
  }

  private async classify(
    service: PolicyServiceKey,
    head: ReleaseHead | null,
    masterSha: string | null,
    rules: ReturnType<typeof compileHeldRules>,
    budget: { reads: number },
    app?: FrontendApp,
  ): Promise<RangeClassification> {
    const unknown = (why: string): RangeClassification => ({
      ...EMPTY_CLASSIFICATION,
      unknown: why,
    });
    if (!masterSha) return unknown('could not read master');
    if (!head) {
      return unknown(
        `no successful production release of ${app ? `${service} (${app})` : service} could be read`,
      );
    }
    const graph = await this.github.compareCommitGraph(
      this.monorepo(),
      head.ref,
      masterSha,
    );
    if (!graph) return unknown(`could not compare ${head.ref}...master`);
    if (graph.status === 'behind' || graph.status === 'identical') {
      return { ...EMPTY_CLASSIFICATION };
    }
    if (!(await this.loadFiles(graph.commits, budget))) {
      return unknown('still reading the files of the range');
    }
    return classifyRange({
      service,
      app,
      commits: graph.commits,
      filesOf: (sha) => this.fileCache.get(sha),
      rules,
      rangeTruncated: graph.truncated,
    });
  }

  /**
   * Read the files of every non-merge commit not yet cached, within the
   * pass's budget. False when the budget ran out first; a commit GitHub
   * would not list stays uncached and `classifyRange` reports it unknown.
   */
  private async loadFiles(
    commits: { sha: string; parents: string[] }[],
    budget: { reads: number },
  ): Promise<boolean> {
    for (const commit of commits) {
      if (commit.parents.length > 1 || this.fileCache.has(commit.sha)) continue;
      if (budget.reads <= 0) return false;
      budget.reads -= 1;
      const files = await this.github.getCommitFiles(
        this.monorepo(),
        commit.sha,
      );
      if (!files) continue;
      if (this.fileCache.size >= COMMIT_FILE_CACHE_SIZE) {
        const oldest = this.fileCache.keys().next().value;
        if (oldest !== undefined) this.fileCache.delete(oldest);
      }
      this.fileCache.set(commit.sha, files);
    }
    return true;
  }

  /** Ideas whose linked pull requests (or merge commits) are in the range. */
  private async opportunitiesOf(
    classification: RangeClassification,
  ): Promise<string[]> {
    const shas = classification.commits.map((commit) => commit.sha);
    if (!shas.length) return [];
    const repo = this.monorepoFullName();
    const where = [
      ...(classification.prNumbers.length
        ? [{ repo, prNumber: In(classification.prNumbers) }]
        : []),
      { mergeSha: In(shas) },
    ];
    const links = await this.linkRepository.find({ where });
    return [...new Set(links.map((link) => link.opportunityId))].sort();
  }

  private monorepo(): string {
    return repoName(this.configService.githubMonorepo);
  }

  private monorepoFullName(): string {
    return `${this.configService.githubOrg}/${this.monorepo()}`;
  }
}
