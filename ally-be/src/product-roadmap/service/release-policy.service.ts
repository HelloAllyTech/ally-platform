import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';

import { BUILDER_RELEASE_SETTLE_MS } from 'src/builder/constants/builder.constants';
import { AppConfigService } from 'src/config/config.service';
import {
  CompletedWorkflowRun,
  GithubActionsService,
} from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  RELEASE_TARGETS,
  ReleaseTarget,
} from 'src/release/constants/release-targets.constants';
import { FrontendApps } from 'src/release/constants/release-services.constants';
import { ProductionReleaseService } from 'src/release/service/production-release.service';

import {
  RELEASE_BREAKER_THRESHOLD,
  RELEASE_HEALTH_ATTEMPTS,
  RELEASE_POLICY_SERVICES,
  PolicyServiceKey,
  isPolicyServiceKey,
} from '../constants/release-policy.constants';
import { ReleasePolicyLog } from '../entity/release-policy-log.entity';
import {
  ReleasePolicyBreakerEvent,
  ReleasePolicyComparison,
  ReleasePolicyDecision,
  ReleasePolicyLogKind,
  ReleasePolicyMode,
  ReleasePolicyOrigin,
  ReleasePolicyOutcome,
} from '../enum/release-policy.enum';
import {
  newestSuccessfulRun,
  tagFromRunTitle,
} from '../util/item-release.util';
import {
  PolicyVerdict,
  ServiceReleasePlan,
  comparisonFromDecision,
  consecutiveFailures,
  decideReleases,
  unverifiedBackends,
} from '../util/release-policy.util';
import { HeadKey, ReleaseHead } from './item-release.service';
import { ReleasePlanService, ReleasePlans } from './release-plan.service';
import { ReleasePolicyAccessService } from './release-policy-access.service';
import { ReleasePolicyOwnerNotifier } from './release-policy-notifier';
import {
  ReleasePolicySettings,
  ReleasePolicySettingsService,
} from './release-policy-settings.service';

const LOCK_NAME = 'roadmap-release-policy';

/**
 * The mode the policy runs in. **P5 is shadow only**: whatever the settings
 * say, the policy computes and logs and never dispatches. It takes no
 * settings on purpose: nothing stored can change the answer.
 *
 * Going live is a later, deliberate change, after at least five shadow cycles
 * and the cutover check (plan §7): this function takes the settings and returns
 * `settings.autoReleaseEnabled && settings.autoReleasePolicyLive ? LIVE : SHADOW`,
 * and the dispatch for a `release` decision is added in `recordDecisions`.
 * Neither exists in this phase, so no setting can make it dispatch.
 */
export function policyMode(): ReleasePolicyMode {
  return ReleasePolicyMode.SHADOW;
}

/** The release a service's plan would dispatch, by its apps for the frontend. */
export function releaseTargetFor(
  service: PolicyServiceKey,
  apps: FrontendApps | null,
): ReleaseTarget {
  if (service === 'be') return RELEASE_TARGETS['ally-be'];
  if (service === 'ai') return RELEASE_TARGETS['ally-ai'];
  if (service === 'learn') return RELEASE_TARGETS['ally-ai-learn'];
  if (apps === 'admin') return RELEASE_TARGETS['ally-web:admin'];
  if (apps === 'helpline') return RELEASE_TARGETS['ally-web:helpline'];
  return RELEASE_TARGETS['ally-web:frontends'];
}

/** The key Builder's health URLs are stored under for a target. */
function healthKeyFor(service: PolicyServiceKey, apps: string | null): string {
  if (service === 'be') return 'ally-be';
  if (service === 'ai') return 'ally-ai';
  if (service === 'learn') return 'ally-ai-learn';
  if (apps === 'admin') return 'ally-web:admin';
  if (apps === 'helpline') return 'ally-web:helpline';
  return 'ally-web:frontends';
}

