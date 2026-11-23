/**
 * The findings with `line` added. ally-be sends running totals after each batch of pages ("Found 3
 * team members", later "Found 8 team members"), so a line that differs only in its number replaces
 * the earlier one rather than piling up beside it.
 */
export const withFinding = (findings: string[], line: string): string[] => {
  const shape = (text: string) => text.replace(/\d+/g, "#");
  const index = findings.findIndex(existing => shape(existing) === shape(line));
  if (index < 0) return [...findings, line];
  const next = [...findings];
  next[index] = line;
  return next;
};
