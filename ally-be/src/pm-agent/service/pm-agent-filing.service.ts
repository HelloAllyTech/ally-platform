import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunityStage,
} from 'src/product-roadmap/enum/roadmap-opportunity.enum';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentOutbox } from '../entity/pm-agent-outbox.entity';
import {
  PmCardKind,
  PmCardStatus,
  PmLaneStatDimension,
  PmOutboxStatus,
  PmOutboxStep,
} from '../enum/pm-agent.enum';
import {
  PM_OUTBOX_MAX_ATTEMPTS,
  PM_OUTBOX_RETRY_MS,
  PM_RECONCILED_STATUSES,
} from '../constants/pm-agent.constants';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentLaneStatRepository,
  PmAgentOutboxRepository,
  PmAgentOutcomeRepository,
} from '../repository/pm-agent.repositories';
import { PM_ROADMAP_READINESS_IDS } from '../gate/pm-critic';
import { validateCardPayload } from '../dto/pm-card-payload.dto';
import { PmRoadmapFiling } from '../pipeline/pm-pipeline.types';
import {
  PmAgentRoadmapPort,
  PmRoadmapOpportunityView,
} from './pm-agent-roadmap-port.service';
import { PmAgentEventsService } from './pm-agent-events.service';
import { PmAgentImpactService } from '../impact/pm-agent-impact.service';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Why a card cannot be filed as it stands: shown to a person in Tracking › Needs you. */
class FilingStop extends Error {
  constructor(
    reason: string,
    readonly patch: Partial<PmAgentCard> = {},
  ) {
    super(reason);
  }
}

/**
 * Accept → roadmap (docs/pm-agent.md "Filing to the roadmap"): the outbox worker that files an
 * accepted card as a Product Manager Agent opportunity, and the reconcile that follows the
 * opportunity's roadmap stage afterwards. The agent proposes; it never builds.
 *
 * One outbox row per accepted card, due when the 10-second undo window closes:
 *   accepted_pending → queued (the claim; losing it means the card was undone)
 *   → checks: the drafted entry still meets the payload contract, it was graded against the
 *     roadmap checklist in force NOW, and its product goal still exists
 *   → the roadmap's own duplicate check (skipped after File anyway)
 *   → RoadmapOpportunityService.create with a readiness token → `filed`.
 *
 * Idempotent: an opportunity already filed for the card (found by its source tag and card id)
 * is adopted instead of filing again, so a crash between filing and recording never doubles.
 * A stop a person must resolve — a duplicate, a stale checklist, a removed goal, the roadmap
 * refusing the filing — moves the card to `needs_attention` with the reason; Retry (or File
 * anyway, for a duplicate) resumes it. A transient failure parks the row and retries.
 *
 * Reconcile (shared 5-min tick): a `filed` card follows its opportunity. Released → `released`
 * (counts as shipped; starts the +14/+30 d impact checks); archived or removed → `roadmap_archived`
 * (a soft negative for learning). New and prioritised leave the card `filed`.
 */
@Injectable()
export class PmAgentFilingService {
  private readonly logger = LoggerService.getInstance(
    PmAgentFilingService.name,
  );

  constructor(
    private readonly cards: PmAgentCardRepository,
    private readonly outbox: PmAgentOutboxRepository,
    private readonly outcomes: PmAgentOutcomeRepository,
    private readonly laneStats: PmAgentLaneStatRepository,
    private readonly roadmap: PmAgentRoadmapPort,
    private readonly events: PmAgentEventsService,
    @Optional() private readonly impact?: PmAgentImpactService,
  ) {}

  // ── outbox worker ─────────────────────────────────────────────────────────