/** The plan behind the idea page's Ship tab and the release dialog. */
export interface ReleasePlanView {
  service: PolicyServiceKey;
  apps: FrontendApps | null;
  baseTag: string | null;
  baseRef: string | null;
  headSha: string | null;
  /** Echo it back to `POST /v1/roadmap/release`: a release is refused if more landed since. */
  serviceHeadSha: string | null;
  /** The tag a release would take now. Read only; nothing is created. */
  nextTag: string | null;
  commits: ServiceReleasePlan['commits'];
  heldReasons: ServiceReleasePlan['heldReasons'];
  held: boolean;
  opportunityIds: string[];
  unknown: string | null;
  /** What the policy would do with this service right now. */
  decision: PolicyVerdict;
  mode: ReleasePolicyMode;
  breaker: { pausedAt: Date | null; reason: string | null };
  canRelease: boolean;
}

/**
 * The auto-release policy (Roadmap v2, P5; plan §5.5, D5/D6), in shadow mode.
 *
 * Every five minutes it works out what each service's next release would ship
 * and what it would do about it — release, hold for a click, debounce, wait
 * for the window or for the backends — and writes that to
 * `release_policy_log` and the app log ("would release be-v… with these
 * commits"). It also records every production release humans actually made in
 * the same window and how each compares with its decision, which is the
 * cutover check. **It never dispatches.**
 *
 * The one thing here that dispatches is a person's Release click
 * (`release`), behind the `roadmap_v2` flag and the Owner/lead check.
 */
@Injectable()
export class ReleasePolicyService {
  private readonly logger = LoggerService.getInstance(
    ReleasePolicyService.name,
  );
  /** When the policy started logging; releases before it are history, not observations. */
  private observingSince: Date | null = null;

