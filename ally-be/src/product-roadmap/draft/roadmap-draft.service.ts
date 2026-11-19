import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BuilderMessageRepository } from 'src/builder/repository/builder-message.repository';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import type { BuilderMessage } from 'src/builder/entity/builder-message.entity';
import {
  BuilderMessageRole,
  BuilderSessionKind,
  BuilderSessionVisibility,
} from 'src/builder/enum/builder.enum';
import {
  PlanEventKind,
  PlanStage,
  RoadmapNotificationKind,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanCeilingService } from 'src/product-planning/service/plan-ceiling.service';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import { RoadmapInboxService } from 'src/product-planning/service/roadmap-inbox.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { roleAtLeast } from 'src/product-planning/util/roadmap-role.util';
import type { PlanIdeaState } from 'src/product-planning/type/plan-record.type';
import {
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_LIMITS,
} from '../constants/product-roadmap.constants';
import { CreateOpportunityDto } from '../dto/roadmap-opportunity.dto';
import { RoadmapOpportunityEffort } from '../enum/roadmap-opportunity.enum';
import { RoadmapAiService } from '../service/roadmap-ai.service';
import { RoadmapAllocationService } from '../service/roadmap-allocation.service';
import { RoadmapBuilderService } from '../service/roadmap-builder.service';
import { RoadmapCommentService } from '../service/roadmap-comment.service';
import { RoadmapCopilotService } from '../service/roadmap-copilot.service';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapReadinessTokenService } from '../service/roadmap-readiness-token.service';
import { normaliseOpportunityCode } from '../util/item-release.util';
import { currentPeriodKey } from '../util/roadmap-period.util';
import { IDEA_WRAP_UP_REPLY } from '../plan/plan-idea.service';
import { PlanSession, PlanSessionStore } from '../plan/plan-session.store';
import { PlanStageService } from '../plan/plan-stage.service';
import {
  ARCHIVE_AFTER_DAYS,
  PURGE_AFTER_ARCHIVE_DAYS,
} from '../plan/plan-view.service';
import { RoadmapItemLookupService } from '../item/roadmap-item-lookup.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import type { ItemDetail } from '../item/roadmap-item.types';
import type { ShownStage } from 'src/product-planning/util/plan-stage.util';
import type { RoadmapOpportunityBrief } from '../type/roadmap-brief.type';
import {
  normaliseFilingInterview,
  normaliseOpportunityBrief,
} from '../util/roadmap-brief.util';
import {
  composeDescription,
  DraftCheck,
  draftChecks,
  DRAFT_CHECK_ORDER,
  draftProposal,
  DraftProposal,
  firstLine,
  QuotableAnswer,
  verifiedEvidence,
} from './roadmap-draft.util';

const DAY_MS = 86_400_000;
const COPILOT_SPEND_TASK = 'roadmap-opportunity-copilot';
const IDEA_STAGE = { planStage: 'idea' } as const;
/** Similar ideas shown on the draft page (§4.2). */
const SIMILAR_MAX = 2;
/** Fewer characters than this is not enough to look for duplicates of. */
const SIMILAR_MIN_CHARS = 15;
const UNIQUE_VIOLATION = '23505';

export interface DraftMessage {
  id: string;
  seq: number;
  from: 'author' | 'agent';
  text: string;
  at: string;
  idempotencyKey?: string;
  wrapUp?: boolean;
}

export interface DraftDetail {
  code: string;
  sessionId: string;
  shownStage: 'draft';
  statusParts: { stage: 'draft'; checksMet: number; checksTotal: number };
  text: string;
  title: string;
  goal: { id: string; name: string } | null;
  suggestedGoal: { id: string; name: string } | null;
  checks: DraftCheck[];
  checksMet: number;
  checksTotal: number;
  canSubmit: boolean;
  selfChecked: boolean;
  selfCheckOffered: boolean;
  checkedAt: string | null;
  conversation: DraftMessage[];
  version: number;
  savedAt: string;
  createdAt: string;
  archivedAt: string | null;
  archiveAt: string | null;
  purgeAt: string | null;
  spend: { spentUsd: number; ideaCapUsd: number; wrapUp: boolean };
  /**
   * Audit rec. 6, all optional for an older page. The one character limit for the text box
   * (the same one Submit files against), the idea agent's statement and short title for "What
   * will be submitted" (null until it has drafted one), and its research brief for "What the
   * idea agent found" (null until its first turn).
   */
  textMax?: number;
  proposal?: DraftProposal | null;
  brief?: RoadmapOpportunityBrief | null;
}

export interface DraftRow {
  code: string;
  title: string;
  checksMet: number;
  checksTotal: number;
  updatedAt: string;
  archivedAt: string | null;
  archiveAt: string | null;
  purgeAt: string | null;
}

export interface SimilarIdea {
  code: string;
  title: string;
  shownStage: ShownStage;
  votes: number;
  reason: string;
}

interface Goal {
  id: string;
  name: string;
}

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const coded = (status: HttpStatus, code: string, message: string, extra = {}) =>
  new HttpException({ statusCode: status, code, message, ...extra }, status);

