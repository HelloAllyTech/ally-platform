import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { SlackService } from 'src/notification/service/slack.service';
import { BuilderSessionStatus } from 'src/builder/enum/builder.enum';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentOutbox } from '../entity/pm-agent-outbox.entity';
import {
  PmCardStatus,
  PmLaneStatDimension,
  PmOutboxStatus,
  PmOutboxStep,
} from '../enum/pm-agent.enum';
import {
  PM_CIRCUIT_BREAKER_FAILURES,
  PM_OUTBOX_MAX_ATTEMPTS,
  PM_OUTBOX_RETRY_MS,
  PM_PLATFORM_USER_ID,
  PM_RECONCILED_STATUSES,
} from '../constants/pm-agent.constants';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentLaneStatRepository,
  PmAgentOutboxRepository,
  PmAgentOutcomeRepository,
  PmAgentSettingsRepository,
} from '../repository/pm-agent.repositories';
import { compilePlan, RecommendationPayload } from '../util/compile-plan';
import { PmAgentBuilderPort } from './pm-agent-builder-port.service';
import { PmAgentEventsService } from './pm-agent-events.service';
import { PmAgentImpactService } from '../impact/pm-agent-impact.service';

/** A step's verdict: move on, park and retry later, or stop in front of a person. */
type StepResult =
  | { kind: 'next'; step: PmOutboxStep; cardStatus?: PmCardStatus }
  | { kind: 'wait'; reason: string; cardStatus?: PmCardStatus }
  | { kind: 'done'; cardStatus: PmCardStatus }
  | { kind: 'attention'; reason: string };

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Builder's own refusal when its build slots are full (assertWithinConcurrency). */
const isConcurrencyRefusal = (error: unknown) =>
  error instanceof BadRequestException &&
  /already running, which is the current limit/i.test(message(error));

/** Builder's kill switch refusal (startDesign / startBuild). */
const isBuilderOffRefusal = (error: unknown) =>
  error instanceof BadRequestException &&
  /switched off for this environment/i.test(message(error));

/**
 * Accept → Builder (docs/pm-agent.md), the outbox worker, the status reconcile and the
 * circuit breaker.
 *
 * The chain, one durable step per outbox row update so a crash resumes rather than
 * repeats: create_session → file_roadmap → patch_prd → set_repos → start_design →
 * await_design (auto-approve) → start_build. Each step is idempotent on its own:
 *  - create_session looks for a session already requested for this card before
 *    creating one, and the card claims it with a conditional UPDATE (UNIQUE
 *    builderSessionId);
 *  - file_roadmap is skipped once the card has an opportunity, and is best-effort — a
 *    roadmap failure never blocks the build;
 *  - the PRD is the deterministic compiled template, so re-patching writes the same text;
 *  - start_design / start_build read the design's state first.
 *
 * Builder full → the card waits in `queued` and the next tick retries ("drain").
 * `pauseAutoBuild`, the circuit breaker and Builder's kill switch stop STARTING runs
 * (design and build) and nothing else. A refusal Builder explains (PRD not ready, design
 * with open decisions) puts the card in `needs_attention` with Builder's reason.
 */
@Injectable()
export class PmAgentBuildService {
  private readonly logger = LoggerService.getInstance(PmAgentBuildService.name);

  constructor(
    private readonly cards: PmAgentCardRepository,
    private readonly outbox: PmAgentOutboxRepository,
    private readonly outcomes: PmAgentOutcomeRepository,
    private readonly laneStats: PmAgentLaneStatRepository,
    private readonly settings: PmAgentSettingsRepository,
    private readonly builder: PmAgentBuilderPort,
    private readonly events: PmAgentEventsService,
    @Optional() private readonly slack?: SlackService,
    @Optional() private readonly impact?: PmAgentImpactService,
  ) {}

  // ── outbox worker ─────────────────────────────────────────────────────────

  /** One drain pass: every due row, one step each. Returns rows processed. */
  async drain(limit = 10): Promise<number> {
    const ids = await this.outbox.listDue(limit);
    let processed = 0;
    for (const id of ids) {
      const row = await this.outbox.claim(id);
      if (!row) continue; // another worker, or no longer due
      processed += 1;
      try {
        await this.process(row);
      } catch (error) {
        this.logger.error(
          `[PM_AGENT] Outbox ${row.id} step ${row.step} crashed: ${message(error)}`,
        );
        await this.outbox.settle(row.id, {
          status: PmOutboxStatus.WAITING,
          dueAt: new Date(Date.now() + PM_OUTBOX_RETRY_MS),
          lastError: message(error).slice(0, 1000),
        });
      }
    }
    return processed;
  }

