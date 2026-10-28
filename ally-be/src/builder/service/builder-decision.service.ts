import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderPullRequestRepository } from '../repository/builder-build.repository';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderBuildService } from './builder-build.service';
import { BuilderPullRequestService } from './builder-pull-request.service';
import { BuilderSessionService } from './builder-session.service';
import { BuilderInterviewOrchestratorService } from './builder-interview-orchestrator.service';
import { BuilderMessageRole, BuilderSessionStatus } from '../enum/builder.enum';
import {
  AnswerBuilderDecisionDto,
  CreateBuilderMessageDto,
} from '../dto/builder.dto';
import {
  BUILDER_DECISION_CATEGORY,
  BuilderDecision,
  BuilderDecisionAnswerResult,
  BuilderDecisionKind,
  buildDecisionId,
  parseDecisionId,
} from '../type/builder-decision.type';
import { BuilderQuestionEvent } from '../type/builder-sse.type';
import { BuilderPrdDocument } from '../type/builder-prd.type';
import {
  BuilderSituationBrief,
  storedSituationBrief,
} from '../util/builder-situation-brief.util';
import {
  computeDesignReadiness,
  productHashOf,
} from '../util/builder-technical-design.util';
import {
  BUILDER_TURN_LOCK_PREFIX,
  BUILDER_TURN_LOCK_TTL_SECONDS,
} from '../constants/builder.constants';

/** How much of a long PRD summary or error a card shows before cutting it. */
const CONTEXT_CLIP = 280;

/** The two preset raises, in dollars of headroom over the current ceiling. */
const BUDGET_RAISE_STEPS = [10, 25] as const;