/**
 * Roadmap v2's New idea, My drafts and the draft page (plans/roadmap-builder-merge
 * §4.2, §4.4, §4.13; D3, D9). Session-first, as rev 5.2: New idea creates a
 * private `kind='plan'` session at once and gives it the code it will keep for
 * life; nothing reaches `roadmap_opportunities` until Submit, so a private idea
 * cannot leak into the board, search or the public roadmap.
 *
 * Every method is reached only through routes that answered 404 while
 * `roadmap_v2` is off. A draft is its author's alone: everyone else gets 404.
 */
@Injectable()
export class RoadmapDraftService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: PlanSettingsService,
    private readonly roles: RoadmapRoleService,
    private readonly store: PlanSessionStore,
    private readonly stage: PlanStageService,
    private readonly builderSessions: BuilderSessionService,
    private readonly messages: BuilderMessageRepository,
    private readonly copilot: RoadmapCopilotService,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly readinessToken: RoadmapReadinessTokenService,
    private readonly roadmapBuilder: RoadmapBuilderService,
    private readonly roadmapAi: RoadmapAiService,
    private readonly allocations: RoadmapAllocationService,
    private readonly comments: RoadmapCommentService,
    private readonly events: PlanEventService,
    private readonly spend: PlanSpendService,
    private readonly ceiling: PlanCeilingService,
    private readonly inbox: RoadmapInboxService,
    private readonly broadcast: RoadmapNotificationService,
    private readonly lookup: RoadmapItemLookupService,
    private readonly reader: RoadmapItemReadService,
  ) {}

  // ── Create, list, read ─────────────────────────────────────────────────────

  /** New idea (D3): one sentence saves a private draft instantly, with no AI. */
  async create(
    userId: number,
    input: { text: string; goalId?: string | null; captureMode?: string },
  ): Promise<DraftDetail> {
    await this.assertCanDraft(userId);
    const text = this.cleanText(input.text);
    if (!text) {
      throw new UnprocessableEntityException('Say what the idea is first.');
    }
    const goal = input.goalId ? await this.goalById(input.goalId) : null;
    const session = await this.builderSessions.createSession(userId, {
      title: firstLine(text),
    });
    const [{ code }] = await this.dataSource.query(
      `SELECT 'OPP-' || lpad(nextval('roadmap_opportunity_code_seq')::text, 4, '0') AS code`,
    );
    const now = new Date();
    await this.store.repository.update(
      { id: session.id },
      {
        kind: BuilderSessionKind.PLAN,
        visibility: BuilderSessionVisibility.PRIVATE,
        planStage: PlanStage.IDEA,
        planStageAt: now,
      },
    );
    await this.store.patchPlan(session.id, {
      code,
      draftText: text,
      draftGoalId: goal?.id ?? null,
      draftVersion: 1,
      parked: true,
      captureMode: input.captureMode === 'voice' ? 'voice' : 'typed',
      lastActiveAt: now.toISOString(),
    });
    await this.events.record({
      sessionId: session.id,
      kind: PlanEventKind.PARKED,
      actorUserId: userId,
    });
    return this.detail(userId, code);
  }

  /** My drafts (§4.4): newest first. Archived ones only when asked for. */
  async list(userId: number, includeArchived: boolean): Promise<DraftRow[]> {
    await this.assertCanRead(userId);
    const query = this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere('s.visibility = :v', { v: BuilderSessionVisibility.PRIVATE })
      .andWhere('s.createdBy = :userId', { userId })
      .andWhere(`s.plan->>'code' IS NOT NULL`);
    if (!includeArchived) query.andWhere('s.archivedAt IS NULL');
    const rows = (await query
      .orderBy('s.updatedAt', 'DESC')
      .take(200)
      .getMany()) as PlanSession[];
    const answers = await this.answersBySession(rows.map((r) => r.id));
    return rows.map((s) => {
      const record = s.plan ?? {};
      const checks = draftChecks(
        record.idea,
        record.draftText ?? '',
        answers.get(s.id) ?? [],
      );
      const timing = this.timing(s);
      return {
        code: record.code as string,
        title: firstLine(record.draftText ?? s.title),
        checksMet: checks.filter((c) => c.met).length,
        checksTotal: checks.length,
        updatedAt: iso(s.updatedAt) as string,
        archivedAt: iso(s.archivedAt),
        archiveAt: timing.archiveAt,
        purgeAt: timing.purgeAt,
      };
    });
  }

  async detail(userId: number, code: string): Promise<DraftDetail> {
    const draft = await this.ownDraft(userId, code);
    return this.render(draft);
  }

  // ── Autosave and the draft's life ──────────────────────────────────────────

  /**
   * Debounced autosave (§4.2). One atomic statement: with `baseVersion`, a
   * save from a stale tab or a late offline sync is refused with the current
   * draft rather than overwriting newer words.
   */
  async patch(
    userId: number,
    code: string,
    input: { text?: string; goalId?: string | null; baseVersion?: number },
  ): Promise<{
    code: string;
    title: string;
    version: number;
    savedAt: string;
    checksMet: number;
    checksTotal: number;
  }> {
    const draft = await this.editableDraft(userId, code);
    const patch: Record<string, unknown> = {
      lastActiveAt: new Date().toISOString(),
    };
    if (input.text !== undefined) {
      const text = this.cleanText(input.text);
      patch.draftText = text;
    }
    if (input.goalId !== undefined) {
      patch.draftGoalId = input.goalId
        ? (await this.goalById(input.goalId)).id
        : null;
    }
    const result = await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || $2::jsonb
                || jsonb_build_object('draftVersion', COALESCE(("plan"->>'draftVersion')::int, 0) + 1),
              "title" = COALESCE($4, "title"),
              "updatedAt" = now()
        WHERE id = $1
          AND ($3::int IS NULL OR COALESCE(("plan"->>'draftVersion')::int, 0) = $3::int)
        RETURNING ("plan"->>'draftVersion')::int AS version, "updatedAt"`,
      [
        draft.id,
        JSON.stringify(patch),
        input.baseVersion ?? null,
        typeof patch.draftText === 'string' && patch.draftText
          ? firstLine(patch.draftText)
          : null,
      ],
    );
    const rows: { version: number; updatedAt: Date }[] = Array.isArray(
      result?.[0],
    )
      ? result[0]
      : result;
    if (!rows?.length) {
      throw coded(
        HttpStatus.CONFLICT,
        'draft_version_conflict',
        'This draft changed somewhere else since you loaded it.',
        { current: await this.render(await this.store.get(draft.id)) },
      );
    }
    const saved = await this.store.get(draft.id);
    const text = saved.plan.draftText ?? '';
    const checks = draftChecks(
      saved.plan.idea,
      text,
      await this.authorAnswers(saved.id),
    );
    return {
      code: saved.plan.code as string,
      title: firstLine(text || saved.title),
      version: Number(rows[0].version),
      savedAt: iso(rows[0].updatedAt) as string,
      checksMet: checks.filter((c) => c.met).length,
      checksTotal: checks.length,
    };
  }

  /** Discard a draft for good (also what the page does with a draft left empty). */
  async discard(userId: number, code: string): Promise<void> {
    const draft = await this.ownDraft(userId, code);
    await this.store.repository.delete({ id: draft.id });
  }

  async restore(userId: number, code: string): Promise<DraftDetail> {
    const draft = await this.ownDraft(userId, code);
    if (draft.archivedAt) {
      await this.store.update(draft.id, { archivedAt: null });
      await this.store.patchPlan(draft.id, {
        lastActiveAt: new Date().toISOString(),
        expiryWarnings: [],
      });
      await this.events.record({
        sessionId: draft.id,
        kind: PlanEventKind.RESTORED,
        actorUserId: userId,
      });
    }
    return this.detail(userId, code);
  }

  // ── Check my idea and the idea interview ───────────────────────────────────

  /**
   * One copilot turn on the draft (§4.2, §4.13). With no answer it is Check
   * my idea: the copilot reads the idea as written now, ticks what it meets
   * with the words that meet it, suggests a goal, and asks about the rest.
   * The evidence and the goal come back in the same `submit_turn` — no new
   * model call. Past the $1 idea-stage cap the copilot wraps up instead.
   */
  async turn(
    userId: number,
    code: string,
    input: { answer?: string; idempotencyKey?: string },
  ): Promise<DraftDetail> {
    const draft = await this.editableDraft(userId, code);
    const key = input.idempotencyKey?.trim() || undefined;
    if (key && (await this.hasMessageWithKey(draft.id, key))) {
      return this.render(await this.store.get(draft.id));
    }
    const text = draft.plan.draftText ?? '';
    if (!text.trim()) {
      throw new UnprocessableEntityException('Write the idea down first.');
    }
    // Before anything is written, so a refused turn leaves the draft as it was.
    await this.ceiling.assertWithinCeiling(draft.id, 'copilot_turn');

    const answer = (input.answer ?? '').trim();
    if (answer) {
      const stored = await this.appendOnce(draft.id, {
        role: BuilderMessageRole.USER,
        content: answer.slice(0, 4000),
        metadata: { ...IDEA_STAGE, ...(key ? { idempotencyKey: key } : {}) },
        createdBy: userId,
      });
      if (!stored) return this.render(await this.store.get(draft.id));
    }
    await this.store.patchPlan(draft.id, {
      lastActiveAt: new Date().toISOString(),
      parked: false,
    });

    const cap = await this.spend.checkCeiling(draft.id, PlanStage.IDEA);
    if (cap.state === 'wrap_up') {
      await this.messages.appendMessage(draft.id, {
        role: BuilderMessageRole.ASSISTANT,
        content: IDEA_WRAP_UP_REPLY,
        metadata: { ...IDEA_STAGE, wrapUp: true },
      });
      return this.render(await this.store.get(draft.id));
    }

    const conversation = await this.ideaMessages(draft.id);
    const history = [
      {
        role: 'admin' as const,
        content: `My idea, as I have written it now:\n${text}`,
      },
      ...conversation
        .filter((m) => m.content && !m.metadata?.wrapUp)
        .map((m) => ({
          role:
            m.role === BuilderMessageRole.USER
              ? ('admin' as const)
              : ('agent' as const),
          content: m.content as string,
        })),
    ];
    const idea: PlanIdeaState = draft.plan.idea ?? {};

    let result: Awaited<ReturnType<RoadmapCopilotService['takeTurn']>>;
    try {
      result = await this.copilot.takeTurn(
        {
          messages: history,
          brief: idea.brief,
          checks: { reopened: idea.reopened ?? [] },
          onUsage: async (usage) => {
            await this.spend.record({
              sessionId: draft.id,
              stage: PlanStage.IDEA,
              actorUserId: userId,
              specialist: null,
              taskId: COPILOT_SPEND_TASK,
              provider: usage.provider,
              model: usage.model,
              tokensIn: usage.inputTokens,
              tokensOut: usage.outputTokens,
              cachedTokens: usage.cachedTokens,
              cacheWriteTokens: usage.cacheCreationTokens,
            });
          },
        },
        userId,
      );
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      const failures = (idea.turnFailures ?? 0) + 1;
      await this.store.patchPlan(draft.id, {
        idea: { ...idea, turnFailures: failures },
      });
      throw coded(
        HttpStatus.SERVICE_UNAVAILABLE,
        'assistant_unavailable',
        "Couldn't reach the assistant. Your words are saved; try again.",
        { failures, selfCheckOffered: false },
      );
    }

    await this.messages.appendMessage(draft.id, {
      role: BuilderMessageRole.ASSISTANT,
      content: result.reply,
      metadata: { ...IDEA_STAGE, gates: result.gates },
    });
    const answers = await this.authorAnswers(draft.id);
    await this.store.patchPlan(draft.id, {
      idea: {
        ...idea,
        brief: result.brief ?? idea.brief ?? null,
        gates: (result.gates ?? []).map((g) => ({
          id: String(g.id),
          met: !!g.met,
          note: g.note ?? undefined,
        })),
        draft: result.draft
          ? {
              description: result.draft.description,
              title: result.draft.title ?? null,
              productGoal: result.draft.productGoal ?? null,
              effort: (result.draft.effort as string | null) ?? null,
            }
          : null,
        readinessToken: result.readinessToken ?? null,
        lastTurnAt: new Date().toISOString(),
        evidence: verifiedEvidence(
          result.checkTurn?.evidence ?? {},
          text,
          answers,
        ),
        suggestedGoal:
          result.checkTurn?.suggestedGoal ?? idea.suggestedGoal ?? null,
        reopened: [],
        turnFailures: 0,
      },
    });
    return this.render(await this.store.get(draft.id));
  }

  /** "Not quite" (§4.13, [FP-1708]): the check goes back to unmet; the next turn asks again. */
  async reopenCheck(
    userId: number,
    code: string,
    checkId: string,
  ): Promise<DraftDetail> {
    const draft = await this.editableDraft(userId, code);
    if (!(DRAFT_CHECK_ORDER as readonly string[]).includes(checkId)) {
      throw new NotFoundException('There is no such check.');
    }
    const idea: PlanIdeaState = draft.plan.idea ?? {};
    const selfCheck = idea.selfCheck ? { ...idea.selfCheck } : null;
    if (selfCheck) delete selfCheck[checkId];
    await this.store.patchPlan(draft.id, {
      idea: {
        ...idea,
        reopened: [...new Set([...(idea.reopened ?? []), checkId])],
        selfCheck:
          selfCheck && Object.keys(selfCheck).length ? selfCheck : null,
      },
      lastActiveAt: new Date().toISOString(),
    });
    return this.render(await this.store.get(draft.id));
  }

  /**
   * "Fill it in yourself" (§4.13) is gone (lifecycle 2026-11-18): drafts are finished by the
   * interview, the same bar for everyone. Answers 410 so an old client says why.
   */
  async selfCheck(): Promise<DraftDetail> {
    throw new GoneException(
      'Filling the checks in yourself was removed: a draft is ready once the idea agent has interviewed it. Try Check my idea again.',
    );
  }

  // ── Similar ideas and Add my point ─────────────────────────────────────────

  /** Similar ideas as you type (§4.2): the existing duplicate detection, at most 2. */
  async similar(
    userId: number,
    code: string,
  ): Promise<{ matches: SimilarIdea[] }> {
    const draft = await this.ownDraft(userId, code);
    const text = (draft.plan.draftText ?? '').trim();
    if (text.length < SIMILAR_MIN_CHARS) return { matches: [] };
    const goal = await this.goalOf(draft);
    return this.similarTo(userId, text, goal?.name, null);
  }

  /** Shared with triage (GET /items/:code/similar): duplicates of a text, as queue rows. */
  async similarTo(
    userId: number,
    text: string,
    productGoal: string | undefined,
    excludeId: string | null,
  ): Promise<{ matches: SimilarIdea[] }> {
    const found = await this.roadmapAi.findDuplicates(text, productGoal);
    const matches = (found?.matches ?? []).filter((m) => m.id !== excludeId);
    const rows = await this.reader.rowsFor(
      userId,
      matches.map((m) => m.id),
    );
    const reasons = new Map(matches.map((m) => [m.id, m.reason]));
    const idByCode = await this.codesOf(matches.map((m) => m.id));
    return {
      matches: rows.slice(0, SIMILAR_MAX).map((row) => ({
        code: row.code,
        title: row.title,
        shownStage: row.shownStage,
        votes: row.votes,
        reason: reasons.get(idByCode.get(row.code) ?? '') ?? '',
      })),
    };
  }

  /**
   * "Add my point to OPP-212" (§4.2): one vote if you have none on it and
   * votes to spend, your words posted there as your comment, and this draft
   * archived so nothing you wrote is lost.
   */
  async addTo(
    userId: number,
    code: string,
    targetCode: string,
  ): Promise<{ target: { code: string }; voted: boolean; commentId: string }> {
    const draft = await this.editableDraft(userId, code);
    const text = (draft.plan.draftText ?? '').trim();
    if (!text) {
      throw new UnprocessableEntityException('There is nothing to add yet.');
    }
    const target = await this.reader.detail(userId, targetCode);
    if (!target.can.comment) {
      throw new ConflictException(`${target.code} is not taking comments.`);
    }
    const ref = await this.lookup.get(target.code);

    let voted = false;
    if (target.can.vote) {
      const [mine] = await this.dataSource.query(
        `SELECT COALESCE(SUM(votes), 0)::int AS votes FROM "roadmap_allocations"
          WHERE "userId" = $1 AND "opportunityId" = $2 AND "periodKey" = $3`,
        [userId, ref.id, currentPeriodKey()],
      );
      if (!Number(mine?.votes)) {
        try {
          await this.allocations.setVotes(userId, ref.id, 1);
          voted = true;
        } catch {
          // Out of votes, or the idea stopped taking them: the point still lands.
        }
      }
    }
    const comment = await this.comments.create(userId, ref.id, {
      // A comment is shorter than an idea; the archived draft keeps the rest.
      body:
        text.length > ROADMAP_LIMITS.COMMENT_MAX
          ? `${text.slice(0, ROADMAP_LIMITS.COMMENT_MAX - 1)}…`
          : text,
    });

    await this.store.update(draft.id, { archivedAt: new Date() });
    await this.events.record({
      sessionId: draft.id,
      kind: PlanEventKind.ARCHIVED,
      actorUserId: userId,
      detail: { addedTo: ref.code },
    });
    return { target: { code: ref.code }, voted, commentId: comment.id };
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  /**
   * Submit (D3, D12): 5 of 5, then Submitted (`reviewState='pending'`), the
   * session shared, the Owners told. Keeps the draft's code. Idempotent
   * against a double click: the second one waits on nothing and answers 409.
   */
  async submit(
    userId: number,
    code: string,
    input: {
      goalId?: string | null;
      /** One line naming the idea: required since 2026-11-19 (#342). */
      title: string;
      /** Audit rec. 6: what the summary says. Absent (every older client) means `mine`. */
      use?: 'mine' | 'agent';
      statement?: string;
    },
  ): Promise<{ item: ItemDetail; firstSubmit: boolean }> {
    const draft = await this.editableDraft(userId, code);
    const draftCode = draft.plan.code as string;
    const text = (draft.plan.draftText ?? '').trim();
    const idea: PlanIdeaState = draft.plan.idea ?? {};
    const checks = draftChecks(idea, text, await this.authorAnswers(draft.id));
    const missing = checks.filter((c) => !c.met).map((c) => c.id);
    if (!text || missing.length) {
      throw coded(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'checks_incomplete',
        'Not ready to submit yet.',
        { missing },
      );
    }
    const goal = input.goalId
      ? await this.goalById(input.goalId)
      : await this.goalOf(draft, true);
    if (!goal) {
      throw coded(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'goal_required',
        'Pick the goal this idea serves.',
      );
    }
    const selfChecked = checks.some((c) => c.source === 'self');
    // The checks above always grade the author's own words (they quote them verbatim); this
    // only chooses what the idea's text says once filed. The author's words stay on the
    // session as `draftText` and show on the idea as where it started.
    const submittedAs: 'author' | 'agent' =
      input.use === 'agent' ? 'agent' : 'author';
    let description: string;
    if (submittedAs === 'agent') {
      const proposal = draftProposal(idea);
      if (!proposal) {
        throw coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'no_statement',
          "The idea agent hasn't written a statement for this idea. Submit your own words.",
        );
      }
      // The title is its own field (#342); the statement is the summary beneath it.
      description = (input.statement ?? proposal.statement)
        .replace(/\r\n/g, '\n')
        .trim();
      if (!description) {
        throw coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'statement_empty',
          'Write a summary, or submit your own words.',
        );
      }
    } else {
      description = composeDescription(
        text,
        selfChecked ? (idea.selfCheck ?? null) : null,
      );
    }
    if (description.length > ROADMAP_LIMITS.DESCRIPTION_MAX) {
      throw coded(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'too_long',
        `A summary can be at most ${ROADMAP_LIMITS.DESCRIPTION_MAX} characters.`,
      );
    }

    // Claim the submit so a second click cannot file twice.
    const claimed = await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || jsonb_build_object('filingAt', now()::text)
        WHERE id = $1 AND COALESCE("plan"->>'filingAt', '') = ''
          AND COALESCE("plan"->>'opportunityId', '') = ''
        RETURNING id`,
      [draft.id],
    );
    const rows = Array.isArray(claimed?.[0]) ? claimed[0] : claimed;
    if (!rows?.length) {
      throw coded(
        HttpStatus.CONFLICT,
        'submit_in_progress',
        'This idea is already being submitted.',
      );
    }

    try {
      const firstSubmit = await this.isFirstSubmit(userId);
      const effort = this.fileableEffort(idea.draft?.effort);
      const brief = !selfChecked && idea.brief ? idea.brief : null;
      const signed = !!(effort && brief);
      const transcript = (await this.ideaMessages(draft.id))
        .filter((m) => m.content)
        .map((m) => ({
          role: m.role === BuilderMessageRole.USER ? 'admin' : 'agent',
          content: m.content,
        }));
      const created = await this.opportunityService.create(
        userId,
        {
          title: input.title,
          description,
          productGoal: goal.name,
          effort: effort ?? undefined,
          ...(signed
            ? {
                // The server graded these checks itself; it signs what it files.
                readinessToken: this.readinessToken.issue({
                  description,
                  productGoal: goal.name,
                  failedCriteria: [],
                  proposedEffort: effort,
                  brief: brief as any,
                }),
                brief,
                interviewTranscript: [
                  { role: 'admin', content: text },
                  ...transcript,
                ],
              }
            : {}),
        } as unknown as CreateOpportunityDto,
        { canManage: false, enforceReadiness: signed, code: draftCode },
      );
      if (!signed) {
        // Audit rec. 5: an idea the agent could not size (or an unsigned filing) used to lose
        // its brief and its interview here. Both are the server's own record of this draft,
        // not anything the client sent, so keeping them claims nothing on the agent's behalf
        // that it did not say; the readiness token still only signs a sized draft.
        await this.keepFilingRecord(created.id, idea.brief, [
          { role: 'admin', content: text },
          ...transcript,
        ]);
      }

      await this.dataSource.query(
        `UPDATE "roadmap_opportunities"
            SET "reviewState" = 'pending', "selfChecked" = $2,
                "builderSessionId" = COALESCE("builderSessionId", $3)
          WHERE id = $1`,
        [created.id, selfChecked, draft.id],
      );
      const filedAt = new Date().toISOString();
      await this.store.update(draft.id, {
        visibility: BuilderSessionVisibility.SHARED,
        title: input.title.slice(0, 120),
        archivedAt: null,
        updatedBy: userId,
      });
      await this.store.patchPlan(draft.id, {
        filedAt,
        opportunityId: created.id,
        filingAt: null,
        lastActiveAt: filedAt,
        planningStarted: false,
        submittedAs,
      });
      const handoff = await this.roadmapBuilder.handoffTextForOpportunity(
        created.id,
      );
      if (handoff) {
        await this.builderSessions.attachHandoffContext(draft.id, handoff);
      }
      await this.events.record({
        sessionId: draft.id,
        kind: PlanEventKind.FILED,
        actorUserId: userId,
        detail: { opportunityId: created.id, selfChecked, submittedAs },
      });
      await this.events.record({
        sessionId: draft.id,
        kind: PlanEventKind.VISIBILITY_CHANGED,
        actorUserId: userId,
        detail: { to: 'shared' },
      });
      await this.stage.sync(draft.id, userId);
      await this.inbox.deliver({
        kind: RoadmapNotificationKind.SUBMITTED,
        itemId: created.id,
        sessionId: draft.id,
        actorUserId: userId,
        payload: {
          code: draftCode,
          title: input.title,
          selfChecked,
        },
      });
      this.broadcast.emit({
        kind: 'ITEM_CHANGED',
        actorId: userId,
        code: draftCode,
        fields: ['stage'],
      });
      return { item: await this.reader.detail(userId, draftCode), firstSubmit };
    } catch (error) {
      await this.store.patchPlan(draft.id, { filingAt: null });
      throw error;
    }
  }

  // ── Shared with dictation ──────────────────────────────────────────────────

  /** The caller's own unsubmitted draft by code, or 404. Exported for dictation. */
  async ownDraft(userId: number, code: string): Promise<PlanSession> {
    const key = normaliseOpportunityCode(code ?? '') ?? '';
    if (!key) throw new NotFoundException('Draft not found');
    const row = (await this.store.repository
      .createQueryBuilder('s')
      .addSelect('s.plan')
      .where('s.kind = :kind', { kind: BuilderSessionKind.PLAN })
      .andWhere(`s.plan->>'code' = :code`, { code: key })
      .getOne()) as PlanSession | null;
    if (
      !row ||
      row.createdBy !== userId ||
      row.visibility !== BuilderSessionVisibility.PRIVATE
    ) {
      throw new NotFoundException('Draft not found');
    }
    return { ...row, plan: row.plan ?? {} } as PlanSession;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async assertCanRead(userId: number): Promise<void> {
    if ((await this.roles.roleOf(userId)) === 'none') {
      throw new ForbiddenException('You do not have access to the Roadmap.');
    }
  }

  private async assertCanDraft(userId: number): Promise<void> {
    if (!roleAtLeast(await this.roles.roleOf(userId), 'idea')) {
      throw new ForbiddenException(
        'Writing ideas needs the Idea role on the Roadmap.',
      );
    }
  }

  /** Your own draft, still a draft, not archived, and you may still write ideas. */
  private async editableDraft(
    userId: number,
    code: string,
  ): Promise<PlanSession> {
    const draft = await this.ownDraft(userId, code);
    await this.assertCanDraft(userId);
    if (draft.archivedAt) {
      throw coded(
        HttpStatus.CONFLICT,
        'draft_archived',
        'Restore this draft before working on it.',
      );
    }
    if (draft.plan.filingAt || draft.plan.opportunityId) {
      throw coded(
        HttpStatus.CONFLICT,
        'submit_in_progress',
        'This idea is being submitted.',
      );
    }
    return draft;
  }

  /** Brief and filing interview onto an unsigned filing, each only where there is one. */
  private async keepFilingRecord(
    opportunityId: string,
    rawBrief: unknown,
    rawTranscript: unknown,
  ): Promise<void> {
    const brief = normaliseOpportunityBrief(rawBrief);
    const transcript = normaliseFilingInterview(rawTranscript);
    if (!brief && !transcript?.length) return;
    await this.dataSource.query(
      `UPDATE "roadmap_opportunities"
          SET "brief" = COALESCE($2::jsonb, "brief"),
              "interviewTranscript" = COALESCE($3::jsonb, "interviewTranscript")
        WHERE id = $1`,
      [
        opportunityId,
        brief ? JSON.stringify(brief) : null,
        transcript?.length ? JSON.stringify(transcript) : null,
      ],
    );
  }

  private cleanText(text: string | undefined): string {
    const value = (text ?? '').replace(/\r\n/g, '\n').trim();
    if (value.length > ROADMAP_LIMITS.DESCRIPTION_MAX) {
      throw new UnprocessableEntityException(
        `An idea can be at most ${ROADMAP_LIMITS.DESCRIPTION_MAX} characters.`,
      );
    }
    return value;
  }

  private async goalById(id: string): Promise<Goal> {
    const [goal] = await this.dataSource.query(
      `SELECT id::text AS id, name FROM "roadmap_product_goals" WHERE id::text = $1`,
      [String(id)],
    );
    if (!goal) {
      throw new UnprocessableEntityException('That goal does not exist.');
    }
    return goal;
  }

  private async goalByName(
    name: string | null | undefined,
  ): Promise<Goal | null> {
    if (!name) return null;
    const [goal] = await this.dataSource.query(
      `SELECT id::text AS id, name FROM "roadmap_product_goals" WHERE name = $1`,
      [name],
    );
    return goal ?? null;
  }

  /** The author's goal, else (when `suggested`) the copilot's suggestion. */
  private async goalOf(
    draft: PlanSession,
    suggested = true,
  ): Promise<Goal | null> {
    if (draft.plan.draftGoalId) {
      const [goal] = await this.dataSource.query(
        `SELECT id::text AS id, name FROM "roadmap_product_goals" WHERE id::text = $1`,
        [String(draft.plan.draftGoalId)],
      );
      if (goal) return goal;
    }
    return suggested
      ? this.goalByName(draft.plan.idea?.suggestedGoal ?? null)
      : null;
  }

  private fileableEffort(
    effort: string | null | undefined,
  ): RoadmapOpportunityEffort | null {
    return effort &&
      (ROADMAP_FILEABLE_EFFORTS as readonly string[]).includes(effort)
      ? (effort as RoadmapOpportunityEffort)
      : null;
  }

  private async isFirstSubmit(userId: number): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM "roadmap_opportunities"
        WHERE "createdBy" = $1 AND type = 'idea' AND "deletedAt" IS NULL`,
      [userId],
    );
    return Number(row?.n ?? 0) === 0;
  }

  private async codesOf(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows: { id: string; code: string }[] = await this.dataSource.query(
      `SELECT id, code FROM "roadmap_opportunities" WHERE id = ANY($1)`,
      [ids],
    );
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  private async ideaMessages(sessionId: string): Promise<BuilderMessage[]> {
    return (await this.messages.listBySession(sessionId)).filter(
      (m) => m.metadata?.planStage === 'idea',
    );
  }

  private async authorAnswers(sessionId: string): Promise<QuotableAnswer[]> {
    return (await this.ideaMessages(sessionId))
      .filter((m) => m.role === BuilderMessageRole.USER && m.content)
      .map((m) => ({ id: m.id, text: m.content as string }));
  }

  private async answersBySession(
    ids: string[],
  ): Promise<Map<string, QuotableAnswer[]>> {
    if (!ids.length) return new Map();
    const rows: { id: string; sessionId: string; content: string }[] =
      await this.dataSource.query(
        `SELECT id, "sessionId", content FROM "builder_messages"
          WHERE "sessionId" = ANY($1) AND role = 'user' AND content IS NOT NULL
            AND metadata->>'planStage' = 'idea'`,
        [ids],
      );
    const out = new Map<string, QuotableAnswer[]>();
    for (const r of rows) {
      const list = out.get(r.sessionId) ?? [];
      list.push({ id: r.id, text: r.content });
      out.set(r.sessionId, list);
    }
    return out;
  }

  private async hasMessageWithKey(
    sessionId: string,
    key: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM "builder_messages"
        WHERE "sessionId" = $1 AND metadata->>'idempotencyKey' = $2 LIMIT 1`,
      [sessionId, key],
    );
    return !!rows?.length;
  }

  /** Append, or null when the idempotency key was already used (the unique index). */
  private async appendOnce(
    sessionId: string,
    message: Parameters<BuilderMessageRepository['appendMessage']>[1],
  ): Promise<BuilderMessage | null> {
    try {
      return await this.messages.appendMessage(sessionId, message);
    } catch (error) {
      if ((error as { code?: string })?.code === UNIQUE_VIOLATION) return null;
      if (
        (error as { driverError?: { code?: string } })?.driverError?.code ===
        UNIQUE_VIOLATION
      ) {
        return null;
      }
      throw error;
    }
  }

  private timing(s: PlanSession): {
    archiveAt: string | null;
    purgeAt: string | null;
  } {
    if (s.archivedAt) {
      return {
        archiveAt: null,
        purgeAt: iso(
          new Date(
            new Date(s.archivedAt).getTime() +
              PURGE_AFTER_ARCHIVE_DAYS * DAY_MS,
          ),
        ),
      };
    }
    const last = new Date(s.plan?.lastActiveAt ?? s.createdAt).getTime();
    return {
      archiveAt: iso(new Date(last + ARCHIVE_AFTER_DAYS * DAY_MS)),
      purgeAt: null,
    };
  }

  private async render(draft: PlanSession): Promise<DraftDetail> {
    const record = draft.plan ?? {};
    const text = record.draftText ?? '';
    const messages = await this.ideaMessages(draft.id);
    const answers = messages
      .filter((m) => m.role === BuilderMessageRole.USER && m.content)
      .map((m) => ({ id: m.id, text: m.content as string }));
    const checks = draftChecks(record.idea, text, answers);
    const checksMet = checks.filter((c) => c.met).length;
    const [goal, suggestedGoal, cap] = await Promise.all([
      this.goalOf(draft, false),
      this.goalByName(record.idea?.suggestedGoal ?? null),
      this.spend.checkCeiling(draft.id, PlanStage.IDEA),
    ]);
    const timing = this.timing(draft);
    return {
      code: record.code as string,
      sessionId: draft.id,
      shownStage: 'draft',
      statusParts: { stage: 'draft', checksMet, checksTotal: checks.length },
      text,
      title: firstLine(text || draft.title),
      goal,
      suggestedGoal,
      checks,
      checksMet,
      checksTotal: checks.length,
      canSubmit: !!text.trim() && checksMet === checks.length,
      selfChecked: checks.some((c) => c.source === 'self'),
      // "Fill it in yourself" was removed (lifecycle 2026-11-18): never offered.
      selfCheckOffered: false,
      checkedAt: record.idea?.lastTurnAt ?? null,
      conversation: messages
        .filter((m) => m.content)
        .map((m) => ({
          id: m.id,
          seq: m.seq,
          from:
            m.role === BuilderMessageRole.USER
              ? ('author' as const)
              : ('agent' as const),
          text: m.content as string,
          at: iso(m.createdAt) as string,
          ...(m.metadata?.idempotencyKey
            ? { idempotencyKey: String(m.metadata.idempotencyKey) }
            : {}),
          ...(m.metadata?.wrapUp ? { wrapUp: true } : {}),
        })),
      version: Number(record.draftVersion ?? 1),
      savedAt: iso(draft.updatedAt) as string,
      createdAt: iso(draft.createdAt) as string,
      archivedAt: iso(draft.archivedAt),
      archiveAt: timing.archiveAt,
      purgeAt: timing.purgeAt,
      spend: {
        spentUsd: cap.spentUsd,
        ideaCapUsd: cap.ceilingUsd,
        wrapUp: cap.state === 'wrap_up',
      },
      textMax: ROADMAP_LIMITS.DESCRIPTION_MAX,
      proposal: draftProposal(record.idea),
      brief: normaliseOpportunityBrief(record.idea?.brief),
    };
  }
}
