import { TrackItemType } from 'src/track/type/track.type';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
  CourseBriefSkillTarget,
} from '../type/course-copilot.type';

/**
 * Course Pilot's transfer check (phase 3): a skill target's B level — how widely learners can use
 * the skill — must be practised in the plan, and code can check it, so it is code's job.
 *
 *   B1  practised scenarios only — nothing extra.
 *   B2  at least one practice on a NEW scenario of SIMILAR difficulty to ones practised before.
 *   B3  at least one practice on a NEW, HARDER scenario than ones practised before.
 *
 * Evals found every plan missed B2 the same way: each roleplay harder than the last, never a new
 * scenario of the same difficulty — and an LLM critic did not reliably catch it. So the planner
 * marks each practice item with `spec.transfer` and `spec.targetSkills`, and this checks them.
 * A "new" practice must come after something was practised: transfer is to a new scenario.
 */

export type CoursePilotTransfer = 'practised' | 'new-similar' | 'new-harder';
export const COURSE_PILOT_TRANSFERS: readonly CoursePilotTransfer[] = [
  'practised',
  'new-similar',
  'new-harder',
];

/** Items where a learner practises a scenario: these carry `spec.transfer`. */
const PRACTICE_TYPES = new Set<string>([
  TrackItemType.ROLEPLAY,
  TrackItemType.BRANCHING_SCENARIO,
]);

const NEEDS: Record<string, { transfer: CoursePilotTransfer; words: string }> =
  {
    B2: {
      transfer: 'new-similar',
      words: 'a NEW scenario of SIMILAR difficulty to ones practised earlier',
    },
    B3: {
      transfer: 'new-harder',
      words: 'a NEW scenario that is HARDER than ones practised earlier',
    },
  };

const norm = (text: unknown) =>
  String(text ?? '')
    .trim()
    .toLowerCase();

function transferOf(item: CourseBlueprintItem): CoursePilotTransfer | null {
  const value = norm(item.spec?.transfer).replace(/[\s_]+/g, '-');
  return (COURSE_PILOT_TRANSFERS as readonly string[]).includes(value)
    ? (value as CoursePilotTransfer)
    : null;
}

/** Whether a practice item names this skill (by name or competency id); unnamed = whole course. */
function practises(
  item: CourseBlueprintItem,
  target: CourseBriefSkillTarget,
): boolean {
  const named = Array.isArray(item.spec?.targetSkills)
    ? item.spec.targetSkills.map(norm)
    : [];
  if (!named.length) return true;
  return (
    named.includes(norm(target.skill)) ||
    (!!target.competencyId && named.includes(norm(target.competencyId)))
  );
}

/** What the plan still lacks for the brief's B2/B3 targets; empty when every target is covered. */
export function transferProblems(
  blueprint: CourseBlueprint,
  brief: CourseBrief,
): string[] {
  const targets = (brief?.skillTargets ?? []).filter(
    (t) => t.b === 'B2' || t.b === 'B3',
  );
  if (!targets.length) return [];
  const practice = (blueprint?.sections ?? [])
    .flatMap((section) => section.items ?? [])
    .filter((item) => PRACTICE_TYPES.has(item.type));

  const problems: string[] = [];
  for (const target of targets) {
    const need = NEEDS[target.b as string];
    const mine = practice.filter((item) => practises(item, target));
    const index = mine.findIndex((item) => transferOf(item) === need.transfer);
    const where = `Skill target "${target.skill}" is ${target.b}`;
    if (index === -1) {
      problems.push(
        `${where}, but no practice gives learners ${need.words}. Add a roleplay or scenario quiz ` +
          `that does (or turn an existing one into it) and mark it spec.transfer: "${need.transfer}", ` +
          `spec.targetSkills: ["${target.skill}"].` +
          (target.b === 'B2'
            ? ' A harder scenario does not count for B2.'
            : ''),
      );
    } else if (index === 0) {
      problems.push(
        `${where}: its "${need.transfer}" practice ("${mine[0].title}") comes first, so there is ` +
          'nothing earlier to transfer from. Put a practised scenario (spec.transfer: "practised") before it.',
      );
    }
  }
  return problems;
}

/**
 * The requirement as the planner reads it before planning, built from the brief by code so the
 * planner's stored prompt does not change. Null when no target needs transfer practice.
 */
export function transferRequirements(brief: CourseBrief): string | null {
  const targets = (brief?.skillTargets ?? []).filter(
    (t) => t.b === 'B2' || t.b === 'B3',
  );
  if (!targets.length) return null;
  return [
    'TRANSFER PRACTICE (required — checked by code):',
    'Mark every ROLEPLAY and BRANCHING_SCENARIO item with spec.transfer ("practised", "new-similar" or ' +
      '"new-harder") and spec.targetSkills (the skill names it practises).',
    ...targets.map(
      (t) =>
        `- "${t.skill}" is ${t.b}: include at least one practice on ${NEEDS[t.b as string].words}, marked "${NEEDS[t.b as string].transfer}", after a "practised" one.`,
    ),
    'A course that only makes each scenario harder than the last does not meet B2.',
  ].join('\n');
}