  /** Advance one claimed row by one step, and settle it. */
  async process(row: PmAgentOutbox): Promise<void> {
    const card = await this.cards.findOne({ where: { id: row.cardId } });
    if (!card) {
      await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
      return;
    }

    // First touch after the undo window: accepted_pending → queued. Losing this means
    // the card was undone (or moved by someone else): the row is cancelled, not run.
    if (card.status === PmCardStatus.ACCEPTED_PENDING) {
      const moved = await this.cards.transition({
        cardId: card.id,
        from: [PmCardStatus.ACCEPTED_PENDING],
        to: PmCardStatus.QUEUED,
        patch: { undoUntil: null },
        event: { type: 'queued', actorUserId: null },
      });
      if (!moved) {
        await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
        return;
      }
      Object.assign(card, moved);
      this.events.cardUpdated(card.id);
    }
    if (![PmCardStatus.QUEUED, PmCardStatus.DESIGNING].includes(card.status)) {
      await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
      return;
    }

    let result: StepResult;
    try {
      result = await this.runStep(row, card);
    } catch (error) {
      if (isConcurrencyRefusal(error) || isBuilderOffRefusal(error)) {
        result = { kind: 'wait', reason: message(error) };
      } else if (row.attempts >= PM_OUTBOX_MAX_ATTEMPTS) {
        result = {
          kind: 'attention',
          reason: `Builder refused step "${row.step}": ${message(error)}`,
        };
      } else if (error instanceof BadRequestException) {
        // Builder's refusals are written for a person and are not transient.
        result = { kind: 'attention', reason: message(error) };
      } else {
        throw error; // transient: drain() parks it for a retry
      }
    }
    await this.settleStep(row, card, result);
  }

