import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BuilderPullRequest } from 'src/builder/entity/builder-pull-request.entity';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { PmAgentCard } from '../entity/pm-agent-card.entity';
import { PmAgentCardEvent } from '../entity/pm-agent-card-event.entity';
import { PmAgentEvidence } from '../entity/pm-agent-evidence.entity';
import { PmCardStatus } from '../enum/pm-agent.enum';
import { PM_NEEDS_YOU_STATUSES } from '../constants/pm-agent.constants';
import {
  PmCardDetailResponse,
  PmCardResponse,
  PmDelivery,
  PmNeedsYou,
} from '../dto/pm-agent.dto';
import { PmAgentImpactService } from '../impact/pm-agent-impact.service';

const iso = (value?: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

const DEFAULT_NEEDS_YOU_REASON: Partial<Record<PmCardStatus, string>> = {
  [PmCardStatus.FAILED]: 'The build failed.',
  [PmCardStatus.NEEDS_ATTENTION]: 'The build stopped and needs a person.',
  [PmCardStatus.MERGED_NOT_RELEASED]:
    'Merged, but the release did not reach production.',
};

/**
 * Shapes cards for the API (the `Card` type in docs/pm-agent.md). Builder state is
 * read directly from its tables (read-only; Builder's own services own every write), in
 * one query per page rather than one per card.
 */
@Injectable()
export class PmAgentPresenterService {
  constructor(
    @InjectRepository(BuilderPullRequest)
    private readonly pullRequests: Repository<BuilderPullRequest>,
    @InjectRepository(BuilderSession)
    private readonly sessions: Repository<BuilderSession>,
    @Optional() private readonly impact?: PmAgentImpactService,
  ) {}

  async present(cards: PmAgentCard[]): Promise<PmCardResponse[]> {
    const [deliveries, impacts] = await Promise.all([
      this.deliveries(cards),
      this.impact ? this.impact.views(cards) : new Map(),
    ]);
    return cards.map((card) => {
      const delivery = card.builderSessionId
        ? deliveries.get(card.builderSessionId)
        : undefined;
      const impact = impacts.get(card.id);
      return PmAgentPresenterService.toResponse(
        card,
        // `delivery.impact` rides on the delivery (a copy: deliveries are shared per session).
        delivery && impact ? { ...delivery, impact } : delivery,
      );
    });
  }

  async presentOne(card: PmAgentCard): Promise<PmCardResponse> {
    return (await this.present([card]))[0];
  }

  async presentDetail(
    card: PmAgentCard,
    evidence: PmAgentEvidence[],
    events: PmAgentCardEvent[],
  ): Promise<PmCardDetailResponse> {
    return {
      ...(await this.presentOne(card)),
      evidence: evidence.map((item) => ({
        id: item.id,
        source: item.source,
        kind: item.kind,
        label: item.label,
        query: item.query ?? null,
        snapshot: item.snapshot ?? null,
        url: item.url ?? null,
        fetchedAt: iso(item.fetchedAt)!,
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus ?? null,
        toStatus: event.toStatus ?? null,
        cardVersion: event.cardVersion,
        actorUserId: event.actorUserId ?? null,
        detail: event.detail ?? null,
        createdAt: iso(event.createdAt)!,
      })),
    };
  }

  private async deliveries(
    cards: PmAgentCard[],
  ): Promise<Map<string, PmDelivery>> {
    const sessionIds = [
      ...new Set(
        cards
          .map((card) => card.builderSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const out = new Map<string, PmDelivery>();
    if (!sessionIds.length) return out;
    const [sessions, prs] = await Promise.all([
      this.sessions.find({
        where: { id: In(sessionIds) },
        select: { id: true, status: true, totalCostUsd: true },
        withDeleted: true,
      }),
      this.pullRequests.find({
        where: { sessionId: In(sessionIds) },
        order: { createdAt: 'ASC' },
      }),
    ]);
    for (const session of sessions) {
      out.set(session.id, {
        status: session.status ?? null,
        prs: [],
        costUsd:
          session.totalCostUsd != null ? Number(session.totalCostUsd) : null,
      });
    }
    for (const pr of prs) {
      const delivery = out.get(pr.sessionId);
      if (!delivery) continue;
      delivery.prs.push({
        url: pr.prUrl,
        state: pr.state ?? null,
        ciStatus: pr.ciStatus ?? null,
        merged: Boolean(pr.merged),
        releaseState: pr.releaseState ?? null,
        releaseTag: pr.releaseTag ?? null,
      });
    }
    return out;
  }

  static needsYouOf(card: PmAgentCard): PmNeedsYou | undefined {
    if (
      !PM_NEEDS_YOU_STATUSES.includes(card.status) ||
      card.needsYouDismissedAt
    ) {
      return undefined;
    }
    const actions: PmNeedsYou['actions'] =
      card.status === PmCardStatus.MERGED_NOT_RELEASED
        ? ['open_pr', 'dismiss']
        : card.builderSessionId
          ? ['retry', 'open_pr', 'dismiss']
          : ['retry', 'dismiss'];
    return {
      reason:
        card.needsYouReason ??
        DEFAULT_NEEDS_YOU_REASON[card.status] ??
        'Needs a person.',
      actions,
    };
  }

  static toResponse(card: PmAgentCard, delivery?: PmDelivery): PmCardResponse {
    const needsYou = PmAgentPresenterService.needsYouOf(card);
    return {
      id: card.id,
      kind: card.kind,
      category: card.category,
      status: card.status,
      version: card.version,
      versionHash: card.versionHash,
      title: card.title,
      payload: card.payload,
      rank: Number(card.rank ?? 0),
      evidenceFreshness: iso(card.evidenceFreshness),
      createdAt: iso(card.createdAt)!,
      decidedAt: iso(card.decidedAt),
      decidedBy: card.decidedBy ?? null,
      undoUntil: iso(card.undoUntil),
      ...(needsYou ? { needsYou } : {}),
      ...(delivery ? { delivery } : {}),
      revisedFromCardId: card.revisedFromCardId ?? null,
      reasonChip: card.reasonChip ?? null,
      reason: card.reason ?? null,
    };
  }
}
