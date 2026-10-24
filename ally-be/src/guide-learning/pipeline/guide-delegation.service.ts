import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentDelegation } from 'src/llm-agent/entity/agent-delegation.entity';
import { AgentReleaseAuthorKind } from 'src/llm-agent/harness/enum/harness.enum';
import { AgentLessonAuditAction } from 'src/llm-agent/harness/enum/learning.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_BUNDLE,
  GuideReleaseBundle,
  evaluatorPolicy,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { GuideLearningAuditService } from '../curator/guide-learning-audit.service';
import { RED_TEAM_CATEGORY_IDS } from '../evals/categories';
import { GuideReviewService } from '../review/guide-review.service';
import {
  DelegationCounts,
  DelegationStage,
  Precondition,
  STAGE_LABELS,
  delegationPreconditions,
  highestUnlockedStage,
  stageChangeRefusal,
} from './delegation';

/** Case sources that count as mined from real conversations. */
export const MINED_SOURCES = ['trace', 'failed_turn', 'review'];

export interface DelegationStatus {
  stage: DelegationStage;
  label: string;
  unlocked: DelegationStage;
  changedAt: Date | null;
  changedBy: number | null;
  reason: string | null;
  preconditions: Precondition[];
  stages: Array<{ stage: DelegationStage; label: string; unlocked: boolean }>;
  autoRevert: true;
}

/**
 * The delegation stage and its preconditions (plans/ally-guide/plan.md
 * §7.13). The stored stage is what a person set; the effective stage is
 * that, lowered to the highest one whose preconditions still hold — and a
 * drop is written back and audited, so the Console never shows a stage the
 * loop is not actually running at.
 */