  private async runStep(
    row: PmAgentOutbox,
    card: PmAgentCard,
  ): Promise<StepResult> {
    const userId = row.createdBy;
    switch (row.step) {
      case PmOutboxStep.CREATE_SESSION: {
        if (card.builderSessionId) {
          return { kind: 'next', step: PmOutboxStep.FILE_ROADMAP };
        }
        const sessionId =
          (await this.builder.findSessionForCard(card.id)) ??
          (await this.builder.createSession(
            userId,
            card.id,
            card.title.slice(0, 120),
          ));
        const claimed = await this.cards.patchIf(
          card.id,
          [PmCardStatus.QUEUED],
          { builderSessionId: sessionId },
          {
            type: 'builder_session_created',
            actorUserId: null,
            detail: { sessionId },
          },
        );
        if (!claimed) {
          return {
            kind: 'attention',
            reason:
              'The card moved while its Builder session was being created.',
          };
        }
        card.builderSessionId = sessionId;
        await this.outcomes.flag(card.id, { buildStarted: true });
        return { kind: 'next', step: PmOutboxStep.FILE_ROADMAP };
      }

      case PmOutboxStep.FILE_ROADMAP: {
        if (!card.roadmapOpportunityId && card.builderSessionId) {
          try {
            const compiled = await this.compile(card);
            const opportunityId = await this.builder.fileRoadmapItem(
              userId,
              card.builderSessionId,
              compiled.description,
            );
            if (opportunityId) {
              await this.cards.update(
                { id: card.id },
                { roadmapOpportunityId: opportunityId },
              );
            }
          } catch (error) {
            // Best-effort: the build does not depend on the board.
            await this.cards.addEvent(card, 'roadmap_filing_failed', null, {
              error: message(error).slice(0, 300),
            });
          }
        }
        return { kind: 'next', step: PmOutboxStep.PATCH_PRD };
      }

      case PmOutboxStep.PATCH_PRD: {
        const compiled = await this.compile(card);
        const readiness = await this.builder.patchPrd(
          card.builderSessionId!,
          userId,
          compiled.prdOps,
          `Compiled from PM Agent card v${card.version}`,
        );
        await this.cards.update(
          { id: card.id },
          {
            compiledPrd: { ops: compiled.prdOps } as Record<string, any>,
            compiledPrdHash: compiled.prdHash,
          },
        );
        if (!readiness.ready) {
          return {
            kind: 'attention',
            reason: `Builder's PRD review did not pass: ${readiness.blockers
              .slice(0, 3)
              .join(' ')}`.slice(0, 1000),
          };
        }
        return { kind: 'next', step: PmOutboxStep.SET_REPOS };
      }

      case PmOutboxStep.SET_REPOS: {
        const repos: string[] = Array.isArray(card.payload?.repos)
          ? card.payload.repos
          : [];
        if (repos.length) {
          await this.builder.setRepos(card.builderSessionId!, userId, repos);
        }
        return { kind: 'next', step: PmOutboxStep.START_DESIGN };
      }

      case PmOutboxStep.START_DESIGN: {
        const design = await this.builder.designStatus(
          card.builderSessionId!,
          userId,
        );
        if (design.status === 'approved') {
          return { kind: 'next', step: PmOutboxStep.START_BUILD };
        }
        if (design.status === 'drafting' || design.status === 'review') {
          return {
            kind: 'next',
            step: PmOutboxStep.AWAIT_DESIGN,
            cardStatus: PmCardStatus.DESIGNING,
          };
        }
        const paused = await this.pausedReason();
        if (paused) return { kind: 'wait', reason: paused };
        await this.builder.startDesign(card.builderSessionId!, userId);
        return {
          kind: 'next',
          step: PmOutboxStep.AWAIT_DESIGN,
          cardStatus: PmCardStatus.DESIGNING,
        };
      }

      case PmOutboxStep.AWAIT_DESIGN: {
        const design = await this.builder.designStatus(
          card.builderSessionId!,
          userId,
        );
        if (design.status === 'drafting') {
          return {
            kind: 'wait',
            reason: 'The technical design is drafting.',
            cardStatus: PmCardStatus.DESIGNING,
          };
        }
        if (design.status === 'failed' || !design.status) {
          return {
            kind: 'attention',
            reason: `The technical design failed${design.error ? `: ${design.error}` : '.'}`,
          };
        }
        if (design.status === 'review') {
          if (design.openDecisions.length) {
            return {
              kind: 'attention',
              reason: `The technical design has open decisions: ${design.openDecisions.slice(0, 3).join('; ')}`,
            };
          }
          // The system approves the design [D]: the PRD it was drafted from is the
          // compiled card the admin accepted. approveDesign re-checks staleness and
          // readiness itself and refuses (→ needs_attention) if either fails.
          await this.builder.approveDesign(
            card.builderSessionId!,
            PM_PLATFORM_USER_ID,
          );
        }
        return { kind: 'next', step: PmOutboxStep.START_BUILD };
      }

      case PmOutboxStep.START_BUILD: {
        const paused = await this.pausedReason();
        if (paused)
          return { kind: 'wait', reason: paused, cardStatus: card.status };
        await this.builder.startBuild(card.builderSessionId!, userId);
        return { kind: 'done', cardStatus: PmCardStatus.BUILDING };
      }

      default:
        return { kind: 'done', cardStatus: card.status };
    }
  }

  private async settleStep(
    row: PmAgentOutbox,
    card: PmAgentCard,
    result: StepResult,
  ): Promise<void> {
    const moveTo = async (
      to: PmCardStatus,
      type: string,
      detail?: Record<string, unknown>,
    ) => {
      if (to === card.status) return;
      const moved = await this.cards.transition({
        cardId: card.id,
        from: [card.status],
        to,
        event: { type, actorUserId: null, detail },
      });
      if (moved) this.events.cardUpdated(card.id);
    };

    switch (result.kind) {
      case 'next':
        if (result.cardStatus)
          await moveTo(result.cardStatus, 'design_started');
        await this.outbox.settle(row.id, {
          status: PmOutboxStatus.PENDING,
          step: result.step,
          dueAt: new Date(),
          attempts: 0,
          lastError: null,
        });
        return;
      case 'wait':
        if (result.cardStatus)
          await moveTo(result.cardStatus, 'design_started');
        await this.outbox.settle(row.id, {
          status: PmOutboxStatus.WAITING,
          dueAt: new Date(Date.now() + PM_OUTBOX_RETRY_MS),
          lastError: result.reason.slice(0, 1000),
          // A park is not a failed attempt.
          attempts: Math.max(0, row.attempts - 1),
        });
        return;
      case 'done':
        await moveTo(result.cardStatus, 'build_started');
        await this.outbox.settle(row.id, {
          status: PmOutboxStatus.DONE,
          step: PmOutboxStep.DONE,
          lastError: null,
        });
        return;
      case 'attention': {
        const moved = await this.cards.transition({
          cardId: card.id,
          from: [card.status],
          to: PmCardStatus.NEEDS_ATTENTION,
          patch: {
            needsYouReason: result.reason.slice(0, 1000),
            needsYouDismissedAt: null,
          },
          event: {
            type: 'needs_attention',
            actorUserId: null,
            detail: { step: row.step },
          },
        });
        // The step it stopped at is kept, so Retry resumes there.
        await this.outbox.settle(row.id, {
          status: PmOutboxStatus.FAILED,
          lastError: result.reason.slice(0, 1000),
        });
        if (moved) this.events.cardUpdated(card.id);
        return;
      }
    }
  }

