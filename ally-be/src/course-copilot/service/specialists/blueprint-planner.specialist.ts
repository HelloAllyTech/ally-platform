import { Injectable, Logger } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_DEFAULT_ITEM_MINUTES,
  COURSE_COPILOT_DEFAULT_DURATION_MINUTES,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBlueprint } from '../../type/course-copilot.type';
import {
  normaliseBlueprint,
  validateBlueprint,
} from '../../util/course-blueprint.util';
import {
  transferProblems,
  transferRequirements,
} from '../../util/course-pilot-transfer.util';
import { lengthProblems } from '../../util/course-pilot-length.util';
import { SpecialistLlmService } from './specialist-llm.service';
import { learnerProfileReference } from '../course-copilot-learner-profile.service';
import { exampleCourseReference } from '../course-copilot-example-course.service';
import {
  BlueprintPlannerInput,
  SpecialistValidationError,
} from './specialist.types';
import { briefForPrompt, SPECIALIST_MAX_TOKENS } from './specialist.util';

/**
 * Drafts the course blueprint from the interview brief: one specialist call
 * with its own narrow prompt, not a second manager LLM (plan §2.4).
 *
 * The sequencing rules live in `blueprint_planner.txt`:
 * - "Write Assessments First, Then Derive Objectives" — the brief's
 *   assessment is the capstone, placed last, and everything builds to it.
 * - "Organize Training via Task Classes from Simple to Complex" and "Define
 *   Task Classes via Simplifying Conditions Variation" — sections are whole
 *   versions of the task, each varying ONE simplifying condition.
 * - "Completion Strategy: Sequencing from Worked Examples to Independent
 *   Problems" — an annotated transcript precedes the first roleplay on the
 *   same behaviours, and later sections fade that support.
 * - "Four interrelated components of training blueprints" — supportive
 *   information (article / video) precedes the practice that needs it; no
 *   part-task drills in v1.
 * - "After-Action Review Deepens Reflection in Interactive Learning" — a
 *   journal follows every practice block.
 * - Games only as breaks, never last.
 *
 * Output is normalised in code (`normaliseBlueprint`). When the result still
 * has problems the planner could have avoided — limits, a case with one
 * roleplay, ending on a game — it gets ONE repair call with those problems,
 * and whichever attempt has fewer problems is returned; what remains is the
 * trainer's to resolve in the tree. Videos waiting for a link are warnings,
 * not problems, so they never trigger a repair.
 */
/** What the planner's own check found and did, kept on the session for the Stages tab. */
export interface BlueprintPlannerReport {
  /** Problems code found on the first plan (limits, transfer, length). */
  firstProblems: string[];
  /** Whether a repair call was made, and whether its plan was kept. */
  repairTried: boolean;
  repairKept: boolean;
  /** Why the repair was not kept, when it was not. */
  repairNote?: string;
  /** Problems on the plan that went out. */
  remaining: string[];
}

@Injectable()
export class BlueprintPlannerSpecialist {
  private readonly logger = new Logger(BlueprintPlannerSpecialist.name);

  constructor(private readonly llm: SpecialistLlmService) {}

  async plan(
    input: BlueprintPlannerInput,
    report?: BlueprintPlannerReport,
  ): Promise<CourseBlueprint> {
    const problemsOf = (blueprint: CourseBlueprint) => [
      ...validateBlueprint(blueprint, input.brief),
      ...(input.checkTransfer ? transferProblems(blueprint, input.brief) : []),
      // Course Pilot: within 10% of the length the trainer asked for.
      ...(input.checkTransfer ? lengthProblems(blueprint, input.brief) : []),
    ];

    const done = (
      plan: CourseBlueprint,
      fields: Omit<BlueprintPlannerReport, 'remaining'>,
    ) => {
      if (report)
        Object.assign(report, fields, { remaining: problemsOf(plan) });
      return plan;
    };

    let first: CourseBlueprint;
    try {
      first = await this.attempt(input);
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      // Unparseable output: the one retry goes here instead.
      const retried = await this.attempt(input, error.errors);
      return done(retried, {
        firstProblems: error.errors,
        repairTried: true,
        repairKept: true,
        repairNote:
          'The first answer was not a usable plan; the retry was used.',
      });
    }

    const problems = problemsOf(first);
    if (!problems.length) {
      return done(first, {
        firstProblems: [],
        repairTried: false,
        repairKept: false,
      });
    }

    try {
      const second = await this.attempt(input, problems);
      // Fewer problems, and never a transfer problem the first plan did not have: a length
      // repair once dropped every practice's transfer marks to hit the minutes.
      const transferOf = (plan: CourseBlueprint) =>
        input.checkTransfer ? transferProblems(plan, input.brief).length : 0;
      const fewer = problemsOf(second).length < problems.length;
      const keptTransfer = transferOf(second) <= transferOf(first);
      return fewer && keptTransfer
        ? done(second, {
            firstProblems: problems,
            repairTried: true,
            repairKept: true,
          })
        : done(first, {
            firstProblems: problems,
            repairTried: true,
            repairKept: false,
            repairNote: !fewer
              ? 'The repaired plan did not have fewer problems.'
              : 'The repaired plan broke a skill-target practice rule.',
          });
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      this.logger.warn(
        `Blueprint repair for session ${input.sessionId} returned no JSON; keeping the first plan.`,
      );
      return done(first, {
        firstProblems: problems,
        repairTried: true,
        repairKept: false,
        repairNote: 'The repair returned no usable plan.',
      });
    }
  }

