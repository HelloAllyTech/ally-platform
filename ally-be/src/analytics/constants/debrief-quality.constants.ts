/**
 * The debrief-quality rubric's arithmetic, kept here rather than in the judge.
 *
 * The judge returns a 0-10 score per dimension and a list of hard fails; it
 * never returns an overall. The overall is computed from these weights at read
 * time, so a weight can change without re-judging a single debrief — the same
 * division of labour as every other judge ("labels in the row, rates in SQL").
 */

/** Dimension → its column on `debrief_quality_judgment` and its weight. */
export const DEBRIEF_QUALITY_DIMENSIONS = [
  {
    dimension: 'evidence_specificity',
    column: 'evidenceSpecificity',
    weight: 0.2,
  },
  { dimension: 'accuracy', column: 'accuracy', weight: 0.2 },
  { dimension: 'actionability', column: 'actionability', weight: 0.15 },
  { dimension: 'prioritisation', column: 'prioritisation', weight: 0.1 },
  {
    dimension: 'personalisation_progress',
    column: 'personalisationProgress',
    weight: 0.1,
  },
  { dimension: 'practice_alignment', column: 'practiceAlignment', weight: 0.1 },
  { dimension: 'tone', column: 'tone', weight: 0.1 },
  { dimension: 'clarity', column: 'clarity', weight: 0.05 },
] as const;

export type DebriefQualityDimension =
  (typeof DEBRIEF_QUALITY_DIMENSIONS)[number]['dimension'];

/** Any hard fail caps the overall here, whatever the dimension scores say. */
export const DEBRIEF_QUALITY_HARD_FAIL_CAP = 4;

/** The bar a debrief must meet: this overall or more, and no hard fail. */
export const DEBRIEF_QUALITY_PASS = 8;

/**
 * Overall out of 10, rounded to one decimal.
 *
 * Returns null unless every dimension is present: a missing score must not
 * read as a zero, which would drag the overall down for a reason that is about
 * the judge, not the debrief.
 */
export function computeDebriefOverall(
  scores: Partial<Record<DebriefQualityDimension, number | null>>,
  hardFailCount: number,
): number | null {
  let total = 0;
  for (const d of DEBRIEF_QUALITY_DIMENSIONS) {
    const s = scores[d.dimension];
    if (s == null) return null;
    total += s * d.weight;
  }
  const overall = Math.round(total * 10) / 10;
  return hardFailCount > 0
    ? Math.min(overall, DEBRIEF_QUALITY_HARD_FAIL_CAP)
    : overall;
}

/**
 * The same overall as a SQL expression over one `debrief_quality_judgment`
 * row, so dashboards and the TypeScript function can never disagree.
 */
export function debriefOverallSql(alias: string): string {
  const sum = DEBRIEF_QUALITY_DIMENSIONS.map(
    (d) => `${d.weight} * ${alias}."${d.column}"`,
  ).join(' + ');
  return (
    `CASE WHEN jsonb_array_length(COALESCE(${alias}."hardFails", '[]'::jsonb)) > 0 ` +
    `THEN LEAST(round((${sum})::numeric, 1), ${DEBRIEF_QUALITY_HARD_FAIL_CAP}) ` +
    `ELSE round((${sum})::numeric, 1) END`
  );
}
