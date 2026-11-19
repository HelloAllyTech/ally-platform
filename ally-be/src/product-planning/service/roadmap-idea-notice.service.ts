import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  PlanStage,
  RoadmapNotificationKind,
} from '../enum/product-planning.enum';
import { RoadmapInboxService } from './roadmap-inbox.service';

/** What a question notice needs to know about the question the agent asked. */
export interface AskedQuestion {
  id: string;
  prompt?: string;
  /** The agent says this is about the problem or the people who have it: the author's to answer. */
  forAuthor?: boolean;
}

/** The stages at which the plan first reads ready (the PRD passes readiness, or more). */
const READY_STAGES: string[] = [PlanStage.DESIGN, PlanStage.READY];

const clip = (text: string | undefined, max = 140): string => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Tell the person an idea now waits on, and tell the author (Roadmap idea-to-
 * plan audit, recommendations 8 and 10). One place for the notices the
 * planning hand-offs send, so the actions that cause them (Start planning,
 * Close plan, a stage moving, an agent turn, an answer, a comment) each add a
 * single call:
 *
 * - Start planning → `accepted` to the author, voters and watchers (also when
 *   it accepts a pending idea, whose held accept notice it cancels).
 * - The plan first reads ready → `plan_ready`, once per plan.
 * - Close plan → `plan_closed`.
 * - The planning agent asks → `agent_question`: a problem-or-user question
 *   goes to the author (and the planner); any other only to the planner.
 * - Someone answers → `question_answered` to the planner.
 * - A comment → one grouped `comment` notice per follower.
 * - The idea is opened → its notices are read; the author's first look during
 *   planning is stamped on the plan for Measures.
 *
 * Lives in ProductPlanningModule beside the inbox so Builder (the agent turn,
 * the plan conversation) and the roadmap (review, stage sync) can both call
 * it. Every method is best effort and never throws: a notice must never fail
 * or slow the action it reports.
 */
@Injectable()
export class RoadmapIdeaNoticeService {
  private readonly logger = LoggerService.getInstance(
    RoadmapIdeaNoticeService.name,
  );

  constructor(
    private readonly inbox: RoadmapInboxService,
    private readonly dataSource: DataSource,
  ) {}

  /** End of Start planning (first press only). */
  async planningStarted(input: {
    actorUserId: number;
    itemId: string;
    code: string;
    sessionId: string;
    /** It was still awaiting review: Start planning accepted it. */
    acceptedNow: boolean;
  }): Promise<void> {
    await this.safely('planning started', () =>
      this.inbox.deliver({
        kind: RoadmapNotificationKind.ACCEPTED,
        itemId: input.itemId,
        sessionId: input.sessionId,
        actorUserId: input.actorUserId,
        payload: {
          code: input.code,
          via: 'start_planning',
          byUserId: input.actorUserId,
          ...(input.acceptedNow ? {} : { alreadyAccepted: true }),
        },
      }),
    );
  }

  /** End of Close plan (closing only; reopening tells nobody). */
  async planClosed(input: {
    actorUserId: number;
    itemId: string;
    code: string;
    sessionId: string;
  }): Promise<void> {
    await this.safely('plan closed', () =>
      this.inbox.deliver({
        kind: RoadmapNotificationKind.PLAN_CLOSED,
        itemId: input.itemId,
        sessionId: input.sessionId,
        actorUserId: input.actorUserId,
        payload: { code: input.code, byUserId: input.actorUserId },
      }),
    );
  }

  /**
   * A plan's stage moved (PlanStageService.sync). The first time a planned
   * idea reaches a ready stage, its followers are told, once: the stamp on the
   * plan is written by a compare-and-set, so two syncs racing send one notice.
   */
  async stageEntered(sessionId: string, stage: string): Promise<void> {
    if (!READY_STAGES.includes(stage)) return;
    await this.safely('plan ready', async () => {
      const result = await this.dataSource.query(
        `UPDATE "builder_sessions"
            SET "plan" = COALESCE("plan", '{}'::jsonb)
                  || jsonb_build_object('planReadyNoticeAt', now())
          WHERE id = $1 AND "deletedAt" IS NULL
            AND "plan"->>'planningStarted' = 'true'
            AND NOT ("plan" ? 'planReadyNoticeAt')
          RETURNING id`,
        [sessionId],
      );
      const rows = Array.isArray(result?.[0]) ? result[0] : result;
      if (!rows?.length) return;
      const item = await this.itemOf(sessionId);
      if (!item) return;
      await this.inbox.deliver({
        kind: RoadmapNotificationKind.PLAN_READY,
        itemId: item.itemId,
        sessionId,
        payload: { code: item.code },
      });
    });
  }

