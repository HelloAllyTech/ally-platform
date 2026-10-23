import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { AgentMessage } from 'src/llm-agent/type/agent-llm.type';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import {
  GUIDE_TOOL_NAMES,
  GUIDE_TOOLS,
  GUIDE_VISITOR_TOOLS,
  GUIDE_VISITOR_TOOL_NAMES,
  checkPresentable,
} from '../capabilities/guide-tools';
import { GuideTutorService } from '../capabilities/specialists/guide-tutor.service';
import { GuideConductorService } from '../conductor/guide-conductor.service';
import {
  GuidanceDial,
  atmosphereOf,
  decideSteer,
  planFirstWin,
  proseBudget,
} from '../conductor/pacing';
import { renderSituationReport } from '../conductor/situation-report';
import { GUIDE_AI_TASKS } from '../constants/guide-ai-tasks.constants';
import {
  buildCourseSpan,
  buildLearnerMessage,
  buildOrgSpan,
  buildSystemSpans,
  CourseContext,
} from '../context/guide-context';
import { GuideOrgProfile } from '../entity/guide-org-profile.entity';
import { GuideMode } from '../enum/guide.enum';
import { GuideReleaseBundle } from '../release/guide-release.bundle';
import {
  ReleaseGate,
  runOrchestrator,
} from '../runtime/guide-orchestrator.runner';
import { GuideModelService } from '../runtime/guide-model.service';
import {
  GuideIntent,
  GUIDE_MAX_TOOL_PASSES,
  GUIDE_ORCHESTRATOR_MAX_TOKENS,
} from '../runtime/guide-turn.service';
import { DEFAULT_CRISIS_TEXT } from '../safety/fixed-responses';
import { GuideSentinelService } from '../safety/guide-sentinel.service';
import { isLearnerCrisis } from '../safety/sentinel';

export interface PlaygroundInput {
  releaseId: string;
  trackId: string;
  /** An organisation whose Ally layer to use; none means platform defaults. */
  tenantId?: string | null;
  /** Items the imagined learner has completed (0 = just starting). */
  progress?: number;
  mode?: GuideMode;
  guidance?: GuidanceDial;
  channel?: 'text' | 'voice';
  /** Run as an anonymous visitor on the public link. */
  visitor?: boolean;
  /** Earlier turns, as plain text. */
  history?: Array<{ role: 'learner' | 'ally'; text: string }>;
  message: string;
  intent?: GuideIntent | null;
}

export interface PlaygroundToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  simulated: boolean;
}

/**
 * The Ally Console's Playground (plans/ally-guide/plan.md §10.5, §7.4 "the
 * release process never feels like friction"): one turn of any release —
 * a draft included — against a real course, an imagined learner and a
 * scripted conversation. The Sentinel, the orchestrator and the Tutor run
 * for real; everything that would write (cards, memory, notebook, pacing)
 * is a dry run that reports what would have happened. Nothing is stored
 * and no learner is charged; run two releases on the same input to compare.
 */
@Injectable()
export class GuidePlaygroundService {
  constructor(
    private readonly releases: AgentReleaseService,
    private readonly conductor: GuideConductorService,
    private readonly models: GuideModelService,
    private readonly sentinel: GuideSentinelService,
    private readonly tutor: GuideTutorService,
    @InjectRepository(GuideOrgProfile)
    private readonly orgProfiles: Repository<GuideOrgProfile>,
  ) {}

