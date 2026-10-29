import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { loadPromptTemplate } from 'src/common/util/prompt-template.util';
import {
  BUILDER_SESSION_ASK_SYSTEM,
  BUILDER_WORK_ASK_SYSTEM,
  renderPrompt,
} from 'src/prompt/contracts';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderHistoryEntry } from '../entity/builder-history.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import {
  BuilderBuildRunRepository,
  BuilderPullRequestRepository,
} from '../repository/builder-build.repository';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderBuildService } from './builder-build.service';
import { BuilderDecisionService } from './builder-decision.service';
import {
  BuilderHistoryRepository,
  BuilderHistoryService,
} from './builder-history.service';
import { BuilderRulesService } from './builder-rules.service';
import { BuilderRuleContextService } from './builder-rule-context.service';
import { BuilderNowService } from './builder-now.service';
import { BuilderLiveService } from './builder-live.service';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderSessionStatus,
} from '../enum/builder.enum';
import { renderPrd } from '../constants/builder-build-prompt';
import { BUILDER_AI_TASKS } from '../constants/builder.constants';
import { parseJsonObject } from '../util/builder-json.util';

export interface BuilderAskAnswer {
  historyId: string | null;
  answer: string;
  basedOn: string[];
  /** When the honest answer is "change something": the instruction to send. */
  suggestedInstruction: string | null;
}

export type BuilderTellRoute =
  /** Sent to the interview now, as the admin's message. */
  | 'interview'
  /** Queued in History; the next run (or fix round) reads it. */
  | 'queued'
  /** The active run was stopped and restarted with it. */
  | 'applied_now';

export interface BuilderTellResult {
  historyId: string | null;
  route: BuilderTellRoute;
  /** What the person is told happened, in one sentence. */
  message: string;
}

const CONTEXT_CLIP = 14_000;
const ASK_MAX = 2000;

const clip = (text: string | null | undefined, max: number): string => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * Ask and Tell: the person's two verbs to a session.
 *
 * **Ask** changes nothing. It takes no turn lock, writes no transcript and
 * calls no tool; it answers from what the session already holds, and the
 * answer goes to History so it can be found again.
 *
 * **Tell** changes the work, routed by where the session is: into the
 * interview now, or queued in the person's own lane until the next run reads
 * it — never mixed into automated follow-ups, and never applied silently to a
 * run already in flight (that is the explicit, costed "Apply now").
 */
@Injectable()
export class BuilderAskService {
  private readonly logger = LoggerService.getInstance(BuilderAskService.name);

  constructor(
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly pullRequestRepository: BuilderPullRequestRepository,
    private readonly prdService: BuilderPrdService,
    private readonly buildService: BuilderBuildService,
    private readonly decisionService: BuilderDecisionService,
    private readonly historyService: BuilderHistoryService,
    private readonly historyRepository: BuilderHistoryRepository,
    private readonly rulesService: BuilderRulesService,
    private readonly ruleContext: BuilderRuleContextService,
    private readonly nowService: BuilderNowService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly prompts: PromptSharedService,
    @Optional() private readonly liveService?: BuilderLiveService,
  ) {}

  /* ── Ask ───────────────────────────────────────────────────────────────── */

  async ask(
    sessionId: string,
    question: string,
    userId: number,
  ): Promise<BuilderAskAnswer> {
    const text = String(question ?? '').trim();
    if (!text) throw new BadRequestException('Ask a question first.');
    const session = await this.findSession(sessionId);
    const context = await this.sessionContext(session);

    const template = await loadPromptTemplate(
      this.prompts,
      BUILDER_SESSION_ASK_SYSTEM.code,
    );
    const result = await this.llmCompletion.complete({
      taskId: BUILDER_AI_TASKS.SESSION_ASK,
      task: LlmTask.BUILDER_SESSION_ASK,
      promptCode: BUILDER_SESSION_ASK_SYSTEM.code,
      system: renderPrompt(BUILDER_SESSION_ASK_SYSTEM, template, {}),
      prompt: `${context}\n\n## The admin asks\n${clip(text, ASK_MAX)}`,
      maxTokens: 1200,
      usageMetadata: { sessionId },
    });
    const parsed = parseJsonObject<{
      answer?: string;
      basedOn?: string[];
      suggestedInstruction?: string | null;
    }>(result.text);
    const answer = String(parsed?.answer ?? result.text ?? '').trim();
    const basedOn = Array.isArray(parsed?.basedOn)
      ? parsed!.basedOn.map(String).slice(0, 6)
      : [];
    const suggestion =
      String(parsed?.suggestedInstruction ?? '').trim() || null;

    const row = await this.historyService.record({
      entryType: 'ask',
      sessionId: session.id,
      sessionTitle: session.title.slice(0, 200),
      prompt: clip(text, ASK_MAX),
      answerText: answer,
      chosenLabel: suggestion,
      surface: 'now',
      actorUserId: userId,
      decidedAt: new Date(),
    });
    return {
      historyId: row?.id ?? null,
      answer,
      basedOn,
      suggestedInstruction: suggestion,
    };
  }

