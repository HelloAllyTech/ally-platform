import { CourseCopilotExampleCourseService } from './course-copilot-example-course.service';
import { CourseCopilotDesignGuidanceService } from './course-copilot-design-guidance.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { applyJsonPatch, JsonPatchOp } from 'src/common/util/json-patch.util';
import { AppConfigService } from 'src/config/config.service';
import { ClUseCase } from 'src/context-library/enum/context-library.enum';
import { ContextCitationService } from 'src/context-library/service/context-citation.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackService } from 'src/track/service/track.service';
import { TrackStatus } from 'src/track/type/track.type';
import { TRACK_MAX_COMPETENCIES } from 'src/track/constants/track.constant';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotSessionStatus } from '../enum/course-copilot.enum';
import { CourseCopilotSessionRepository } from '../repository/course-copilot.repository';
import { CourseBlueprint } from '../type/course-copilot.type';
import { transferProblems } from '../util/course-pilot-transfer.util';
import {
  lengthProblems,
  lengthWarning,
} from '../util/course-pilot-length.util';
import { CourseCopilotBlueprintResponse } from '../type/course-copilot-api.type';
import {
  blueprintWarnings,
  courseCopilotGameOptions,
  normaliseBlueprint,
  validateBlueprint,
} from '../util/course-blueprint.util';
import {
  BlueprintPlannerReport,
  BlueprintPlannerSpecialist,
} from './specialists/blueprint-planner.specialist';
import { CourseCopilotBriefService } from './course-copilot-brief.service';
import { CourseCopilotCostService } from './course-copilot-cost.service';
import { CourseCopilotSourcesService } from './course-copilot-sources.service';
import { CourseCopilotLibraryService } from './course-copilot-library.service';
import { CourseCopilotStructureService } from './course-copilot-structure.service';

/**
 * The blueprint: the plan the trainer approves before anything is generated.
 *
 * The planner runs once, as a one-shot specialist — not as a second managing
 * agent ("Hierarchical Agent Managers Double Costs Without Quality
 * Gains"). Every change after that — a chat edit through `update_blueprint`,
 * an inline edit in the tree — goes through the same normalise → estimate →
 * validate path, so the tree, the estimate and the approve button can never
 * disagree about what is being approved.
 */
/**
 * The model sees an item's completion rule as `rule` (`compactBlueprint`), so it patches
 * `/sections/2/items/0/rule`; the blueprint keeps it as `completionCriteria`. Read the name it
 * sees, and let `replace` set a rule the item does not have yet (a journal has none).
 */
const RULE_PATH =
  /^(\/sections\/\d+\/items\/\d+\/)(rule|completionCriteria)(?=\/|$)/;

export function blueprintPatchOps(ops: JsonPatchOp[]): JsonPatchOp[] {
  return (ops ?? []).map((op) => {
    const match =
      typeof op?.path === 'string' ? op.path.match(RULE_PATH) : null;
    if (!match) return op;
    const path = op.path.replace(RULE_PATH, '$1completionCriteria');
    const wholeRule = path === `${match[1]}completionCriteria`;
    return {
      ...op,
      path,
      op: op.op === 'replace' && wholeRule ? 'add' : op.op,
    };
  });
}

import {
  BlueprintCriticFinding,
  BlueprintCriticSpecialist,
  criticRepairList,
} from './specialists/blueprint-critic.specialist';
import { repairCompetencyIds } from '../util/course-copilot-competency.util';

/** What the critic did to a plan, kept on the session and shown to the interviewer. */
export interface CoursePilotCriticReport {
  at: string;
  found: BlueprintCriticFinding[];
  repaired: boolean;
  /** Findings on the plan that went out (the repaired one, when kept). */
  remaining: BlueprintCriticFinding[];
}

