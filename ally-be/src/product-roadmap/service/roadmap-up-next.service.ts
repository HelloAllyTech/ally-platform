import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { BuilderNowService } from 'src/builder/service/builder-now.service';
import { BuilderDecisionService } from 'src/builder/service/builder-decision.service';
import { BuilderHistoryService } from 'src/builder/service/builder-history.service';
import { BuilderLiveService } from 'src/builder/service/builder-live.service';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { RoadmapOpportunityService } from './roadmap-opportunity.service';
import { RoadmapBuilderService } from './roadmap-builder.service';
import { ListOpportunitiesQueryDto } from '../dto/roadmap-opportunity.dto';
import { RoadmapOpportunityBrief } from '../type/roadmap-brief.type';

export interface UpNextItem {
  id: string;
  code: string;
  /** The description's first line: what the person reads to decide. */
  title: string;
  description: string;
  queueRank: number | null;
  voterCount: number;
  effort: string | null;
  productGoal: string | null;
  goalsHelped: number;
  goalsAssessed: number;
  successMetric: string | null;
  /** The copilot's one-line case, when the opportunity was filed with a brief. */
  assessment: string | null;
}

export interface UpNextResponse {
  items: UpNextItem[];
  inProgress: number;
  limit: number;
}

const firstLine = (text: string, max = 140): string => {
  const line = String(text ?? '')
    .trim()
    .split('\n')[0]
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/**
 * The Builder tab's Up next: the top of the prioritised roadmap, one Start
 * away from Builder.
 *
 * Lives with the roadmap because the roadmap owns opportunities and already
 * depends on Builder; Builder never imports the roadmap. Picking is a
 * two-way door, so Start is one press and Put back undoes it — but the
 * person's limit is enforced here, never silently queued past.
 */
@Injectable()
export class RoadmapUpNextService {
  private readonly logger = LoggerService.getInstance(
    RoadmapUpNextService.name,
  );

  constructor(
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly roadmapBuilderService: RoadmapBuilderService,
    private readonly builderSessionService: BuilderSessionService,
    private readonly nowService: BuilderNowService,
    private readonly decisionService: BuilderDecisionService,
    private readonly historyService: BuilderHistoryService,
    private readonly liveService: BuilderLiveService,
  ) {}

  /**
   * Prioritised opportunities with no Builder session, in the roadmap's own
   * queue order. Bugs are left out: the roadmap hides the Builder button for
   * them, because a bug goes to Bug Hunter.
   */
  async upNext(userId: number): Promise<UpNextResponse> {
    const [list, count] = await Promise.all([
      this.opportunityService.list(userId, {
        stage: [RoadmapOpportunityStage.PRIORITISED],
        limit: 100,
      } as ListOpportunitiesQueryDto),
      this.nowService.inProgressCount(),
    ]);
    const open = list.items
      .filter(
        (item) =>
          !item.builderSessionId && item.type !== RoadmapOpportunityType.BUG,
      )
      .sort(
        (a, b) =>
          (a.queueRank ?? Number.MAX_SAFE_INTEGER) -
            (b.queueRank ?? Number.MAX_SAFE_INTEGER) ||
          (b.compositeScore ?? 0) - (a.compositeScore ?? 0),
      );
    const briefs = await this.briefs(open.map((item) => item.id));
    return {
      items: open.map((item) => {
        const brief = briefs.get(item.id) ?? null;
        return {
          id: item.id,
          code: item.code,
          title: firstLine(item.description),
          description: item.description,
          queueRank: item.queueRank ?? null,
          voterCount: item.voterCount ?? 0,
          effort: item.effort ?? null,
          productGoal: item.productGoal ?? null,
          goalsHelped: item.goalsHelped ?? 0,
          goalsAssessed: item.goalsAssessed ?? 0,
          successMetric: brief?.successMetric ?? null,
          assessment: brief?.assessment?.summary ?? null,
        };
      }),
      ...count,
    };
  }

  /**
   * Hand an opportunity to Builder and start its interview server-side, so
   * three quick Starts give three running interviews without opening a page.
   */
  async start(
    userId: number,
    opportunityId: string,
  ): Promise<{ sessionId: string; created: boolean }> {
    const { inProgress, limit } = await this.nowService.inProgressCount();
    if (inProgress >= limit) {
      throw new ConflictException(
        `${inProgress} of ${limit} in progress. Put one back, or finish one, to start another.`,
      );
    }
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: opportunityId },
    });
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }
    if (opportunity.type === RoadmapOpportunityType.BUG) {
      throw new BadRequestException(
        'Bugs go to Bug Hunter, not Builder. Open it on the roadmap instead.',
      );
    }

    const handle = await this.roadmapBuilderService.openSession(
      userId,
      opportunityId,
    );
    if (handle.created && handle.seedMessage) {
      try {
        await this.decisionService.startBackgroundTurn(
          handle.sessionId,
          handle.seedMessage,
          userId,
        );
      } catch (error) {
        // The session exists and is linked; only its first turn failed to
        // start. Opening it sends the seed the old way, so this is a warning,
        // not a failed Start.
        this.logger.warn(
          `Up next started ${opportunity.code} but its first turn did not: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await this.historyService.record({
      entryType: 'start',
      sessionId: handle.sessionId,
      sessionTitle: firstLine(opportunity.description, 200),
      prompt: `Start ${opportunity.code}`,
      chosenLabel: 'Started from Up next',
      surface: 'now',
      actorUserId: userId,
      decidedAt: new Date(),
      appliedAt: new Date(),
    });
    this.liveService.changed('sessionsChanged');
    return { sessionId: handle.sessionId, created: handle.created };
  }

  /**
   * Cancel an interview nobody has answered anything in, and return its
   * opportunity to the prioritised roadmap. Anything further along has
   * decisions in it worth keeping, so it is cancelled from its own page.
   */
  async putBack(
    userId: number,
    sessionId: string,
  ): Promise<{ ok: true; opportunityId: string | null }> {
    const { sessions } = await this.nowService.now();
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      throw new NotFoundException('That session is not in progress.');
    }
    if (!session.putBackEligible) {
      throw new ConflictException(
        "Only an interview you haven't answered anything in can be put back. Cancel this one from its session page.",
      );
    }

    await this.builderSessionService.cancelSession(sessionId, userId);
    const opportunity = await this.opportunityRepository.findOne({
      where: { builderSessionId: sessionId },
    });
    if (opportunity) {
      await this.opportunityRepository.update(
        { id: opportunity.id },
        {
          builderSessionId: null,
          stage:
            opportunity.stage === RoadmapOpportunityStage.UNDER_DEVELOPMENT
              ? RoadmapOpportunityStage.PRIORITISED
              : opportunity.stage,
          updatedBy: userId,
        },
      );
    }
    await this.historyService.record({
      entryType: 'putback',
      sessionId,
      sessionTitle: session.title.slice(0, 200),
      prompt: `Put back ${session.code ?? session.title}`,
      chosenLabel: opportunity
        ? 'Put back on the roadmap'
        : 'Closed (not from the roadmap)',
      surface: 'now',
      actorUserId: userId,
      decidedAt: new Date(),
      appliedAt: new Date(),
    });
    this.liveService.changed('sessionsChanged', 'decisionsChanged');
    return { ok: true, opportunityId: opportunity?.id ?? null };
  }

  private async briefs(
    ids: string[],
  ): Promise<Map<string, RoadmapOpportunityBrief>> {
    if (!ids.length) return new Map();
    const rows = await this.opportunityRepository.find({
      where: { id: In(ids) },
      select: { id: true, brief: true },
    });
    return new Map(
      rows
        .filter((row) => row.brief)
        .map((row) => [row.id, row.brief as RoadmapOpportunityBrief]),
    );
  }
}