  /** Why STARTING a run is held, or null. */
  private async pausedReason(): Promise<string | null> {
    const [settings, builder] = await Promise.all([
      this.settings.getSingleton(),
      this.builder.builderSettings(),
    ]);
    if (!builder.enabled) return 'Builder is switched off.';
    if (settings.pauseAutoBuild) return 'Auto-build is paused.';
    if (settings.autoBuildPaused) {
      return `Auto-build is paused by the circuit breaker${
        settings.autoBuildPausedReason
          ? `: ${settings.autoBuildPausedReason}`
          : '.'
      }`;
    }
    return null;
  }

  private async compile(card: PmAgentCard) {
    const compiled = compilePlan(
      {
        id: card.id,
        version: card.version,
        versionHash: card.versionHash,
        category: card.category,
        payload: card.payload as RecommendationPayload,
      },
      { tenantNames: await this.cards.listTenantNames() },
    );
    const titleOp = compiled.prdOps.find((op) => op.path === '/title');
    const summaryOp = compiled.prdOps.find((op) => op.path === '/summary');
    return {
      ...compiled,
      description: `${String(titleOp?.value ?? card.title)}\n\n${String(
        summaryOp?.value ?? '',
      )}`,
    };
  }

  // ── status reconcile + circuit breaker ────────────────────────────────────

  /** Map each in-flight card's Builder session and pull requests to a card status. */
  async reconcile(): Promise<number> {
    const cards = await this.cards.listByStatuses(PM_RECONCILED_STATUSES, 200);
    let changed = 0;
    for (const card of cards) {
      if (!card.builderSessionId) continue;
      try {
        if (await this.reconcileCard(card)) changed += 1;
      } catch (error) {
        this.logger.warn(
          `[PM_AGENT] Reconcile of card ${card.id} failed: ${message(error)}`,
        );
      }
    }
    return changed;
  }

  /** Pure mapping: Builder state → the card status it implies (null = no change). */
  static deriveStatus(
    session: { status: BuilderSessionStatus } | null,
    prs: {
      merged: boolean;
      state?: string | null;
      releaseState?: string | null;
    }[],
  ): { status: PmCardStatus; reason?: string; unhealthy?: boolean } | null {
    if (!session) {
      return {
        status: PmCardStatus.NEEDS_ATTENTION,
        reason: 'The Builder session no longer exists.',
      };
    }
    const unhealthy = prs.some((pr) => pr.releaseState === 'unhealthy');
    if (prs.length) {
      if (prs.some((pr) => !pr.merged && pr.state === 'closed')) {
        return {
          status: PmCardStatus.NEEDS_ATTENTION,
          reason: 'A pull request was closed without merging.',
        };
      }
      if (prs.some((pr) => !pr.merged)) {
        return { status: PmCardStatus.PR_OPEN };
      }
      const delivered = (state?: string | null) =>
        state === 'released' || state === 'skipped';
      if (prs.every((pr) => delivered(pr.releaseState))) {
        return { status: PmCardStatus.RELEASED };
      }
      if (prs.some((pr) => pr.releaseState === 'failed' || unhealthy)) {
        return {
          status: PmCardStatus.MERGED_NOT_RELEASED,
          reason: unhealthy
            ? 'Released, but the post-release health check failed.'
            : 'Merged, but the release failed.',
          unhealthy,
        };
      }
      return { status: PmCardStatus.MERGED };
    }
    switch (session.status) {
      case BuilderSessionStatus.BUILDING:
        return { status: PmCardStatus.BUILDING };
      case BuilderSessionStatus.WAITING_FOR_INPUT:
        return {
          status: PmCardStatus.NEEDS_ATTENTION,
          reason: 'Builder paused the build to ask a question.',
        };
      case BuilderSessionStatus.FAILED:
        return { status: PmCardStatus.FAILED, reason: 'The build failed.' };
      case BuilderSessionStatus.CANCELLED:
        return {
          status: PmCardStatus.NEEDS_ATTENTION,
          reason: 'The build was cancelled in Builder.',
        };
      case BuilderSessionStatus.COMPLETED:
        return {
          status: PmCardStatus.NEEDS_ATTENTION,
          reason: 'The build finished without opening a pull request.',
        };
      default:
        // INTERVIEWING / PRD_READY: still in design; the outbox owns that phase.
        return null;
    }
  }

