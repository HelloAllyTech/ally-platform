import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { GuideAdminService } from 'src/guide/admin/guide-admin.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { ArmLearningMetrics, learningGuard } from '../evals/gate';
import { GuideReviewService } from '../review/guide-review.service';
import {
  ArmStats,
  CanaryDecision,
  CanaryEvidence,
  CriterionArms,
  decideCanary,
} from './canary-decision';

type Arm = 'ga' | 'canary';

/**
 * Gathers a running canary's evidence since it started and decides
 * (plans/ally-guide/plan.md §7.13). Reads only: acting on the decision is
 * the pipeline's job.
 */
@Injectable()
export class GuideCanaryMonitorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly admin: GuideAdminService,
    private readonly reviews: GuideReviewService,
  ) {}

  async evidence(canary: AgentRelease): Promise<CanaryEvidence> {
    const startedAt =
      (await this.releases.canaryStartedAt(canary.id)) ??
      canary.updatedAt ??
      new Date();
    const daysRunning = (Date.now() - startedAt.getTime()) / 86_400_000;
    const windowDays = Math.max(1, Math.ceil(daysRunning));
    const arms = (await this.admin.armMetrics(windowDays, canary.id)) as Array<
      ArmLearningMetrics & { turns: number; failureRate: number | null }
    >;
    const judged: Array<{
      arm: Arm;
      critic: { criteria?: Record<string, { verdict: string }> } | null;
      deterministic: Array<{
        applicable: boolean;
        passed: boolean;
        severity: string;
      }> | null;
    }> = await this.dataSource.query(
      `SELECT CASE WHEN e."arm" = 'canary' AND e."releaseId" = $2 THEN 'canary' ELSE 'ga' END AS arm,
              e."critic", e."deterministic"
         FROM "agent_evaluations" e
         JOIN "agent_turns" t ON t."id" = e."turnId"
        WHERE e."agentKey" = $1 AND e."status" = 'judged' AND t."createdAt" >= $3`,
      [ALLY_GUIDE_AGENT_KEY, canary.id, startedAt],
    );
    const trusted = await this.reviews.trustedCriteria();
    const per: Record<Arm, { judged: number; safety: number }> = {
      ga: { judged: 0, safety: 0 },
      canary: { judged: 0, safety: 0 },
    };
    const criteria = new Map<string, CriterionArms>();
    for (const row of judged) {
      per[row.arm].judged++;
      if (
        (row.deterministic ?? []).some(
          (c) => c.applicable && !c.passed && c.severity === 'safety',
        )
      ) {
        per[row.arm].safety++;
      }
      for (const [id, verdict] of Object.entries(row.critic?.criteria ?? {})) {
        if (!trusted.has(id) || verdict?.verdict === 'na') continue;
        const c =
          criteria.get(id) ??
          ({
            id,
            ga: { fail: 0, judged: 0 },
            canary: { fail: 0, judged: 0 },
          } as CriterionArms);
        c[row.arm].judged++;
        if (verdict.verdict === 'fail') c[row.arm].fail++;
        criteria.set(id, c);
      }
    }
    const statsOf = (arm: Arm): ArmStats | null => {
      const m = arms.find((a) => a.arm === arm);
      if (!m) return null;
      return {
        threads: m.threads,
        turns: m.turns,
        failureRate: m.failureRate,
        ratedTurns: m.thumbsUp + m.thumbsDown,
        judgedWindows: per[arm].judged,
        safetyFailureWindows: per[arm].safety,
      };
    };
    return {
      daysRunning,
      ga: statsOf('ga'),
      canary: statsOf('canary'),
      criteria: [...criteria.values()],
      trusted: [...trusted],
      guard: learningGuard(
        arms.find((a) => a.arm === 'ga') ?? null,
        arms.find((a) => a.arm === 'canary') ?? null,
      ),
    };
  }

  async decide(canary: AgentRelease): Promise<{
    decision: CanaryDecision;
    evidence: CanaryEvidence;
  }> {
    const evidence = await this.evidence(canary);
    // The rules come from GA, never from the release being judged.
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    const policy = loopPolicy(
      ((ga ?? canary).bundle as unknown as GuideReleaseBundle).policy,
    );
    return { decision: decideCanary(evidence, policy), evidence };
  }
}
