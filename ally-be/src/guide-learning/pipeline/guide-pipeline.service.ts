import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import {
  AgentReleaseAuditAction,
  AgentReleaseAuthorKind,
  AgentReleaseStatus,
} from 'src/llm-agent/harness/enum/harness.enum';
import {
  AgentLessonAuditAction,
  AgentShadowStatus,
} from 'src/llm-agent/harness/enum/learning.enum';
import { AgentEvalRunKind } from 'src/llm-agent/harness/enum/eval.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { GuideCuratorService } from '../curator/guide-curator.service';
import { GuideLearningAuditService } from '../curator/guide-learning-audit.service';
import { GuideEvalRunService } from '../evals/guide-eval-run.service';
import { GuideShadowService } from '../shadow/guide-shadow.service';
import { CanaryDecision } from './canary-decision';
import { GuideCanaryMonitorService } from './guide-canary-monitor.service';
import { GuideDelegationService } from './guide-delegation.service';

export const PIPELINE_TASK = 'ally-guide-learning-pipeline';

export interface PipelineStep {
  releaseId: string | null;
  version: number | null;
  step: string;
  detail?: Record<string, unknown>;
}

const DAY_MS = 86_400_000;

/**
 * The learning loop's conveyor (plans/ally-guide/plan.md §7.4, §7.13): every
 * hour it moves releases on as far as the delegation stage allows, and
 * decides any running canary.
 *
 *   curator draft → gate → candidate → shadow → canary → decision → GA
 *
 *  - Stage 1: nothing moves on its own; people run each step.
 *  - Stage 2: the gate, the shadow and the canary start on their own for a
 *    curator release; a failed gate or shadow retires it. A "promote"
 *    decision waits for a person.
 *  - Stage 3: a "promote" decision promotes, at least 3 days after the
 *    previous promotion.
 *
 * Auto-revert is always on, at every stage and for every canary — a
 * person's included. Each step is written to the release audit (status
 * changes) and the learning audit (why the pipeline took it).
 */