@Injectable()
export class GuideDelegationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly reviews: GuideReviewService,
    private readonly audit: GuideLearningAuditService,
  ) {}

  private get rows() {
    return this.dataSource.getRepository(AgentDelegation);
  }

  async counts(): Promise<DelegationCounts> {
    const caseRows: Array<{
      category: string;
      safety: boolean;
      source: string;
      n: string;
    }> = await this.dataSource.query(
      `SELECT "category", "safety", "source", count(*) AS n
         FROM "agent_eval_cases"
        WHERE "agentKey" = $1 AND "status" = 'active'
        GROUP BY 1, 2, 3`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    const [first]: Array<{ night: string | null }> =
      await this.dataSource.query(
        `SELECT min("night")::text AS night FROM "agent_evaluations"
        WHERE "agentKey" = $1 AND "status" = 'judged'`,
        [ALLY_GUIDE_AGENT_KEY],
      );
    const [clean]: Array<{ n: string }> = await this.dataSource.query(
      // A clean canary: the monitor's last word on it was "promote", it was
      // never reverted, and a person promoted it.
      `WITH decided AS (
         SELECT DISTINCT ON ("releaseId") "releaseId", "detail"->>'action' AS action
           FROM "agent_release_audit"
          WHERE "agentKey" = $1 AND "action" = 'canary_decided'
          ORDER BY "releaseId", "createdAt" DESC)
       SELECT count(*) AS n FROM decided d
        WHERE d.action = 'promote'
          AND EXISTS (SELECT 1 FROM "agent_release_audit" p
                       WHERE p."releaseId" = d."releaseId" AND p."action" = 'promoted'
                         AND p."actorKind" = 'human')
          AND NOT EXISTS (SELECT 1 FROM "agent_release_audit" r
                           WHERE r."releaseId" = d."releaseId" AND r."action" = 'canary_reverted')`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    const agreement = await this.reviews.agreement();
    const n = (row: { n: string }) => Number(row.n);
    const byCategory: Record<string, number> = {};
    for (const row of caseRows) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + n(row);
    }
    return {
      activeCases: caseRows.reduce((sum, row) => sum + n(row), 0),
      safetyCases: caseRows
        .filter((row) => row.safety)
        .reduce((sum, row) => sum + n(row), 0),
      minedCases: caseRows
        .filter((row) => MINED_SOURCES.includes(row.source))
        .reduce((sum, row) => sum + n(row), 0),
      casesByHardCategory: byCategory,
      evaluatorDays: first?.night
        ? (Date.now() - Date.parse(`${first.night}T00:00:00Z`)) / 86_400_000
        : null,
      kappa: Object.fromEntries(
        agreement.critic.map((row) => [
          row.criterion,
          { kappa: row.kappa, trusted: row.trusted },
        ]),
      ),
      cleanCanaries: Number(clean?.n ?? 0),
    };
  }

  private async policies() {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    const bundle = (ga?.bundle ??
      GUIDE_DEFAULT_BUNDLE) as unknown as GuideReleaseBundle;
    return {
      loop: loopPolicy(bundle.policy),
      kappaThreshold: evaluatorPolicy(bundle.policy).kappaThreshold,
    };
  }

  async preconditions(): Promise<Precondition[]> {
    const { loop, kappaThreshold } = await this.policies();
    return delegationPreconditions(
      await this.counts(),
      loop,
      kappaThreshold,
      RED_TEAM_CATEGORY_IDS,
    );
  }

  /** The stage a person set (1 when none). */
  async storedStage(): Promise<AgentDelegation> {
    const row = await this.rows.findOne({
      where: { agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    return (
      row ??
      ({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        stage: 1,
        changedBy: null,
        reason: null,
        changedAt: null,
      } as unknown as AgentDelegation)
    );
  }

  /**
   * The stage the loop runs at now. Lowered (and audited) when the stored
   * stage's preconditions no longer hold.
   */
  async effectiveStage(): Promise<DelegationStatus> {
    const [row, preconditions] = await Promise.all([
      this.storedStage(),
      this.preconditions(),
    ]);
    const unlocked = highestUnlockedStage(preconditions);
    let stage = row.stage as DelegationStage;
    if (stage > unlocked) {
      const failing = preconditions
        .filter((p) => p.stage <= stage && !p.met)
        .map((p) => p.id);
      await this.write(
        unlocked,
        null,
        `lowered automatically: ${failing.join(', ')} no longer hold`,
        stage,
      );
      stage = unlocked;
      row.reason = `lowered automatically`;
      row.changedBy = null;
      row.changedAt = new Date();
    }
    return {
      stage,
      label: STAGE_LABELS[stage],
      unlocked,
      changedAt: row.changedAt ?? null,
      changedBy: row.changedBy ?? null,
      reason: row.reason ?? null,
      preconditions,
      stages: ([1, 2, 3] as DelegationStage[]).map((s) => ({
        stage: s,
        label: STAGE_LABELS[s],
        unlocked: s <= unlocked,
      })),
      autoRevert: true,
    };
  }

  /** A person sets the stage: down any time, up one unlocked step at a time. */
  async setStage(
    requested: number,
    userId: number,
    reason?: string,
  ): Promise<DelegationStatus> {
    const status = await this.effectiveStage();
    const refusal = stageChangeRefusal(
      status.stage,
      requested,
      status.unlocked,
    );
    if (refusal) throw new BadRequestException(refusal);
    if (requested !== status.stage) {
      await this.write(
        requested as DelegationStage,
        userId,
        reason ?? null,
        status.stage,
      );
    }
    return this.effectiveStage();
  }

  private async write(
    stage: DelegationStage,
    userId: number | null,
    reason: string | null,
    from: number,
  ) {
    await this.rows.save({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      stage,
      changedBy: userId,
      reason,
      changedAt: new Date(),
    });
    await this.audit.record({
      action: AgentLessonAuditAction.STAGE_CHANGED,
      actorKind:
        userId === null
          ? AgentReleaseAuthorKind.SYSTEM
          : AgentReleaseAuthorKind.HUMAN,
      actorUserId: userId,
      detail: { from, to: stage, reason },
    });
  }
}