  constructor(
    @InjectRepository(ReleasePolicyLog)
    private readonly logRepository: Repository<ReleasePolicyLog>,
    private readonly planService: ReleasePlanService,
    private readonly settingsService: ReleasePolicySettingsService,
    private readonly accessService: ReleasePolicyAccessService,
    private readonly notifier: ReleasePolicyOwnerNotifier,
    private readonly github: GithubActionsService,
    private readonly releaseService: ProductionReleaseService,
    private readonly configService: AppConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // ── The shadow pass ────────────────────────────────────────────────────────

  /**
   * One pass: plan, observe what humans released, decide, log, check the
   * breaker. Runs whatever `roadmap_v2` says, because the shadow log has to
   * exist before the switch (cutover checklist); it only reads GitHub and
   * writes its own table. Skipped when another pass holds the lock.
   */
  async tick(now = new Date()): Promise<void> {
    if (!this.github.isConfigured) return;
    await this.withLock(async () => {
      const settings = await this.settingsService.get();
      const mode = policyMode();
      const built = await this.planService.buildPlans(settings.heldPaths);
      await this.observeReleases(built, now);
      await this.checkHealth(now);
      const verdicts = decideReleases({
        plans: built.plans,
        now,
        pausedAt: settings.autoReleasePausedAt,
        window: settings.releaseWindow,
        unverifiedBackends: unverifiedBackends(
          await this.recentBackendReleases(now),
          now,
        ),
      });
      await this.recordDecisions(built, verdicts, mode);
      await this.evaluateBreaker(settings);
    });
  }

  /**
   * Log each service's decision when it changes, and say what a release would
   * be. In shadow mode this is the whole effect of a `release` decision.
   */
  private async recordDecisions(
    built: ReleasePlans,
    verdicts: Map<PolicyServiceKey, PolicyVerdict>,
    mode: ReleasePolicyMode,
  ): Promise<void> {
    for (const service of RELEASE_POLICY_SERVICES) {
      const plan = built.plans.get(service);
      const verdict = verdicts.get(service);
      if (!plan || !verdict) continue;

      const last = await this.logRepository.findOne({
        where: { kind: ReleasePolicyLogKind.DECISION, service },
        order: { createdAt: 'DESC' },
      });
      if (
        last &&
        last.decision === verdict.decision &&
        (last.baseRef ?? null) === plan.baseRef &&
        (last.serviceHeadSha ?? null) === plan.serviceHeadSha &&
        (last.apps ?? null) === plan.apps
      ) {
        continue;
      }

      const tag =
        verdict.decision === ReleasePolicyDecision.RELEASE
          ? await this.nextTag(service, plan.apps)
          : null;
      await this.logRepository.save(
        this.logRepository.create({
          kind: ReleasePolicyLogKind.DECISION,
          mode,
          service,
          apps: plan.apps,
          decision: verdict.decision,
          reason: verdict.readyAt
            ? `${verdict.reason ?? ''}; releasable from ${verdict.readyAt.toISOString()}`
            : verdict.reason,
          baseRef: plan.baseRef,
          baseTag: plan.baseTag,
          headSha: plan.headSha,
          serviceHeadSha: plan.serviceHeadSha,
          tag,
          commits: plan.commits,
          heldReasons: plan.heldReasons,
          opportunityIds: plan.opportunityIds,
        }),
      );

      const shas = plan.commits
        .filter((commit) => !commit.merge)
        .map((commit) => commit.sha.slice(0, 7));
      if (verdict.decision === ReleasePolicyDecision.RELEASE) {
        this.logger.info(
          `[RELEASE-POLICY ${mode}] would release ${tag ?? service}${plan.apps ? ` [apps=${plan.apps}]` : ''} ` +
            `from ${plan.baseTag ?? plan.baseRef} with ${shas.length} commit(s): ${shas.join(', ')}` +
            (plan.prNumbers.length
              ? ` (PRs #${plan.prNumbers.join(', #')})`
              : ''),
        );
      } else if (verdict.decision !== ReleasePolicyDecision.NOTHING) {
        this.logger.info(
          `[RELEASE-POLICY ${mode}] ${service}: ${verdict.decision}${verdict.reason ? ` (${verdict.reason})` : ''}, ` +
            `${shas.length} unreleased commit(s)`,
        );
      }
    }
  }

  // ── What humans released ───────────────────────────────────────────────────

  /**
   * Record each production release run that finished since the policy began
   * logging, whoever cut it, and how it compares with the policy's last
   * decision for that service before the run started.
   */
  private async observeReleases(built: ReleasePlans, now: Date): Promise<void> {
    const since = await this.observationStart(now);
    const sources: [PolicyServiceKey, HeadKey][] = [
      ['be', 'be'],
      ['ai', 'ai'],
      ['learn', 'learn'],
      ['frontend', 'frontend:admin'],
    ];
    for (const [service, key] of sources) {
      // The two dashboards share one workflow, so either head carries its runs.
      const head =
        built.heads.get(key) ??
        (service === 'frontend'
          ? built.heads.get('frontend:helpline')
          : null) ??
        null;
      if (!head) continue;
      const fresh = head.runs.filter(
        (run) => run.startedAt.getTime() >= since.getTime(),
      );
      if (!fresh.length) continue;
      const seen = new Set(
        (
          await this.logRepository.find({
            where: {
              kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
              runId: In(fresh.map((run) => run.id)),
            },
          })
        ).map((row) => row.runId),
      );
      for (const run of fresh) {
        if (seen.has(run.id)) continue;
        await this.recordObservedRelease(service, head, run);
      }
    }
    await this.compareObservedReleases();
  }

  private async recordObservedRelease(
    service: PolicyServiceKey,
    head: ReleaseHead,
    run: CompletedWorkflowRun,
  ): Promise<void> {
    const apps =
      service === 'frontend'
        ? (/\[apps=([a-z]+)\]/.exec(run.title)?.[1] ?? 'both')
        : null;
    const prefix = releaseTargetFor(service, null).tagPrefix;
    const tag =
      service === 'frontend'
        ? tagFromRunTitle(run.title, prefix)
        : newestSuccessfulRun(head.runs) === run
          ? head.tag
          : null;
    const succeeded = run.conclusion === 'success';
    const origin = await this.originOf(service, tag, run);
    try {
      await this.logRepository.save(
        this.logRepository.create({
          kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
          mode: ReleasePolicyMode.SHADOW,
          service,
          apps: ['admin', 'helpline', 'both'].includes(apps ?? '')
            ? apps
            : null,
          headSha: run.headSha,
          tag,
          runId: run.id,
          runUrl: run.htmlUrl || null,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          outcome: succeeded
            ? ReleasePolicyOutcome.SUCCEEDED
            : ReleasePolicyOutcome.FAILED,
          origin,
          reason: succeeded ? null : run.conclusion,
        }),
      );
      this.logger.info(
        `[RELEASE-POLICY] observed ${origin} release of ${service}${tag ? ` ${tag}` : ''}: ${run.conclusion ?? 'unknown'}.`,
      );
    } catch (error) {
      // Another replica recorded the same run first (unique on runId).
      this.logger.warn(
        `[RELEASE-POLICY] could not record release run ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** A Release click this run answered, by tag or by dispatch time; otherwise a human. */
  private async originOf(
    service: PolicyServiceKey,
    tag: string | null,
    run: CompletedWorkflowRun,
  ): Promise<ReleasePolicyOrigin> {
    const clicks = await this.logRepository.find({
      where: { kind: ReleasePolicyLogKind.MANUAL_RELEASE, service },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const hit = clicks.find((click) => {
      if (tag && click.tag) return click.tag === tag;
      const at = click.startedAt?.getTime() ?? 0;
      return (
        run.createdAt.getTime() >= at - 60_000 &&
        run.createdAt.getTime() <= at + 5 * 60_000
      );
    });
    return hit ? ReleasePolicyOrigin.MANUAL_CLICK : ReleasePolicyOrigin.HUMAN;
  }

  /**
   * The cutover check, per observed release not yet compared: the policy's
   * last decision for the service before the run started, and — when that
   * decision was `release` — whether the release carried exactly the service
   * commits the policy saw.
   */
  private async compareObservedReleases(): Promise<void> {
    const pending = await this.logRepository.find({
      where: {
        kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
        comparison: IsNull(),
      },
      order: { createdAt: 'ASC' },
      take: 20,
    });
    for (const row of pending) {
      if (!row.service || !isPolicyServiceKey(row.service)) continue;
      const decision = row.startedAt
        ? await this.logRepository.findOne({
            where: {
              kind: ReleasePolicyLogKind.DECISION,
              service: row.service,
              createdAt: LessThan(row.startedAt),
            },
            order: { createdAt: 'DESC' },
          })
        : null;
      let comparison = comparisonFromDecision(decision?.decision ?? null);
      if (comparison === null && decision) {
        const extra =
          decision.headSha && row.headSha
            ? await this.planService.serviceCommitsBetween(
                row.service,
                decision.headSha,
                row.headSha,
                row.apps === 'admin' || row.apps === 'helpline'
                  ? row.apps
                  : undefined,
              )
            : null;
        if (extra === null) continue; // try again next pass
        comparison =
          extra === 0
            ? ReleasePolicyComparison.MATCH
            : ReleasePolicyComparison.DIFFERENT_HEAD;
      }
      await this.logRepository.update(
        { id: row.id },
        { comparison, comparedDecisionId: decision?.id ?? null },
      );
    }
  }

  /**
   * One health check per pass for each successful release that has settled
   * and not answered yet — Builder's checks (`builderHealthUrls`, the same
   * settle time), spread over passes instead of sleeping between tries.
   * Healthy on the first answer; unhealthy after three misses. A service with
   * no health URL is recorded as checked, health unknown.
   */
  private async checkHealth(now: Date): Promise<void> {
    const due = await this.logRepository.find({
      where: {
        kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
        outcome: ReleasePolicyOutcome.SUCCEEDED,
        healthCheckedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const urls = this.configService.builderHealthUrls;
    for (const row of due) {
      if (!row.service || !isPolicyServiceKey(row.service)) continue;
      const finished = row.finishedAt?.getTime() ?? 0;
      if (now.getTime() - finished < BUILDER_RELEASE_SETTLE_MS) continue;
      const url = urls[healthKeyFor(row.service, row.apps ?? null)];
      if (!url) {
        await this.logRepository.update(
          { id: row.id },
          { healthCheckedAt: now, healthy: null },
        );
        continue;
      }
      const ok = await this.answersHealthy(url);
      const attempts = row.healthAttempts + 1;
      if (ok || attempts >= RELEASE_HEALTH_ATTEMPTS) {
        await this.logRepository.update(
          { id: row.id },
          { healthCheckedAt: now, healthy: ok, healthAttempts: attempts },
        );
        if (!ok) {
          this.logger.warn(
            `[RELEASE-POLICY] ${row.service}${row.tag ? ` ${row.tag}` : ''} released but its health check failed ${attempts} times (${url}).`,
          );
        }
      } else {
        await this.logRepository.update(
          { id: row.id },
          { healthAttempts: attempts },
        );
      }
    }
  }

  private async answersHealthy(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async recentBackendReleases(now: Date) {
    const rows = await this.logRepository.find({
      where: {
        kind: ReleasePolicyLogKind.OBSERVED_RELEASE,
        service: In(['be', 'ai', 'learn']),
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return rows
      .filter((row) => row.finishedAt)
      .map((row) => ({
        service: row.service ?? '',
        succeeded: row.outcome === ReleasePolicyOutcome.SUCCEEDED,
        healthy: row.healthy ?? (row.healthCheckedAt ? true : null),
        finishedAt: row.finishedAt!,
      }))
      .filter(
        (release) =>
          now.getTime() - release.finishedAt.getTime() >= 0 &&
          release.service !== '',
      );
  }

  // ── The circuit breaker ────────────────────────────────────────────────────

  /**
   * Two consecutive failed or unhealthy auto-releases pause auto-release
   * platform-wide and tell the Owners (D6). Only releases the policy itself
   * made count, and in shadow mode it makes none — so the real breaker
   * cannot trip in P5. What shadow mode records instead is when live mode
   * WOULD have paused, from the releases humans made.
   */
  private async evaluateBreaker(
    settings: ReleasePolicySettings,
  ): Promise<void> {
    const observed = await this.logRepository.find({
      where: { kind: ReleasePolicyLogKind.OBSERVED_RELEASE },
      order: { finishedAt: 'DESC' },
      take: 20,
    });
    const asOutcome = (row: ReleasePolicyLog) => ({
      succeeded: row.outcome === ReleasePolicyOutcome.SUCCEEDED,
      healthy: row.healthy ?? (row.healthCheckedAt ? true : null),
    });

    const own = observed.filter(
      (row) => row.origin === ReleasePolicyOrigin.POLICY,
    );
    if (
      !settings.autoReleasePausedAt &&
      consecutiveFailures(own.map(asOutcome)) >= RELEASE_BREAKER_THRESHOLD
    ) {
      await this.trip(own.slice(0, RELEASE_BREAKER_THRESHOLD));
    }

    const streak = consecutiveFailures(observed.map(asOutcome));
    if (streak < RELEASE_BREAKER_THRESHOLD) return;
    const newestFailure = observed.find(
      (row) => !asOutcome(row).succeeded || asOutcome(row).healthy === false,
    );
    if (!newestFailure?.runId) return;
    const already = await this.logRepository.findOne({
      where: {
        kind: ReleasePolicyLogKind.BREAKER,
        breakerEvent: ReleasePolicyBreakerEvent.WOULD_TRIP,
        runId: newestFailure.runId,
      },
    });
    if (already) return;
    await this.logRepository.save(
      this.logRepository.create({
        kind: ReleasePolicyLogKind.BREAKER,
        mode: ReleasePolicyMode.SHADOW,
        breakerEvent: ReleasePolicyBreakerEvent.WOULD_TRIP,
        runId: newestFailure.runId,
        reason: `${streak} consecutive failed or unhealthy releases (latest: ${newestFailure.service} ${newestFailure.tag ?? newestFailure.runId})`,
      }),
    );
    this.logger.warn(
      `[RELEASE-POLICY shadow] the breaker would have paused auto-release: ${streak} consecutive failed or unhealthy releases.`,
    );
  }

  /** Open the breaker and tell the Owners. Reached only from releases the policy made. */
  private async trip(failures: ReleasePolicyLog[]): Promise<void> {
    const pausedAt = new Date();
    const reason = `${failures.length} consecutive failed or unhealthy auto-releases`;
    if (!(await this.settingsService.pause(reason, pausedAt))) return;
    await this.logRepository.save(
      this.logRepository.create({
        kind: ReleasePolicyLogKind.BREAKER,
        mode: ReleasePolicyMode.LIVE,
        breakerEvent: ReleasePolicyBreakerEvent.TRIPPED,
        reason,
        runId: failures[0]?.runId ?? null,
      }),
    );
    this.logger.error(`[RELEASE-POLICY] Auto-release paused: ${reason}.`);
    await this.notifier.breakerTripped({
      pausedAt,
      reason,
      releases: failures.map((row) => ({
        service: row.service ?? '',
        tag: row.tag ?? null,
        runUrl: row.runUrl ?? null,
        detail:
          row.outcome === ReleasePolicyOutcome.FAILED
            ? (row.reason ?? 'failed')
            : 'deployed, but the health check failed',
      })),
    });
  }

  // ── The release endpoints (behind roadmap_v2) ──────────────────────────────

  /** 404 while `roadmap_v2` is off, so nothing here can run before cutover. */
  async assertEnabled(): Promise<ReleasePolicySettings> {
    const settings = await this.settingsService.get();
    if (!settings.roadmapV2) throw new NotFoundException();
    return settings;
  }

  /** `GET /v1/roadmap/release/plan?service=`: what a release would ship now. */
  async getPlan(userId: number, service: string): Promise<ReleasePlanView> {
    const settings = await this.assertEnabled();
    if (!(await this.accessService.canView(userId))) {
      throw new ForbiddenException('You need Roadmap access to see releases.');
    }
    const { plan, verdict } = await this.planFor(service, settings);
    return {
      service: plan.service,
      apps: plan.apps,
      baseTag: plan.baseTag,
      baseRef: plan.baseRef,
      headSha: plan.headSha,
      serviceHeadSha: plan.serviceHeadSha,
      nextTag: plan.commits.length
        ? await this.nextTag(plan.service, plan.apps)
        : null,
      commits: plan.commits,
      heldReasons: plan.heldReasons,
      held: plan.heldReasons.length > 0,
      opportunityIds: plan.opportunityIds,
      unknown: plan.unknown,
      decision: verdict,
      mode: policyMode(),
      breaker: {
        pausedAt: settings.autoReleasePausedAt,
        reason: settings.autoReleasePausedReason,
      },
      canRelease: await this.accessService.canRelease(
        userId,
        plan.opportunityIds,
      ),
    };
  }

  /**
   * `POST /v1/roadmap/release`: a person's Release click, for a held service
   * or any other. Dispatches through `ProductionReleaseService`. Works while
   * the breaker is open (D6). Refused when more of the service landed since
   * the person read the plan, so the dialog's list is what ships.
   */
  async release(
    userId: number,
    service: string,
    serviceHeadSha: string,
  ): Promise<{
    service: string;
    tag: string;
    dispatchedAt: Date;
    apps: string | null;
  }> {
    const settings = await this.assertEnabled();
    const { plan } = await this.planFor(service, settings);
    if (!(await this.accessService.canRelease(userId, plan.opportunityIds))) {
      throw new ForbiddenException(
        'Only an Owner, or the lead of an idea in this release, can release it.',
      );
    }
    if (plan.unknown) {
      throw new ConflictException(
        `Couldn't read everything this release would ship (${plan.unknown}). Try again in a few minutes.`,
      );
    }
    if (!plan.commits.length) {
      throw new ConflictException(
        `Nothing new to release for ${plan.service}.`,
      );
    }
    if (plan.serviceHeadSha !== serviceHeadSha) {
      throw new ConflictException(
        'More changes landed since you opened this. Review the list again before releasing.',
      );
    }
    const target = releaseTargetFor(plan.service, plan.apps);
    const active = await this.github.countActiveRuns(
      target.repo,
      target.workflow,
    );
    if (active === null || active > 0) {
      throw new ConflictException(
        active === null
          ? "Couldn't check whether a release is already running. Try again in a minute."
          : `A ${target.label} release is already running. Wait for it to finish.`,
      );
    }

    const { tag, dispatchedAt } = await this.releaseService.dispatch(
      target,
      'master',
    );
    await this.logRepository.save(
      this.logRepository.create({
        kind: ReleasePolicyLogKind.MANUAL_RELEASE,
        mode: ReleasePolicyMode.MANUAL,
        service: plan.service,
        apps: plan.apps,
        baseRef: plan.baseRef,
        baseTag: plan.baseTag,
        headSha: plan.headSha,
        serviceHeadSha: plan.serviceHeadSha,
        tag,
        startedAt: dispatchedAt,
        commits: plan.commits,
        heldReasons: plan.heldReasons,
        opportunityIds: plan.opportunityIds,
        userId,
      }),
    );
    this.logger.info(
      `[RELEASE-POLICY] user ${userId} released ${tag} (${plan.service}) with ${plan.commits.length} commit(s)` +
        (plan.heldReasons.length ? ', held paths included' : '') +
        '.',
    );
    return { service: plan.service, tag, dispatchedAt, apps: plan.apps };
  }

  /** `POST /v1/roadmap/release/resume`: Owner only. */
  async resume(
    userId: number,
  ): Promise<{ pausedAt: null; wasPausedAt: Date | null }> {
    await this.assertEnabled();
    if (!(await this.accessService.isOwner(userId))) {
      throw new ForbiddenException('Only an Owner can resume auto-release.');
    }
    const wasPausedAt = await this.settingsService.resume();
    if (wasPausedAt) {
      await this.logRepository.save(
        this.logRepository.create({
          kind: ReleasePolicyLogKind.BREAKER,
          mode: ReleasePolicyMode.MANUAL,
          breakerEvent: ReleasePolicyBreakerEvent.RESUMED,
          reason: `paused since ${wasPausedAt.toISOString()}`,
          userId,
        }),
      );
      this.logger.info(
        `[RELEASE-POLICY] auto-release resumed by user ${userId}.`,
      );
    }
    return { pausedAt: null, wasPausedAt };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async planFor(
    service: string,
    settings: ReleasePolicySettings,
  ): Promise<{ plan: ServiceReleasePlan; verdict: PolicyVerdict }> {
    if (!isPolicyServiceKey(service)) {
      throw new NotFoundException(
        service === 'mobile'
          ? 'ally-mobile ships through the app-store pipeline, not a release here.'
          : `Unknown service "${service}". Use be, ai, learn or frontend.`,
      );
    }
    const now = new Date();
    const built = await this.planService.buildPlans(settings.heldPaths);
    const verdicts = decideReleases({
      plans: built.plans,
      now,
      pausedAt: settings.autoReleasePausedAt,
      window: settings.releaseWindow,
      unverifiedBackends: unverifiedBackends(
        await this.recentBackendReleases(now),
        now,
      ),
    });
    return { plan: built.plans.get(service)!, verdict: verdicts.get(service)! };
  }

  /** The tag a release would take: read only (tags are listed, never made). */
  private async nextTag(
    service: PolicyServiceKey,
    apps: FrontendApps | null,
  ): Promise<string | null> {
    const target = releaseTargetFor(service, apps);
    try {
      return await this.github.nextPatchTag(target.repo, target.tagPrefix);
    } catch {
      return null;
    }
  }

  private async observationStart(now: Date): Promise<Date> {
    if (this.observingSince) return this.observingSince;
    const first = await this.logRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    this.observingSince = first?.createdAt ?? now;
    return this.observingSince;
  }

  /** One pass at a time across replicas (the P1 pattern). */
  private async withLock(work: () => Promise<void>): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = await runner.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
        [LOCK_NAME],
      );
      if (!rows?.[0]?.locked) return;
      try {
        await work();
      } catch (error) {
        this.logger.warn(
          `[RELEASE-POLICY] pass failed: ${error instanceof Error ? error.message : String(error)}`,
        );
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
