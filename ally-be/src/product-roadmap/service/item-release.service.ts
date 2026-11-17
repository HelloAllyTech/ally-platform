import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';

import { BuilderPullRequest } from 'src/builder/entity/builder-pull-request.entity';
import { AppConfigService } from 'src/config/config.service';
import {
  repoFromGithubUrl,
  repoName,
} from 'src/github/constants/github-repos.constants';
import {
  CompletedWorkflowRun,
  GithubActionsService,
  TagRef,
} from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  MOBILE_PROMOTE_WORKFLOW,
  NO_RELEASE_SERVICE,
  RELEASE_SERVICES,
  ReleaseServiceKey,
  touchedServices,
} from 'src/release/constants/release-services.constants';

import { ItemLinkedPr } from '../entity/item-linked-pr.entity';
import { ItemRelease } from '../entity/item-release.entity';
import {
  ItemLinkSource,
  ItemLinkState,
  ItemReleaseState,
} from '../enum/item-release.enum';
import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import {
  ReleaseRunLike,
  ResolvedTag,
  containedIn,
  extractOpportunityCodes,
  firstReleaseAfter,
  newestSuccessfulRun,
  normaliseOpportunityCode,
  opportunityShipped,
  parsePullRequestRef,
  releaseFailedSince,
  sortTagsNewestFirst,
  tagCreatedDuring,
  tagFromRunTitle,
} from '../util/item-release.util';
import { LinkedPrsResponseDto } from '../dto/item-release.dto';

/** Rows still in flight. A stage a person set — released, archived — is theirs and never revisited. */
const CANDIDATE_STAGES = [
  RoadmapOpportunityStage.NEW,
  RoadmapOpportunityStage.PRIORITISED,
];

/** GitHub reads for links per pass, so one backlog cannot spend the hour's rate limit. */
const LINKS_PER_PASS = 25;
/** How many of the newest tags are read to find the one a release made. */
const TAGS_TO_SCAN = 8;

const LOCK_NAME = 'roadmap-item-release-reconcile';

/**
 * A service's newest successful production release, as release tracking reads
 * it: the ref to compare merges against, the tag (when it could be named), and
 * the run history that says when a merge first went out or that a release
 * after it failed.
 */
interface ReleaseHead {
  /** A tag name, or the run's head commit when the tag could not be named. */
  ref: string;
  tag: string | null;
  runs: ReleaseRunLike[];
  /** For frontends: which app the head is for (`shippedApp` filter). */
  app?: string;
}

type HeadKey =
  | 'be'
  | 'ai'
  | 'learn'
  | 'frontend:admin'
  | 'frontend:helpline'
  | 'mobile';

export interface ItemReleaseReconcileResult {
  linked: number;
  resolved: number;
  live: number;
  released: number;
}

/**
 * Released, decided from what is actually in production (Roadmap v2, P1;
 * plan §5.4). Deterministic: no model call anywhere.
 *
 * 1. **Link** pull requests to opportunities: the Builder session's own
 *    (`builder_pull_requests`), any pull request whose title or branch names
 *    the opportunity's code, and any a person linked as "Built elsewhere".
 *    Merged pull requests are learned from the merge journal product updates
 *    already ingests (`product_update_sources`); open ones from one listing of
 *    the monorepo's open pull requests.
 * 2. **Resolve** each merged pull request to the services its files touch, as
 *    `item_releases` rows.
 * 3. **Evaluate** each row: live when its merge commit is an ancestor of the
 *    newest SUCCESSFUL production release tag for its service (GitHub compare
 *    `behind` / `identical`). Successful means the release workflow's run
 *    concluded `success`; a failed run still burns its tag (the tag is made
 *    before tests and deploy), so a tag alone proves nothing.
 * 4. **Release** an opportunity once every touched service of every merged
 *    pull request is live — however the release was cut.
 *
 * This replaces `reconcileShippedOpportunities`' reading of
 * `builder_pull_requests.releaseState`, which stayed null whenever Builder's
 * auto-release was off (so Builder work never reached Released) and counted
 * `skipped` as delivered (so work could reach it without being deployed).
 */
@Injectable()
export class ItemReleaseService {
  private readonly logger = LoggerService.getInstance(ItemReleaseService.name);

