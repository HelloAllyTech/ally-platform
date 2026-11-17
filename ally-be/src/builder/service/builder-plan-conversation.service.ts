import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PlanEventKind,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapNotificationService } from 'src/product-roadmap/service/roadmap-notification.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  roleAtLeast,
  RoadmapRole,
} from 'src/product-planning/util/roadmap-role.util';
import type { BuilderMessage } from '../entity/builder-message.entity';
import {
  BuilderMessageRole,
  BuilderSessionKind,
  BuilderSessionVisibility,
} from '../enum/builder.enum';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import {
  PlanPost,
  PlanPostAuthor,
  PlanPostMeta,
  planPostsOf,
  PlanQuestionState,
  questionsOf,
  questionStates,
} from '../util/plan-conversation.util';

const UNIQUE_VIOLATION = '23505';
const TEXT_MAX = 4000;

/** A plan session and the idea it belongs to, as the rules read them. */
interface PlanFacts {
  id: string;
  createdBy: number;
  leadUserId: number | null;
  itemId: string | null;
  code: string | null;
  /** Declined, closed or archived: read-only for everyone (§4.7). */
  readOnly: boolean;
}

export interface QuestionAnswers extends Omit<
  PlanQuestionState,
  'answers' | 'settledBy'
> {
  answers: PlanPost[];
  settler: PlanPostAuthor | null;
  settledBy: PlanPostAuthor | null;
}

/**
 * Roadmap v2's one attributed session (plans/roadmap-builder-merge D13,
 * §4.5a, §5.7a): anyone with Roadmap access answers the agent's questions on
 * a shared plan, comments go to people (and reach the agent as context), and
 * the settler — the lead, or the author before a lead exists, or an Owner —
 * chooses between conflicting answers with "Use this answer", which is
 * recorded as a decision. Posts never start an agent turn; the lead's next
 * turn receives them (BuilderInterviewOrchestratorService + renderPlanBatch).
 *
 * BuilderSessionVisibilityInterceptor has already let the caller in by role;
 * this service applies the per-idea rules. Every route reaching here answers
 * 404 while `roadmap_v2` is off.
 */
