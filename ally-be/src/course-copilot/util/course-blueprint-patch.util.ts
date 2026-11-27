import { CourseBlueprint } from '../type/course-copilot.type';

/**
 * Course Pilot critic repair as an edit, not a rewrite. The planner's repair call returns a whole
 * plan, and a whole-plan rewrite could quietly change items the critic never questioned (a
 * transfer mark lost, a quiz re-scoped). When every blocking finding names an item, every item
 * the repair kept under the same id that no finding names is put back exactly as it was before.
 * New items, removed items, section changes and the flagged items come from the repair.
 *
 * A finding about the whole course (no itemId) can need any item changed, so then the repair is
 * taken as it is (`mode: 'whole'`).
 */
export interface BlueprintPatchResult {
  blueprint: CourseBlueprint;
  mode: 'patch' | 'whole';
  /** Unflagged items put back as they were. */
  restored: number;
  /** Items the repair changed: flagged, new, or (in whole mode) anything different. */
  changed: number;
}

export function applyCriticPatch(
  before: CourseBlueprint,
  after: CourseBlueprint,
  findings: Array<{ severity: string; itemId?: string }>,
): BlueprintPatchResult {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const flagged = new Set(
    blocking.map((f) => f.itemId).filter((id): id is string => !!id),
  );
  const beforeItems = new Map(
    (before.sections ?? []).flatMap((section) =>
      (section.items ?? []).map((item) => [item.id, item] as const),
    ),
  );
  const whole = !blocking.length || blocking.some((f) => !f.itemId);
  let restored = 0;
  let changed = 0;
  const sections = (after.sections ?? []).map((section) => ({
    ...section,
    items: (section.items ?? []).map((item) => {
      const old = beforeItems.get(item.id);
      const differs = !old || JSON.stringify(old) !== JSON.stringify(item);
      if (!whole && old && !flagged.has(item.id)) {
        if (differs) restored += 1;
        return old;
      }
      if (differs) changed += 1;
      return item;
    }),
  }));
  return {
    blueprint: { ...after, sections },
    mode: whole ? 'whole' : 'patch',
    restored,
    changed,
  };
}

/** The current plan, for the planner's repair call: edit it, keep every other item and its id. */
export function currentPlanReference(blueprint: CourseBlueprint): string {
  return [
    'CURRENT PLAN (edit this plan; do not start over)',
    'Change only what the problems below name. Return every other section and item exactly as it is, with the same id. ' +
      'A new item gets a new id; an item you change keeps its id.',
    JSON.stringify(blueprint),
  ].join('\n');
}
