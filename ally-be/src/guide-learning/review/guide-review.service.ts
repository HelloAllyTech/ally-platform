import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentEvaluation } from 'src/llm-agent/entity/agent-evaluation.entity';
import { AgentReview } from 'src/llm-agent/entity/agent-review.entity';
import {
  AgentReviewReason,
  AgentReviewStatus,
} from 'src/llm-agent/harness/enum/eval.enum';
import { ALLY_GUIDE_AGENT_KEY } from 'src/guide/release/guide-release.bundle';
import { redactText } from 'src/guide/safety/redaction';
import { GuideJudgeService } from '../evaluator/guide-judge.service';
import {
  CriterionAgreement,
  rubricAgreement,
  trustedCriteria,
} from '../evaluator/kappa';
import {
  RUBRIC_CRITERIA,
  RUBRIC_IDS,
  RubricVerdict,
} from '../evaluator/rubric';
import { evaluatorPolicy } from 'src/guide/release/guide-release.bundle';
import { GuideWindowService } from '../windows/guide-window.service';
import { ProductionWindow } from '../windows/production-window';

const PRIORITY: Record<AgentReviewReason, number> = {
  [AgentReviewReason.SAFETY_FLAG]: 0,
  [AgentReviewReason.DISAGREEMENT]: 1,
  [AgentReviewReason.THUMBS_DOWN]: 2,
  [AgentReviewReason.CALIBRATION]: 3,
};

const VERDICTS: RubricVerdict[] = ['pass', 'fail', 'na'];

/**
 * The human review queue (plans/ally-guide/plan.md §7.13, §2.1 decision 10).
 *
 * People read windows REDACTED (src/guide/safety/redaction.ts) and label
 * every rubric criterion BLIND: the critic's and verifier's verdicts are
 * withheld until the label is in, so the label measures the window and not
 * the model's opinion of it — which is what makes κ honest. The queue holds
 * ids and reasons; the text is read live from the conversation, so deleting
 * the conversation leaves nothing behind.
 */
@Injectable()
export class GuideReviewService {
  constructor(
    @InjectRepository(AgentReview)
    private readonly reviews: Repository<AgentReview>,
    @InjectRepository(AgentEvaluation)
    private readonly evaluations: Repository<AgentEvaluation>,
    private readonly dataSource: DataSource,
    private readonly windows: GuideWindowService,
    private readonly judges: GuideJudgeService,
  ) {}