@Injectable()
export class CourseCopilotBlueprintService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotBlueprintService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly planner: BlueprintPlannerSpecialist,
    private readonly briefService: CourseCopilotBriefService,
    private readonly costService: CourseCopilotCostService,
    private readonly library: CourseCopilotLibraryService,
    private readonly structureService: CourseCopilotStructureService,
    private readonly trackService: TrackService,
    @Optional() private readonly citations?: ContextCitationService,
    @Optional() private readonly sources?: CourseCopilotSourcesService,
    @Optional()
    private readonly designGuidance?: CourseCopilotDesignGuidanceService,
    /** Course Pilot's blueprint critic. Optional: fixtures without it plan as before. */
    @Optional() private readonly critic?: BlueprintCriticSpecialist,
  ) {}

  /** Run the planner and store blueprint v(n+1). Caller has checked readiness. */
  async propose(
    session: CourseCopilotSession,
    notes?: string,
  ): Promise<CourseCopilotBlueprintResponse> {
    const libraryPicks = await this.libraryPicks(session);
    const reference = await this.referenceForPlan(session, notes);
    const guidance = this.designGuidance
      ? await this.designGuidance.referenceWithCodes({
          sessionId: session.id,
          tenantId: session.tenantId,
          brief: session.brief ?? {},
          stage: 'blueprint',
        })
      : { text: '', codes: [] as string[] };
    // The same pick the planner makes (exampleCourseReference), recorded for the build log.
    const example = new CourseCopilotExampleCourseService().closestTo(
      session.brief?.shape?.durationMinutes,
    );
    const plannerInput = {
      sessionId: session.id,
      brief: session.brief ?? {},
      notes,
      libraryPicks,
      games: courseCopilotGameOptions(),
      referenceMaterial: reference?.text ?? null,
      designGuidance: guidance.text || null,
      usageMetadata: { courseCopilotSessionId: session.id },
      checkTransfer: this.configService.courseCopilot.stages,
    };
    const plannerReport = {} as BlueprintPlannerReport;
    const planned = await this.planner.plan(plannerInput, plannerReport);
    if (plannerInput.checkTransfer) {
      // For the Stages tab: what the planner's own check found and whether its repair was kept.
      await this.saveCoursePilotKey(session.id, 'planner', {
        at: new Date().toISOString(),
        ...plannerReport,
        exampleCourse: example?.title ?? null,
        principles: guidance.codes,
      });
    }
    const checked = await this.checkWithCritic(
      session,
      plannerInput,
      planned,
      guidance.text || null,
    );
    const response = await this.store(session, checked.blueprint, {
      status: CourseCopilotSessionStatus.AWAITING_BLUEPRINT,
    });
    return {
      ...response,
      planningContext: {
        exampleCourse: example?.title ?? null,
        principles: guidance.codes,
        ...(checked.report ? { critic: checked.report } : {}),
      },
    };
  }

  /**
   * Only shared competencies may tag a course, and one mistyped id fails course creation, so ids
   * are repaired (a near-miss of one real id) or dropped here, never sent on unchecked. A failed
   * lookup sends them as they are: course creation still checks them.
   */
  private async validCompetencyIds(
    ids: string[],
    sessionId: string,
  ): Promise<string[]> {
    if (!ids.length) return ids;
    try {
      const known = await this.library.listCompetencies(undefined, 100);
      if (!known.length) return ids;
      const repair = repairCompetencyIds(ids, undefined, known);
      if (repair.fixed.length || repair.dropped.length) {
        this.logger.warn(
          `Course Copilot ${sessionId}: competency ids repaired at approval: ` +
            `fixed ${repair.fixed.map((f) => `${f.from}->${f.to}`).join(', ') || 'none'}; ` +
            `dropped ${repair.dropped.join(', ') || 'none'}`,
        );
      }
      return repair.ids;
    } catch {
      return ids;
    }
  }

  /** Writes one key of metadata.coursePilot without touching the rest. */
  private async saveCoursePilotKey(
    sessionId: string,
    key: 'planner' | 'critic',
    value: unknown,
  ): Promise<void> {
    await this.sessionRepository.manager.query(
      `UPDATE "course_copilot_sessions"
          SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
                'coursePilot',
                COALESCE("metadata" -> 'coursePilot', '{}'::jsonb) ||
                  jsonb_build_object($2::text, $3::jsonb))
        WHERE id = $1`,
      [sessionId, key, JSON.stringify(value)],
    );
  }

  /**
   * Course Pilot's critic (COURSE_PILOT_CRITIC): check the plan against the brief before the
   * trainer sees it; on blocking findings, one repair round by the planner, then a second check
   * to see what is left. The repaired plan is kept only if it has no more code problems and no
   * more blocking findings than the first. A critic failure never blocks the plan.
   */
  private async checkWithCritic(
    session: CourseCopilotSession,
    plannerInput: Parameters<BlueprintPlannerSpecialist['plan']>[0],
    planned: CourseBlueprint,
    designGuidance: string | null,
  ): Promise<{
    blueprint: CourseBlueprint;
    report: CoursePilotCriticReport | null;
  }> {
    if (!this.critic || !this.configService.courseCopilot.critic) {
      return { blueprint: planned, report: null };
    }
    const brief = session.brief ?? {};
    const usageMetadata = { courseCopilotSessionId: session.id };
    try {
      const findings = await this.critic.critique({
        brief,
        blueprint: planned,
        designGuidance,
        usageMetadata,
      });
      const blocking = criticRepairList(findings);
      let blueprint = planned;
      let remaining = findings;
      let repaired = false;
      if (blocking.length) {
        const second = await this.planner.repair(plannerInput, blocking);
        // Code problems, transfer and length included: a repair must not undo what the
        // planner's check fixed.
        const codeProblems = (plan: CourseBlueprint) =>
          validateBlueprint(plan, brief).length +
          (plannerInput.checkTransfer
            ? transferProblems(plan, brief).length +
              lengthProblems(plan, brief).length
            : 0);
        if (second && codeProblems(second) <= codeProblems(planned)) {
          const after = await this.critic.critique({
            brief,
            blueprint: second,
            designGuidance,
            usageMetadata,
          });
          const blockingAfter = after.filter(
            (f) => f.severity === 'blocking',
          ).length;
          if (blockingAfter <= blocking.length) {
            blueprint = second;
            remaining = after;
            repaired = true;
          }
        }
      }
      const report: CoursePilotCriticReport = {
        at: new Date().toISOString(),
        found: findings,
        repaired,
        remaining,
      };
      await this.saveCoursePilotKey(session.id, 'critic', report);
      this.logger.info(
        `[COURSE_PILOT] session=${session.id} critic: ${findings.length} findings ` +
          `(${blocking.length} blocking), repaired=${repaired}, left blocking=` +
          remaining.filter((f) => f.severity === 'blocking').length,
      );
      return { blueprint, report };
    } catch (error) {
      this.logger.warn(
        `Course Pilot critic failed for ${session.id}; the plan goes out unchecked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { blueprint: planned, report: null };
    }
  }

  /**
   * The trainer's reference passages that bear on the whole course, so the
   * plan follows the partner's own structure and content. A lookup failure
   * plans without them.
   */
  private async referenceForPlan(
    session: CourseCopilotSession,
    notes?: string,
  ) {
    if (!this.sources) return null;
    const brief = session.brief ?? {};
    const query = [
      brief.seed,
      brief.outcomes?.terminal,
      ...(brief.outcomes?.enabling ?? []),
      brief.audience?.who,
      brief.audience?.applicationContext,
      ...(brief.competencyNames ?? []),
      notes,
    ]
      .filter(Boolean)
      .join(' ');
    try {
      return await this.sources.referenceFor(session.id, query, {
        limit: 10,
        maxChars: 12_000,
      });
    } catch (error) {
      this.logger.warn(
        `Course Copilot ${session.id}: reference lookup for the plan failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** `update_blueprint` from chat: JSON patch over the current blueprint. */
  async applyPatch(
    session: CourseCopilotSession,
    ops: JsonPatchOp[],
  ): Promise<CourseCopilotBlueprintResponse> {
    if (!session.blueprint) {
      throw new BadRequestException(
        'There is no blueprint yet — call propose_blueprint first.',
      );
    }
    this.assertEditable(session);
    const patched = applyJsonPatch<CourseBlueprint>(
      session.blueprint,
      blueprintPatchOps(ops),
    );
    return this.store(session, patched);
  }

  /** `PUT blueprint` from the tree: a whole blueprint, version-checked. */
  async replace(
    session: CourseCopilotSession,
    blueprint: CourseBlueprint,
    version: number,
  ): Promise<CourseCopilotBlueprintResponse> {
    this.assertEditable(session);
    if (Number(version) !== session.blueprintVersion) {
      throw new ConflictException(
        'The blueprint changed while you were editing it (probably from the chat). ' +
          'Your view has been refreshed — make the edit again.',
      );
    }
    return this.store(session, blueprint);
  }

  /** Normalise, estimate, check and present — without storing. */
  async evaluate(
    session: CourseCopilotSession,
    raw: unknown,
  ): Promise<{
    blueprint: CourseBlueprint;
    problems: string[];
    warnings: string[];
  }> {
    const brief = session.brief ?? {};
    const blueprint = normaliseBlueprint(raw, brief);
    blueprint.estimate = this.costService.estimate(blueprint, brief);
    const problems = validateBlueprint(blueprint, brief);
    // Library picks must still be live: a roleplay archived since the
    // interview cannot be referenced by a course.
    problems.push(...(await this.staleLibraryProblems(blueprint)));
    return {
      blueprint,
      problems,
      warnings: [
        ...blueprintWarnings(blueprint, brief),
        // Course Pilot: shown, never blocking — the trainer may approve a plan without it.
        ...(this.configService?.courseCopilot?.stages
          ? [
              ...transferProblems(blueprint, brief),
              ...lengthWarning(blueprint, brief),
            ]
          : []),
      ],
    };
  }

  async response(
    session: CourseCopilotSession,
  ): Promise<CourseCopilotBlueprintResponse | null> {
    if (!session.blueprint) return null;
    const { blueprint, problems } = await this.evaluate(
      session,
      session.blueprint,
    );
    return {
      blueprint,
      version: session.blueprintVersion,
      estimate: blueprint.estimate,
      budget: await this.costService.budget(session),
      problems,
    };
  }

  /**
   * Freeze the blueprint and create the DRAFT course. Returns the session with
   * `trackId` bound; the caller queues the jobs and starts the build.
   */
  async approve(
    session: CourseCopilotSession,
    version: number,
    userId: number,
  ): Promise<CourseCopilotSession> {
    if (session.status !== CourseCopilotSessionStatus.AWAITING_BLUEPRINT) {
      throw new ConflictException(
        'This blueprint has already been approved or is not ready yet.',
      );
    }
    if (!session.blueprint) {
      throw new BadRequestException('There is no blueprint to approve.');
    }
    if (Number(version) !== session.blueprintVersion) {
      throw new ConflictException(
        'The blueprint changed since you last saw it. Review the latest version, then approve.',
      );
    }
    const { blueprint, problems } = await this.evaluate(
      session,
      session.blueprint,
    );
    if (problems.length) {
      throw new BadRequestException(
        `Fix these before building: ${problems.join(' · ')}`,
      );
    }
    const budget = await this.costService.budget(session);
    if (
      budget.remainingUsd !== null &&
      blueprint.estimate.usd > budget.remainingUsd
    ) {
      throw new BadRequestException(
        `This blueprint is estimated at $${blueprint.estimate.usd.toFixed(2)} but ` +
          `only $${budget.remainingUsd.toFixed(2)} of the session budget is left. ` +
          'Raise the budget or make the course smaller.',
      );
    }

    const brief = session.brief ?? {};
    const competencyIds = (
      await this.validCompetencyIds(
        [
          ...new Set([
            ...(blueprint.competencyIds ?? []),
            ...(brief.competencyIds ?? []),
          ]),
        ],
        session.id,
      )
    ).slice(0, TRACK_MAX_COMPETENCIES);
    const coverImageUrl =
      blueprint.cover?.mode === 'library'
        ? (blueprint.cover.imageUrl ?? brief.look?.coverImageUrl)
        : undefined;

    // Claim the transition first: a double-clicked Approve must create one
    // course, not two.
    const claimed = await this.sessionRepository.manager
      .query(
        `UPDATE "course_copilot_sessions" SET "status" = 'BUILDING', "updatedAt" = now()
          WHERE id = $1 AND "status" = 'AWAITING_BLUEPRINT' AND "blueprintVersion" = $2
          RETURNING id`,
        [session.id, session.blueprintVersion],
      )
      .then((result: any) => (Array.isArray(result?.[0]) ? result[0] : result));
    if (!claimed?.length) {
      throw new ConflictException('This blueprint is already being built.');
    }

    let track: { id: string };
    try {
      track = await this.structureService.asOwner(session, () =>
        this.trackService.createTrack({
          title: blueprint.title.slice(0, 200),
          description: blueprint.description,
          status: TrackStatus.DRAFT,
          estimatedDurationMinutes: blueprint.estimatedDurationMinutes,
          ...(competencyIds.length ? { competencyIds } : {}),
          ...(coverImageUrl ? { coverImageUrl } : {}),
        } as any),
      );
    } catch (error) {
      await this.sessionRepository.update(
        { id: session.id },
        { status: CourseCopilotSessionStatus.AWAITING_BLUEPRINT },
      );
      throw error;
    }

    await this.sessionRepository.update(
      { id: session.id },
      {
        trackId: track.id,
        title: blueprint.title.slice(0, 200),
        approvedBlueprint: blueprint as any,
        status: CourseCopilotSessionStatus.BUILDING,
        updatedBy: userId,
      },
    );
    this.logger.info(
      `Course Copilot ${session.id}: blueprint v${session.blueprintVersion} approved → track ${track.id}`,
    );
    return (await this.sessionRepository.findOne({
      where: { id: session.id },
    }))!;
  }

  private async store(
    session: CourseCopilotSession,
    raw: unknown,
    extra: { status?: CourseCopilotSessionStatus } = {},
  ): Promise<CourseCopilotBlueprintResponse> {
    const evaluated = await this.evaluate(session, raw);
    const { problems } = evaluated;
    const blueprint = await this.checkCitations(session, evaluated.blueprint);
    const rows: { blueprintVersion: number }[] =
      await this.sessionRepository.manager
        .query(
          `UPDATE "course_copilot_sessions"
            SET "blueprint" = $2::jsonb,
                "blueprintVersion" = "blueprintVersion" + 1,
                "title" = $3,
                "status" = COALESCE($4, "status"),
                "updatedAt" = now()
          WHERE id = $1
          RETURNING "blueprintVersion"`,
          [
            session.id,
            JSON.stringify(blueprint),
            blueprint.title?.slice(0, 200) || session.title,
            extra.status ?? null,
          ],
        )
        .then((result: any) =>
          Array.isArray(result?.[0]) ? result[0] : result,
        );
    const version = Number(
      rows?.[0]?.blueprintVersion ?? session.blueprintVersion + 1,
    );
    session.blueprint = blueprint;
    session.blueprintVersion = version;
    if (extra.status) session.status = extra.status;
    return {
      blueprint,
      version,
      estimate: blueprint.estimate,
      budget: await this.costService.budget(session),
      problems,
    };
  }

  /**
   * Citation integrity, as Builder's PRD has it: `[LD-…]` principles and `[CC-…]` catalogue items
   * cited in the blueprint that this session was never shown (or that do not exist) are stripped
   * before it is stored, and the rest are checked by a small model in the background — only a
   * pass counts as a verified use of the principle. Never fails or slows the save beyond one
   * query: the model call is off the save path, and any failure keeps the blueprint as written.
   */
  private async checkCitations(
    session: CourseCopilotSession,
    blueprint: CourseBlueprint,
  ): Promise<CourseBlueprint> {
    if (!this.citations) return blueprint;
    try {
      const checked = await this.citations.validate({
        useCase: ClUseCase.COURSE_COPILOT,
        sessionId: session.id,
        text: JSON.stringify(blueprint),
        previousText: JSON.stringify(session.blueprint ?? {}),
      });
      const kept = checked.rejected.length
        ? (JSON.parse(checked.text) as CourseBlueprint)
        : blueprint;
      if (checked.rejected.length) {
        this.logger.info(
          `Course Copilot ${session.id}: removed citations not shown in this session: ${checked.rejected.join(', ')}`,
        );
      }
      if (checked.valid.length) {
        void this.citations
          .verify({
            useCase: ClUseCase.COURSE_COPILOT,
            sessionId: session.id,
            text: checked.text,
            codes: checked.valid,
          })
          .catch(() => undefined);
      }
      return kept;
    } catch (error) {
      this.logger.warn(
        `Course Copilot ${session.id}: citation check skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return blueprint;
    }
  }

  private assertEditable(session: CourseCopilotSession): void {
    if (
      session.status !== CourseCopilotSessionStatus.AWAITING_BLUEPRINT &&
      session.status !== CourseCopilotSessionStatus.INTERVIEWING
    ) {
      throw new ConflictException(
        'The blueprint is frozen once the build starts. Change the course itself instead.',
      );
    }
  }

  private async libraryPicks(session: CourseCopilotSession) {
    const slots = session.brief?.practice ?? [];
    const scenarioIds = slots
      .filter((slot) => slot.source === 'library' && slot.scenarioId)
      .map((slot) => slot.scenarioId!) as number[];
    const scenarios = await this.library.getActiveScenarios(scenarioIds);
    const names = await this.library.competencyNames(
      scenarios.map((s) => s.competencyId ?? '').filter(Boolean),
    );
    const picks: {
      scenarioId?: number;
      caseId?: string;
      title: string;
      competency?: string | null;
      difficulty?: string | null;
    }[] = scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      title: scenario.title ?? `Roleplay ${scenario.id}`,
      competency: scenario.competencyId
        ? (names.get(scenario.competencyId) ?? null)
        : null,
      difficulty: (scenario as any).difficultyLevel ?? null,
    }));
    for (const slot of slots) {
      if (slot.source !== 'library' || !slot.caseId) continue;
      const caseRow = await this.library.getActiveCase(slot.caseId);
      if (caseRow) picks.push({ caseId: caseRow.id, title: caseRow.title });
    }
    return picks;
  }

  private async staleLibraryProblems(
    blueprint: CourseBlueprint,
  ): Promise<string[]> {
    const problems: string[] = [];
    const refs = blueprint.sections.flatMap((section, sectionIndex) =>
      section.items
        .filter((item) => item.source?.kind === 'library')
        .map((item) => ({ item, sectionIndex })),
    );
    const scenarioIds = refs
      .map(({ item }) => (item.source as any).scenarioId)
      .filter(Boolean) as number[];
    const active = new Set(
      (await this.library.getActiveScenarios(scenarioIds)).map((s) => s.id),
    );
    for (const { item, sectionIndex } of refs) {
      const source = item.source as { scenarioId?: number; caseId?: string };
      if (source.scenarioId && !active.has(source.scenarioId)) {
        problems.push(
          `Section ${sectionIndex + 1} · "${item.title}" uses a roleplay that is no longer published — pick another or make a new one.`,
        );
      }
      if (source.caseId && !(await this.library.getActiveCase(source.caseId))) {
        problems.push(
          `Section ${sectionIndex + 1} · "${item.title}" uses a case that is no longer published.`,
        );
      }
    }
    return problems;
  }
}