  /**
   * One more plan with a list of problems to fix (the Course Pilot critic's blocking findings).
   * Null when the model returns no usable JSON — the caller keeps the plan it has.
   */
  async repair(
    input: BlueprintPlannerInput,
    problems: string[],
  ): Promise<CourseBlueprint | null> {
    try {
      return await this.attempt(input, problems);
    } catch (error) {
      if (!(error instanceof SpecialistValidationError)) throw error;
      this.logger.warn(
        `Critic repair for session ${input.sessionId} returned no JSON; keeping the first plan.`,
      );
      return null;
    }
  }

  private async attempt(
    input: BlueprintPlannerInput,
    repairErrors?: string[],
  ): Promise<CourseBlueprint> {
    const { brief } = input;
    const enabling = brief?.outcomes?.enabling ?? [];
    const { data } = await this.llm.runJson({
      specialist: 'blueprint_planner',
      promptCode: COURSE_COPILOT_PROMPTS.BLUEPRINT_PLANNER,
      taskId: COURSE_COPILOT_AI_TASKS.BLUEPRINT,
      task: LlmTask.COURSE_COPILOT_BLUEPRINT,
      maxTokens: SPECIALIST_MAX_TOKENS.BLUEPRINT,
      usageMetadata: input.usageMetadata,
      repairErrors,
      // The matched learner profile rides in the reference block, not a new prompt variable;
      // the skill targets and rubric are already in brief_json.
      referenceMaterial:
        [
          input.referenceMaterial,
          learnerProfileReference(brief?.learnerProfileId),
          // A person-chosen published course of a similar size, as a pattern (not content).
          exampleCourseReference(brief?.shape?.durationMinutes),
          input.designGuidance,
          input.checkTransfer ? transferRequirements(brief) : null,
        ]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join('\n\n---\n') || null,
      variables: {
        brief_json: briefForPrompt(brief),
        objectives_list: enabling.length
          ? enabling.map((outcome, index) => `${index}: ${outcome}`).join('\n')
          : '(none recorded — leave objectiveRefs empty)',
        trainer_notes: input.notes?.trim() || '(none)',
        library_picks_json: JSON.stringify(input.libraryPicks ?? [], null, 2),
        video_urls_json: JSON.stringify(
          (brief?.videoUrls ?? []).map((video, index) => ({ index, ...video })),
          null,
          2,
        ),
        games_json: JSON.stringify(input.games ?? [], null, 2),
        limits_json: JSON.stringify(
          {
            sections: COURSE_COPILOT_LIMITS.sections,
            items: COURSE_COPILOT_LIMITS.items,
            itemsPerSection: COURSE_COPILOT_LIMITS.itemsPerSection,
            newCases: COURSE_COPILOT_LIMITS.newCases,
            images: COURSE_COPILOT_LIMITS.images,
            languagesPerRoleplay: COURSE_COPILOT_LIMITS.languagesPerRoleplay,
            quizQuestions: COURSE_COPILOT_LIMITS.quizQuestions,
            articleQuestions: COURSE_COPILOT_LIMITS.articleQuestions,
          },
          null,
          2,
        ),
        item_minutes_json: JSON.stringify(COURSE_COPILOT_DEFAULT_ITEM_MINUTES),
        duration_minutes: String(
          brief?.shape?.durationMinutes ??
            COURSE_COPILOT_DEFAULT_DURATION_MINUTES,
        ),
        // The stored prompt still says "at most {{max_new_roleplays}} new":
        // new roleplays have no limit of their own, so it is the item limit.
        max_new_roleplays: String(COURSE_COPILOT_LIMITS.items),
        max_article_questions: String(COURSE_COPILOT_LIMITS.articleQuestions),
        max_quiz_questions: String(COURSE_COPILOT_LIMITS.quizQuestions),
        max_labels: String(COURSE_COPILOT_LIMITS.annotationLabels),
      },
    });
    return normaliseBlueprint(data, brief);
  }
}
