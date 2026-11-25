/**
 * Modules in the order a person reads them. Authors often number their modules
 * ("Section 1" ... "Section 12") but the stored order can drift from the numbers
 * (a module added later sits at the end, or in the middle). When every title is
 * the same words followed by a number, the numbers decide; otherwise the stored
 * order is kept untouched, so a course with named modules is never re-sorted.
 */
const NUMBERED = /^(.*?)(\d+)\s*$/;

export const inModuleOrder = <T extends { title: string }>(
  rows: readonly T[],
): T[] => {
  const parsed = rows.map((row) => NUMBERED.exec(row.title.trim()));
  const prefixes = new Set(parsed.map((m) => m?.[1].trim().toLowerCase()));
  if (rows.length < 2 || parsed.some((m) => m === null) || prefixes.size !== 1)
    return [...rows];
  return rows
    .map((row, index) => ({ row, index, n: Number(parsed[index]![2]) }))
    .sort((a, b) => a.n - b.n || a.index - b.index)
    .map((entry) => entry.row);
};
