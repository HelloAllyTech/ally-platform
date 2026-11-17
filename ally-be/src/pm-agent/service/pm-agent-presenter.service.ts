import { Injectable, Optional } from '@nestjs/common';
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
import { PmRoadmapFiling } from '../pipeline/pm-pipeline.types';
import { PmAgentRoadmapPort } from './pm-agent-roadmap-port.service';

const iso = (value?: Date | string | null): string | null =>
  value ? new Date(value).toISOString() : null;

const DEFAULT_NEEDS_YOU_REASON: Partial<Record<PmCardStatus, string>> = {
  [PmCardStatus.NEEDS_ATTENTION]:
    'Filing to the roadmap stopped and needs a person.',
  [PmCardStatus.FAILED]: 'The build failed.',
  [PmCardStatus.MERGED_NOT_RELEASED]:
    'Merged, but the release did not reach production.',
};

/**
 * Shapes cards for the API (the `Card` type in docs/pm-agent.md). Where a filed card sits on
 * the roadmap is read through PmAgentRoadmapPort in one query per page, not one per card.
 */
@Injectable()
export class PmAgentPresenterService {
  constructor(
    private readonly roadmap: PmAgentRoadmapPort,
    @Optional() private readonly impact?: PmAgentImpactService,
  ) {}

  async present(cards: PmAgentCard[]): Promise<PmCardResponse[]> {
    const [deliveries, impacts] = await Promise.all([
      this.deliveries(cards),
      this.impact ? this.impact.views(cards) : new Map(),
    ]);
    return cards.map((card) => {
      const delivery = deliveries.get(card.id);
      const impact = impacts.get(card.id);
      return PmAgentPresenterService.toResponse(
        card,
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

  /** Card id → delivery, for every card that has reached the roadmap. */
  private async deliveries(
    cards: PmAgentCard[],
  ): Promise<Map<string, PmDelivery>> {
    const filed = cards.filter((card) => card.roadmapOpportunityId);
    const out = new Map<string, PmDelivery>();
    if (!filed.length) return out;
    const views = await this.roadmap
      .getOpportunities(filed.map((card) => card.roadmapOpportunityId!))
      .catch(() => new Map());
    for (const card of filed) {
      const view = views.get(card.roadmapOpportunityId!);
      out.set(card.id, {
        status: view?.stage ?? null,
        prs: [],
        costUsd: null,
        roadmap: {
          opportunityId: card.roadmapOpportunityId!,
          code: view?.code ?? null,
          stage: view?.stage ?? null,
          removed: view ? view.deleted : false,
        },
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
    const filing = (card.roadmapFiling ?? {}) as PmRoadmapFiling;
    const duplicateStop =
      card.status === PmCardStatus.NEEDS_ATTENTION &&
      Boolean(filing.duplicates?.length) &&
      !filing.fileAnyway;
    return {
      reason:
        card.needsYouReason ??
        DEFAULT_NEEDS_YOU_REASON[card.status] ??
        'Needs a person.',
      actions: duplicateStop
        ? ['file_anyway', 'dismiss']
        : card.status === PmCardStatus.MERGED_NOT_RELEASED
          ? ['dismiss']
          : ['retry', 'dismiss'],
      ...(duplicateStop ? { duplicates: filing.duplicates } : {}),
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