  private async reconcileCard(card: PmAgentCard): Promise<boolean> {
    const [session, prs] = await Promise.all([
      this.builder.getSession(card.builderSessionId!),
      this.builder.listPullRequests(card.builderSessionId!),
    ]);
    const next = PmAgentBuildService.deriveStatus(session, prs);
    if (!next || next.status === card.status) return false;
    // A card still in design is the outbox's until the build starts.
    if (
      card.status === PmCardStatus.DESIGNING &&
      next.status === PmCardStatus.NEEDS_ATTENTION &&
      !prs.length
    ) {
      return false;
    }

    const moved = await this.cards.transition({
      cardId: card.id,
      from: [card.status],
      to: next.status,
      patch: next.reason
        ? { needsYouReason: next.reason, needsYouDismissedAt: null }
        : {},
      event: {
        type: 'delivery_changed',
        actorUserId: null,
        detail: { sessionStatus: session?.status ?? null, prs: prs.length },
      },
    });
    if (!moved) return false; // someone else moved it this tick
    this.events.cardUpdated(card.id);

    // Outcome flags only move forward; the breaker counts transitions this call won.
    const cost = session?.totalCostUsd ?? null;
    switch (next.status) {
      case PmCardStatus.PR_OPEN:
        await this.outcomes.flag(card.id, { prOpened: true });
        break;
      case PmCardStatus.MERGED:
        await this.outcomes.flag(card.id, { prOpened: true, merged: true });
        await this.settings.resetBuildFailures();
        break;
      case PmCardStatus.RELEASED:
        await this.outcomes.flag(card.id, {
          prOpened: true,
          merged: true,
          released: true,
          buildCostUsd: cost,
        });
        await this.settings.resetBuildFailures();
        await this.laneStats
          .bump(PmLaneStatDimension.CATEGORY, card.category, 'shipped')
          .catch(() => undefined);
        // Impact checks: baseline now, reads at +14 / +30 d. Idempotent and never throws.
        await this.impact?.onReleased(
          card,
          PmAgentBuildService.releasedAt(prs),
        );
        break;
      case PmCardStatus.MERGED_NOT_RELEASED:
        await this.outcomes.flag(card.id, {
          prOpened: true,
          merged: true,
          ...(next.unhealthy ? { healthCheckFailed: true } : {}),
        });
        if (next.unhealthy) {
          await this.tripBreaker(
            'a release failed its post-release health check',
          );
        }
        break;
      case PmCardStatus.FAILED:
        await this.recordBuildFailure(card);
        break;
      default:
        break;
    }
    return true;
  }

  /** When the change reached production: the last PR's release time (now if unrecorded). */
  static releasedAt(prs: { releasedAt?: Date | null }[]): Date {
    const times = prs
      .map((pr) => (pr.releasedAt ? new Date(pr.releasedAt).getTime() : NaN))
      .filter((time) => Number.isFinite(time));
    return times.length ? new Date(Math.max(...times)) : new Date();
  }

  /** Count a failed build; the third in a row trips the breaker. */
  async recordBuildFailure(card: Pick<PmAgentCard, 'id' | 'category'>) {
    await this.outcomes.flag(card.id, { buildFailed: true });
    await this.laneStats
      .bump(PmLaneStatDimension.CATEGORY, card.category, 'failed')
      .catch(() => undefined);
    const failures = await this.settings.incrementBuildFailures();
    if (failures >= PM_CIRCUIT_BREAKER_FAILURES) {
      await this.tripBreaker(`${failures} builds failed in a row`);
    }
  }

  /** Pause auto-build until an admin resumes it, and say so once. */
  async tripBreaker(reason: string): Promise<boolean> {
    const tripped = await this.settings.tripBreaker(reason);
    if (!tripped) return false;
    this.logger.warn(`[PM_AGENT] Circuit breaker opened: ${reason}`);
    this.events.stateUpdated();
    const settings = await this.settings.getSingleton();
    if (settings.slackNotify && this.slack) {
      await this.slack
        .sendMessage(
          `PM Agent paused auto-build: ${reason}. Cards are still generated; resume it from PM Agent › Agent › Settings.`,
        )
        .catch(() => undefined);
    }
    return true;
  }
}
