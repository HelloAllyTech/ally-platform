import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { PlanEventKind } from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { PlanSessionStore } from '../plan/plan-session.store';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import {
  BRIEF_DEEP_LINK_LIMIT,
  pickBriefInput,
  renderBuildBrief,
} from './roadmap-build-brief.util';
import { RoadmapItemLookupService } from './roadmap-item-lookup.service';
import { RoadmapItemReadService } from './roadmap-item-read.service';
import type { ItemDetail } from './roadmap-item.types';

export interface BuildBriefResponse {
  code: string;
  markdown: string;
  length: number;
  fitsDeepLink: boolean;
  filename: string;
  branch: string;
  prTitle: string;
}

/**
 * Build here or open in Claude Code (D18, §4.5b): the build brief, and
 * "Brief sent to Claude Code". Both belong to whoever may start the build —
 * the idea's lead or an Owner, once it is Ready to build (`can.exportBrief`,
 * the same capability the idea page shows).
 */
@Injectable()
export class RoadmapItemBuildService {
  constructor(
    private readonly reader: RoadmapItemReadService,
    private readonly lookup: RoadmapItemLookupService,
    private readonly builderSessions: BuilderSessionService,
    private readonly planStore: PlanSessionStore,
    private readonly events: PlanEventService,
    private readonly inbox: RoadmapInboxService,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /**
   * The brief, from the allowlist in roadmap-build-brief.util. Reads the
   * idea's title and problem, the plan's success measure, and the PRD
   * document; never the transcript, spend, rank or strategy, which the
   * read model also carries but this never passes on.
   */
  async brief(userId: number, code: string): Promise<BuildBriefResponse> {
    const detail = await this.assertCanSend(userId, code);
    const ref = await this.lookup.get(code);
    const plan = ref.builderSessionId
      ? await this.planStore.find(ref.builderSessionId)
      : null;
    const session = plan
      ? await this.builderSessions.getSessionDetail(plan.id, plan.createdBy)
      : null;
    const design = (session?.prd as { technicalDesign?: { status?: string } })
      ?.technicalDesign;

    const input = pickBriefInput({
      code: ref.code,
      title: detail.title,
      ideaProblem: detail.summary.problem ?? null,
      ideaOutcome: detail.summary.outcome ?? null,
      successMeasure: plan?.plan?.successMeasure ?? null,
      prd: session?.prd ?? null,
      designApproved:
        design?.status === 'approved' && !session?.designReadiness?.stale,
    });
    const markdown = renderBuildBrief(input);
    return {
      code: ref.code,
      markdown,
      length: markdown.length,
      fitsDeepLink: markdown.length <= BRIEF_DEEP_LINK_LIMIT,
      filename: `${ref.code}-brief.md`,
      branch: input.branch,
      prTitle: input.prTitle,
    };
  }

  /**
   * "Brief sent to Claude Code by …": stamped on the plan session, logged as
   * a plan event and told to open queues. From here the idea's code-matched
   * PRs drive its release, and it shows as Building once one exists.
   */
  async recordExternalBuild(userId: number, code: string): Promise<ItemDetail> {
    await this.assertCanSend(userId, code);
    const ref = await this.lookup.get(code);
    const plan = ref.builderSessionId
      ? await this.planStore.find(ref.builderSessionId)
      : null;
    if (!plan) {
      throw new ConflictException(
        'This idea has no plan, so there is nothing to send to Claude Code.',
      );
    }
    const externalBuild = {
      tool: 'claude_code' as const,
      byUserId: userId,
      at: new Date().toISOString(),
    };
    await this.planStore.patchPlan(plan.id, { externalBuild });
    await this.events.record({
      sessionId: plan.id,
      kind: PlanEventKind.EXTERNAL_BUILD,
      actorUserId: userId,
      detail: { tool: externalBuild.tool },
    });
    this.notifications.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['externalBuild'],
    });
    await this.inbox.markSeen(userId, ref.id);
    return this.reader.detail(userId, code);
  }

  private async assertCanSend(
    userId: number,
    code: string,
  ): Promise<ItemDetail> {
    const detail = await this.reader.detail(userId, code);
    if (!detail.can.exportBrief) {
      throw new ForbiddenException(
        "Only the idea's lead or an Owner can send it to build, once it is ready to build.",
      );
    }
    return detail;
  }
}
