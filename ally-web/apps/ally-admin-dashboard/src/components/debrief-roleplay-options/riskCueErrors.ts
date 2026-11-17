/**
 * The plain message ally-be sends with a refusal: `data.message` (a string, or a list of them)
 * and, for a bad form, `data.problems`. Falls back to the given words when it sent none.
 */
export const riskCueErrorMessage = (error: unknown, fallback: string): string => {
  const data = (error as { data?: { message?: unknown; problems?: unknown } } | null)?.data;
  const lines: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) lines.push(v.trim());
    else if (Array.isArray(v)) v.forEach(add);
  };
  add(data?.message);
  add(data?.problems);
  return lines.length ? Array.from(new Set(lines)).join(" ") : fallback;
};
