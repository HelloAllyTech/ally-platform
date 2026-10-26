/**
 * The `{name}` placeholders a prompt's text uses, in order of first use. Same
 * rule as ally-be's contract check (`placeholdersIn`): it also catches the
 * inner name of `{{name}}`, and ignores braces around anything that isn't a
 * name (JSON examples, prose).
 */
export const placeholdersIn = (text: string): string[] => {
  const seen = new Set<string>();
  for (const match of text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) seen.add(match[1]);
  return [...seen];
};

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * A line diff from `before` to `after` (longest common subsequence). Prompts
 * are a few kilobytes, so the quadratic table is fine; past MAX_LINES each
 * side, it falls back to "everything removed, everything added".
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map(text => ({ kind: "removed" as const, text })),
      ...b.map(text => ({ kind: "added" as const, text })),
    ];
  }
  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
};

const MAX_LINES = 2000;