  /** Queue a window once per reason. Returns whether it was new. */
  async enqueue(input: {
    window: Pick<ProductionWindow, 'turn'>;
    reason: AgentReviewReason;
    evaluationId?: string | null;
    feedbackId?: string | null;
  }): Promise<boolean> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO "agent_reviews"
         ("agentKey", "turnId", "threadId", "evaluationId", "feedbackId", "reason", "priority", "tenant_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("turnId", "reason") DO NOTHING
       RETURNING "id"`,
      [
        ALLY_GUIDE_AGENT_KEY,
        input.window.turn.id,
        input.window.turn.threadId,
        input.evaluationId ?? null,
        input.feedbackId ?? null,
        input.reason,
        PRIORITY[input.reason],
        input.window.turn.tenantId ?? null,
      ],
    );
    return rows.length > 0;
  }

  /** Thumbs-down WITH a comment on a night's turns (plan §7.13). */
  async enqueueThumbsDown(night: string): Promise<number> {
    const rows: Array<{
      feedbackId: string;
      turnId: string;
      threadId: string;
      tenantId: string | null;
      evaluationId: string | null;
    }> = await this.dataSource.query(
      `SELECT f."id" AS "feedbackId", m."turnId", m."threadId", f."tenant_id" AS "tenantId",
              e."id" AS "evaluationId"
         FROM "guide_turn_feedback" f
         JOIN "guide_messages" m ON m."id" = f."messageId"
         LEFT JOIN "agent_evaluations" e ON e."turnId" = m."turnId"
        WHERE f."rating" < 0 AND COALESCE(btrim(f."comment"), '') <> ''
          AND m."turnId" IS NOT NULL
          AND f."updatedAt" >= $1::date AND f."updatedAt" < $1::date + interval '1 day'`,
      [night],
    );
    let queued = 0;
    for (const row of rows) {
      const created = await this.enqueue({
        window: {
          turn: {
            id: row.turnId,
            threadId: row.threadId,
            tenantId: row.tenantId,
          } as ProductionWindow['turn'],
        },
        reason: AgentReviewReason.THUMBS_DOWN,
        evaluationId: row.evaluationId,
        feedbackId: row.feedbackId,
      });
      if (created) queued++;
    }
    return queued;
  }

  /** The queue, highest priority and oldest first. Ids and reasons only. */
  async list(query: { status?: string; reason?: string; limit?: number }) {
    const status = query.status ?? 'open';
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r."id", r."reason", r."status", r."priority", r."turnId", r."threadId",
              r."reviewerId", r."claimedAt", r."completedAt", r."verdict", r."createdAt",
              e."night"::text AS night, e."flags", e."disagreements",
              (SELECT COALESCE(jsonb_agg(c->>'id'), '[]'::jsonb)
                 FROM jsonb_array_elements(COALESCE(e."deterministic", '[]'::jsonb)) c
                WHERE (c->>'passed')::boolean = false) AS "failedChecks"
         FROM "agent_reviews" r
         LEFT JOIN "agent_evaluations" e ON e."id" = r."evaluationId"
        WHERE r."agentKey" = $1
          AND ($2::text = 'all' OR r."status" = $2
               OR ($2 = 'open' AND r."status" = 'claimed'))
          AND ($3::text IS NULL OR r."reason" = $3)
        ORDER BY r."priority" ASC, r."createdAt" ASC
        LIMIT $4`,
      [ALLY_GUIDE_AGENT_KEY, status, query.reason ?? null, limit],
    );
    const counts: Array<{ reason: string; status: string; n: string }> =
      await this.dataSource.query(
        `SELECT "reason", "status", count(*) AS n FROM "agent_reviews"
          WHERE "agentKey" = $1 GROUP BY 1, 2`,
        [ALLY_GUIDE_AGENT_KEY],
      );
    return {
      items: rows,
      counts: counts.map((row) => ({ ...row, n: Number(row.n) })),
    };
  }

  private async getRow(id: string): Promise<AgentReview> {
    const row = await this.reviews.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!row) throw new NotFoundException('Review not found');
    return row;
  }

  /**
   * One review, with the window to read. Redacted text only. The judges'
   * verdicts are withheld until the review is done.
   */
  async get(id: string) {
    const row = await this.getRow(id);
    const evaluation = row.evaluationId
      ? await this.evaluations.findOne({ where: { id: row.evaluationId } })
      : null;
    const window = await this.windows.loadTurn(row.turnId, 4);
    const feedback = row.feedbackId
      ? ((
          await this.dataSource.query(
            `SELECT "rating", "comment" FROM "guide_turn_feedback" WHERE "id" = $1`,
            [row.feedbackId],
          )
        )[0] ?? null)
      : null;
    const closed =
      row.status === AgentReviewStatus.DONE ||
      row.status === AgentReviewStatus.DISMISSED;
    return {
      review: row,
      rubric: RUBRIC_CRITERIA.map(({ id: cid, label, pass, fail, safety }) => ({
        id: cid,
        label,
        pass,
        fail,
        safety,
      })),
      window: window
        ? {
            situation: {
              mode: window.window.mode,
              channel: window.window.channel,
              budgetWords: window.window.budget?.maxWords ?? null,
              steerLevel: window.situation?.steerLevel ?? null,
              releaseWindowOpen: Boolean(window.window.releaseWindowOpen),
              quizOpen: Boolean(window.situation?.quizOpen),
              overlay: window.window.sentinel?.overlay ?? null,
            },
            recent: window.reviewable.recent,
            learnerText: window.reviewable.learnerText,
            reply: window.reviewable.reply,
            tools: window.window.toolCalls.map((call) => ({
              name: call.name,
              reason: (call.input?.reason as string | undefined) ?? null,
            })),
            flags: window.flags,
          }
        : null,
      feedback: feedback
        ? {
            rating: feedback.rating,
            comment: feedback.comment ? redactText(feedback.comment) : null,
          }
        : null,
      evaluation: evaluation
        ? {
            id: evaluation.id,
            night: evaluation.night,
            sample: evaluation.sample,
            deterministic: evaluation.deterministic,
            disagreements: closed ? evaluation.disagreements : undefined,
            critic: closed ? evaluation.critic : undefined,
            verifier: closed ? evaluation.verifier : undefined,
          }
        : null,
      judgesHidden: !closed,
    };
  }

  async claim(id: string, userId: number) {
    const row = await this.getRow(id);
    if (
      row.status === AgentReviewStatus.CLAIMED &&
      row.reviewerId &&
      row.reviewerId !== userId
    ) {
      throw new ConflictException('Someone else is reviewing this window');
    }
    if (
      row.status !== AgentReviewStatus.OPEN &&
      row.status !== AgentReviewStatus.CLAIMED
    ) {
      throw new ConflictException('This review is closed');
    }
    await this.reviews.update(row.id, {
      status: AgentReviewStatus.CLAIMED,
      reviewerId: userId,
      claimedAt: new Date(),
    });
    return this.getRow(id);
  }

  async submit(
    id: string,
    userId: number,
    input: {
      labels: Record<string, string>;
      verdict: 'ok' | 'problem';
      notes?: string | null;
    },
  ) {
    const row = await this.getRow(id);
    if (
      row.status === AgentReviewStatus.DONE ||
      row.status === AgentReviewStatus.DISMISSED
    ) {
      throw new ConflictException('This review is closed');
    }
    if (row.reviewerId && row.reviewerId !== userId) {
      throw new ConflictException('Someone else is reviewing this window');
    }
    const labels: Record<string, RubricVerdict> = {};
    for (const [criterion, verdict] of Object.entries(input.labels ?? {})) {
      if (!RUBRIC_IDS.includes(criterion)) {
        throw new BadRequestException(`Unknown criterion ${criterion}`);
      }
      if (!VERDICTS.includes(verdict as RubricVerdict)) {
        throw new BadRequestException(
          `A label is pass, fail or na (got ${verdict} for ${criterion})`,
        );
      }
      labels[criterion] = verdict as RubricVerdict;
    }
    const missing = RUBRIC_IDS.filter((criterion) => !labels[criterion]);
    if (missing.length) {
      throw new BadRequestException(
        `Label every criterion; missing: ${missing.join(', ')}`,
      );
    }
    await this.reviews.update(row.id, {
      status: AgentReviewStatus.DONE,
      reviewerId: userId,
      labels,
      verdict: input.verdict,
      notes: input.notes ? redactText(input.notes).slice(0, 2000) : null,
      completedAt: new Date(),
    });
    return this.get(id);
  }

  async dismiss(id: string, userId: number, notes?: string | null) {
    const row = await this.getRow(id);
    if (row.status === AgentReviewStatus.DONE) {
      throw new ConflictException('This review is already done');
    }
    await this.reviews.update(row.id, {
      status: AgentReviewStatus.DISMISSED,
      reviewerId: userId,
      notes: notes ? redactText(notes).slice(0, 2000) : null,
      completedAt: new Date(),
    });
    return this.getRow(id);
  }

  /**
   * κ per criterion: the critic against people, and the verifier against
   * people beside it. Criteria under the threshold, or without enough
   * labels, are listed as excluded from automated decisions.
   */
  async agreement(): Promise<{
    threshold: number;
    minPairs: number;
    critic: CriterionAgreement[];
    verifier: CriterionAgreement[];
    trusted: string[];
    labelledReviews: number;
  }> {
    const bundle = await this.judges.evaluatorBundle();
    const policy = evaluatorPolicy(bundle.policy);
    const rows: Array<{
      labels: Record<string, RubricVerdict>;
      critic: { criteria?: Record<string, { verdict: RubricVerdict }> } | null;
      verifier: {
        criteria?: Record<string, { verdict: RubricVerdict }>;
      } | null;
    }> = await this.dataSource.query(
      `SELECT r."labels", e."critic", e."verifier"
         FROM "agent_reviews" r
         JOIN "agent_evaluations" e ON e."id" = r."evaluationId"
        WHERE r."agentKey" = $1 AND r."status" = 'done' AND r."labels" IS NOT NULL`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    const verdicts = (
      judgement: {
        criteria?: Record<string, { verdict: RubricVerdict }>;
      } | null,
    ) =>
      Object.fromEntries(
        Object.entries(judgement?.criteria ?? {}).map(([id, c]) => [
          id,
          c.verdict,
        ]),
      ) as Record<string, RubricVerdict>;
    const critic = rubricAgreement(
      rows
        .filter((row) => row.critic)
        .map((row) => ({ critic: verdicts(row.critic), human: row.labels })),
      policy,
    );
    const verifier = rubricAgreement(
      rows
        .filter((row) => row.verifier)
        .map((row) => ({ critic: verdicts(row.verifier), human: row.labels })),
      policy,
    );
    return {
      threshold: policy.kappaThreshold,
      minPairs: policy.kappaMinPairs,
      critic,
      verifier,
      trusted: [...trustedCriteria(critic)],
      labelledReviews: rows.length,
    };
  }

  /** The criteria automated decisions may use (κ ≥ threshold on enough labels). */
  async trustedCriteria(): Promise<Set<string>> {
    return new Set((await this.agreement()).trusted);
  }
}
