import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentBuilderChainService } from 'src/learn/service/agent-builder-chain.service';
import { ScenarioDifficultyLevel } from 'src/learn/type/scenario.type';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_SCENARIO_CATEGORY,
} from '../constants/course-copilot.constants';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBlueprintSection,
  CourseBrief,
  CourseCopilotRoleplayCard,
} from '../type/course-copilot.type';
import { ROLEPLAY_MODES, RoleplayMode } from '../type/roleplay-brief.type';
import { roleplayDesignForMode } from '../util/roleplay-mode-design.util';
import { CourseCopilotLibraryService } from './course-copilot-library.service';
import { RoleplayBriefSpecialist } from './specialists/roleplay-brief.specialist';
import { RoleplayFitCheckSpecialist } from './specialists/roleplay-fit-check.specialist';
import {
  SpecialistContext,
  SpecialistValidationError,
} from './specialists/specialist.types';

/** What a trainer asks the roleplay agent for, outside any course. */
export interface RoleplayAgentRequest {
  /** Who the learners are: "school teachers new to mental health". */
  learners: string;
  /** What the learner should be able to do by the end of this roleplay. */
  goal: string;
  competencyIds: string[];
  mode: RoleplayMode;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  /** Who the client is and how they behave. Optional: the agent writes one from the goal. */
  clientDescription?: string;
  /** Reuse a Character Library character (checked for fit; swapped or rewritten if it can't carry it). */
  characterId?: string;
  /** Also keep a newly written character in the Character Library. */
  saveCharacter?: boolean;
  languageIds?: string[];
  minScore?: number;
  lengthMinutes?: number;
  triggerWarningIds?: string[];
  /** Anything else the trainer wants the agent to know. */
  notes?: string;
}

export type RoleplayAgentRunStatus = 'running' | 'done' | 'failed';

export type RoleplayAgentStep =
  | 'brief'
  | 'casting'
  | 'building'
  | 'saving'
  | 'done';

export interface RoleplayAgentRun {
  id: string;
  status: RoleplayAgentRunStatus;
  step: RoleplayAgentStep;
  createdBy: string;
  tenantId: string | null;
  request: RoleplayAgentRequest;
  startedAt: string;
  heartbeatAt: string;
  finishedAt?: string;
  error?: string;
  result?: {
    scenarioId: number;
    characterId?: string;
    summary: string;
    card: CourseCopilotRoleplayCard;
    casting?: { note: string };
  };
}

const RUN_KEY = (id: string) => `roleplay-agent:run:${id}`;
/** Runs are kept a week: long enough to come back to, short enough to need no cleanup. */
const RUN_TTL_SECONDS = 7 * 24 * 3600;
/** A run whose heartbeat is this old died with its process (a deploy or restart). */
const RUN_STALE_MS = 10 * 60 * 1000;
const DEFAULT_MINUTES = 6;

/** Difficulty as the task class the brief writer reads (the manual's openness × concerns). */
const TASK_CLASS_BY_DIFFICULTY = {
  EASY: 'cooperative client, one concern',
  MEDIUM: 'ambivalent client, one concern',
  HARD: 'distressed client, several concerns',
} as const;
const MAX_TEXT = 1500;

const clean = (value: unknown, max = MAX_TEXT): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

/**
 * The roleplay agent on its own: one roleplay from a trainer's short request, with the same
 * steps Course Copilot runs for a new roleplay in a course — the structured brief, the casting
 * fit check, states and supports for the mode, the validator — and nothing course-shaped around
 * it. The request is laid out as a one-item course so the brief writer reads it exactly as it
 * reads a Copilot slot (one prompt, one behaviour to keep right).
 *
 * A build takes minutes, so it runs in the background and its progress lives in Redis; the
 * caller polls. A run lost to a restart reads as failed, never as forever running.
 */
@Injectable()
export class RoleplayAgentService {
  private readonly logger = LoggerService.getInstance(
    RoleplayAgentService.name,
  );

  constructor(
    private readonly redis: RedisService,
    private readonly library: CourseCopilotLibraryService,
    private readonly roleplayBrief: RoleplayBriefSpecialist,
    private readonly fitCheck: RoleplayFitCheckSpecialist,
    private readonly chain: AgentBuilderChainService,
  ) {}

  /** What the request form offers: modes, competencies, languages and trigger warnings. */
  async options() {
    const [competencies, languages, triggerWarnings] = await Promise.all([
      this.library.listCompetencies(undefined, 100),
      this.library.listLanguages(),
      this.library.listTriggerWarnings(),
    ]);
    return {
      modes: ROLEPLAY_MODES,
      competencies,
      languages: languages.filter((l) => l.voiceCount > 0),
      triggerWarnings,
      limits: { languages: COURSE_COPILOT_LIMITS.languagesPerRoleplay },
    };
  }

