import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import {
  PmAcceptPath,
  PmCardKind,
  PmCardStatus,
  PmDecision,
  PmFeedbackStatus,
  PmLaneStatDimension,
  PmMemoryKind,
  PmMemorySource,
  PmOutboxStep,
  PmQuestionScope,
} from '../enum/pm-agent.enum';
import {
  PM_NEEDS_YOU_STATUSES,
  PM_REJECT_REASON_WINDOW_MS,
  PM_SKIP_SUPPRESSION_MS,
  PM_UNDO_WINDOW_MS,
} from '../constants/pm-agent.constants';
import {
  AcceptCardDto,
  AnswerCardDto,
  FeedbackCardDto,
  ListCardsQueryDto,
  PmCardDetailResponse,
  PmCardResponse,
  RejectCardDto,
} from '../dto/pm-agent.dto';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentEvidenceRepository,
  PmAgentFeedbackRepository,
  PmAgentLaneStatRepository,
  PmAgentMemoryRepository,
  PmAgentOutboxRepository,
  PmAgentOutcomeRepository,
} from '../repository/pm-agent.repositories';
import { PmRoadmapFiling } from '../pipeline/pm-pipeline.types';
import { PmAgentEventsService } from './pm-agent-events.service';
import { PmAgentPresenterService } from './pm-agent-presenter.service';
import {
  PM_AGENT_RUN_TRIGGER,
  PmAgentRunTrigger,
} from './pm-agent-run-trigger';
import { PmAgentSettingsRepository } from '../repository/pm-agent.repositories';

const normaliseKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120);

/**
 * The card state machine (docs/pm-agent.md; plan §7).
 *
 * Every decision is one conditional transition (PmAgentCardRepository.transition): the
 * card moves only from the status(es) the action allows, the audit event and any side
 * rows (outbox, feedback, memory, outcome) commit in the same transaction, and a lost
 * race answers 409 rather than double-acting. Any decision frees a queue slot, because
 * the slot count IS the number of `open` cards — there is no counter to drift.
 *
 * What this service never does: call a model, Builder or the roadmap. Accept writes an
 * outbox row; PmAgentFilingService files the card to the roadmap once the undo window closes.
 */
@Injectable()
export class PmAgentCardService {
  private readonly logger = LoggerService.getInstance(PmAgentCardService.name);

  constructor(
    private readonly cards: PmAgentCardRepository,
    private readonly evidence: PmAgentEvidenceRepository,
    private readonly outbox: PmAgentOutboxRepository,
    private readonly feedbackRows: PmAgentFeedbackRepository,
    private readonly memory: PmAgentMemoryRepository,
    private readonly outcomes: PmAgentOutcomeRepository,
    private readonly laneStats: PmAgentLaneStatRepository,
    private readonly settings: PmAgentSettingsRepository,
    private readonly presenter: PmAgentPresenterService,
    private readonly events: PmAgentEventsService,
    @Inject(PM_AGENT_RUN_TRIGGER)
    private readonly runTrigger: PmAgentRunTrigger,
  ) {}

  // ── reads ─────────────────────────────────────────────────────────────────

  async list(query: ListCardsQueryDto): Promise<{ cards: PmCardResponse[] }> {
    const cards = await this.cards.listForReview({
      statuses: query.status,
      kind: query.kind,
      limit: query.limit ?? 50,
    });
    return { cards: await this.presenter.present(cards) };
  }

  async getDetail(id: string): Promise<PmCardDetailResponse> {
    const card = await this.load(id);
    const [evidence, events] = await Promise.all([
      this.evidence.listByIds(
        Array.isArray(card.payload?.evidenceIds)
          ? card.payload.evidenceIds
          : [],
      ),
      this.cards.listEvents(card.id),
    ]);
    return this.presenter.presentDetail(card, evidence, events);
  }

