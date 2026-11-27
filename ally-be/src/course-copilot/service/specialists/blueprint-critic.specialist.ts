import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { CourseBlueprint, CourseBrief } from '../../type/course-copilot.type';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  asArray,
  asText,
  briefForPrompt,
  isRecord,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

/** At most this many findings: enough for a real plan, few enough to act on. */
export const BLUEPRINT_CRITIC_MAX_FINDINGS = 8;

export const BLUEPRINT_CRITIC_CRITERIA = [
  'assessment',
  'skill_targets',
  'progression',
  'reflection',
  'fit',
] as const;
export type BlueprintCriticCriterion =
  (typeof BLUEPRINT_CRITIC_CRITERIA)[number];

export interface BlueprintCriticFinding {
  severity: 'blocking' | 'advisory';
  criterion: BlueprintCriticCriterion;
  itemId?: string;
  problem: string;
  fix: string;
}

export interface BlueprintCriticInput {
  brief: CourseBrief;
  blueprint: CourseBlueprint;
  designGuidance?: string | null;
  usageMetadata?: Record<string, any>;
}

/**
 * Course Pilot's critic (plan §3): reads a freshly planned blueprint against the confirmed brief
 * and the Learning Design principles, before the trainer sees it. It finds problems and never
 * writes — a separate reviewer, not the planner grading itself. Blocking findings go back to
 * the planner for one repair round (CourseCopilotBlueprintService.propose).
 *
 * The code's own checks (limits, ids, budget) already ran in the planner; this judges what code
 * cannot: does the plan serve this brief. An itemId the plan does not hold is dropped, not
 * trusted.
 */
@Injectable()
export class BlueprintCriticSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async critique(
    input: BlueprintCriticInput,
  ): Promise<BlueprintCriticFinding[]> {
    const { data } = await this.llm.runJson({
      specialist: 'blueprint_critic',
      promptCode: COURSE_COPILOT_PROMPTS.BLUEPRINT_CRITIC,
      taskId: COURSE_COPILOT_AI_TASKS.BLUEPRINT_CRITIC,
      task: LlmTask.COURSE_COPILOT_BLUEPRINT_CRITIC,
      maxTokens: SPECIALIST_MAX_TOKENS.BLUEPRINT_CRITIC,
      usageMetadata: input.usageMetadata ?? {},
      variables: {
        brief_json: briefForPrompt(input.brief),
        blueprint_json: JSON.stringify(
          compactBlueprintForCritic(input.blueprint),
        ),
        design_guidance: input.designGuidance || '(none available)',
        max_findings: String(BLUEPRINT_CRITIC_MAX_FINDINGS),
      },
    });
    return normaliseCriticFindings(data, input.blueprint);
  }
}

/** What the critic needs of a plan: structure, purpose, timing, rules and each item's spec. */
export function compactBlueprintForCritic(blueprint: CourseBlueprint) {
  return {
    title: blueprint.title,
    estimatedDurationMinutes: blueprint.estimatedDurationMinutes,
    sections: (blueprint.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      purpose: section.purpose,
      items: (section.items ?? []).map((item: any) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        minutes: item.estimatedMinutes,
        source: item.source,
        ...(item.completionCriteria ? { rule: item.completionCriteria } : {}),
        spec: item.spec ?? undefined,
      })),
    })),
  };
}

/** Pure: raw model JSON → findings, blocking first. Exported for tests. */
export function normaliseCriticFindings(
  raw: Record<string, any>,
  blueprint: CourseBlueprint,
): BlueprintCriticFinding[] {
  const itemIds = new Set(
    (blueprint.sections ?? []).flatMap((s) => (s.items ?? []).map((i) => i.id)),
  );
  const findings: BlueprintCriticFinding[] = [];
  for (const rawFinding of asArray(raw?.findings ?? raw?.issues).filter(
    isRecord,
  )) {
    const problem = asText(rawFinding.problem ?? rawFinding.note, 400);
    if (!problem) continue;
    const severityText = asText(rawFinding.severity).toLowerCase();
    const criterionText = asText(rawFinding.criterion).toLowerCase();
    const finding: BlueprintCriticFinding = {
      severity: ['blocking', 'block', 'fix', 'must', 'high'].includes(
        severityText,
      )
        ? 'blocking'
        : 'advisory',
      criterion: (BLUEPRINT_CRITIC_CRITERIA as readonly string[]).includes(
        criterionText,
      )
        ? (criterionText as BlueprintCriticCriterion)
        : 'fit',
      problem,
      fix: asText(rawFinding.fix ?? rawFinding.suggestion, 400),
    };
    const itemId = asText(rawFinding.itemId);
    if (itemId && itemIds.has(itemId)) finding.itemId = itemId;
    findings.push(finding);
  }
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        Number(a.finding.severity !== 'blocking') -
          Number(b.finding.severity !== 'blocking') || a.index - b.index,
    )
    .map(({ finding }) => finding)
    .slice(0, BLUEPRINT_CRITIC_MAX_FINDINGS);
}

/** Blocking findings as the planner's repair list: what to change, item by item. */
export function criticRepairList(findings: BlueprintCriticFinding[]): string[] {
  return findings
    .filter((f) => f.severity === 'blocking')
    .map(
      (f) =>
        `Critic (${f.criterion})${f.itemId ? ` on item ${f.itemId}` : ''}: ${f.problem}` +
        (f.fix ? ` Change: ${f.fix}` : ''),
    );
}