  async start(
    user: { id: string | number; tenantId?: string | null },
    request: RoleplayAgentRequest,
  ): Promise<RoleplayAgentRun> {
    if (!ROLEPLAY_MODES.includes(request.mode)) {
      throw new BadRequestException(`Unknown mode "${request.mode}".`);
    }
    if (!request.competencyIds?.length) {
      throw new BadRequestException('Pick at least one competency.');
    }
    const now = new Date().toISOString();
    const run: RoleplayAgentRun = {
      id: randomUUID(),
      status: 'running',
      step: 'brief',
      createdBy: String(user.id),
      tenantId: user.tenantId ?? null,
      request,
      startedAt: now,
      heartbeatAt: now,
    };
    await this.save(run);
    // Fire and forget: the run records its own outcome.
    void this.execute(run).catch(() => undefined);
    return run;
  }

  /** One run, only for the trainer who started it. */
  async get(runId: string, userId: string): Promise<RoleplayAgentRun> {
    const raw = await this.redis.get(RUN_KEY(runId));
    const run = raw ? (JSON.parse(raw) as RoleplayAgentRun) : null;
    if (!run || run.createdBy !== String(userId)) {
      throw new NotFoundException('No such roleplay agent run.');
    }
    if (
      run.status === 'running' &&
      Date.now() - Date.parse(run.heartbeatAt) > RUN_STALE_MS
    ) {
      return {
        ...run,
        status: 'failed',
        error:
          'The build stopped (the server restarted while it ran). Start it again; nothing was saved.',
      };
    }
    return run;
  }