@Injectable()
export class GuidePipelineService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GuidePipelineService.name,
  );
  private running = false;

  constructor(
    private readonly releases: AgentReleaseService,
    private readonly delegation: GuideDelegationService,
    private readonly curator: GuideCuratorService,
    private readonly runs: GuideEvalRunService,
    private readonly shadows: GuideShadowService,
    private readonly monitor: GuideCanaryMonitorService,
    private readonly audit: GuideLearningAuditService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', PIPELINE_TASK, () =>
      this.advance().then(() => undefined),
    );
  }

  /** One pass. Re-entrant calls (a slow pass) are skipped. */
  async advance(): Promise<{ stage: number; steps: PipelineStep[] }> {
    if (this.running) return { stage: 0, steps: [] };
    this.running = true;
    try {
      return await this.pass();
    } finally {
      this.running = false;
    }
  }

  private async pass(): Promise<{ stage: number; steps: PipelineStep[] }> {
    const steps: PipelineStep[] = [];
    await this.curator.syncStatuses();
    const { stage } = await this.delegation.effectiveStage();
    const step = async (
      release: AgentRelease | null,
      name: string,
      detail: Record<string, unknown> = {},
    ) => {
      steps.push({
        releaseId: release?.id ?? null,
        version: release?.version ?? null,
        step: name,
        detail,
      });
      await this.audit.record({
        action: AgentLessonAuditAction.PIPELINE_STEP,
        actorKind: AgentReleaseAuthorKind.SYSTEM,
        releaseId: release?.id ?? null,
        detail: { step: name, stage, ...detail },
      });
    };

    // Canaries first: auto-revert is never gated by the stage.
    const canary = await this.releases.getCanary(ALLY_GUIDE_AGENT_KEY);
    if (canary) await this.handleCanary(canary, stage, step);

    if (stage >= 2) {
      const release = await this.curator.inFlight();
      if (release) await this.moveOn(release, step);
    }
    await this.curator.syncStatuses();
    return { stage, steps };
  }

  /** Stage ≥ 2: start the next step for a curator release, or retire it. */
  private async moveOn(
    release: AgentRelease,
    step: (
      r: AgentRelease,
      name: string,
      d?: Record<string, unknown>,
    ) => Promise<void>,
  ) {
    const fresh = await this.releases.getById(release.id);
    switch (fresh.status) {
      case AgentReleaseStatus.DRAFT: {
        if (fresh.shadowReportId) {
          const report = await this.shadows.get(fresh.shadowReportId);
          if (report.status === AgentShadowStatus.FAILED) {
            await this.releases.retireUnreleased(
              fresh.id,
              'shadow failed',
              AgentReleaseAuthorKind.SYSTEM,
            );
            return step(fresh, 'retired_after_shadow', {
              shadowReportId: report.id,
              reasons: report.summary?.reasons ?? [],
            });
          }
        }
        if (fresh.evalRunId) {
          const run = await this.runs.get(fresh.evalRunId);
          await this.releases.retireUnreleased(
            fresh.id,
            'eval gate failed',
            AgentReleaseAuthorKind.SYSTEM,
          );
          return step(fresh, 'retired_after_gate', {
            evalRunId: run.id,
            reasons: run.summary?.decision?.reasons ?? [],
          });
        }
        try {
          const run = await this.runs.start(
            fresh.id,
            { kind: AgentEvalRunKind.GATE },
            null,
          );
          return step(fresh, 'gate_started', { evalRunId: run.id });
        } catch (error) {
          return step(fresh, 'gate_not_started', {
            why: error instanceof Error ? error.message : String(error),
          });
        }
      }
      case AgentReleaseStatus.EVALUATING:
        return; // the gate is running
      case AgentReleaseStatus.CANDIDATE: {
        const report = await this.shadows.run(fresh.id, null);
        return step(fresh, 'shadow_ran', {
          shadowReportId: report.id,
          status: report.status,
          reasons: report.summary?.reasons ?? [],
        });
      }
      case AgentReleaseStatus.SHADOW: {
        const report = fresh.shadowReportId
          ? await this.shadows.get(fresh.shadowReportId)
          : null;
        if (report?.status !== AgentShadowStatus.PASSED) {
          // Inconclusive or still running: a person decides.
          return;
        }
        const other = await this.releases.getCanary(ALLY_GUIDE_AGENT_KEY);
        if (other) return;
        const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
        const policy = loopPolicy(
          ((ga ?? fresh).bundle as unknown as GuideReleaseBundle).policy,
        );
        await this.releases.startCanary(
          fresh.id,
          policy.canaryPercent,
          null,
          'shadow passed; started automatically',
          AgentReleaseAuthorKind.SYSTEM,
        );
        return step(fresh, 'canary_started', { percent: policy.canaryPercent });
      }
      default:
        return;
    }
  }

  private async handleCanary(
    canary: AgentRelease,
    stage: number,
    step: (
      r: AgentRelease,
      name: string,
      d?: Record<string, unknown>,
    ) => Promise<void>,
  ) {
    const { decision } = await this.monitor.decide(canary);
    await this.recordIfChanged(canary, decision);
    if (decision.action === 'revert') {
      await this.releases.stopCanary(
        ALLY_GUIDE_AGENT_KEY,
        null,
        decision.emergency,
        decision.reasons.join('; '),
        {
          actorKind: AgentReleaseAuthorKind.SYSTEM,
          action: AgentReleaseAuditAction.CANARY_REVERTED,
          detail: { decision: decision.action, reasons: decision.reasons },
        },
      );
      return step(canary, 'canary_reverted', {
        emergency: decision.emergency,
        reasons: decision.reasons,
      });
    }
    if (decision.action !== 'promote') return;
    if (stage < 3) {
      return; // recorded; a person promotes (the Console shows the decision)
    }
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    const policy = loopPolicy(
      ((ga ?? canary).bundle as unknown as GuideReleaseBundle).policy,
    );
    const last = await this.releases.lastPromotionAt(ALLY_GUIDE_AGENT_KEY);
    if (
      last &&
      Date.now() - last.getTime() < policy.promotionGapDays * DAY_MS
    ) {
      return step(canary, 'promotion_held', {
        why: `the last promotion was under ${policy.promotionGapDays} days ago`,
        lastPromotionAt: last.toISOString(),
      });
    }
    await this.releases.makeGa(
      canary.id,
      null,
      AgentReleaseAuditAction.PROMOTED,
      `canary decision: ${decision.reasons.join('; ')}`,
      AgentReleaseAuthorKind.SYSTEM,
    );
    return step(canary, 'promoted', { reasons: decision.reasons });
  }

  /** One CANARY_DECIDED row per change of mind, not one per hour. */
  private async recordIfChanged(
    canary: AgentRelease,
    decision: CanaryDecision,
  ) {
    const audit = await this.releases.auditFor(canary.id);
    const last = [...audit]
      .reverse()
      .find((row) => row.action === AgentReleaseAuditAction.CANARY_DECIDED);
    const same =
      last &&
      last.detail?.action === decision.action &&
      JSON.stringify(last.detail?.reasons) === JSON.stringify(decision.reasons);
    if (same) return;
    await this.releases.recordCanaryDecision(canary.id, {
      action: decision.action,
      emergency: decision.emergency,
      reasons: decision.reasons,
      ready: decision.ready,
      thresholds: decision.thresholds,
      criteria: decision.criteria,
      guard: decision.guard,
    });
  }

  /** The monitor's current view of the running canary, for the Console. */
  async canaryStatus() {
    const canary = await this.releases.getCanary(ALLY_GUIDE_AGENT_KEY);
    if (!canary) return { canary: null };
    const { decision, evidence } = await this.monitor.decide(canary);
    const { stage } = await this.delegation.effectiveStage();
    return {
      canary: {
        id: canary.id,
        version: canary.version,
        percent: canary.rolloutPercent,
        authorKind: canary.authorKind,
      },
      stage,
      decision,
      evidence,
      promotesAutomatically: stage >= 3,
    };
  }

  /**
   * The complete trail of one release: its release audit and the learning
   * audit (curator, pipeline steps, lessons it carries), oldest first.
   */
  async trail(releaseId: string) {
    const [release, releaseAudit, learning] = await Promise.all([
      this.releases.getById(releaseId),
      this.releases.auditFor(releaseId),
      this.audit.list({ releaseId, limit: 500 }),
    ]);
    const rows = [
      ...releaseAudit.map((row) => ({
        at: row.createdAt,
        source: 'release' as const,
        action: row.action,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId ?? null,
        detail: row.detail ?? null,
      })),
      ...learning.map((row) => ({
        at: row.createdAt,
        source: 'learning' as const,
        action: row.action,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId ?? null,
        lessonId: row.lessonId ?? null,
        detail: row.detail ?? null,
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return {
      release: {
        id: release.id,
        version: release.version,
        status: release.status,
        authorKind: release.authorKind,
        evalRunId: release.evalRunId ?? null,
        shadowReportId: release.shadowReportId ?? null,
        changeSet: release.changeSet ?? null,
      },
      trail: rows,
    };
  }
}