  /** Free review slots: cap minus open cards. What a run may fill. */
  async freeSlots(): Promise<number> {
    const [settings, open] = await Promise.all([
      this.settings.getSingleton(),
      this.cards.countOpen(),
    ]);
    return Math.max(0, settings.queueCap - open);
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  /**
   * Accept = file to the roadmap. The card waits out the 10-second undo window in
   * `accepted_pending`; the outbox row is not due until then, and PmAgentFilingService files it
   * as a Product Manager Agent opportunity. `path` is accepted for old clients and ignored: the
   * Builder and plan.md paths were removed on 2026-11-17.
   */
  async accept(
    userId: number,
    id: string,
    dto: AcceptCardDto,
  ): Promise<PmCardResponse> {
    const card = await this.load(id);
    this.assertKind(card, PmCardKind.RECOMMENDATION, 'accept');
    if (!card.payload?.opportunity) {
      throw new UnprocessableEntityException(
        'This card was written before cards were filed to the roadmap and has no roadmap entry. Reject it or give feedback for a revised card.',
      );
    }
    const now = new Date();
    const undoUntil = new Date(now.getTime() + PM_UNDO_WINDOW_MS);
    const moved = await this.cards.transition({
      cardId: id,
      from: [PmCardStatus.OPEN],
      to: PmCardStatus.ACCEPTED_PENDING,
      guard: { versionHash: dto.versionHash },
      patch: {
        decidedAt: now,
        decidedBy: userId,
        acceptPath: PmAcceptPath.ROADMAP,
        undoUntil,
      },
      event: {
        type: 'accepted',
        actorUserId: userId,
        detail: {
          path: PmAcceptPath.ROADMAP,
          versionHash: card.versionHash,
          undoUntil: undoUntil.toISOString(),
        },
      },
      also: async (manager, row) => {
        // Not due until the undo window closes: the worker cannot see it before then.
        await this.outbox.insertWith(manager, {
          cardId: row.id,
          dueAt: undoUntil,
          step: PmOutboxStep.FILE_ROADMAP,
          createdBy: userId,
        });
        await this.recordDecision(
          manager,
          row,
          PmDecision.ACCEPTED,
          userId,
          now,
        );
      },
    });
    return this.after(
      moved,
      id,
      'accept',
      PmLaneStatDimension.CATEGORY,
      'accepted',
    );
  }

  /**
   * Undo an accept: only while `accepted_pending` and before `undoUntil` — both in the
   * UPDATE's WHERE, so an undo racing the worker's claim has exactly one winner. The
   * outbox row is deleted only while still PENDING; if the worker already took it, the
   * delete matches nothing, the transaction rolls back, and the answer is 409.
   */
  async undo(userId: number, id: string): Promise<PmCardResponse> {
    await this.load(id);
    let outboxGone = true;
    const moved = await this.cards
      .transition({
        cardId: id,
        from: [PmCardStatus.ACCEPTED_PENDING],
        to: PmCardStatus.OPEN,
        guard: { undoOpen: true },
        patch: {
          decidedAt: null,
          decidedBy: null,
          acceptPath: null,
          undoUntil: null,
        },
        event: { type: 'undone', actorUserId: userId },
        also: async (manager, row) => {
          const deleted = await this.outbox.deletePendingWith(manager, row.id);
          if (!deleted.affected) {
            outboxGone = false;
            throw new ConflictException(
              'The card is already being filed to the roadmap and can no longer be undone.',
            );
          }
          await this.outcomes.recordDecisionWith(manager, {
            cardId: row.id,
            decision: PmDecision.ACCEPTED,
            decidedBy: userId,
            decidedAt: new Date(),
            undone: true,
          });
        },
      })
      .catch((error) => {
        if (!outboxGone) return null;
        throw error;
      });
    return this.after(moved, id, 'undo');
  }

  async reject(
    userId: number,
    id: string,
    dto: RejectCardDto,
  ): Promise<PmCardResponse> {
    const card = await this.load(id);
    const now = new Date();
    const reason = dto.reason?.trim() || null;
    const moved = await this.cards.transition({
      cardId: id,
      from: [PmCardStatus.OPEN],
      to: PmCardStatus.REJECTED,
      patch: {
        decidedAt: now,
        decidedBy: userId,
        reasonChip: dto.reasonChip ?? null,
        reason,
      },
      event: {
        type: 'rejected',
        actorUserId: userId,
        detail: { reasonChip: dto.reasonChip ?? null, hasReason: !!reason },
      },
      also: async (manager, row) => {
        await this.memory.insertWith(manager, {
          kind: PmMemoryKind.FACT,
          key: `rejected:${normaliseKey(row.title)}`,
          value: PmAgentCardService.rejectionFact(
            row.title,
            dto.reasonChip ?? null,
            reason,
          ),
          scope: PmQuestionScope.GLOBAL,
          source: PmMemorySource.REJECTION,
          sourceCardId: row.id,
          createdBy: userId,
          updatedBy: userId,
        });
        await this.recordDecision(
          manager,
          row,
          PmDecision.REJECTED,
          userId,
          now,
          {
            reasonChip: dto.reasonChip ?? null,
          },
        );
      },
    });
    return this.after(
      moved,
      card.id,
      'reject',
      PmLaneStatDimension.CATEGORY,
      'rejected',
    );
  }

  /** Add or replace the reason within 30 s of the reject (the non-blocking toast). */
  async setReason(
    userId: number,
    id: string,
    dto: RejectCardDto,
  ): Promise<PmCardResponse> {
    await this.load(id);
    const reason = dto.reason?.trim() || null;
    const moved = await this.cards.patchIf(
      id,
      [PmCardStatus.REJECTED],
      { reasonChip: dto.reasonChip ?? null, reason },
      {
        type: 'reason_added',
        actorUserId: userId,
        detail: { reasonChip: dto.reasonChip ?? null, hasReason: !!reason },
      },
      { decidedWithinMs: PM_REJECT_REASON_WINDOW_MS },
    );
    if (moved) {
      await this.memory.update(
        { sourceCardId: id, source: PmMemorySource.REJECTION },
        {
          value: PmAgentCardService.rejectionFact(
            moved.title,
            dto.reasonChip ?? null,
            reason,
          ),
          updatedBy: userId,
        },
      );
      await this.outcomes.flag(id, { reasonChip: dto.reasonChip ?? null });
    }
    return this.after(moved, id, 'add a reason to');
  }

  async feedback(
    userId: number,
    id: string,
    dto: FeedbackCardDto,
  ): Promise<PmCardResponse> {
    await this.load(id);
    const now = new Date();
    let feedbackId: string | null = null;
    const moved = await this.cards.transition({
      cardId: id,
      from: [PmCardStatus.OPEN],
      to: PmCardStatus.FEEDBACK_CLOSED,
      patch: { decidedAt: now, decidedBy: userId },
      event: {
        type: 'feedback',
        actorUserId: userId,
        detail: { chips: dto.chips ?? [], reviseNow: !!dto.reviseNow },
      },
      also: async (manager, row) => {
        const saved = await this.feedbackRows.insertWith(manager, {
          cardId: row.id,
          text: dto.text.trim(),
          chips: dto.chips ?? [],
          reviseNow: !!dto.reviseNow,
          status: PmFeedbackStatus.PENDING,
          createdBy: userId,
        });
        feedbackId = saved.id;
        await this.recordDecision(
          manager,
          row,
          PmDecision.FEEDBACK,
          userId,
          now,
          {
            feedbackChips: dto.chips ?? [],
          },
        );
      },
    });
    const response = await this.after(
      moved,
      id,
      'give feedback on',
      PmLaneStatDimension.CATEGORY,
      'feedback',
    );
    if (dto.reviseNow && feedbackId) {
      const fid: string = feedbackId;
      void this.runTrigger
        .reviseNow(fid, userId)
        .catch((error) =>
          this.logger.warn(
            `[PM_AGENT] Revise-now for feedback ${fid} did not start: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
    }
    return response;
  }

  async answer(
    userId: number,
    id: string,
    dto: AnswerCardDto,
  ): Promise<PmCardResponse> {
    const card = await this.load(id);
    this.assertKind(card, PmCardKind.QUESTION, 'answer');
    const options: { label: string; consequence?: string }[] = Array.isArray(
      card.payload?.options,
    )
      ? card.payload.options
      : [];
    const custom = dto.customText?.trim();
    if ((dto.optionIndex === undefined) === !custom) {
      throw new UnprocessableEntityException(
        'Send exactly one of optionIndex or customText.',
      );
    }
    const option =
      dto.optionIndex !== undefined ? options[dto.optionIndex] : undefined;
    if (dto.optionIndex !== undefined && !option) {
      throw new UnprocessableEntityException(
        `optionIndex must be between 0 and ${options.length - 1}.`,
      );
    }
    const answerText = option
      ? `${option.label}${option.consequence ? ` — ${option.consequence}` : ''}`
      : custom!;
    const now = new Date();
    const moved = await this.cards.transition({
      cardId: id,
      from: [PmCardStatus.OPEN],
      to: PmCardStatus.ANSWERED,
      patch: { decidedAt: now, decidedBy: userId },
      event: {
        type: 'answered',
        actorUserId: userId,
        detail: { optionIndex: dto.optionIndex ?? null, custom: !!custom },
      },
      also: async (manager, row) => {
        await this.memory.insertWith(manager, {
          kind: PmMemoryKind.FACT,
          key: row.questionKey ?? `question:${normaliseKey(row.title)}`,
          value: `Q: ${row.title}\nA: ${answerText}`.slice(0, 2000),
          scope: Object.values(PmQuestionScope).includes(row.payload?.scope)
            ? row.payload.scope
            : PmQuestionScope.GLOBAL,
          source: PmMemorySource.ANSWER,
          sourceCardId: row.id,
          createdBy: userId,
          updatedBy: userId,
        });
        await this.recordDecision(
          manager,
          row,
          PmDecision.ANSWERED,
          userId,
          now,
        );
      },
    });
    return this.after(moved, id, 'answer');
  }

  async skip(userId: number, id: string): Promise<PmCardResponse> {
    const card = await this.load(id);
    this.assertKind(card, PmCardKind.QUESTION, 'skip');
    const now = new Date();
    const moved = await this.cards.transition({
      cardId: id,
      from: [PmCardStatus.OPEN],
      to: PmCardStatus.SKIPPED,
      patch: {
        decidedAt: now,
        decidedBy: userId,
        suppressUntil: new Date(now.getTime() + PM_SKIP_SUPPRESSION_MS),
        questionKey:
          card.questionKey ??
          (typeof card.payload?.questionKey === 'string'
            ? card.payload.questionKey
            : `question:${normaliseKey(card.title)}`),
      },
      event: { type: 'skipped', actorUserId: userId },
      also: (manager, row) =>
        this.recordDecision(manager, row, PmDecision.SKIPPED, userId, now),
    });
    return this.after(moved, id, 'skip');
  }

  /** needs_attention / failed → queued: the outbox row reopens where it stopped. */
  /** Try filing a stopped card again, from the top (every check runs again). */
  async retry(userId: number, id: string): Promise<PmCardResponse> {
    const card = await this.load(id);
    return this.refile(userId, card, 'retried');
  }

  /**
   * File a card the roadmap's duplicate check stopped, over that check. Only for a duplicate
   * stop: every other check (contract, checklist, goal, the roadmap's own gate) still runs.
   */
  async fileAnyway(userId: number, id: string): Promise<PmCardResponse> {
    const card = await this.load(id);
    const filing = (card.roadmapFiling ?? {}) as PmRoadmapFiling;
    if (
      card.status !== PmCardStatus.NEEDS_ATTENTION ||
      !filing.duplicates?.length
    ) {
      throw new ConflictException(
        'Only a card stopped as a possible roadmap duplicate can be filed anyway.',
      );
    }
    return this.refile(userId, card, 'file_anyway', {
      roadmapFiling: {
        ...filing,
        fileAnyway: { by: userId, at: new Date().toISOString() },
      },
    });
  }

  private async refile(
    userId: number,
    card: PmAgentCard,
    type: 'retried' | 'file_anyway',
    patch: Partial<PmAgentCard> = {},
  ): Promise<PmCardResponse> {
    const moved = await this.cards.transition({
      cardId: card.id,
      from: [PmCardStatus.NEEDS_ATTENTION, PmCardStatus.FAILED],
      to: PmCardStatus.QUEUED,
      patch: { ...patch, needsYouReason: null, needsYouDismissedAt: null },
      event: { type, actorUserId: userId },
    });
    if (moved) {
      await this.outbox.reopen(
        card.id,
        PmOutboxStep.FILE_ROADMAP,
        card.decidedBy ?? userId,
      );
    }
    return this.after(
      moved,
      card.id,
      type === 'retried' ? 'retry' : 'file anyway',
    );
  }

  /** Take a needs-you item off the list; its status is unchanged. */
  async dismiss(userId: number, id: string): Promise<PmCardResponse> {
    await this.load(id);
    const moved = await this.cards.patchIf(
      id,
      PM_NEEDS_YOU_STATUSES,
      { needsYouDismissedAt: new Date() },
      { type: 'dismissed', actorUserId: userId },
    );
    return this.after(moved, id, 'dismiss');
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  static rejectionFact(
    title: string,
    chip: string | null,
    reason: string | null,
  ): string {
    const why = [chip ? chip.replace(/_/g, ' ') : null, reason]
      .filter(Boolean)
      .join(': ');
    return `Do not propose "${title}" again${why ? ` (${why})` : ''}.`.slice(
      0,
      2000,
    );
  }

  private async recordDecision(
    manager: EntityManager,
    card: PmAgentCard,
    decision: PmDecision,
    userId: number,
    at: Date,
    extra: { reasonChip?: string | null; feedbackChips?: string[] } = {},
  ): Promise<void> {
    const opened = card.openedAt ?? card.createdAt;
    await this.outcomes.recordDecisionWith(manager, {
      cardId: card.id,
      decision,
      decidedBy: userId,
      decidedAt: at,
      decisionLatencyMs: opened
        ? Math.max(0, at.getTime() - new Date(opened).getTime())
        : null,
      reasonChip: extra.reasonChip ?? null,
      feedbackChips: extra.feedbackChips ?? null,
      undone: false,
      impactMetricName:
        typeof card.payload?.impactMetric?.name === 'string'
          ? card.payload.impactMetric.name.slice(0, 120)
          : null,
    });
  }

  /** 409 on a lost race, with the status the card is actually in. */
  private async after(
    moved: PmAgentCard | null,
    id: string,
    verb: string,
    statDimension?: PmLaneStatDimension,
    counter?: 'accepted' | 'rejected' | 'feedback',
  ): Promise<PmCardResponse> {
    if (!moved) {
      const current = await this.cards.findOne({ where: { id } });
      throw new ConflictException(
        `Cannot ${verb} this card: it is ${current?.status ?? 'gone'}${
          current?.status === PmCardStatus.ACCEPTED_PENDING ||
          current?.status === PmCardStatus.REJECTED
            ? ' (or its window has closed)'
            : ''
        }.`,
      );
    }
    if (statDimension && counter) {
      await this.laneStats
        .bump(statDimension, moved.category, counter)
        .catch(() => undefined);
    }
    this.events.cardUpdated(moved.id);
    return this.presenter.presentOne(moved);
  }

  private async load(id: string): Promise<PmAgentCard> {
    const card = await this.cards.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  private assertKind(card: PmAgentCard, kind: PmCardKind, verb: string) {
    if (card.kind !== kind) {
      throw new UnprocessableEntityException(
        `Only a ${kind} card can be ${verb === 'answer' ? 'answered' : verb === 'skip' ? 'skipped' : 'accepted'}.`,
      );
    }
  }
}
