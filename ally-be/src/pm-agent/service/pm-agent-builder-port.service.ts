import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { BuilderSession } from 'src/builder/entity/builder-session.entity';
import { BuilderSettings } from 'src/builder/entity/builder-settings.entity';
import { BuilderPullRequest } from 'src/builder/entity/builder-pull-request.entity';
import { BuilderSessionStatus } from 'src/builder/enum/builder.enum';
import { PM_AGENT_REQUESTER } from 'src/builder/util/builder-requesters.registry';
import type { BuilderTechnicalDesignStatus } from 'src/builder/type/builder-prd.type';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';
import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';
import { PrdPatchOp } from '../util/compile-plan';

export interface PmBuilderSessionView {
  id: string;
  status: BuilderSessionStatus;
  totalCostUsd: string | null;
  error: string | null;
}

/**
 * Everything the PM Agent asks of Builder and the roadmap, in one place.
 *
 * Writes go through Builder's and the roadmap's OWN services (createSession, patchPrd,
 * updateSession, startDesign, approveDesign, startBuild, RoadmapOpportunityService.create,
 * RoadmapBuilderService.openSession), resolved lazily through ModuleRef exactly as the
 * Debrief PM agent does: BuilderModule imports far more than this needs, and importing it
 * here would put the PM Agent on Builder's import graph (and Builder, via UX Signals, on
 * ours). Reads are plain repository reads of Builder's tables.
 *
 * A seam for tests, too: PmAgentBuildService is specified against this class.
 */
@Injectable()
export class PmAgentBuilderPort {
  constructor(
    private readonly moduleRef: ModuleRef,
    @InjectRepository(BuilderSession)
    private readonly sessions: Repository<BuilderSession>,
    @InjectRepository(BuilderSettings)
    private readonly settings: Repository<BuilderSettings>,
    @InjectRepository(BuilderPullRequest)
    private readonly pullRequests: Repository<BuilderPullRequest>,
    private readonly opportunities: RoadmapOpportunityRepository,
    private readonly goals: RoadmapProductGoalRepository,
  ) {}

  private async sessionService() {
    const { BuilderSessionService } =
      await import('../../builder/service/builder-session.service');
    return this.moduleRef.get(BuilderSessionService, { strict: false });
  }

  private async buildService() {
    const { BuilderBuildService } =
      await import('../../builder/service/builder-build.service');
    return this.moduleRef.get(BuilderBuildService, { strict: false });
  }

  private async prdService() {
    const { BuilderPrdService } =
      await import('../../builder/service/builder-prd.service');
    return this.moduleRef.get(BuilderPrdService, { strict: false });
  }

  /** Builder's kill switch and concurrency, read-only. */
  async builderSettings(): Promise<{
    enabled: boolean;
    maxConcurrentBuilds: number;
  }> {
    const [row] = await this.settings.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    return {
      enabled: Boolean(row?.enabled),
      maxConcurrentBuilds: row?.maxConcurrentBuilds ?? 3,
    };
  }

  /** A session this card already has (crash between create and record). */
  async findSessionForCard(cardId: string): Promise<string | null> {
    const row = await this.sessions.findOne({
      where: { requestedBy: PM_AGENT_REQUESTER, requestRef: cardId },
      select: { id: true },
      order: { createdAt: 'ASC' },
    });
    return row?.id ?? null;
  }

  async createSession(
    userId: number,
    cardId: string,
    title: string,
  ): Promise<string> {
    const service = await this.sessionService();
    const session = await service.createSession(userId, {
      title,
      tenantId: null,
      requestedBy: PM_AGENT_REQUESTER,
      requestRef: cardId,
    });
    return session.id;
  }

  async getSession(sessionId: string): Promise<PmBuilderSessionView | null> {
    const row = await this.sessions.findOne({
      where: { id: sessionId },
      select: { id: true, status: true, totalCostUsd: true, error: true },
    });
    return row
      ? {
          id: row.id,
          status: row.status,
          totalCostUsd: row.totalCostUsd ?? null,
          error: row.error ?? null,
        }
      : null;
  }

  async patchPrd(
    sessionId: string,
    userId: number,
    ops: PrdPatchOp[],
    summary: string,
  ): Promise<{ ready: boolean; blockers: string[] }> {
    const service = await this.sessionService();
    const { readiness } = await service.patchPrd(
      sessionId,
      userId,
      ops,
      summary,
    );
    return { ready: readiness.ready, blockers: readiness.blockers ?? [] };
  }

  async setRepos(
    sessionId: string,
    userId: number,
    repos: string[],
  ): Promise<void> {
    const service = await this.sessionService();
    await service.updateSession(sessionId, userId, { repos });
  }

  async designStatus(
    sessionId: string,
    userId: number,
  ): Promise<{
    status: BuilderTechnicalDesignStatus | null;
    error: string | null;
    openDecisions: string[];
  }> {
    const prd = await this.prdService();
    const doc = await prd.getOrCreateDoc(sessionId, userId);
    const design = doc.draft.technicalDesign;
    return {
      status: design?.status ?? null,
      error: design?.error ?? null,
      openDecisions: design?.openDecisions ?? [],
    };
  }

  async startDesign(sessionId: string, userId: number): Promise<void> {
    const [sessions, builds] = await Promise.all([
      this.sessionService(),
      this.buildService(),
    ]);
    await builds.startDesign(await sessions.getSession(sessionId), userId);
  }

  async approveDesign(sessionId: string, userId: number): Promise<void> {
    const [sessions, builds] = await Promise.all([
      this.sessionService(),
      this.buildService(),
    ]);
    await builds.approveDesign(await sessions.getSession(sessionId), userId);
  }

  async startBuild(sessionId: string, userId: number): Promise<void> {
    const [sessions, builds] = await Promise.all([
      this.sessionService(),
      this.buildService(),
    ]);
    await builds.startBuild(await sessions.getSession(sessionId), userId);
  }

  async listPullRequests(sessionId: string): Promise<BuilderPullRequest[]> {
    return this.pullRequests.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * File the roadmap item and link it to the card's Builder session.
   *
   * RoadmapBuilderService.openSession creates its OWN session when the opportunity has
   * none — one without the PM Agent's requester, and so without the autonomy override.
   * So the opportunity is linked to our session first (conditionally, IsNull — the same
   * claim openSession makes), which makes openSession's idempotent branch the one that
   * runs: it backfills the hand-off and returns our session.
   */
  async fileRoadmapItem(
    userId: number,
    sessionId: string,
    description: string,
  ): Promise<string | null> {
    const goal = (await this.goals.findAllOrdered())[0];
    if (!goal) return null;
    const { RoadmapOpportunityService } =
      await import('../../product-roadmap/service/roadmap-opportunity.service');
    const opportunities = this.moduleRef.get(RoadmapOpportunityService, {
      strict: false,
    });
    const created = await opportunities.create(userId, {
      description: description.slice(0, 1000),
      type: RoadmapOpportunityType.IDEA,
      productGoal: goal.name,
    } as never);
    await this.opportunities.update(
      { id: created.id, builderSessionId: IsNull() },
      {
        builderSessionId: sessionId,
        updatedBy: userId,
      },
    );
    const { RoadmapBuilderService } =
      await import('../../product-roadmap/service/roadmap-builder.service');
    await this.moduleRef
      .get(RoadmapBuilderService, { strict: false })
      .openSession(userId, created.id);
    return created.id;
  }
}