@Injectable()
export class BuilderPlanConversationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly messages: BuilderMessageRepository,
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly inbox: RoadmapInboxService,
    private readonly events: PlanEventService,
    private readonly broadcast: RoadmapNotificationService,
  ) {}

  async list(
    sessionId: string,
    userId: number,
  ): Promise<{ questions: QuestionAnswers[]; comments: PlanPost[] }> {
    await this.settings.assertRoadmapV2();
    const plan = await this.plan(sessionId);
    if ((await this.roles.roleOf(userId)) === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
    const history = await this.messages.listBySession(sessionId);
    return {
      questions: await this.questions(plan, history),
      comments: planPostsOf(history).filter((p) => p.kind === 'comment'),
    };
  }

  /** An answer to one agent question (§4.5a). Never starts a turn. */
  async answer(
    sessionId: string,
    userId: number,
    input: {
      questionId: string;
      text?: string;
      optionIds?: string[];
      idempotencyKey: string;
    },
  ): Promise<{ post: PlanPost; question: QuestionAnswers }> {
    await this.settings.assertRoadmapV2();
    const plan = await this.writable(sessionId);
    const role = await this.roles.roleOf(userId);
    if (!roleAtLeast(role, 'idea')) {
      throw new ForbiddenException('Answering needs the Idea role.');
    }
    const history = await this.messages.listBySession(sessionId);
    const question = questionsOf(history).get(input.questionId);
    if (!question) throw new NotFoundException('Question not found');

    const optionIds = [...new Set(input.optionIds ?? [])];
    const options = new Map(
      (question.options ?? []).map((o) => [String(o.id), String(o.label)]),
    );
    if (optionIds.some((id) => !options.has(id))) {
      throw new UnprocessableEntityException(
        'That option is not on the question.',
      );
    }
    const typed = (input.text ?? '').trim();
    const text = [
      ...optionIds.map((id) => options.get(id) as string),
      ...(typed ? [typed] : []),
    ]
      .join('; ')
      .slice(0, TEXT_MAX);
    if (!text) throw new UnprocessableEntityException('Write an answer first.');

    const by = await this.author(plan, userId, role);
    const { post, created } = await this.post(
      sessionId,
      userId,
      input.idempotencyKey,
      {
        content: text,
        meta: {
          kind: 'answer',
          questionId: input.questionId,
          ...(optionIds.length ? { optionIds } : {}),
          by,
        },
      },
    );
    if (created) this.changed(plan, 'answers', userId);
    const after = await this.messages.listBySession(sessionId);
    const states = await this.questions(plan, after);
    const state = states.find(
      (s) => s.questionId === input.questionId,
    ) as QuestionAnswers;
    const wasConflict = questionStates(history).some(
      (s) => s.questionId === input.questionId && s.conflict,
    );
    if (state.conflict && !wasConflict) {
      await this.inbox.deliver({
        kind: RoadmapNotificationKind.ANSWERS_CONFLICT,
        itemId: plan.itemId,
        sessionId,
        actorUserId: userId,
        payload: { code: plan.code, questionId: input.questionId },
      });
    }
    await this.syncConflicts(sessionId, states);
    return { post, question: state };
  }

  /** A comment to people, with @mentions that notify (§4.5a). Context for the agent, never an answer. */
  async comment(
    sessionId: string,
    userId: number,
    input: { text: string; mentionUserIds?: number[]; idempotencyKey: string },
  ): Promise<{ post: PlanPost }> {
    await this.settings.assertRoadmapV2();
    const plan = await this.writable(sessionId);
    const role = await this.roles.roleOf(userId);
    if (role === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
    const text = (input.text ?? '').trim().slice(0, TEXT_MAX);
    if (!text) throw new UnprocessableEntityException('Write a comment first.');
    const mentions = [...new Set(input.mentionUserIds ?? [])]
      .map(Number)
      .filter((id) => Number.isInteger(id) && id !== userId)
      .slice(0, 20);
    const by = await this.author(plan, userId, role);
    const { post, created } = await this.post(
      sessionId,
      userId,
      input.idempotencyKey,
      {
        content: text,
        meta: {
          kind: 'comment',
          ...(mentions.length ? { mentionUserIds: mentions } : {}),
          by,
        },
      },
    );
    // A retried offline send is the same comment: nobody is told twice.
    if (created) this.changed(plan, 'comments', userId);
    if (mentions.length && created) {
      await this.inbox.deliver({
        kind: RoadmapNotificationKind.MENTION,
        itemId: plan.itemId,
        sessionId,
        actorUserId: userId,
        payload: { code: plan.code, postId: post.id },
        directRecipientIds: mentions,
      });
    }
    return { post };
  }

  /** "Use this answer" (D13): the settler's choice, recorded as a decision. */
  async settle(
    sessionId: string,
    userId: number,
    postId: string,
    idempotencyKey?: string,
  ): Promise<{ question: QuestionAnswers }> {
    await this.settings.assertRoadmapV2();
    const plan = await this.writable(sessionId);
    const role = await this.roles.roleOf(userId);
    const settles =
      role === 'owner' ||
      (plan.leadUserId !== null &&
        plan.leadUserId === userId &&
        roleAtLeast(role, 'builder')) ||
      (plan.leadUserId === null &&
        plan.createdBy === userId &&
        roleAtLeast(role, 'idea'));
    if (!settles) {
      throw new ForbiddenException(
        plan.leadUserId
          ? "Only this idea's lead can choose between answers."
          : 'Only the author can choose between answers before there is a lead.',
      );
    }
    const history = await this.messages.listBySession(sessionId);
    const chosen = planPostsOf(history).find(
      (p) => p.id === postId && p.kind === 'answer',
    );
    if (!chosen?.questionId) throw new NotFoundException('Answer not found');

    const by = await this.author(plan, userId, role);
    await this.post(
      sessionId,
      userId,
      idempotencyKey || `settle-${postId}-${Date.now()}`,
      {
        content: chosen.text,
        meta: {
          kind: 'settled',
          questionId: chosen.questionId,
          chosenPostId: chosen.id,
          by,
        },
      },
    );
    await this.events.record({
      sessionId,
      kind: PlanEventKind.ANSWER_SETTLED,
      actorUserId: userId,
      detail: { questionId: chosen.questionId, postId: chosen.id },
    });
    this.changed(plan, 'answers', userId);
    const states = await this.questions(
      plan,
      await this.messages.listBySession(sessionId),
    );
    await this.syncConflicts(sessionId, states);
    return {
      question: states.find(
        (s) => s.questionId === chosen.questionId,
      ) as QuestionAnswers,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Tells open queues and idea pages (`roadmap:item-changed`) so they refetch
   * instead of polling. Names the field only, never its text.
   */
  private changed(
    plan: PlanFacts,
    field: 'answers' | 'comments',
    actorId: number,
  ): void {
    if (!plan.code) return;
    this.broadcast.emit({
      kind: 'ITEM_CHANGED',
      actorId,
      code: plan.code,
      fields: [field],
    });
  }

  private async plan(sessionId: string): Promise<PlanFacts> {
    const [row] = await this.dataSource.query(
      `SELECT s.id, s."createdBy", s."leadUserId", s.kind, s.visibility,
              s."archivedAt", s."planStage",
              o.id AS "itemId", o.code, o."reviewState"
         FROM "builder_sessions" s
         LEFT JOIN "roadmap_opportunities" o
           ON o."builderSessionId" = s.id AND o."deletedAt" IS NULL
        WHERE s.id = $1 AND s."deletedAt" IS NULL`,
      [sessionId],
    );
    if (
      !row ||
      row.kind !== BuilderSessionKind.PLAN ||
      row.visibility !== BuilderSessionVisibility.SHARED
    ) {
      throw new NotFoundException('Plan not found');
    }
    return {
      id: row.id,
      createdBy: Number(row.createdBy),
      leadUserId: row.leadUserId == null ? null : Number(row.leadUserId),
      itemId: row.itemId ?? null,
      code: row.code ?? null,
      readOnly:
        !!row.archivedAt ||
        row.planStage === 'closed' ||
        row.reviewState === 'declined',
    };
  }

  private async writable(sessionId: string): Promise<PlanFacts> {
    const plan = await this.plan(sessionId);
    if (plan.readOnly) {
      throw new ForbiddenException('This idea is read-only now.');
    }
    return plan;
  }

  private async author(
    plan: PlanFacts,
    userId: number,
    role: RoadmapRole,
  ): Promise<PlanPostAuthor> {
    const [user] = await this.dataSource.query(
      `SELECT name FROM "users" WHERE id = $1`,
      [userId],
    );
    const relation: PlanPostAuthor['relation'] =
      plan.leadUserId === userId
        ? 'lead'
        : plan.createdBy === userId
          ? 'author'
          : role === 'none'
            ? 'viewer'
            : role;
    return {
      id: userId,
      name: user?.name || `User ${userId}`,
      role,
      relation,
    };
  }

  /**
   * Store one post. A retried send (same idempotency key) returns the post
   * already stored instead of a second one; the unique index decides a race.
   */
  private async post(
    sessionId: string,
    userId: number,
    idempotencyKey: string,
    body: { content: string; meta: PlanPostMeta },
  ): Promise<{ post: PlanPost; created: boolean }> {
    const key = String(idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 80) {
      throw new UnprocessableEntityException(
        'An idempotencyKey of 8 to 80 characters is required.',
      );
    }
    const existing = await this.byKey(sessionId, key);
    if (existing) return { post: existing, created: false };
    let created = true;
    try {
      await this.messages.appendMessage(sessionId, {
        role: BuilderMessageRole.USER,
        content: body.content,
        metadata: { planPost: body.meta, idempotencyKey: key },
        createdBy: userId,
      });
    } catch (error) {
      const code =
        (error as { code?: string })?.code ??
        (error as { driverError?: { code?: string } })?.driverError?.code;
      if (code !== UNIQUE_VIOLATION) throw error;
      created = false;
    }
    const stored = await this.byKey(sessionId, key);
    if (!stored) throw new NotFoundException('Post not found');
    return { post: stored, created };
  }

  private async byKey(
    sessionId: string,
    key: string,
  ): Promise<PlanPost | null> {
    const rows: BuilderMessage[] = await this.dataSource.query(
      `SELECT * FROM "builder_messages"
        WHERE "sessionId" = $1 AND metadata->>'idempotencyKey' = $2 LIMIT 1`,
      [sessionId, key],
    );
    return planPostsOf(rows ?? [])[0] ?? null;
  }

  private async questions(
    plan: PlanFacts,
    history: BuilderMessage[],
  ): Promise<QuestionAnswers[]> {
    const settler = await this.settler(plan);
    return questionStates(history).map((s) => ({ ...s, settler }));
  }

  /** The lead; the author before a lead exists (D13). */
  private async settler(plan: PlanFacts): Promise<PlanPostAuthor | null> {
    const id = plan.leadUserId ?? plan.createdBy;
    if (!id) return null;
    return this.author(plan, id, await this.roles.roleOf(id));
  }

  /** The read model's `answersConflict` (settleAnswer capability) reads this count. */
  private async syncConflicts(
    sessionId: string,
    states: QuestionAnswers[],
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || jsonb_build_object('openConflicts', $2::int)
        WHERE id = $1`,
      [sessionId, states.filter((s) => s.conflict).length],
    );
  }
}