  /** One drain pass: every due row, one attempt each. Returns rows processed. */
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
        await this.retryLater(row, error);
      }
    }
    return processed;
  }

  /** Attempt one claimed row, and settle it. */
  async process(row: PmAgentOutbox): Promise<void> {
    const card = await this.cards.findOne({ where: { id: row.cardId } });
    if (!card) {
      await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
      return;
    }

    // First touch after the undo window: accepted_pending → queued. Losing this means the
    // card was undone (or moved by someone else): the row is cancelled, not run.
    if (card.status === PmCardStatus.ACCEPTED_PENDING) {
      const moved = await this.cards.transition({
        cardId: card.id,
        from: [PmCardStatus.ACCEPTED_PENDING],
        to: PmCardStatus.QUEUED,
        patch: { undoUntil: null },
        event: { type: 'filing', actorUserId: null },
      });
      if (!moved) {
        await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
        return;
      }
      Object.assign(card, moved);
      this.events.cardUpdated(card.id);
    }
    if (card.status !== PmCardStatus.QUEUED) {
      await this.outbox.settle(row.id, { status: PmOutboxStatus.CANCELLED });
      return;
    }

    let filed: { id: string; code: string | null; adopted: boolean };
    try {
      filed = await this.fileCard(card, row.createdBy);
    } catch (error) {
      if (error instanceof FilingStop) {
        await this.stop(row, card, error.message, error.patch);
        return;
      }
      if (error instanceof BadRequestException) {
        // The roadmap's refusals are written for a person and are not transient.
        await this.stop(
          row,
          card,
          `The roadmap refused the filing: ${message(error)}`,
        );
        return;
      }
      if (row.attempts >= PM_OUTBOX_MAX_ATTEMPTS) {
        await this.stop(
          row,
          card,
          `Filing to the roadmap kept failing: ${message(error)}`,
        );
        return;
      }
      throw error; // transient: drain() parks it for a retry
    }

    const moved = await this.cards.transition({
      cardId: card.id,
      from: [PmCardStatus.QUEUED],
      to: PmCardStatus.FILED,
      patch: { roadmapOpportunityId: filed.id },
      event: {
        type: 'filed',
        actorUserId: null,
        detail: {
          opportunityId: filed.id,
          code: filed.code,
          ...(filed.adopted ? { adopted: true } : {}),
        },
      },
    });
    await this.outbox.settle(row.id, {
      status: PmOutboxStatus.DONE,
      step: PmOutboxStep.DONE,
      lastError: null,
    });
    if (moved) this.events.cardUpdated(card.id);
  }

  /** The checks, the duplicate check and the filing itself. Throws FilingStop for a person. */
  private async fileCard(
    card: PmAgentCard,
    acceptedBy: number,
  ): Promise<{ id: string; code: string | null; adopted: boolean }> {
    const existing = await this.roadmap.findFiledForCard(card.id);
    if (existing) {
      const view = (await this.roadmap.getOpportunities([existing])).get(
        existing,
      );
      return { id: existing, code: view?.code ?? null, adopted: true };
    }

    const filing = (card.roadmapFiling ?? {}) as PmRoadmapFiling;
    const opportunity = card.payload?.opportunity;
    if (
      card.kind !== PmCardKind.RECOMMENDATION ||
      !opportunity ||
      validateCardPayload(card.kind, card.payload).length > 0
    ) {
      throw new FilingStop(
        'This card has no roadmap entry the roadmap would accept. Give the agent feedback on a newer card instead.',
      );
    }
    const graded = [...(filing.readiness?.criteria ?? [])].sort().join(',');
    const current = [...PM_ROADMAP_READINESS_IDS].sort().join(',');
    if (graded !== current || filing.readiness?.failed?.length) {
      throw new FilingStop(
        "The roadmap's filing checklist changed after this card was checked, so it can't be filed as it is. The agent will propose it again if it still holds.",
      );
    }
    if (!(await this.roadmap.productGoalExists(opportunity.productGoal))) {
      throw new FilingStop(
        `The product goal "${opportunity.productGoal}" is no longer on the roadmap.`,
      );
    }

    if (!filing.fileAnyway) {
      const duplicates = await this.roadmap.findDuplicates(
        opportunity.description,
        opportunity.productGoal,
      );
      if (duplicates.length) {
        const first = duplicates[0];
        throw new FilingStop(
          `This looks like ${first.code ?? 'an opportunity'} already on the roadmap${
            first.reason ? `: ${first.reason}` : '.'
          }`,
          { roadmapFiling: { ...filing, duplicates } },
        );
      }
    }

    const created = await this.roadmap.file({
      userId: acceptedBy,
      cardId: card.id,
      description: opportunity.description,
      productGoal: opportunity.productGoal,
      effort: opportunity.effort as RoadmapOpportunityEffort,
    });
    return { ...created, adopted: false };
  }

  private async stop(
    row: PmAgentOutbox,
    card: PmAgentCard,
    reason: string,
    patch: Partial<PmAgentCard> = {},
  ): Promise<void> {
    const moved = await this.cards.transition({
      cardId: card.id,
      from: [card.status],
      to: PmCardStatus.NEEDS_ATTENTION,
      patch: {
        ...patch,
        needsYouReason: reason.slice(0, 1000),
        needsYouDismissedAt: null,
      },
      event: {
        type: 'needs_attention',
        actorUserId: null,
        detail: { step: row.step },
      },
    });
    await this.outbox.settle(row.id, {
      status: PmOutboxStatus.FAILED,
      lastError: reason.slice(0, 1000),
    });
    if (moved) this.events.cardUpdated(card.id);
  }

  private async retryLater(row: PmAgentOutbox, error: unknown): Promise<void> {
    this.logger.error(
      `[PM_AGENT] Filing card ${row.cardId} failed (attempt ${row.attempts}): ${message(error)}`,
    );
    await this.outbox.settle(row.id, {
      status: PmOutboxStatus.WAITING,
      dueAt: new Date(Date.now() + PM_OUTBOX_RETRY_MS),
      lastError: message(error).slice(0, 1000),
    });
  }

  // ── reconcile: follow the roadmap ─────────────────────────────────────────

  /** Move each `filed` card to what its opportunity's roadmap stage implies. */
  async reconcile(): Promise<number> {
    const cards = (
      await this.cards.listByStatuses(PM_RECONCILED_STATUSES, 200)
    ).filter((card) => card.roadmapOpportunityId);
    if (!cards.length) return 0;
    const views = await this.roadmap.getOpportunities(
      cards.map((card) => card.roadmapOpportunityId!),
    );
    let changed = 0;
    for (const card of cards) {
      try {
        const view = views.get(card.roadmapOpportunityId!) ?? null;
        if (await this.reconcileCard(card, view)) changed += 1;
      } catch (error) {
        this.logger.warn(
          `[PM_AGENT] Reconcile of card ${card.id} failed: ${message(error)}`,
        );
      }
    }
    return changed;
  }

  /** Pure mapping: the opportunity's roadmap state → the card status it implies (null = none). */
  static deriveStatus(
    view: Pick<PmRoadmapOpportunityView, 'stage' | 'deleted'> | null,
  ): PmCardStatus | null {
    if (!view || view.deleted) return PmCardStatus.ROADMAP_ARCHIVED;
    switch (view.stage) {
      case RoadmapOpportunityStage.RELEASED:
        return PmCardStatus.RELEASED;
      case RoadmapOpportunityStage.ARCHIVED:
        return PmCardStatus.ROADMAP_ARCHIVED;
      default:
        return null; // new / prioritised: still on the roadmap
    }
  }

  private async reconcileCard(
    card: PmAgentCard,
    view: PmRoadmapOpportunityView | null,
  ): Promise<boolean> {
    const next = PmAgentFilingService.deriveStatus(view);
    if (!next || next === card.status) return false;
    const moved = await this.cards.transition({
      cardId: card.id,
      from: [card.status],
      to: next,
      event: {
        type: 'roadmap_changed',
        actorUserId: null,
        detail: {
          stage: view?.stage ?? null,
          deleted: view ? view.deleted : true,
        },
      },
    });
    if (!moved) return false; // someone else moved it this tick
    this.events.cardUpdated(card.id);

    if (next === PmCardStatus.RELEASED) {
      await this.outcomes.flag(card.id, { released: true });
      await this.laneStats
        .bump(PmLaneStatDimension.CATEGORY, card.category, 'shipped')
        .catch(() => undefined);
      // Impact checks: baseline now, reads at +14 / +30 d. Idempotent and never throws.
      await this.impact?.onReleased(card, view?.releasedAt ?? new Date());
    } else if (next === PmCardStatus.ROADMAP_ARCHIVED) {
      await this.outcomes.flag(card.id, { roadmapArchived: true });
    }
    return true;
  }
}
