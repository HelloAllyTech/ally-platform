import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { In } from 'typeorm';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from 'src/product-roadmap/enum/roadmap-opportunity.enum';

export interface PmRoadmapOpportunityView {
  id: string;
  code: string;
  stage: RoadmapOpportunityStage;
  releasedAt: Date | null;
  /** Soft-deleted on the roadmap. */
  deleted: boolean;
}

export interface PmRoadmapDuplicate {
  id: string;
  code: string | null;
  reason: string;
}

/**
 * Everything the PM Agent asks of the roadmap, in one place, and the only way it writes there.
 *
 * Filing goes through the roadmap's OWN create path — RoadmapOpportunityService.create with
 * `enforceReadiness: true` and a readiness token from RoadmapReadinessTokenService — so a card
 * meets exactly the bar a person filing through the copilot meets. The token is minted here for
 * the verdict the critic reached when the card was persisted (see PmAgentFilingService), which
 * is the token service's own model: sign the first reading, never re-grade on write.
 *
 * Services are resolved lazily through ModuleRef (strict: false), as the Builder port did:
 * the readiness-token and AI services are not exported by ProductRoadmapModule, and resolving
 * on use keeps the PM Agent off the roadmap module's import graph beyond its repositories.
 *
 * A seam for tests, too: PmAgentFilingService is specified against this class.
 */
@Injectable()
export class PmAgentRoadmapPort {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly opportunities: RoadmapOpportunityRepository,
    private readonly goals: RoadmapProductGoalRepository,
  ) {}

  async productGoalExists(name: string): Promise<boolean> {
    return (await this.goals.findAllOrdered()).some(
      (goal) => goal.name === name,
    );
  }

  /**
   * The opportunity already filed for this card, if any (a crash between filing and recording
   * it). Matched on the source tag and the card id in `reporterContext`, deleted rows included,
   * so a retry never files the same card twice.
   */
  async findFiledForCard(cardId: string): Promise<string | null> {
    const row = await this.opportunities
      .createQueryBuilder('o')
      .withDeleted()
      .select(['o.id'])
      .where('o.source = :source', {
        source: RoadmapOpportunitySource.PM_AGENT,
      })
      .andWhere(`o."reporterContext"->>'pmAgentCardId' = :cardId`, { cardId })
      .orderBy('o.createdAt', 'ASC')
      .getOne();
    return row?.id ?? null;
  }

  /**
   * The roadmap's own duplicate detection (vector search + same-goal candidates + an LLM
   * confirmation pass), the check the filing drawer runs for a person. It degrades to no
   * matches on any failure, so a dead ally-ai never blocks filing.
   */
  async findDuplicates(
    description: string,
    productGoal: string,
  ): Promise<PmRoadmapDuplicate[]> {
    const { RoadmapAiService } =
      await import('../../product-roadmap/service/roadmap-ai.service');
    const ai = this.moduleRef.get(RoadmapAiService, { strict: false });
    const { matches } = await ai.findDuplicates(description, productGoal);
    if (!matches.length) return [];
    const codes = new Map(
      (
        await this.opportunities.find({
          where: { id: In(matches.map((match) => match.id)) },
          select: { id: true, code: true },
        })
      ).map((row) => [row.id, row.code]),
    );
    return matches.map((match) => ({
      id: match.id,
      code: codes.get(match.id) ?? null,
      reason: String(match.reason ?? '').slice(0, 300),
    }));
  }

  /**
   * File one opportunity as the Product Manager Agent. `userId` is the admin who accepted the
   * card: it stays the row's `createdBy` for audit, while `source = pm_agent` is what the board
   * shows as the author. Throws the roadmap's own BadRequestException when the readiness gate
   * refuses (a stale goal, an unsized draft).
   */
  async file(input: {
    userId: number;
    cardId: string;
    description: string;
    productGoal: string;
    effort: RoadmapOpportunityEffort;
  }): Promise<{ id: string; code: string }> {
    const [{ RoadmapOpportunityService }, { RoadmapReadinessTokenService }] =
      await Promise.all([
        import('../../product-roadmap/service/roadmap-opportunity.service'),
        import('../../product-roadmap/service/roadmap-readiness-token.service'),
      ]);
    const opportunities = this.moduleRef.get(RoadmapOpportunityService, {
      strict: false,
    });
    const tokens = this.moduleRef.get(RoadmapReadinessTokenService, {
      strict: false,
    });
    const description = input.description.trim();
    const readinessToken = tokens.issue({
      description,
      productGoal: input.productGoal,
      failedCriteria: [],
      proposedEffort: input.effort,
    });
    const created = await opportunities.create(
      input.userId,
      {
        description,
        type: RoadmapOpportunityType.IDEA,
        productGoal: input.productGoal,
        effort: input.effort,
        readinessToken,
      } as never,
      {
        source: RoadmapOpportunitySource.PM_AGENT,
        reporterContext: { pmAgentCardId: input.cardId },
        enforceReadiness: true,
      },
    );
    return { id: created.id, code: created.code };
  }

  /** Stage, release time and deletion of filed opportunities, deleted rows included. */
  async getOpportunities(
    ids: string[],
  ): Promise<Map<string, PmRoadmapOpportunityView>> {
    if (!ids.length) return new Map();
    const rows = await this.opportunities.find({
      where: { id: In(ids) },
      select: {
        id: true,
        code: true,
        stage: true,
        releasedAt: true,
        deletedAt: true,
      },
      withDeleted: true,
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          code: row.code,
          stage: row.stage,
          releasedAt: row.releasedAt ?? null,
          deleted: Boolean(row.deletedAt),
        },
      ]),
    );
  }
}