const clip = (text: string | null | undefined, max = CONTEXT_CLIP): string => {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

const money = (value: number): string => `$${value.toFixed(2)}`;

/**
 * Everything a Builder session is waiting on a person for, as one list.
 *
 * Read `builder-decision.type.ts` first for what a decision is and why none
 * of this is stored. This service does two things: it *derives* the pending
 * decisions from session, transcript and pull-request state, and it *routes*
 * an answer back to whichever service call the session page would have made
 * for the same click. It never implements an action of its own — a decision
 * answered here and the same decision answered on the session page must do
 * exactly the same thing, or the feed becomes a second, subtly different
 * Builder.
 */
@Injectable()
export class BuilderDecisionService {
  private readonly logger = LoggerService.getInstance(
    BuilderDecisionService.name,
  );

  constructor(
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly prdService: BuilderPrdService,
    private readonly buildService: BuilderBuildService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly sessionService: BuilderSessionService,
    private readonly orchestrator: BuilderInterviewOrchestratorService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Every pending decision across every non-archived session, oldest wait
   * first. Ordering by kind is the client's call — it knows which sitting
   * this is — so the server only promises a stable, oldest-first list.
   */
  async listPending(): Promise<BuilderDecision[]> {
    const sessions = await this.sessionRepository.find({
      where: { archivedAt: IsNull() },
      order: { updatedAt: 'ASC' },
    });
    if (!sessions.length) return [];

    const [names, pullRequests] = await Promise.all([
      this.sessionRepository.findCreatorNames(
        sessions.map((session) => session.createdBy),
      ),
      this.pullRequestRepository.find({
        where: { sessionId: In(sessions.map((session) => session.id)) },
      }),
    ]);
    const pullRequestsBySession = new Map<string, BuilderPullRequest[]>();
    for (const pullRequest of pullRequests) {
      const list = pullRequestsBySession.get(pullRequest.sessionId) ?? [];
      list.push(pullRequest);
      pullRequestsBySession.set(pullRequest.sessionId, list);
    }

    const decisions: BuilderDecision[] = [];
    for (const session of sessions) {
      const createdByName = names.get(session.createdBy) ?? null;
      try {
        decisions.push(
          ...(await this.decisionsForSession(
            session,
            createdByName,
            pullRequestsBySession.get(session.id) ?? [],
          )),
        );
      } catch (error) {
        // One session's bad row must not empty the whole feed.
        this.logger.warn(
          `Could not derive decisions for Builder session ${session.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return decisions.sort(
      (a, b) =>
        new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime(),
    );
  }

  /**
   * Route an answer to the service call the session page makes for the same
   * click. The decision is re-derived first: a question answered on the
   * session page a minute ago is no longer anyone's to answer, and the feed
   * says so rather than appending a second answer to the transcript.
   */
  async answer(
    decisionId: string,
    dto: AnswerBuilderDecisionDto,
    userId: number,
  ): Promise<BuilderDecisionAnswerResult> {
    const parsed = parseDecisionId(decisionId);
    if (!parsed) {
      throw new BadRequestException(`"${decisionId}" is not a decision id.`);
    }
    const session = await this.sessionService.getSession(parsed.sessionId);
    const picked = dto.selectedOptionIds ?? [];
    const custom = (dto.customValues ?? [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    const words = custom.length
      ? custom.join('\n')
      : String(dto.message ?? '').trim();

    switch (parsed.kind) {
      case 'question': {
        const pending = await this.interviewDecisions(session, null);
        const question = pending.find(
          (entry) => entry.kind === 'question' && entry.ref === parsed.ref,
        )?.question;
        if (!question) {
          throw new ConflictException(
            'That question has already been answered, or Builder has moved on from it.',
          );
        }
        const message = this.renderAnswer(question, dto, words);
        if (!message) {
          throw new BadRequestException('Pick an option or write an answer.');
        }
        await this.startTurn(
          session.id,
          {
            message,
            questionId: question.id,
            ...(picked.length || custom.length || dto.none
              ? {
                  answer: {
                    ...(picked.length ? { selectedOptionIds: picked } : {}),
                    ...(custom.length ? { customValues: custom } : {}),
                    ...(dto.none ? { none: true } : {}),
                  },
                }
              : {}),
          },
          userId,
        );
        return { ok: true, outcome: 'turn_started' };
      }

      case 'brief': {
        const pending = await this.interviewDecisions(session, null);
        const brief = pending.find(
          (entry) => entry.kind === 'brief' && entry.ref === parsed.ref,
        )?.brief;
        if (!brief) {
          throw new ConflictException(
            'That brief has already been answered, or Builder has moved on from it.',
          );
        }
        // The feed confirms a brief whole. Correcting a line needs the line
        // in front of you, which is the session page's job; the card says so.
        await this.startTurn(
          session.id,
          {
            message: words ? `Confirmed. ${words}` : 'Confirmed.',
            briefResponse: {
              briefId: brief.id,
              lines: brief.lines.map((line) => ({
                id: line.id,
                verdict: 'confirm' as const,
              })),
              ...(words ? { note: words } : {}),
            },
          },
          userId,
        );
        return { ok: true, outcome: 'turn_started' };
      }

      case 'start_build': {
        if (picked.includes('start')) {
          await this.buildService.startBuild(session, userId);
          return { ok: true, outcome: 'build_started' };
        }
        if (picked.includes('design')) {
          await this.buildService.startDesign(session, userId);
          return { ok: true, outcome: 'design_started' };
        }
        if (words) {
          await this.startTurn(session.id, { message: words }, userId);
          return { ok: true, outcome: 'turn_started' };
        }
        throw new BadRequestException(
          'Start the build, draft the design, or say what still needs scoping.',
        );
      }

      case 'design_review': {
        if (picked.includes('approve')) {
          await this.buildService.approveDesign(session, userId);
          return { ok: true, outcome: 'design_approved' };
        }
        if (picked.includes('redraft')) {
          await this.buildService.startDesign(session, userId);
          return { ok: true, outcome: 'design_started' };
        }
        if (words) {
          await this.startTurn(
            session.id,
            { message: `About the technical design: ${words}` },
            userId,
          );
          return { ok: true, outcome: 'turn_started' };
        }
        throw new BadRequestException(
          'Approve the design, redraft it, or say what is wrong with it.',
        );
      }

      case 'budget': {
        const spent = Number(session.totalCostUsd ?? 0);
        const ceiling = Math.max(spent, Number(session.budgetUsd ?? 0));
        if (picked.includes('stop')) {
          await this.sessionService.cancelSession(session.id, userId);
          return { ok: true, outcome: 'cancelled' };
        }
        if (picked.includes('uncap')) {
          await this.buildService.raiseBudget(session, userId, 0);
          return { ok: true, outcome: 'budget_raised' };
        }
        const step = BUDGET_RAISE_STEPS.find((amount) =>
          picked.includes(`raise_${amount}`),
        );
        if (step) {
          await this.buildService.raiseBudget(
            session,
            userId,
            Math.ceil(ceiling + step),
          );
          return { ok: true, outcome: 'budget_raised' };
        }
        const typed = Number(words.replace(/[^0-9.]/g, ''));
        if (words && Number.isFinite(typed) && typed >= 0) {
          await this.buildService.raiseBudget(session, userId, typed);
          return { ok: true, outcome: 'budget_raised' };
        }
        throw new BadRequestException(
          'Pick a raise, type the new ceiling in dollars, or stop the build.',
        );
      }

      case 'pr_needs_human':
      case 'pr_merge': {
        const pullRequestId = parsed.ref;
        if (!pullRequestId) {
          throw new BadRequestException('That decision names no pull request.');
        }
        if (picked.includes('merge')) {
          await this.pullRequestService.mergePullRequest(
            session.id,
            pullRequestId,
            userId,
          );
          return { ok: true, outcome: 'merged' };
        }
        if (picked.includes('resume')) {
          await this.pullRequestService.resumeAutomation(
            session.id,
            pullRequestId,
            userId,
          );
          return { ok: true, outcome: 'resumed' };
        }
        throw new BadRequestException(
          parsed.kind === 'pr_merge'
            ? 'The only thing left to do with this pull request here is merge it.'
            : 'Send the pull request back to Builder, or merge it.',
        );
      }

      case 'build_failed': {
        if (picked.includes('retry')) {
          await this.buildService.startBuild(session, userId);
          return { ok: true, outcome: 'build_started' };
        }
        if (picked.includes('archive')) {
          await this.sessionService.archiveSession(session.id, userId);
          return { ok: true, outcome: 'archived' };
        }
        throw new BadRequestException('Retry the build, or archive it.');
      }

      default:
        throw new BadRequestException(`"${decisionId}" is not a decision id.`);
    }
  }

  /* ── Deriving ──────────────────────────────────────────────────────────── */

  private async decisionsForSession(
    session: BuilderSession,
    createdByName: string | null,
    pullRequests: BuilderPullRequest[],
  ): Promise<BuilderDecision[]> {
    const base = {
      sessionId: session.id,
      sessionTitle: session.title,
      sessionStatus: session.status,
      createdByName,
      repos: session.repos ?? [],
    };
    const decisions: BuilderDecision[] = [];

    const make = (
      kind: BuilderDecisionKind,
      ref: string | null,
      fields: Pick<
        BuilderDecision,
        | 'prompt'
        | 'context'
        | 'blocked'
        | 'selection'
        | 'options'
        | 'allowCustom'
        | 'waitingSince'
      > &
        Partial<BuilderDecision>,
    ): BuilderDecision => ({
      id: buildDecisionId(kind, session.id, ref),
      kind,
      category: BUILDER_DECISION_CATEGORY[kind],
      ...base,
      rationale: null,
      questionType: null,
      allowNone: false,
      minSelections: null,
      pullRequestUrl: null,
      customPlaceholder: null,
      ...fields,
    });

    if (
      session.status === BuilderSessionStatus.INTERVIEWING ||
      session.status === BuilderSessionStatus.PRD_READY
    ) {
      const doc = await this.prdService.getOrCreateDoc(
        session.id,
        session.createdBy,
      );
      const prdContext = this.prdContext(doc.draft);
      const interview = await this.interviewDecisions(session, null);

      for (const pending of interview) {
        if (pending.kind === 'question' && pending.question) {
          const question = pending.question;
          const isSelect = question.kind !== 'freeText';
          decisions.push(
            make('question', question.id, {
              prompt: question.prompt,
              rationale: question.rationale ?? null,
              questionType: question.questionType ?? null,
              context: [
                ...(pending.said ? [`Builder said: ${pending.said}`] : []),
                ...prdContext,
              ],
              blocked: 'Scoping is paused until this is answered.',
              selection:
                question.kind === 'multiSelect' || question.kind === 'dropdown'
                  ? 'multi'
                  : 'single',
              options: isSelect ? (question.options ?? []) : [],
              allowCustom: isSelect ? question.allowCustom !== false : true,
              allowNone: Boolean(question.allowNone),
              minSelections: question.minSelections ?? null,
              customPlaceholder: 'Your own answer…',
              waitingSince: pending.since.toISOString(),
            }),
          );
        } else if (pending.kind === 'brief' && pending.brief) {
          const brief = pending.brief;
          decisions.push(
            make('brief', brief.id, {
              prompt: brief.message || 'What I found before asking anything',
              context: [
                ...brief.lines
                  .slice(0, 8)
                  .map((line) => `${line.id}: ${clip(line.text, 160)}`),
                ...(brief.lines.length > 8
                  ? [`…and ${brief.lines.length - 8} more lines`]
                  : []),
              ],
              blocked:
                'Builder asks nothing until the brief is confirmed. Correcting a line needs the session page.',
              selection: 'single',
              options: [
                {
                  id: 'confirm_all',
                  label: 'Confirm all lines',
                  description: 'Everything Builder found is right; carry on.',
                  recommended: true,
                },
              ],
              allowCustom: true,
              customPlaceholder:
                'Confirm all, and add anything Builder should know…',
              waitingSince: pending.since.toISOString(),
            }),
          );
        }
      }

      if (
        !interview.length &&
        session.status === BuilderSessionStatus.PRD_READY
      ) {
        const design = doc.draft.technicalDesign ?? null;
        const since = design?.draftedAt
          ? new Date(design.draftedAt)
          : session.updatedAt;
        if (design?.status === 'review') {
          const readiness = computeDesignReadiness(doc.draft);
          decisions.push(
            make('design_review', null, {
              prompt: `Approve the technical design for “${session.title}”?`,
              context: [
                ...(design.openDecisions?.length
                  ? [
                      `Open decisions in the design: ${design.openDecisions
                        .slice(0, 3)
                        .map((decision) => clip(decision, 120))
                        .join(' · ')}`,
                    ]
                  : []),
                ...readiness.blockers.map((blocker) => `Blocker: ${blocker}`),
                ...prdContext,
              ],
              blocked: 'The build is held until the design is approved.',
              selection: 'single',
              options: [
                {
                  id: 'approve',
                  label: 'Approve the design',
                  description: readiness.ready
                    ? 'Builds are held to it from here.'
                    : 'Blocked — see the blockers above.',
                  recommended: readiness.ready,
                },
                {
                  id: 'redraft',
                  label: 'Redraft it',
                  description: 'A fresh designer run reads the PRD again.',
                  recommended: !readiness.ready,
                },
              ],
              allowCustom: true,
              customPlaceholder: 'What is wrong with the design…',
              waitingSince: since.toISOString(),
            }),
          );
        } else if (design?.status !== 'drafting') {
          const approvedAndFresh =
            design?.status === 'approved' &&
            productHashOf(doc.draft) === design.productHash;
          decisions.push(
            make('start_build', null, {
              prompt: `“${session.title}” is ready to build.`,
              context: [
                approvedAndFresh
                  ? 'Technical design approved.'
                  : design?.status === 'approved'
                    ? 'The PRD changed after the design was approved — it needs redrafting.'
                    : 'No technical design yet; a build needs an approved one.',
                ...prdContext,
              ],
              blocked: 'Nothing builds until you start it.',
              selection: 'single',
              options: approvedAndFresh
                ? [
                    {
                      id: 'start',
                      label: 'Start the build',
                      description:
                        'Dispatches the build from the approved design.',
                      recommended: true,
                    },
                  ]
                : [
                    {
                      id: 'design',
                      label: 'Draft the technical design',
                      description:
                        'A read-only designer run writes the design for you to approve.',
                      recommended: true,
                    },
                  ],
              allowCustom: true,
              customPlaceholder: 'Or tell Builder what still needs scoping…',
              waitingSince: since.toISOString(),
            }),
          );
        }
      }
    }

    if (
      session.status === BuilderSessionStatus.BUILDING ||
      session.status === BuilderSessionStatus.WAITING_FOR_INPUT
    ) {
      const budget = Number(session.budgetUsd ?? 0);
      const spent = Number(session.totalCostUsd ?? 0);
      if (budget > 0 && spent >= budget) {
        const ceiling = Math.max(spent, budget);
        decisions.push(
          make('budget', null, {
            prompt: `“${session.title}” has spent its ${money(budget)} ceiling.`,
            context: [`Spent ${money(spent)} of ${money(budget)}.`],
            blocked:
              'The run is holding its work until the ceiling is raised or the build is stopped.',
            selection: 'single',
            options: [
              ...BUDGET_RAISE_STEPS.map((step, index) => ({
                id: `raise_${step}`,
                label: `Raise by $${step} (to ${money(Math.ceil(ceiling + step))})`,
                description:
                  index === 0
                    ? 'Roughly one more coding-and-verify round.'
                    : 'Room for a few more rounds.',
                recommended: index === 0,
              })),
              {
                id: 'uncap',
                label: 'Remove the ceiling',
                description: 'No spend limit on this session.',
              },
              {
                id: 'stop',
                label: 'Stop the build',
                description: 'Nothing already written is lost.',
              },
            ],
            allowCustom: true,
            customPlaceholder: 'Or type a new ceiling in dollars…',
            waitingSince: session.updatedAt.toISOString(),
          }),
        );
      }
    }

    if (session.status === BuilderSessionStatus.FAILED) {
      const openPullRequests = pullRequests.filter(
        (pullRequest) => pullRequest.state !== 'closed' || pullRequest.merged,
      );
      decisions.push(
        make('build_failed', null, {
          prompt: `“${session.title}” stopped.`,
          context: [
            ...(session.error ? [clip(session.error)] : []),
            ...(openPullRequests.length
              ? [
                  `${openPullRequests.length} pull request${
                    openPullRequests.length === 1 ? '' : 's'
                  } from this session still open or merged — check them before retrying.`,
                ]
              : []),
          ],
          blocked: 'Nothing happens until you retry or archive it.',
          selection: 'single',
          options: [
            {
              id: 'retry',
              label: 'Retry the build',
              description: 'A new run on the same branches.',
              recommended: !openPullRequests.length,
            },
            {
              id: 'archive',
              label: 'Archive it',
              description: openPullRequests.length
                ? 'The work already shipped as pull requests; this record is done.'
                : 'Not worth another run.',
              recommended: openPullRequests.length > 0,
            },
          ],
          allowCustom: false,
          waitingSince: session.updatedAt.toISOString(),
        }),
      );
    }

    for (const pullRequest of pullRequests) {
      if (pullRequest.merged || pullRequest.state === 'closed') continue;
      const label = `${pullRequest.repo} #${pullRequest.prNumber}`;
      if (pullRequest.needsHumanAt && !pullRequest.escalationResolution) {
        decisions.push(
          make('pr_needs_human', pullRequest.id, {
            prompt: `${label} needs you.`,
            context: [
              ...(pullRequest.needsHumanReason
                ? [pullRequest.needsHumanReason]
                : []),
              ...(pullRequest.title ? [clip(pullRequest.title, 120)] : []),
              `CI: ${pullRequest.ciStatus ?? 'unknown'} · ${pullRequest.fixRunCount} fix round${
                pullRequest.fixRunCount === 1 ? '' : 's'
              } so far.`,
            ],
            blocked: 'Automation has stopped on this pull request.',
            selection: 'single',
            options: [
              {
                id: 'resume',
                label: 'Send it back to Builder',
                description: 'A fresh set of review-and-fix rounds.',
                recommended: true,
              },
              {
                id: 'merge',
                label: 'Merge it as it is',
                description: 'Refused unless every check is green.',
              },
            ],
            allowCustom: false,
            pullRequestUrl: pullRequest.prUrl,
            waitingSince: pullRequest.needsHumanAt.toISOString(),
          }),
        );
        continue;
      }
      if (pullRequest.mergePromptedAt) {
        decisions.push(
          make('pr_merge', pullRequest.id, {
            prompt: `Merge ${label}?`,
            context: [
              ...(pullRequest.title ? [clip(pullRequest.title, 120)] : []),
              'Green, reviewed and approved.',
            ],
            blocked: 'Only the merge is left between this work and production.',
            selection: 'single',
            options: [
              {
                id: 'merge',
                label: 'Merge',
                description:
                  'Checks are read again first; anything red is refused.',
                recommended: true,
              },
            ],
            allowCustom: false,
            pullRequestUrl: pullRequest.prUrl,
            waitingSince: pullRequest.mergePromptedAt.toISOString(),
          }),
        );
      }
    }

    return decisions;
  }

  /**
   * What the interview is waiting on: the last assistant row's unanswered
   * questions, or its unconfirmed situation brief. Only the last row counts —
   * a question from an earlier turn that the admin talked past has been
   * superseded by whatever Builder said next.
   *
   * `messages` may be passed to avoid a second read; null loads them.
   */
  private async interviewDecisions(
    session: BuilderSession,
    messages: BuilderMessage[] | null,
  ): Promise<
    {
      kind: 'question' | 'brief';
      ref: string;
      question?: BuilderQuestionEvent;
      brief?: BuilderSituationBrief;
      /** The assistant's own prose on that row, for the card's context. */
      said: string;
      since: Date;
    }[]
  > {
    if (
      session.status !== BuilderSessionStatus.INTERVIEWING &&
      session.status !== BuilderSessionStatus.PRD_READY
    ) {
      return [];
    }
    const history =
      messages ?? (await this.messageRepository.listBySession(session.id));
    let lastAssistantIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === BuilderMessageRole.ASSISTANT) {
        lastAssistantIndex = index;
        break;
      }
    }
    if (lastAssistantIndex < 0) return [];
    const row = history[lastAssistantIndex];
    // A turn still streaming has not finished asking; a row that died
    // mid-turn asked nothing anyone can answer.
    if (row.metadata?.streaming || row.metadata?.interrupted) return [];

    const later = history.slice(lastAssistantIndex + 1);
    const answeredQuestionIds = new Set(
      later
        .map((message) => message.metadata?.questionId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const answeredBriefIds = new Set(
      later
        .map((message) => message.metadata?.briefResponse?.briefId)
        .filter((id): id is string => typeof id === 'string'),
    );
    const said = clip(row.content, 300);
    const since = row.createdAt ?? session.updatedAt;

    const brief = storedSituationBrief(row.metadata);
    if (brief && !answeredBriefIds.has(brief.id)) {
      return [{ kind: 'brief', ref: brief.id, brief, said, since }];
    }

    const questions: BuilderQuestionEvent[] = Array.isArray(
      row.metadata?.questions,
    )
      ? row.metadata!.questions
      : [];
    return questions
      .filter(
        (question) =>
          question &&
          typeof question.id === 'string' &&
          !answeredQuestionIds.has(question.id),
      )
      .map((question) => ({
        kind: 'question' as const,
        ref: question.id,
        question,
        said,
        since,
      }));
  }

  private prdContext(draft: BuilderPrdDocument | null | undefined): string[] {
    if (!draft) return [];
    const lines: string[] = [];
    if (draft.summary) lines.push(`PRD: ${clip(draft.summary)}`);
    else if (draft.problem) lines.push(`Problem: ${clip(draft.problem)}`);
    return lines;
  }

  /**
   * The answer as the admin's message — the labels of what they picked, in
   * the words the card showed, so the transcript reads the same from the feed
   * as it does from the session page.
   */
  private renderAnswer(
    question: BuilderQuestionEvent,
    dto: AnswerBuilderDecisionDto,
    words: string,
  ): string {
    if (dto.none) return 'None of these';
    const labels = (dto.selectedOptionIds ?? []).map(
      (id) =>
        (question.options ?? []).find((option) => option.id === id)?.label ??
        id,
    );
    const parts = [...labels, ...(words ? [words] : [])];
    if (parts.length) return parts.join(', ');
    return String(dto.message ?? '').trim();
  }

  /* ── Answering an interview question without watching it ─────────────── */

  /**
   * Run one interview turn to completion in the background.
   *
   * The session page streams a turn over SSE and the admin watches the tokens
   * arrive. The feed does the opposite on purpose: the point of a feed is to
   * move to the next card the moment this one is answered, and Builder's
   * follow-up — if there is one — comes back into the feed as a new card when
   * the turn ends. The turn still holds the same per-session lock the stream
   * does, so the two surfaces cannot interleave over one transcript.
   */
  private async startTurn(
    sessionId: string,
    dto: CreateBuilderMessageDto,
    userId: number,
  ): Promise<void> {
    const lockKey = `${BUILDER_TURN_LOCK_PREFIX}:${sessionId}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      BUILDER_TURN_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      throw new ConflictException(
        'Builder is still working on this session. Try again in a moment.',
      );
    }

    const drain = async () => {
      try {
        const frames = this.orchestrator.streamTurn(sessionId, dto, userId);
        for await (const frame of frames) {
          if (frame.event === 'error') {
            this.logger.warn(
              `Builder decision turn for session ${sessionId} reported: ${
                frame.data?.message ?? 'error'
              }`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Builder decision turn failed for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        try {
          await this.redisService.releaseLock(lockKey);
        } catch (error) {
          this.logger.warn(
            `Failed to release Builder turn lock for session ${sessionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    };
    // Deliberately not awaited: the answer is recorded by the orchestrator's
    // first step (the user row), and the caller gets a 2xx the moment the
    // turn is under way.
    void drain();
  }
}
