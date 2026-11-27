import { COURSE_COPILOT_DEFAULT_ITEM_MINUTES } from '../constants/course-copilot.constants';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
} from '../type/course-copilot.type';

/**
 * Course Pilot's length check: the plan's total minutes must be within 10% of the length the
 * trainer asked for. An eval of 10 briefs found 6 plans more than 10% off (most of them 15–20%
 * over), and a 60-minute request becoming a 71-minute course is a broken promise to the trainer,
 * so code checks it and the planner gets its one repair call with the numbers.
 *
 * Only checked when the trainer gave a length (`brief.shape.durationMinutes`); a default length is
 * a guess, not a promise.
 *
 * Each item counts at no less than half its usual length (a roleplay at least 6 minutes): in the
 * first eval with this check, a repair reached 60 minutes partly by listing a roleplay at 3.
 */

/** How far from the asked length a plan may be, as a share of it. */
export const COURSE_PILOT_LENGTH_TOLERANCE = 0.1;

export function lengthBounds(target: number): { min: number; max: number } {
  const slack = Math.max(2, Math.round(target * COURSE_PILOT_LENGTH_TOLERANCE));
  return { min: target - slack, max: target + slack };
}

function itemsOf(blueprint: CourseBlueprint): CourseBlueprintItem[] {
  return (blueprint.sections ?? []).flatMap((section) => section.items ?? []);
}

export function blueprintMinutes(blueprint: CourseBlueprint): number {
  return itemsOf(blueprint).reduce(
    (sum, item) => sum + (Number(item.estimatedMinutes) || 0),
    0,
  );
}

/** The least an item can honestly take; videos have a real length, so no floor. */
export function minimumMinutes(item: CourseBlueprintItem): number {
  if (String(item.type) === 'VIDEO') return 0;
  const usual = COURSE_COPILOT_DEFAULT_ITEM_MINUTES[String(item.type)] ?? 0;
  return Math.ceil(usual / 2);
}

/** The total with every estimate raised to its floor: what the check measures. */
export function realisticMinutes(blueprint: CourseBlueprint): number {
  return itemsOf(blueprint).reduce(
    (sum, item) =>
      sum + Math.max(Number(item.estimatedMinutes) || 0, minimumMinutes(item)),
    0,
  );
}

/** Problems for the planner's repair call; empty when the length is right or none was asked. */
export function lengthProblems(
  blueprint: CourseBlueprint,
  brief: CourseBrief | null | undefined,
): string[] {
  const target = Number(brief?.shape?.durationMinutes);
  if (!Number.isFinite(target) || target <= 0) return [];
  const minutes = realisticMinutes(blueprint);
  const { min, max } = lengthBounds(target);
  if (minutes >= min && minutes <= max) return [];
  const squeezed = itemsOf(blueprint)
    .filter(
      (item) => (Number(item.estimatedMinutes) || 0) < minimumMinutes(item),
    )
    .map(
      (item) =>
        `"${item.title}" (${item.type}, ${item.estimatedMinutes} min; at least ${minimumMinutes(item)})`,
    );

  const over = minutes > max;
  // The biggest items are where minutes are won or lost; name them so the fix is concrete.
  const largest = itemsOf(blueprint)
    .filter((item) => Number(item.estimatedMinutes) > 0)
    .sort((a, b) => Number(b.estimatedMinutes) - Number(a.estimatedMinutes))
    .slice(0, 4)
    .map(
      (item) => `"${item.title}" (${item.type}, ${item.estimatedMinutes} min)`,
    )
    .join(', ');
  return [
    `The trainer asked for a ${target}-minute course; this plan takes about ${minutes} minutes. ` +
      `Bring the total of the items' estimatedMinutes to between ${min} and ${max} by ` +
      (over
        ? `cutting about ${minutes - target} minutes — drop or merge an item that repeats ` +
          `another, or shorten one — but keep the capstone and every practice a skill target needs`
        : `adding about ${target - minutes} minutes of practice or reflection that serves the ` +
          `outcomes`) +
      `. Keep each estimate realistic: do not just change the numbers. Keep every practice ` +
      `item's transfer and targetSkills marks.` +
      (squeezed.length
        ? ` These estimates are too low to count and were raised: ${squeezed.join(', ')}.`
        : '') +
      (largest ? ` Largest items: ${largest}.` : ''),
  ];
}

/** For the trainer, under the plan: shown, never blocking. */
export function lengthWarning(
  blueprint: CourseBlueprint,
  brief: CourseBrief | null | undefined,
): string[] {
  if (!lengthProblems(blueprint, brief).length) return [];
  return [
    `This plan is about ${realisticMinutes(blueprint)} minutes; you asked for ` +
      `${Number(brief?.shape?.durationMinutes)}. Ask me to shorten or lengthen it, or approve it as it is.`,
  ];
}
