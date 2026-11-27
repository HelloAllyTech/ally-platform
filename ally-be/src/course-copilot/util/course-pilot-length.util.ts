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

/** Minutes outside the allowed range (0 inside it, or when no length was asked). */
export function lengthGap(
  blueprint: CourseBlueprint,
  brief: CourseBrief | null | undefined,
): number {
  const target = Number(brief?.shape?.durationMinutes);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const minutes = realisticMinutes(blueprint);
  const { min, max } = lengthBounds(target);
  return minutes > max ? minutes - max : minutes < min ? min - minutes : 0;
}

/**
 * The length budget, given to the planner before its first plan (in the reference block, beside
 * the transfer rules). Two eval plans ran 20% over even after the repair: one listed ten items for
 * a 30-minute course, one four 9–11 minute roleplays for 60. The budget says up front how much
 * fits. Null when no length was asked.
 */
export function lengthBudget(
  brief: CourseBrief | null | undefined,
): string | null {
  const target = Number(brief?.shape?.durationMinutes);
  if (!Number.isFinite(target) || target <= 0) return null;
  const { min, max } = lengthBounds(target);
  const floors = Object.entries(COURSE_COPILOT_DEFAULT_ITEM_MINUTES)
    .filter(([type]) => type !== 'VIDEO')
    .map(([type, usual]) => `${type} ${Math.ceil(usual / 2)}`)
    .join(', ');
  const roleplay = COURSE_COPILOT_DEFAULT_ITEM_MINUTES.ROLEPLAY;
  const typical = Math.max(2, Math.round(target / 6));
  const roleplays = Math.max(1, Math.floor(max / 2 / roleplay));
  return [
    `LENGTH BUDGET (checked in code)`,
    `The trainer asked for ${target} minutes. The items' estimatedMinutes must add up to between ${min} and ${max}.`,
    `No estimate counts below its floor (minutes): ${floors}. Listing an item lower does not save time; it is raised to the floor.`,
    `That is about ${typical} items at usual lengths. At most about ${roleplays} roleplay${roleplays === 1 ? '' : 's'} of ${roleplay} minutes fit if practice is to be half the course.`,
    `Practice a skill target needs (a new scenario of similar difficulty) still has to fit: a scenario quiz (${COURSE_COPILOT_DEFAULT_ITEM_MINUTES.QUIZ} minutes) gives that practice in less time than another roleplay, so cut reading before practice.`,
    `Add the minutes up before you answer. If the total is over ${max}, drop or merge items instead of shortening every estimate.`,
  ].join('\n');
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
  // A count is a clearer instruction than minutes: a repair told "cut 10 minutes" squeezed every
  // estimate instead of removing anything.
  const items = itemsOf(blueprint);
  const average = items.length ? minutes / items.length : 6;
  const itemCount = Math.max(
    1,
    Math.ceil(
      (over ? minutes - target : target - minutes) / Math.max(3, average),
    ),
  );
  return [
    `The trainer asked for a ${target}-minute course; this plan has ${items.length} items and takes about ${minutes} minutes. ` +
      `Bring the total of the items' estimatedMinutes to between ${min} and ${max} by ` +
      (over
        ? `removing or merging about ${itemCount} item${itemCount === 1 ? '' : 's'} (about ${minutes - target} minutes) — ` +
          `start with an item that repeats another, or replace a long roleplay with a shorter practice — ` +
          `but keep the capstone and every practice a skill target needs`
        : `adding about ${itemCount} item${itemCount === 1 ? '' : 's'} (about ${target - minutes} minutes) of practice or ` +
          `reflection that serves the outcomes`) +
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