  constructor(
    @InjectRepository(ItemLinkedPr)
    private readonly linkRepository: Repository<ItemLinkedPr>,
    @InjectRepository(ItemRelease)
    private readonly releaseRepository: Repository<ItemRelease>,
    @InjectRepository(BuilderPullRequest)
    private readonly builderPullRequestRepository: Repository<BuilderPullRequest>,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly github: GithubActionsService,
    private readonly configService: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Entry points ───────────────────────────────────────────────────────────

  /**
   * The full pass: link, resolve, evaluate, release. Every 15 minutes, and
   * after a "Built elsewhere" link. Skipped (null) when another pass holds the
   * lock — the scheduler's 5- and 15-minute ticks fire together on the
   * quarter hour, under different scheduler locks.
   */
  async reconcile(): Promise<ItemReleaseReconcileResult | null> {
    return this.withLock(async () => {
      const result: ItemReleaseReconcileResult = {
        linked: 0,
        resolved: 0,
        live: 0,
        released: 0,
      };
      result.linked += await this.step('Builder links', () =>
        this.syncBuilderLinks(),
      );
      result.linked += await this.step('merged code links', () =>
        this.syncMergedCodeLinks(),
      );
      if (!this.github.isConfigured) {
        // Nothing below can be decided without GitHub. Links still recorded,
        // nothing released: "unknown" never becomes "live".
        return result;
      }
      result.linked += await this.step('open code links', () =>
        this.syncOpenCodeLinks(),
      );
      result.resolved = await this.step('resolve links', () =>
        this.resolveLinks(),
      );
      result.live = await this.step('evaluate releases', () =>
        this.evaluateReleases(),
      );
      result.released = await this.step('release shipped', () =>
        this.releaseShipped(),
      );
      if (result.live || result.released) {
        this.logger.info(
          `[ROADMAP-RELEASE] ${result.live} release row(s) went live; ${result.released} opportunit(ies) released.`,
        );
      }
      return result;
    });
  }

  /**
   * The quick check, every 5 minutes: re-evaluate waiting rows against the
   * newest successful releases, so an opportunity shows Released within
   * minutes of its release workflow finishing. ally-be receives no GitHub
   * webhooks, so "on release completion" is this poll. Costs nothing while
   * nothing waits; a pending row is only compared again once its service's
   * newest release has moved (`checkedRef`).
   */
  async watch(): Promise<void> {
    if (!this.github.isConfigured) return;
    const waiting = await this.releaseRepository.count({
      where: { state: In([ItemReleaseState.PENDING, ItemReleaseState.FAILED]) },
    });
    if (waiting === 0) return;
    await this.withLock(async () => {
      await this.step('evaluate releases', () => this.evaluateReleases());
      await this.step('release shipped', () => this.releaseShipped());
    });
  }

  /**
   * "Built elsewhere": link pull requests to an opportunity by hand, so work
   * built outside Builder reaches Released by the same detection.
   */
  async linkPullRequests(
    userId: number,
    code: string,
    inputs: string[],
  ): Promise<LinkedPrsResponseDto> {
    const opportunity = await this.findByCode(code);
    if (!this.github.isConfigured) {
      throw new ServiceUnavailableException(
        'GitHub is not configured on this environment, so pull requests cannot be read.',
      );
    }

    const monorepo = this.monorepoFullName();
    const org = this.configService.githubOrg.toLowerCase();
    const refs = new Map<string, { repo: string; number: number }>();
    for (const input of inputs) {
      const ref = parsePullRequestRef(input, monorepo);
      if (!ref) {
        throw new BadRequestException(
          `"${input}" is not a pull request. Paste a GitHub pull request link or number.`,
        );
      }
      if (ref.repo.split('/')[0].toLowerCase() !== org) {
        throw new BadRequestException(
          `${ref.repo} is outside ${this.configService.githubOrg}, so it cannot ship anything here.`,
        );
      }
      refs.set(`${ref.repo.toLowerCase()}#${ref.number}`, ref);
    }

    for (const { repo, number } of refs.values()) {
      const pr = await this.github.getPullRequest(repo, number);
      if (!pr) {
        throw new UnprocessableEntityException(
          `Could not read ${repo}#${number} on GitHub. Check the link and try again.`,
        );
      }
      await this.upsertLink({
        opportunityId: opportunity.id,
        repo,
        prNumber: number,
        prUrl: pr.htmlUrl || null,
        source: ItemLinkSource.MANUAL,
        state: pr.merged
          ? ItemLinkState.MERGED
          : pr.state === 'closed'
            ? ItemLinkState.CLOSED
            : ItemLinkState.OPEN,
        branch: pr.headRef,
        mergedAt: pr.mergedAt,
        createdBy: userId,
      });
    }
    this.logger.info(
      `[ROADMAP-RELEASE] User ${userId} linked ${refs.size} pull request(s) to ${opportunity.code}.`,
    );

    // Decide now rather than at the next tick, without making the person
    // wait on GitHub: the answer shows on the next read.
    void this.reconcile().catch((error) =>
      this.logger.warn(
        `[ROADMAP-RELEASE] Pass after linking failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );

    return this.describe(opportunity.id, opportunity.code);
  }

  // ── Linking ────────────────────────────────────────────────────────────────

  /** Builder's own pull requests, for every in-flight opportunity with a session. */
  async syncBuilderLinks(): Promise<number> {
    const opportunities = await this.opportunityRepository.find({
      where: {
        builderSessionId: Not(IsNull()),
        stage: In(CANDIDATE_STAGES),
      },
      select: { id: true, builderSessionId: true },
      take: 200,
    });
    if (opportunities.length === 0) return 0;
    const bySession = new Map(
      opportunities.map((row) => [row.builderSessionId!, row.id]),
    );
    const pullRequests = await this.builderPullRequestRepository.find({
      where: { sessionId: In([...bySession.keys()]) },
    });

    let linked = 0;
    for (const pr of pullRequests) {
      const opportunityId = bySession.get(pr.sessionId);
      if (!opportunityId) continue;
      // The stored URL names the repo the PR really lives in: a pre-cutover
      // PR is in its archived service repo, not the monorepo.
      const repo = repoFromGithubUrl(pr.prUrl) ?? this.github.fullRepo(pr.repo);
      const { created } = await this.upsertLink({
        opportunityId,
        repo,
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        source: ItemLinkSource.BUILDER,
        state: pr.merged
          ? ItemLinkState.MERGED
          : pr.state === 'closed'
            ? ItemLinkState.CLOSED
            : ItemLinkState.OPEN,
        title: pr.title ?? null,
        branch: pr.branch,
        mergedAt: pr.mergedAt ?? null,
      });
      linked += created;
    }
    return linked;
  }

  /**
   * Merged pull requests whose title or branch names an opportunity's code,
   * from the merge journal product updates ingests (`product_update_sources`,
   * filled every 30 minutes from the changelog). Those rows already carry the
   * merge commit and the changed files, so these links resolve with no GitHub
   * call at all.
   */
  async syncMergedCodeLinks(): Promise<number> {
    const sources: {
      repo: string;
      pr_number: number;
      pr_url: string | null;
      head_ref: string | null;
      head_sha: string | null;
      merged_at: Date;
      title: string | null;
      files: string[] | null;
      files_truncated: boolean;
    }[] = await this.dataSource.query(
      `SELECT "repo", "pr_number", "pr_url", "head_ref", "head_sha", "merged_at",
              "subjects"[1] AS "title", "files", "files_truncated"
         FROM "product_update_sources"
        WHERE "pr_number" IS NOT NULL
          AND "enriched_at" IS NOT NULL
          AND ("head_ref" ~* 'opp-[0-9]' OR "subjects"[1] ~* 'opp-[0-9]')`,
    );
    if (sources.length === 0) return 0;

    const codesBySource = sources.map((source) => [
      ...new Set([
        ...extractOpportunityCodes(source.title),
        ...extractOpportunityCodes(source.head_ref),
      ]),
    ]);
    const allCodes = [...new Set(codesBySource.flat())];
    if (allCodes.length === 0) return 0;
    const opportunities = await this.opportunityRepository.find({
      where: { code: In(allCodes) },
      select: { id: true, code: true },
    });
    const idByCode = new Map(opportunities.map((row) => [row.code, row.id]));

    let linked = 0;
    for (const [index, source] of sources.entries()) {
      const repo = repoFromGithubUrl(source.pr_url) ?? source.repo;
      for (const code of codesBySource[index]) {
        const opportunityId = idByCode.get(code);
        if (!opportunityId) continue;
        const { created, resolved } = await this.upsertLink({
          opportunityId,
          repo,
          prNumber: source.pr_number,
          prUrl: source.pr_url,
          source: ItemLinkSource.CODE,
          state: ItemLinkState.MERGED,
          title: source.title,
          branch: source.head_ref,
          mergedAt: source.merged_at,
          mergeSha: source.head_sha,
        });
        linked += created;
        if (resolved) continue;
        const files = source.files ?? [];
        // An unreadable file list is "unknown", left for resolveLinks to
        // read from GitHub; never "touched nothing".
        if (source.head_sha && files.length > 0) {
          await this.resolveFromFiles(
            opportunityId,
            repo,
            source.pr_number,
            source.head_sha,
            source.merged_at,
            files,
          );
        }
      }
    }
    return linked;
  }

  /**
   * Open monorepo pull requests whose title or branch names a code: one
   * listing per pass. So an epic whose next pull request is in review is not
   * called shipped on the strength of the first, and P4's "Building · in
   * Claude Code" has its signal.
   */
  async syncOpenCodeLinks(): Promise<number> {
    const monorepo = this.monorepoFullName();
    const open = await this.github.listPullRequests(monorepo);
    if (!open?.length) return 0;

    const matches = open
      .filter((pr) => pr.number !== null)
      .map((pr) => ({
        pr,
        codes: [
          ...new Set([
            ...extractOpportunityCodes(pr.title),
            ...extractOpportunityCodes(pr.headRef),
          ]),
        ],
      }))
      .filter((entry) => entry.codes.length > 0);
    if (matches.length === 0) return 0;

    const opportunities = await this.opportunityRepository.find({
      where: { code: In([...new Set(matches.flatMap((m) => m.codes))]) },
      select: { id: true, code: true },
    });
    const idByCode = new Map(opportunities.map((row) => [row.code, row.id]));

    let linked = 0;
    for (const { pr, codes } of matches) {
      for (const code of codes) {
        const opportunityId = idByCode.get(code);
        if (!opportunityId) continue;
        const { created } = await this.upsertLink({
          opportunityId,
          repo: monorepo,
          prNumber: pr.number!,
          prUrl: pr.htmlUrl || null,
          source: ItemLinkSource.CODE,
          state: ItemLinkState.OPEN,
          title: pr.title,
          branch: pr.headRef,
        });
        linked += created;
      }
    }
    return linked;
  }

  /**
   * Insert a link, or bring an existing one up to date. Says whether it was
   * new and whether its services are already resolved. `merged` is final: a later read that says otherwise (a stale
   * Builder row) never reopens it. The first source to link a PR keeps it.
   */
  private async upsertLink(link: {
    opportunityId: string;
    repo: string;
    prNumber: number;
    prUrl?: string | null;
    source: ItemLinkSource;
    state: ItemLinkState;
    title?: string | null;
    branch?: string | null;
    mergedAt?: Date | null;
    mergeSha?: string | null;
    createdBy?: number | null;
  }): Promise<{ created: number; resolved: boolean }> {
    const existing = await this.linkRepository.findOne({
      where: {
        opportunityId: link.opportunityId,
        repo: link.repo,
        prNumber: link.prNumber,
      },
    });
    if (!existing) {
      const result = await this.linkRepository
        .createQueryBuilder()
        .insert()
        .values({
          opportunityId: link.opportunityId,
          repo: link.repo,
          prNumber: link.prNumber,
          prUrl: link.prUrl ?? null,
          source: link.source,
          state: link.state,
          title: link.title ?? null,
          branch: link.branch?.slice(0, 255) ?? null,
          mergedAt: link.mergedAt ?? null,
          mergeSha: link.mergeSha ?? null,
          createdBy: link.createdBy ?? null,
        })
        .orIgnore()
        .execute();
      return {
        created: result.identifiers.filter(Boolean).length,
        resolved: false,
      };
    }

    const patch: Partial<ItemLinkedPr> = {};
    if (
      existing.state !== ItemLinkState.MERGED &&
      link.state !== existing.state
    ) {
      patch.state = link.state;
    }
    if (!existing.mergedAt && link.mergedAt) patch.mergedAt = link.mergedAt;
    if (!existing.mergeSha && link.mergeSha) patch.mergeSha = link.mergeSha;
    if (!existing.title && link.title) patch.title = link.title;
    if (!existing.branch && link.branch)
      patch.branch = link.branch.slice(0, 255);
    if (!existing.prUrl && link.prUrl) patch.prUrl = link.prUrl;
    if (Object.keys(patch).length > 0) {
      await this.linkRepository.update({ id: existing.id }, patch);
    }
    return { created: 0, resolved: Boolean(existing.servicesResolvedAt) };
  }

  // ── Resolving merged pull requests to services ─────────────────────────────

  /**
   * Read links GitHub still has to answer for: open ones (has it merged?) and
   * merged ones whose services are not yet known. Oldest-checked first and a
   * bounded number per pass, so a backlog drains over a few ticks instead of
   * spending the rate limit in one.
   */
  async resolveLinks(): Promise<number> {
    const links = await this.linkRepository
      .createQueryBuilder('link')
      .innerJoin(
        'roadmap_opportunities',
        'opp',
        'opp.id = link."opportunityId" AND opp."deletedAt" IS NULL',
      )
      .where('opp.stage IN (:...stages)', { stages: CANDIDATE_STAGES })
      .andWhere(
        `(link.state = :open OR (link.state = :merged AND link."servicesResolvedAt" IS NULL))`,
        { open: ItemLinkState.OPEN, merged: ItemLinkState.MERGED },
      )
      .orderBy('link."updatedAt"', 'ASC')
      .limit(LINKS_PER_PASS)
      .getMany();

    let resolved = 0;
    for (const link of links) {
      try {
        if (await this.resolveLink(link)) resolved += 1;
      } catch (error) {
        this.logger.warn(
          `[ROADMAP-RELEASE] Could not resolve ${link.repo}#${link.prNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return resolved;
  }

  private async resolveLink(link: ItemLinkedPr): Promise<boolean> {
    // Touch first, so a link GitHub cannot answer for goes to the back of the queue.
    await this.linkRepository.update(
      { id: link.id },
      { updatedAt: new Date() },
    );

    if (link.state === ItemLinkState.OPEN) {
      const pr = await this.github.getPullRequest(link.repo, link.prNumber);
      if (!pr) return false;
      if (!pr.merged) {
        if (pr.state === 'closed') {
          await this.linkRepository.update(
            { id: link.id },
            { state: ItemLinkState.CLOSED },
          );
        }
        return false;
      }
      link.mergedAt = pr.mergedAt;
    }

    const summary = await this.github.getPullRequestSummary(
      link.repo,
      link.prNumber,
    );
    const mergeSha = summary?.mergeCommitSha ?? link.mergeSha ?? null;
    if (!summary || !mergeSha) return false;
    const mergedAt = summary.mergedAt ?? link.mergedAt ?? null;
    await this.linkRepository.update(
      { id: link.id },
      {
        state: ItemLinkState.MERGED,
        mergeSha,
        mergedAt,
        title: link.title ?? (summary.title || null),
        branch: link.branch ?? summary.headRef?.slice(0, 255) ?? null,
      },
    );

    const { files } = await this.github.listPullRequestFiles(
      link.repo,
      link.prNumber,
    );
    // A truncated list still names the services it reached; only an empty
    // one is "unknown". GitHub caps the listing at 300 files.
    if (files.length === 0) return false;
    return this.resolveFromFiles(
      link.opportunityId,
      link.repo,
      link.prNumber,
      mergeSha,
      mergedAt,
      files,
    );
  }

  /**
   * Write one release row per service a merged pull request touched, and mark
   * the link resolved. A pull request that touched no service ships in
   * nothing: its `none` row is live from the merge.
   */
  private async resolveFromFiles(
    opportunityId: string,
    repo: string,
    prNumber: number,
    mergeSha: string,
    mergedAt: Date | null,
    files: string[],
  ): Promise<boolean> {
    const touched = touchedServices({
      repo,
      monorepo: this.configService.githubMonorepo,
      files,
    });
    if (touched.length === 0) return false;

    await this.releaseRepository
      .createQueryBuilder()
      .insert()
      .values(
        touched.map(({ service, apps }) => {
          const nothingToShip = service === NO_RELEASE_SERVICE;
          return {
            opportunityId,
            repo,
            prNumber,
            service,
            apps,
            mergeSha,
            mergedAt,
            state: nothingToShip
              ? ItemReleaseState.LIVE
              : ItemReleaseState.PENDING,
            releasedAt: nothingToShip ? mergedAt : null,
          };
        }),
      )
      .orIgnore()
      .execute();
    await this.linkRepository.update(
      { opportunityId, repo, prNumber, servicesResolvedAt: IsNull() },
      { servicesResolvedAt: new Date(), state: ItemLinkState.MERGED, mergeSha },
    );
    return true;
  }

  // ── Evaluating releases ────────────────────────────────────────────────────

  /**
   * Compare each waiting row's merge commit against its service's newest
   * successful release. Returns how many rows went live.
   */
  async evaluateReleases(): Promise<number> {
    const waiting = await this.releaseRepository.find({
      where: { state: In([ItemReleaseState.PENDING, ItemReleaseState.FAILED]) },
    });
    if (waiting.length === 0) return 0;

    const inFlight = new Set(
      (
        await this.opportunityRepository.find({
          where: {
            id: In([...new Set(waiting.map((row) => row.opportunityId))]),
            stage: In(CANDIDATE_STAGES),
          },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    const rows = waiting.filter((row) => inFlight.has(row.opportunityId));
    if (rows.length === 0) return 0;

    const heads = await this.loadHeads(
      new Set(rows.map((row) => row.service as ReleaseServiceKey)),
    );
    const compareCache = new Map<string, Promise<string | null>>();
    let live = 0;
    for (const row of rows) {
      try {
        if (await this.evaluateRow(row, heads, compareCache)) live += 1;
      } catch (error) {
        this.logger.warn(
          `[ROADMAP-RELEASE] Could not evaluate ${row.repo}#${row.prNumber} (${row.service}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return live;
  }

  private headKeysFor(row: ItemRelease): HeadKey[] {
    if (row.service === 'frontend') {
      if (row.apps === 'admin') return ['frontend:admin'];
      if (row.apps === 'helpline') return ['frontend:helpline'];
      return ['frontend:admin', 'frontend:helpline'];
    }
    return [row.service as HeadKey];
  }

  private async evaluateRow(
    row: ItemRelease,
    heads: Map<HeadKey, ReleaseHead | null>,
    compareCache: Map<string, Promise<string | null>>,
  ): Promise<boolean> {
    const keys = this.headKeysFor(row);
    const resolved = keys.map((key) => heads.get(key) ?? null);
    // No successful release can be read for the service: unknown, so wait.
    if (resolved.some((head) => !head)) return false;
    const rowHeads = resolved as ReleaseHead[];
    const checkedRef = rowHeads.map((head) => head.ref).join(',');
    const now = new Date();

    const failed = () =>
      row.mergedAt
        ? rowHeads.some((head) =>
            releaseFailedSince(head.runs, row.mergedAt!, head.app),
          )
        : false;

    if (row.checkedRef === checkedRef) {
      // Nothing new has released since the last compare; only the failure
      // verdict can have changed (a release after the merge has since failed).
      const state = failed()
        ? ItemReleaseState.FAILED
        : ItemReleaseState.PENDING;
      if (state !== row.state) {
        await this.releaseRepository.update(
          { id: row.id },
          { state, lastCheckedAt: now },
        );
      }
      return false;
    }

    const folder = RELEASE_SERVICES[row.service as ReleaseServiceKey].folder;
    const statuses = await Promise.all(
      rowHeads.map((head) => {
        const key = `${folder}|${head.ref}|${row.mergeSha}`;
        if (!compareCache.has(key)) {
          compareCache.set(
            key,
            this.github.compareStatus(folder, head.ref, row.mergeSha),
          );
        }
        return compareCache.get(key)!;
      }),
    );
    // GitHub could not answer one of them: unknown, so try again next pass.
    if (statuses.some((status) => status === null)) {
      await this.releaseRepository.update(
        { id: row.id },
        { lastCheckedAt: now },
      );
      return false;
    }

    if (statuses.every(containedIn)) {
      const times = rowHeads.map((head) =>
        row.mergedAt
          ? firstReleaseAfter(head.runs, row.mergedAt, head.app)
          : null,
      );
      const releasedAt = times.every(Boolean)
        ? new Date(Math.max(...times.map((time) => time!.getTime())))
        : null;
      const tags = [
        ...new Set(rowHeads.map((head) => head.tag).filter(Boolean)),
      ].join(', ');
      await this.releaseRepository.update(
        { id: row.id },
        {
          state: ItemReleaseState.LIVE,
          tag: tags ? tags.slice(0, 80) : null,
          releasedAt,
          checkedRef: checkedRef.slice(0, 200),
          lastCheckedAt: now,
        },
      );
      return true;
    }

    await this.releaseRepository.update(
      { id: row.id },
      {
        state: failed() ? ItemReleaseState.FAILED : ItemReleaseState.PENDING,
        checkedRef: checkedRef.slice(0, 200),
        lastCheckedAt: now,
      },
    );
    return false;
  }

  /**
   * The newest successful release for each service a pass needs, read once.
   * Null for a service whose history cannot be read or has no success yet.
   */
  private async loadHeads(
    services: Set<ReleaseServiceKey>,
  ): Promise<Map<HeadKey, ReleaseHead | null>> {
    const heads = new Map<HeadKey, ReleaseHead | null>();
    for (const service of services) {
      try {
        if (service === 'frontend') {
          const [admin, helpline] = await this.frontendHeads();
          heads.set('frontend:admin', admin);
          heads.set('frontend:helpline', helpline);
        } else if (service === 'mobile') {
          heads.set('mobile', await this.mobileHead());
        } else if (RELEASE_SERVICES[service]) {
          heads.set(service, await this.serverHead(service));
        }
      } catch (error) {
        this.logger.warn(
          `[ROADMAP-RELEASE] Could not read the ${service} release history: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return heads;
  }

  /** be / ai / learn: their run titles do not carry the tag, so it is matched to the run by time. */
  private async serverHead(
    service: 'be' | 'ai' | 'learn',
  ): Promise<ReleaseHead | null> {
    const spec = RELEASE_SERVICES[service];
    const runs = await this.github.listCompletedRuns({
      repo: spec.folder,
      workflow: spec.workflow,
    });
    if (!runs) return null;
    const success = newestSuccessfulRun(runs);
    if (!success) return null;
    const tag = await this.tagMadeBy(spec.folder, spec.tagPrefix, success);
    const ref = tag?.name ?? success.headSha;
    return ref ? { ref, tag: tag?.name ?? null, runs } : null;
  }

  /** The two dashboards share a workflow and a tag series; each run's title names its tag and its apps. */
  private async frontendHeads(): Promise<
    [ReleaseHead | null, ReleaseHead | null]
  > {
    const spec = RELEASE_SERVICES.frontend;
    const runs = await this.github.listCompletedRuns({
      repo: spec.folder,
      workflow: spec.workflow,
    });
    if (!runs) return [null, null];
    const headFor = (app: 'admin' | 'helpline'): ReleaseHead | null => {
      const success = newestSuccessfulRun(runs, app);
      if (!success) return null;
      const tag = tagFromRunTitle(success.title, spec.tagPrefix);
      const ref = tag ?? success.headSha;
      return ref ? { ref, tag, runs, app } : null;
    };
    return [headFor('admin'), headFor('helpline')];
  }

  /**
   * ally-mobile reaches users in two steps: a production build to the Play
   * internal track, then a promotion to production (by hand). Live = an
   * ancestor of the newest `auto-release/*` tag made before the newest
   * successful build that a successful promotion followed. iOS goes through
   * App Store review, which Actions cannot see; Android's promotion is the
   * signal product-update liveness uses too.
   */
  private async mobileHead(): Promise<ReleaseHead | null> {
    const spec = RELEASE_SERVICES.mobile;
    const [builds, promotions] = await Promise.all([
      this.github.listCompletedRuns({
        repo: spec.folder,
        workflow: spec.workflow,
      }),
      this.github.listCompletedRuns({
        repo: spec.folder,
        workflow: MOBILE_PROMOTE_WORKFLOW,
      }),
    ]);
    if (!builds || !promotions) return null;
    const promotion = newestSuccessfulRun(promotions);
    if (!promotion) return null;
    const build = newestSuccessfulRun(
      builds.filter(
        (run) => run.finishedAt.getTime() <= promotion.startedAt.getTime(),
      ),
    );
    if (!build) return null;

    const tags = await this.newestTags(
      spec.folder,
      spec.tagPrefix,
      (tag) => tag.at.getTime() <= build.startedAt.getTime(),
    );
    const tag = tags
      .filter((entry) => entry.at.getTime() <= build.startedAt.getTime())
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return tag ? { ref: tag.name, tag: tag.name, runs: [] } : null;
  }

  /** The tag a release run made, or null when none of the newest tags dates inside it. */
  private async tagMadeBy(
    folder: string,
    prefix: string,
    run: CompletedWorkflowRun,
  ): Promise<ResolvedTag | null> {
    const tags = await this.newestTags(
      folder,
      prefix,
      (tag) => tag.at.getTime() < run.createdAt.getTime() - 2 * 60 * 1000,
    );
    return tagCreatedDuring(tags, run);
  }

  /**
   * The newest tags of a series, resolved to commit and date, newest version
   * first, stopping once `stopAt` says the rest are too old to matter.
   */
  private async newestTags(
    folder: string,
    prefix: string,
    stopAt: (tag: ResolvedTag) => boolean,
  ): Promise<ResolvedTag[]> {
    const refs = await this.github.listTagRefs(folder, prefix);
    if (!refs) return [];
    const byName = new Map<string, TagRef>(refs.map((ref) => [ref.name, ref]));
    const resolved: ResolvedTag[] = [];
    for (const name of sortTagsNewestFirst([...byName.keys()], prefix).slice(
      0,
      TAGS_TO_SCAN,
    )) {
      const target = await this.github.resolveTag(folder, byName.get(name)!);
      if (!target) continue;
      const tag = { name, commitSha: target.commitSha, at: target.at };
      resolved.push(tag);
      if (stopAt(tag)) break;
    }
    return resolved;
  }

  // ── Releasing opportunities ────────────────────────────────────────────────

  /** Release every in-flight opportunity whose linked work is all live. */
  async releaseShipped(): Promise<number> {
    const linked = await this.linkRepository
      .createQueryBuilder('link')
      .select('DISTINCT link."opportunityId"', 'opportunityId')
      .innerJoin(
        'roadmap_opportunities',
        'opp',
        'opp.id = link."opportunityId" AND opp."deletedAt" IS NULL',
      )
      .where('opp.stage IN (:...stages)', { stages: CANDIDATE_STAGES })
      .getRawMany<{ opportunityId: string }>();
    const ids = linked.map((row) => row.opportunityId);
    if (ids.length === 0) return 0;

    const [links, releases] = await Promise.all([
      this.linkRepository.find({ where: { opportunityId: In(ids) } }),
      this.releaseRepository.find({ where: { opportunityId: In(ids) } }),
    ]);

    let released = 0;
    for (const id of ids) {
      const verdict = opportunityShipped(
        links.filter((link) => link.opportunityId === id),
        releases.filter((row) => row.opportunityId === id),
      );
      if (!verdict.shipped) continue;
      if (await this.markReleased(id, verdict.liveAt)) released += 1;
    }
    return released;
  }

  /**
   * The one write that moves an opportunity to Released on evidence — the
   * same stage write the old reconcile made (stage and `releasedAt`, nothing
   * else; that reconcile had no other side effects to preserve).
   *
   * Compare-and-set on the stage: only a row still in flight moves, so a
   * person archiving or releasing it by hand in the meantime wins, and a
   * second pass cannot re-stamp `releasedAt`. Never downgrades.
   *
   * `releasedAt` is when the work went live where that is known, so a card
   * released late lands in the month it shipped; "now" otherwise, as before.
   */
  async markReleased(
    opportunityId: string,
    liveAt: Date | null,
  ): Promise<boolean> {
    const result = await this.opportunityRepository.update(
      { id: opportunityId, stage: In(CANDIDATE_STAGES) },
      {
        stage: RoadmapOpportunityStage.RELEASED,
        releasedAt: liveAt ?? new Date(),
      },
    );
    if (!result.affected) return false;
    this.logger.info(
      `[ROADMAP] Opportunity ${opportunityId} released: every service its merged pull requests touched is in a successful production release.`,
    );
    return true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** The linked pull requests and their release rows, for a response. */
  async describe(
    opportunityId: string,
    code: string,
  ): Promise<LinkedPrsResponseDto> {
    const [links, releases] = await Promise.all([
      this.linkRepository.find({
        where: { opportunityId },
        order: { createdAt: 'ASC' },
      }),
      this.releaseRepository.find({ where: { opportunityId } }),
    ]);
    return {
      code,
      linkedPrs: links.map((link) => ({
        repo: link.repo,
        prNumber: link.prNumber,
        prUrl: link.prUrl ?? null,
        source: link.source,
        state: link.state,
        title: link.title ?? null,
        mergedAt: link.mergedAt ?? null,
        releases: releases
          .filter(
            (row) => row.repo === link.repo && row.prNumber === link.prNumber,
          )
          .map((row) => ({
            service: row.service,
            apps: row.apps ?? null,
            state: row.state,
            tag: row.tag ?? null,
            releasedAt: row.releasedAt ?? null,
          })),
      })),
    };
  }

  private async findByCode(input: string) {
    const code = normaliseOpportunityCode(input);
    const opportunity = code
      ? await this.opportunityRepository.findOne({
          where: { code },
          select: { id: true, code: true },
        })
      : null;
    if (!opportunity) {
      throw new NotFoundException(`No roadmap item ${input}.`);
    }
    return opportunity;
  }

  /** "owner/ally-platform". */
  private monorepoFullName(): string {
    return `${this.configService.githubOrg}/${repoName(
      this.configService.githubMonorepo,
    )}`;
  }

  private async step(
    name: string,
    work: () => Promise<number>,
  ): Promise<number> {
    try {
      return await work();
    } catch (error) {
      this.logger.warn(
        `[ROADMAP-RELEASE] ${name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }

  /**
   * One pass at a time across replicas and ticks: a Postgres session advisory
   * lock on a connection of its own (the pattern the scheduler and Debrief's
   * defaults check use). Null when another pass holds it.
   */
  private async withLock<T>(work: () => Promise<T>): Promise<T | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = await runner.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [LOCK_NAME],
      );
      if (!rows?.[0]?.locked) return null;
      try {
        return await work();
      } finally {
        await runner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
          LOCK_NAME,
        ]);
      }
    } finally {
      await runner.release();
    }
  }
}