  /** ⌘K → Ask about all work: one read-only answer over everything in progress. */
  async askAll(question: string, userId: number): Promise<BuilderAskAnswer> {
    const text = String(question ?? '').trim();
    if (!text) throw new BadRequestException('Ask a question first.');
    const [now, rules, recent] = await Promise.all([
      this.nowService.now(),
      this.rulesService.list(),
      this.historyRepository.find({
        where: { undoneAt: IsNull() },
        order: { decidedAt: 'DESC' },
        take: 40,
      }),
    ]);
    const context = [
      '## In progress',
      now.sessions.length
        ? now.sessions
            .map(
              (s) =>
                `- ${s.code ?? s.id.slice(0, 8)} "${clip(s.title, 100)}": ${s.waitingOn} · ${s.nowLine}`,
            )
            .join('\n')
        : '(nothing)',
      `In progress ${now.inProgress} of a limit of ${now.limit}.`,
      '## Waiting on the admin',
      now.decisions.length
        ? now.decisions
            .map((d) => `- ${clip(d.sessionTitle, 60)}: ${clip(d.prompt, 160)}`)
            .join('\n')
        : '(nothing)',
      "## The admin's rules",
      rules.filter((r) => r.active).length
        ? rules
            .filter((r) => r.active)
            .map((r) => `- [${r.area}] ${r.statement}`)
            .join('\n')
        : '(none)',
      '## Recent history',
      recent.length ? recent.map(historyLine).join('\n') : '(none)',
    ].join('\n');

    const template = await loadPromptTemplate(
      this.prompts,
      BUILDER_WORK_ASK_SYSTEM.code,
    );
    const result = await this.llmCompletion.complete({
      taskId: BUILDER_AI_TASKS.WORK_ASK,
      task: LlmTask.BUILDER_WORK_ASK,
      promptCode: BUILDER_WORK_ASK_SYSTEM.code,
      system: renderPrompt(BUILDER_WORK_ASK_SYSTEM, template, {}),
      prompt: `${clip(context, CONTEXT_CLIP)}\n\n## The admin asks\n${clip(text, ASK_MAX)}`,
      maxTokens: 1200,
    });
    const parsed = parseJsonObject<{ answer?: string; basedOn?: string[] }>(
      result.text,
    );
    const answer = String(parsed?.answer ?? result.text ?? '').trim();
    const row = await this.historyService.record({
      entryType: 'ask',
      sessionId: null,
      sessionTitle: 'All work',
      prompt: clip(text, ASK_MAX),
      answerText: answer,
      surface: 'now',
      actorUserId: userId,
      decidedAt: new Date(),
    });
    return {
      historyId: row?.id ?? null,
      answer,
      basedOn: Array.isArray(parsed?.basedOn)
        ? parsed!.basedOn.map(String).slice(0, 6)
        : [],
      suggestedInstruction: null,
    };
  }

  /** A session's asks and tells, oldest first, for the Session panel's thread. */
  async thread(sessionId: string): Promise<BuilderHistoryEntry[]> {
    return this.historyRepository.find({
      where: { sessionId, entryType: In(['ask', 'tell']) },
      order: { decidedAt: 'ASC' },
      take: 100,
    });
  }

  /* ── Tell ──────────────────────────────────────────────────────────────── */

