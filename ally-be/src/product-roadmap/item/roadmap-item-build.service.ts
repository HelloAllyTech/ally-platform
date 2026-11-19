import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { DataSource } from 'typeorm';
import type { PlanBuildMode } from 'src/product-planning/type/plan-record.type';
import { PlanStageService } from '../plan/plan-stage.service';
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
    private readonly stage: PlanStageService,
    private readonly dataSource: DataSource,
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
      planClosed: plan?.plan?.planClosed ?? null,
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
    // Sending the brief out is building it outside the Builder agent.
    await this.writeBuildMode(
      plan.id,
      userId,
      plan.plan?.buildMode?.mode ?? null,
      'outside',
    );
    this.notifications.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['externalBuild'],
    });
    await this.inbox.markSeen(userId, ref.id);
    return this.reader.detail(userId, code);
  }

  /**
   * How the assigned builder builds it (lifecycle 2026-11-18): with the
   * Builder agent here, or outside it. Theirs to switch at any time; each
   * switch is an attributed `build_mode_set` event on the idea's timeline.
   */
  async setBuildMode(
    userId: number,
    code: string,
    mode: PlanBuildMode,
  ): Promise<ItemDetail> {
    const detail = await this.reader.detail(userId, code);
    if (!detail.can.setBuildMode) {
      throw new ForbiddenException(
        'Only the builder assigned to this idea, or an Owner, says how it is built.',
      );
    }
    const ref = await this.lookup.get(code);
    const plan = ref.builderSessionId
      ? await this.planStore.find(ref.builderSessionId)
      : null;
    if (!plan) {
      throw new ConflictException('This idea has no plan to record it on.');
    }
    const changed = await this.writeBuildMode(
      plan.id,
      userId,
      plan.plan?.buildMode?.mode ?? null,
      mode,
    );
    if (changed) {
      this.notifications.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: ref.code,
        fields: ['buildMode'],
      });
    }
    return this.reader.detail(userId, code);
  }

  /**
   * Mark it Released: the assigned builder's call, or an Owner's. The only way
   * an idea reaches Released (lifecycle 2026-11-18); the release watcher only
   * tells the builder its work is live. Compare-and-set on the stage, so a
   * second click never re-stamps `releasedAt`. `releasedAt` is when its work
   * went live where every release row says so, else now.
   */
  async markReleased(userId: number, code: string): Promise<ItemDetail> {
    const detail = await this.reader.detail(userId, code);
    if (!detail.can.markReleased) {
      throw new ForbiddenException(
        detail.shownStage === 'shipped'
          ? 'This idea is already released.'
          : 'Only the builder assigned to this idea, or an Owner, marks it released.',
      );
    }
    const ref = await this.lookup.get(code);
    const live = detail.releases.filter((r) => r.state === 'live');
    const liveAt =
      live.length && live.length === detail.releases.length
        ? (live
            .map((r) => r.releasedAt)
            .filter((at): at is string => !!at)
            .sort()
            .pop() ?? null)
        : null;
    const result = await this.dataSource.query(
      `UPDATE "roadmap_opportunities"
          SET stage = 'released',
              -- releasedAt is timestamp without time zone, read as UTC.
              "releasedAt" = COALESCE($2::timestamptz, now()) AT TIME ZONE 'UTC',
              "updatedBy" = $3, "updatedAt" = now()
        WHERE id = $1 AND stage IN ('new', 'prioritised') AND "deletedAt" IS NULL
        RETURNING id`,
      [ref.id, liveAt, userId],
    );
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    if (!rows?.length) {
      throw new ConflictException(
        `${ref.code} was released or closed a moment ago.`,
      );
    }
    if (ref.builderSessionId) {
      await this.events.record({
        sessionId: ref.builderSessionId,
        kind: PlanEventKind.MARKED_RELEASED,
        actorUserId: userId,
        detail: liveAt ? { liveAt } : null,
      });
      await this.stage.sync(ref.builderSessionId, userId);
    }
    this.notifications.emit({
      kind: 'ITEM_CHANGED',
      actorId: userId,
      code: ref.code,
      fields: ['stage'],
    });
    return this.reader.detail(userId, code);
  }

  /** Write the build mode and its event when it changes. True if it changed. */
  private async writeBuildMode(
    sessionId: string,
    userId: number,
    from: PlanBuildMode | null,
    to: PlanBuildMode,
  ): Promise<boolean> {
    if (from === to) return false;
    await this.planStore.patchPlan(sessionId, {
      buildMode: { mode: to, byUserId: userId, at: new Date().toISOString() },
    });
    await this.events.record({
      sessionId,
      kind: PlanEventKind.BUILD_MODE_SET,
      actorUserId: userId,
      detail: { from, to },
    });
    return true;
  }

  private async assertCanSend(
    userId: number,
    code: string,
  ): Promise<ItemDetail> {
    const detail = await this.reader.detail(userId, code);
    if (!detail.can.exportBrief) {
      throw new ForbiddenException(
        'Only the builder assigned to this idea, or an Owner, can send it to build.',
      );
    }
    return detail;
  }
}