  /** Runs the steps; exported for tests through `start`. */
  async execute(run: RoleplayAgentRun): Promise<void> {
    const usageMetadata = { roleplayAgentRunId: run.id };
    try {
      await this.asOwner(run, async () => {
        const request = run.request;
        const names = await this.library.competencyNames(request.competencyIds);
        const behaviours = await this.library
          .getBehaviours(request.competencyIds)
          .catch(() => ({ helpful: [], unhelpful: [], unknownIds: [] }));
        const context = this.contextFor(run, {
          competencyNames: request.competencyIds
            .map((id) => names.get(id))
            .filter((n): n is string => Boolean(n)),
          behaviours,
          usageMetadata,
        });

        await this.step(run, 'brief');
        const actor = await this.writeBrief(context);

        await this.step(run, 'casting');
        const casting = await this.fitCheck.cast(actor.structured, {
          sessionId: run.id,
          tenantId: run.tenantId,
          competencyIds: request.competencyIds,
          usageMetadata,
        });
        const newCharacter = Boolean(
          casting.fitCheck && !casting.fitCheck.fits && !casting.swapped,
        );
        const statePrompt = await this.library
          .stateAwareMainPrompt()
          .catch(() => null);
        const design = roleplayDesignForMode(
          actor.structured.mode,
          statePrompt,
        );

        await this.step(run, 'building');
        const created = await this.chain.buildScenarioFromBrief(
          {
            actorDescription: actor.actorDescription,
            agentTestCases: actor.agentTestCases,
            competencyId: request.competencyIds[0],
            competencyIds: request.competencyIds,
            competencyName: context.brief.competencyNames?.[0],
            languageIds: (request.languageIds ?? [])
              .map(String)
              .slice(0, COURSE_COPILOT_LIMITS.languagesPerRoleplay),
            personaGender: actor.personaGender,
            personaAge: actor.personaAge,
            difficultyLevel:
              (actor.difficultyLevel as ScenarioDifficultyLevel) ?? undefined,
            triggerWarningIds: request.triggerWarningIds,
            titleHint: actor.title ?? context.item.title,
            characterId: newCharacter ? undefined : casting.characterId,
            saveCharacter: newCharacter || request.saveCharacter === true,
            category: COURSE_COPILOT_SCENARIO_CATEGORY,
            design,
            provenance:
              `Generated by the roleplay agent (${actor.structured.mode}) for: ` +
              `${clean(request.goal, 300)}. Brief:\n${actor.actorDescription}`,
          } as any,
          {
            userId: Number(run.createdBy),
            tenantId: run.tenantId,
            usageMetadata,
          },
        );

        await this.step(run, 'saving');
        const castingNote = casting.swapped
          ? `Used ${casting.swapped.toName} instead of ${casting.swapped.fromName}: ${casting.swapped.reason}`
          : newCharacter
            ? `Wrote a new character: the chosen one didn't fit (${casting.fitCheck!.reason})`
            : undefined;
        run.status = 'done';
        run.step = 'done';
        run.finishedAt = new Date().toISOString();
        run.result = {
          scenarioId: created.scenarioId,
          ...(created.characterId ? { characterId: created.characterId } : {}),
          summary: created.summary || `Created roleplay "${created.title}"`,
          card: {
            title: created.title,
            mode: actor.structured.mode,
            learnerGoal: actor.structured.learnerGoal ?? null,
            setting: actor.structured.setting ?? null,
            states: (created.states ?? []).map((state) => state.name),
            supports: {
              experienceMode: design.settings?.experienceMode ?? null,
              reminders: Boolean(design.settings?.remindersEnabled),
              stateVisible: Boolean(design.settings?.currentState),
              supervisorNotes: Boolean(design.settings?.supervisorNotesEnabled),
            },
            checks: created.checks ?? [],
          },
          ...(castingNote ? { casting: { note: castingNote } } : {}),
        };
        await this.save(run);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Roleplay agent run ${run.id} failed: ${message}`);
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      run.error = message.slice(0, 500);
      await this.save(run).catch(() => undefined);
    }
  }

  /** The brief, with the one repair pass a Copilot job gets when the model's answer is invalid. */
  private async writeBrief(context: SpecialistContext) {
    try {
      return await this.roleplayBrief.write(context);
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      return this.roleplayBrief.write({
        ...context,
        repairErrors: error.errors,
      });
    }
  }

  /**
   * The request as a one-item course: the brief writer reads the audience, outcome, behaviours
   * and the slot's spec exactly as it would for a Copilot course.
   */
  contextFor(
    run: RoleplayAgentRun,
    extra: {
      competencyNames: string[];
      behaviours: { helpful: string[]; unhelpful: string[] };
      usageMetadata: Record<string, any>;
    },
  ): SpecialistContext {
    const request = run.request;
    const goal = clean(request.goal, 400);
    const brief: CourseBrief = {
      audience: { who: clean(request.learners, 300) },
      outcomes: { terminal: goal, enabling: [goal] },
      competencyIds: request.competencyIds,
      competencyNames: extra.competencyNames,
      behaviours: extra.behaviours,
      notes: request.notes ? [clean(request.notes, 800)] : [],
    } as CourseBrief;
    const minutes = Number(request.lengthMinutes);
    const minScore = Number(request.minScore);
    const item: CourseBlueprintItem = {
      id: `roleplay-agent-${run.id}`,
      type: 'ROLEPLAY',
      title: goal.slice(0, 90) || 'Roleplay',
      purpose: goal,
      objectiveRefs: [0],
      estimatedMinutes:
        Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MINUTES,
      ...(Number.isFinite(minScore) && minScore > 0
        ? { completionCriteria: { minScore } }
        : {}),
      source: { kind: 'new' },
      spec: {
        mode: request.mode,
        ...(request.difficulty && TASK_CLASS_BY_DIFFICULTY[request.difficulty]
          ? { taskClass: TASK_CLASS_BY_DIFFICULTY[request.difficulty] }
          : {}),
        ...(request.clientDescription
          ? { personaBrief: clean(request.clientDescription) }
          : {}),
        ...(request.characterId ? { characterId: request.characterId } : {}),
        ...(request.triggerWarningIds?.length
          ? { triggerWarningIds: request.triggerWarningIds }
          : {}),
      },
    } as unknown as CourseBlueprintItem;
    const section: CourseBlueprintSection = {
      id: 'roleplay-agent',
      title: 'Roleplay',
      description: '',
      purpose: goal,
      items: [item],
    };
    const blueprint = {
      title: goal.slice(0, 90) || 'Roleplay',
      sections: [section],
    } as unknown as CourseBlueprint;
    return {
      sessionId: run.id,
      brief,
      blueprint,
      section,
      item,
      usageMetadata: extra.usageMetadata,
    };
  }

  private async step(run: RoleplayAgentRun, step: RoleplayAgentStep) {
    run.step = step;
    await this.save(run);
  }

  private async save(run: RoleplayAgentRun) {
    run.heartbeatAt = new Date().toISOString();
    await this.redis.set(RUN_KEY(run.id), JSON.stringify(run), RUN_TTL_SECONDS);
  }

  /** The build reads the user from the execution context (library, scenarios, characters). */
  private asOwner<T>(run: RoleplayAgentRun, fn: () => Promise<T>): Promise<T> {
    return ExecutionManager.runWithContext(() => {
      ExecutionManager.setAuthContext(run.createdBy, run.tenantId ?? '');
      return fn();
    });
  }
}