  async run(input: PlaygroundInput) {
    const text = (input.message ?? '').trim();
    if (!text && !input.intent) {
      throw new BadRequestException('A message or an intent is required');
    }
    const startedAt = Date.now();
    const release = await this.releases.getById(input.releaseId);
    const bundle = release.bundle as unknown as GuideReleaseBundle;
    const policy = bundle.policy;
    const visitor = Boolean(input.visitor);
    const course: CourseContext = visitor
      ? await this.conductor.loadPublicCourse(input.trackId)
      : await this.conductor.loadPreviewCourse(
          input.trackId,
          Math.max(0, Math.floor(input.progress ?? 0)),
        );
    const org =
      !visitor && input.tenantId
        ? await this.orgProfiles.findOne({
            where: { tenantId: input.tenantId },
          })
        : null;
    const spans = buildSystemSpans(
      bundle,
      buildOrgSpan(org?.profile ?? null),
      buildCourseSpan(course),
    );
    const history = (input.history ?? []).slice(-20);
    const mode = input.mode ?? GuideMode.NORMAL;
    const guidance = input.guidance ?? 'walk';
    const channel = input.channel ?? 'text';
    const spine = course.spine;
    const pacing = {
      learnerTurns:
        history.filter((turn) => turn.role === 'learner').length + 1,
      offSpineTurns: 0,
    };
    const steer = decideSteer({
      mode,
      pacing,
      spine,
      policy,
      now: Date.now(),
      learnerReady: input.intent === 'start' || input.intent === 'continue',
    });
    const situation = renderSituationReport({
      turn: pacing.learnerTurns,
      mode,
      atmosphere: atmosphereOf({ mode, releaseWindowOpen: false, spine }),
      channel,
      guidance,
      budget: proseBudget(guidance, channel, policy.fade.start.lay, policy),
      steer,
      spine,
      firstWin: planFirstWin(spine, pacing),
      releaseWindowOpen: false,
      overlay: 'none',
      events: [],
      continuePressed: input.intent === 'start' || input.intent === 'continue',
      visitor: visitor
        ? {
            remaining:
              policy.limits.visitorMessagesPerDay - pacing.learnerTurns,
            limit: policy.limits.visitorMessagesPerDay,
          }
        : null,
    });
    const attribution = {
      threadId: null,
      turnId: null,
      userId: null,
      tenantId: null,
      releaseId: release.id,
    };
    let costUsd = 0;
    const onCost = (usd: number) => {
      costUsd += usd;
    };

    // The Sentinel, for real: the Playground is where safety behaviour is
    // checked before a release reaches anyone.
    const sentinel = text
      ? await this.sentinel.assess({
          text,
          recentTurns: history.map((turn) => ({
            role: turn.role,
            text: turn.text,
          })),
          item: null,
          bundle,
          attribution,
        })
      : null;
    if (sentinel && isLearnerCrisis(sentinel)) {
      return {
        release: {
          id: release.id,
          version: release.version,
          status: release.status,
        },
        reply: DEFAULT_CRISIS_TEXT,
        replyKind: 'crisis' as const,
        sentinel,
        situation,
        toolCalls: [] as PlaygroundToolCall[],
        model: null,
        usage: [],
        costUsd: Number(costUsd.toFixed(6)),
        latencyMs: Date.now() - startedAt,
      };
    }

    const messages: AgentMessage[] = [
      ...history.map(
        (turn): AgentMessage => ({
          role: turn.role === 'learner' ? 'user' : 'assistant',
          content: turn.text,
        }),
      ),
      buildLearnerMessage({ text, intent: input.intent ?? null }),
      { role: 'system', content: situation },
    ];
    const gate = new ReleaseGate(async () => undefined);
    await gate.release();
    const toolCalls: PlaygroundToolCall[] = [];
    const tools = visitor ? GUIDE_VISITOR_TOOLS : GUIDE_TOOLS;
    let presented = 0;
    const output = await runOrchestrator({
      system: spans.blocks,
      messages,
      tools,
      maxTokens: GUIDE_ORCHESTRATOR_MAX_TOKENS,
      maxPasses: GUIDE_MAX_TOOL_PASSES,
      signal: new AbortController().signal,
      gate,
      stream: (request) =>
        this.models.stream({
          role: 'orchestrator',
          bundle,
          channel,
          tier: 'premium',
          task: LlmTask.GUIDE_ORCHESTRATOR,
          aiTaskId: GUIDE_AI_TASKS.ORCHESTRATOR,
          attribution,
          request,
          onCost,
        }),
      executeTool: async (name, toolInput) => {
        const call = await this.dryRun(name, toolInput, {
          visitor,
          course,
          bundle,
          mode,
          steer,
          attribution,
          onCost,
          presentedBefore: presented,
        });
        if (name === GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM && !call.isError) {
          presented++;
        }
        toolCalls.push({ name, input: toolInput, ...call });
        return { content: call.result, isError: call.isError };
      },
    });
    const route = this.models.route(bundle, 'orchestrator', channel, 'premium');
    return {
      release: {
        id: release.id,
        version: release.version,
        status: release.status,
      },
      reply: output.text,
      replyKind: output.refusal ? ('refusal' as const) : ('model' as const),
      sentinel,
      situation,
      toolCalls,
      model: route.model,
      usage: output.usage,
      costUsd: Number(costUsd.toFixed(6)),
      latencyMs: Date.now() - startedAt,
    };
  }

  /**
   * A tool, without its side effects. The course rules still apply —
   * presenting a locked item is refused exactly as in a real turn — and the
   * Tutor runs for real, since what it answers is the point of testing.
   */
  private async dryRun(
    name: string,
    input: Record<string, any>,
    ctx: {
      visitor: boolean;
      course: CourseContext;
      bundle: GuideReleaseBundle;
      mode: GuideMode;
      steer: ReturnType<typeof decideSteer>;
      attribution: Record<string, unknown>;
      onCost: (usd: number) => void;
      presentedBefore: number;
    },
  ): Promise<{ result: string; isError: boolean; simulated: boolean }> {
    const ok = (payload: Record<string, unknown>, simulated = true) => ({
      result: JSON.stringify(payload),
      isError: false,
      simulated,
    });
    const fail = (error: string) => ({
      result: JSON.stringify({ error }),
      isError: true,
      simulated: true,
    });
    if (ctx.visitor && !GUIDE_VISITOR_TOOL_NAMES.has(name)) {
      return fail('Not available before the learner signs in.');
    }
    switch (name) {
      case GUIDE_TOOL_NAMES.PRESENT_COURSE_ITEM: {
        const check = checkPresentable({
          spine: ctx.course.spine,
          steer: ctx.steer,
          mode: ctx.mode,
          itemId: String(input.item_id ?? ''),
          reason: input.reason,
          alreadyPresentedThisTurn: ctx.presentedBefore > 0,
        });
        if (!check.ok) return fail(check.error);
        return ok({
          presented: true,
          card: `${check.item.type} "${check.item.title}", about ${check.item.estimatedMinutes} minutes`,
          next: 'The card is on screen. Frame it in one sentence.',
        });
      }
      case GUIDE_TOOL_NAMES.CONSULT_TUTOR: {
        const answer = await this.tutor.consult({
          question: String(input.question ?? ''),
          trackId: ctx.course.spine.trackId,
          spine: ctx.course.spine,
          languageCode: ctx.course.languageCode,
          bundle: ctx.bundle,
          attribution: ctx.attribution as never,
          onCost: ctx.onCost,
        });
        return ok(answer as unknown as Record<string, unknown>, false);
      }
      case GUIDE_TOOL_NAMES.GET_PROGRESS:
        return ok({
          completed: ctx.course.spine.completed,
          total: ctx.course.spine.total,
          next: ctx.course.spine.current?.title ?? null,
        });
      default:
        return ok({ done: true, note: `${name} would run here (dry run).` });
    }
  }
}
