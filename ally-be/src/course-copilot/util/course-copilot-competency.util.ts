/**
 * Competency ids the agent writes into the brief are copied from list_competencies, and a model
 * can copy a UUID wrong: a brief once carried 30c059b6-4f3b-… for the real 30c059b6-4f5b-…, and
 * course creation then failed at Approve ("Invalid competency IDs"). This repairs ids against the
 * shared competencies: an exact id is kept; one within two characters of a single real id, or whose
 * name (same position in competencyNames) matches one, is replaced by it; anything else is dropped.
 */

export interface CompetencyRepair {
  ids: string[];
  fixed: { from: string; to: string; name: string }[];
  dropped: string[];
}

/** Characters that differ, position by position; Infinity when the lengths differ. */
function charDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff;
}

export function repairCompetencyIds(
  ids: readonly string[],
  names: readonly string[] | undefined,
  known: readonly { id: string; name: string }[],
): CompetencyRepair {
  const byId = new Map(known.map((c) => [c.id.toLowerCase(), c]));
  const byName = new Map(known.map((c) => [c.name.trim().toLowerCase(), c]));
  const out: string[] = [];
  const fixed: CompetencyRepair['fixed'] = [];
  const dropped: string[] = [];
  ids.forEach((raw, index) => {
    const id = String(raw ?? '').trim();
    if (!id) return;
    const exact = byId.get(id.toLowerCase());
    if (exact) {
      out.push(exact.id);
      return;
    }
    const near = known.filter(
      (c) => charDistance(c.id.toLowerCase(), id.toLowerCase()) <= 2,
    );
    const named = byName.get(
      String(names?.[index] ?? '')
        .trim()
        .toLowerCase(),
    );
    const match = near.length === 1 ? near[0] : named;
    if (match) {
      out.push(match.id);
      fixed.push({ from: id, to: match.id, name: match.name });
    } else {
      dropped.push(id);
    }
  });
  return { ids: [...new Set(out)], fixed, dropped };
}