  /**
   * The planning agent ended a turn with questions (shared plans only; a
   * private draft's interview is its author's own). A question about the
   * problem or the user goes to the author with a notice [FP-2104]; any other
   * goes only to the person planning it: the lead, or the Owner who started
   * planning while nobody leads it.
   */
  async questionsAsked(
    sessionId: string,
    questions: AskedQuestion[],
  ): Promise<void> {
    if (!questions.length) return;
    await this.safely('agent question', async () => {
      const item = await this.itemOf(sessionId);
      if (!item || !item.shared || !item.planningStarted) return;
      const planner = item.leadUserId ?? item.plannerUserId;
      for (const question of questions) {
        const payload = {
          code: item.code,
          questionId: question.id,
          preview: clip(question.prompt),
          ...(question.forAuthor ? { forAuthor: true } : {}),
        };
        if (question.forAuthor) {
          await this.inbox.deliver({
            kind: RoadmapNotificationKind.AGENT_QUESTION,
            itemId: item.itemId,
            sessionId,
            payload,
            directRecipientIds: [planner],
          });
        } else if (planner) {
          await this.inbox.deliver({
            kind: RoadmapNotificationKind.AGENT_QUESTION,
            itemId: item.itemId,
            sessionId,
            payload,
            directRecipientIds: [planner],
            onlyDirect: true,
          });
        }
      }
    });
  }

  /** Someone answered an agent question on the idea: the planner hears, unless it was them. */
  async questionAnswered(input: {
    sessionId: string;
    itemId: string | null;
    code: string | null;
    questionId: string;
    answererId: number;
  }): Promise<void> {
    if (!input.itemId) return;
    await this.safely('question answered', () =>
      this.inbox.deliver({
        kind: RoadmapNotificationKind.QUESTION_ANSWERED,
        itemId: input.itemId,
        sessionId: input.sessionId,
        actorUserId: input.answererId,
        payload: {
          code: input.code,
          questionId: input.questionId,
          byUserId: input.answererId,
        },
      }),
    );
  }

  /** A comment on the idea's conversation: one grouped notice per follower. */
  async commented(input: {
    sessionId: string;
    itemId: string | null;
    code: string | null;
    actorUserId: number;
    postId: string;
    /** They get the mention notice instead. */
    mentionedIds: number[];
  }): Promise<void> {
    if (!input.itemId) return;
    const itemId = input.itemId;
    await this.safely('comment', () =>
      this.inbox.deliverComment({
        itemId,
        sessionId: input.sessionId,
        actorUserId: input.actorUserId,
        payload: {
          code: input.code,
          postId: input.postId,
          byUserId: input.actorUserId,
        },
        excludeRecipientIds: input.mentionedIds,
      }),
    );
  }

  /**
   * The person opened the idea. Its notices are read (so a mention stops
   * holding it in Needs you), and the author's first look while the plan is
   * being made is stamped on the plan (`authorOpenedPlanAt`), which Measures
   * reads for "the author opened the plan before it closed".
   */
  async opened(userId: number, itemId: string): Promise<void> {
    await this.safely('mark read', async () => {
      await this.inbox.markItemRead(userId, itemId);
      await this.dataSource.query(
        `UPDATE "builder_sessions" s
            SET "plan" = COALESCE(s."plan", '{}'::jsonb)
                  || jsonb_build_object('authorOpenedPlanAt', now())
           FROM "roadmap_opportunities" o
          WHERE o.id = $1 AND o."createdBy" = $2 AND s.id = o."builderSessionId"
            AND s."plan"->>'planningStarted' = 'true'
            AND COALESCE(jsonb_typeof(s."plan"->'planClosed'), 'null') = 'null'
            AND NOT (s."plan" ? 'authorOpenedPlanAt')`,
        [itemId, userId],
      );
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async itemOf(sessionId: string): Promise<{
    itemId: string;
    code: string;
    shared: boolean;
    planningStarted: boolean;
    leadUserId: number | null;
    plannerUserId: number | null;
  } | null> {
    const [row] = await this.dataSource.query(
      `SELECT o.id AS "itemId", o.code, s.visibility, s."leadUserId",
              s.plan->>'planningStarted' AS "planningStarted",
              s.plan->>'planningStartedBy' AS "plannerUserId"
         FROM "builder_sessions" s
         JOIN "roadmap_opportunities" o
           ON o."builderSessionId" = s.id AND o."deletedAt" IS NULL
        WHERE s.id = $1 AND s."deletedAt" IS NULL
        ORDER BY o."createdAt" ASC LIMIT 1`,
      [sessionId],
    );
    if (!row) return null;
    return {
      itemId: String(row.itemId),
      code: String(row.code),
      shared: row.visibility === 'shared',
      planningStarted: row.planningStarted === 'true',
      leadUserId: row.leadUserId == null ? null : Number(row.leadUserId),
      plannerUserId:
        row.plannerUserId == null ? null : Number(row.plannerUserId) || null,
    };
  }

  private async safely(what: string, run: () => Promise<unknown>) {
    try {
      await run();
    } catch (error) {
      this.logger.warn(
        `Could not send the ${what} notice: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
