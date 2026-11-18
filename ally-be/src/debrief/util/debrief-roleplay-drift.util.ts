import { ROLEPLAY_FIELDS } from '../constants/debrief-roleplay-fields.constants';

/**
 * Roleplay-field drift: a field that roleplays used to fill in and newly saved ones no longer do
 * is what a renamed or reshaped field in the creation code looks like. The check compares how
 * many recently saved roleplays carry each registered field against the earlier ones; it calls no
 * model. A person decides the fix; this only finds the drift early and says what it saw.
 */
export const DRIFT_RECENT_DAYS = 30;
/** Fewer roleplays than this on either side is too little to judge. */
export const DRIFT_MIN_EARLIER = 20;
export const DRIFT_MIN_RECENT = 10;
/** The field must have been common before, and recent roleplays at most this fraction of that. */
export const DRIFT_MIN_EARLIER_SHARE = 0.2;
export const DRIFT_DROP_TO = 0.25;

/** "Is this field filled in?" for a roleplay row (`alias` is the scenarios alias), from the registry. */
export function populatedSql(
  f: (typeof ROLEPLAY_FIELDS)[number],
  alias = 'sc',
): string {
  if (f.source.kind === 'column') {
    return `btrim(COALESCE(${alias}."${f.source.name}"::text, '')) <> ''`;
  }
  const m = `${alias}.metadata->'${f.source.name}'`;
  return f.key === 'stages'
    ? `(jsonb_typeof(${m}) = 'array' AND jsonb_array_length(${m}) > 0)`
    : `btrim(COALESCE(${alias}.metadata->>'${f.source.name}', '')) <> ''`;
}

/** One SELECT for the counts: totals, and per field how many were filled in, recent and earlier. */
export function driftCountsSql(alias = 'sc'): string {
  const recent = `${alias}."updatedAt" >= now() - interval '${DRIFT_RECENT_DAYS} days'`;
  const earlier = `${alias}."updatedAt" < now() - interval '${DRIFT_RECENT_DAYS} days'`;
  const cols = ROLEPLAY_FIELDS.flatMap((f) => [
    `count(*) FILTER (WHERE ${recent} AND ${populatedSql(f, alias)})::int AS "r_${f.key}"`,
    `count(*) FILTER (WHERE ${earlier} AND ${populatedSql(f, alias)})::int AS "e_${f.key}"`,
  ]);
  return `SELECT count(*) FILTER (WHERE ${recent})::int AS recent_total,
                 count(*) FILTER (WHERE ${earlier})::int AS earlier_total,
                 ${cols.join(',\n                 ')}
            FROM scenarios ${alias}
           WHERE ${alias}."deletedAt" IS NULL`;
}

export interface DriftFinding {
  key: string;
  label: string;
  earlierShare: number;
  recentShare: number;
}

/** The fields whose recent share fell away from a common earlier one. */
export function driftFindings(row: Record<string, unknown>): DriftFinding[] {
  const earlierTotal = Number(row.earlier_total ?? 0);
  const recentTotal = Number(row.recent_total ?? 0);
  if (earlierTotal < DRIFT_MIN_EARLIER || recentTotal < DRIFT_MIN_RECENT) {
    return [];
  }
  const out: DriftFinding[] = [];
  for (const f of ROLEPLAY_FIELDS) {
    const earlierShare = Number(row[`e_${f.key}`] ?? 0) / earlierTotal;
    const recentShare = Number(row[`r_${f.key}`] ?? 0) / recentTotal;
    if (
      earlierShare >= DRIFT_MIN_EARLIER_SHARE &&
      recentShare <= earlierShare * DRIFT_DROP_TO
    ) {
      out.push({ key: f.key, label: f.label, earlierShare, recentShare });
    }
  }
  return out;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The alert's plain words: what was seen and where to look. */
export function driftMessage(findings: DriftFinding[]): {
  title: string;
  body: string;
} {
  const lines = findings.map(
    (f) =>
      `${f.label}: filled in on ${pct(f.earlierShare)} of earlier roleplays, ${pct(f.recentShare)} of those saved in the last ${DRIFT_RECENT_DAYS} days`,
  );
  return {
    title: 'Debriefs: a roleplay field may have been renamed or reshaped',
    body:
      `${lines.join('. ')}. A debrief reads each of these through the roleplay-field registry ` +
      '(debrief-roleplay-fields.constants.ts); check the roleplay creation code for a rename or a new shape, then update the registry.',
  };
}