  async tell(
    sessionId: string,
    instruction: string,
    applyNow: boolean,
    userId: number,
  ): Promise<BuilderTellResult> {
    const text = String(instruction ?? '').trim();
    if (!text) throw new BadRequestException('Write the instruction first.');
    const session = await this.findSession(sessionId);

    const record = (fields: Partial<BuilderHistoryEntry>) =>
      this.historyService.record({
        entryType: 'tell',
        sessionId: session.id,
        sessionTitle: session.title.slice(0, 200),
        prompt: clip(text, 4000),
        surface: 'now',
        actorUserId: userId,
        decidedAt: new Date(),
        ...fields,
      });

    if (
      session.status === BuilderSessionStatus.INTERVIEWING ||
      session.status === BuilderSessionStatus.PRD_READY
    ) {
      // Before a build, the interview is where the work is shaped: the
      // instruction goes in as the admin's own words, now.
      await this.decisionService.startBackgroundTurn(session.id, text, userId);
      const row = await record({
        tellStatus: 'applied',
        appliedAt: new Date(),
      });
      this.liveService?.changed('sessionsChanged');
      return {
        historyId: row?.id ?? null,
        route: 'interview',
        message: 'Sent to the interview.',
      };
    }

    const row = await record({ tellStatus: 'queued' });
    if (!applyNow) {
      this.liveService?.changed('sessionsChanged');
      return {
        historyId: row?.id ?? null,
        route: 'queued',
        message: 'Queued. It applies when the next run starts.',
      };
    }

    // Apply now: stop the run in flight and start again with the instruction
    // in its brief. Costs a run, which is why it is only ever the explicit
    // secondary button.
    const active = await this.runRepository.findOne({
      where: { sessionId: session.id, status: In(BUILDER_RUN_ACTIVE_STATUSES) },
      order: { sequence: 'DESC' },
    });
    try {
      if (active) await this.buildService.cancelRun(active, userId);
      const fresh = await this.findSession(session.id);
      await this.buildService.startBuild(fresh, userId);
      this.liveService?.changed('sessionsChanged');
      return {
        historyId: row?.id ?? null,
        route: 'applied_now',
        message: 'The run restarted with your instruction.',
      };
    } catch (error) {
      this.logger.warn(
        `Apply-now for ${session.id} could not restart the run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        historyId: row?.id ?? null,
        route: 'queued',
        message:
          "Couldn't restart the run, so it's queued for the next one. Restart it from the session page if it can't wait.",
      };
    }
  }

  /**
   * The person's queued instructions for a session's next run, as a brief
   * section, stamped applied to that run. Idempotent per run: a run that
   * fetches its spec twice sees the same instructions both times.
   */
  async tellsForRun(sessionId: string, runId: string | null): Promise<string> {
    try {
      const rows = await this.historyRepository.find({
        where: [
          { sessionId, entryType: 'tell', tellStatus: 'queued' },
          ...(runId
            ? [{ sessionId, entryType: 'tell' as const, appliedRunId: runId }]
            : []),
        ],
        order: { decidedAt: 'ASC' },
      });
      if (!rows.length) return '';
      const queued = rows.filter((row) => row.tellStatus === 'queued');
      if (queued.length) {
        await this.historyRepository.update(
          { id: In(queued.map((row) => row.id)) },
          { tellStatus: 'applied', appliedRunId: runId, appliedAt: new Date() },
        );
        this.liveService?.changed('sessionsChanged');
      }
      return [
        '## You were told',
        'Instructions from the admin since the last run. They outrank the PRD where the two disagree; say in your report how you applied each one.',
        ...rows.map((row) => `- ${row.prompt}`),
      ].join('\n');
    } catch (error) {
      this.logger.warn(
        `Could not read queued instructions for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  async sessionOfPullRequest(pullRequestId: string): Promise<string | null> {
    const row = await this.pullRequestRepository.findOne({
      where: { id: pullRequestId },
    });
    return row?.sessionId ?? null;
  }

  /* ── Grounding ─────────────────────────────────────────────────────────── */

  private async findSession(sessionId: string): Promise<BuilderSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('No such Builder session.');
    return session;
  }

  private async sessionContext(session: BuilderSession): Promise<string> {
    const [doc, messages, runs, pullRequests, history, rules] =
      await Promise.all([
        this.prdService
          .getOrCreateDoc(session.id, session.createdBy)
          .catch(() => null),
        this.messageRepository.listBySession(session.id).catch(() => []),
        this.runRepository
          .find({
            where: { sessionId: session.id },
            order: { sequence: 'DESC' },
            take: 5,
          })
          .catch(() => []),
        this.pullRequestRepository
          .find({ where: { sessionId: session.id } })
          .catch(() => []),
        this.historyRepository
          .find({
            where: { sessionId: session.id, undoneAt: IsNull() },
            order: { decidedAt: 'DESC' },
            take: 15,
          })
          .catch(() => []),
        this.ruleContext.renderRulesBlock(session.id),
      ]);
    const parts = [
      `## Session\n"${session.title}" · status ${session.status}${
        session.currentStage ? ` · stage ${session.currentStage}` : ''
      }`,
      doc?.draft ? `## PRD\n${clip(renderPrd(doc.draft), 5000)}` : '',
      messages.length
        ? `## Latest transcript\n${messages
            .slice(-10)
            .map((m) => `${m.role}: ${clip(m.content, 500)}`)
            .join('\n')}`
        : '',
      runs.length
        ? `## Runs\n${runs
            .map(
              (run) =>
                `- #${run.sequence} ${run.mode} ${run.status}${
                  run.error ? `: ${clip(run.error, 200)}` : ''
                }`,
            )
            .join('\n')}`
        : '',
      pullRequests.length
        ? `## Pull requests\n${pullRequests
            .map(
              (pr) =>
                `- ${pr.repo}#${pr.prNumber} ${pr.merged ? 'merged' : (pr.state ?? 'open')} · CI ${pr.ciStatus ?? 'unknown'}${
                  pr.title ? ` · ${clip(pr.title, 100)}` : ''
                }`,
            )
            .join('\n')}`
        : '',
      history.length
        ? `## What the admin decided, asked and told\n${history
            .map(historyLine)
            .join('\n')}`
        : '',
      rules,
    ];
    return clip(parts.filter(Boolean).join('\n\n'), CONTEXT_CLIP);
  }
}

const historyLine = (row: BuilderHistoryEntry): string => {
  const when = new Date(row.decidedAt).toISOString().slice(0, 10);
  if (row.entryType === 'ask') {
    return `- ${when} asked "${clip(row.prompt, 120)}" → ${clip(row.answerText, 160)}`;
  }
  if (row.entryType === 'tell') {
    return `- ${when} told "${clip(row.prompt, 160)}" (${row.tellStatus ?? 'sent'})`;
  }
  return `- ${when} ${clip(row.sessionTitle, 40)}: ${clip(row.prompt, 120)} → ${clip(
    row.chosenLabel ?? row.customText,
    80,
  )}`;
};
