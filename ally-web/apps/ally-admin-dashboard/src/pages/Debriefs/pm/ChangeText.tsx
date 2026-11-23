import React from "react";

import { en } from "@constants";

type Part = { text: string; kind: "same" | "removed" | "added" };

/**
 * A word-level difference between two texts (longest common subsequence over words and the
 * spaces between them). Small texts only: a prompt passage or a card's wording.
 */
export const wordDiff = (before: string, after: string): Part[] => {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: Part[] = [];
  const push = (text: string, kind: Part["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(a[i], "same");
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i++], "removed");
    } else {
      push(b[j++], "added");
    }
  }
  while (i < n) push(a[i++], "removed");
  while (j < m) push(b[j++], "added");
  return out;
};

export const Wording: React.FC<{ before: string; after: string }> = ({ before, after }) => {
  const t = en.debriefs.v2.home;
  const parts = wordDiff(before, after);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="needs-diff">
      <div className="flex flex-col gap-1">
        <div className="text-xs text-neutral-600">{t.before}</div>
        <p className="m-0 whitespace-pre-wrap bg-white px-3 py-2 text-sm leading-normal">
          {parts
            .filter(p => p.kind !== "added")
            .map((p, k) =>
              p.kind === "removed" ? (
                <del key={k} className="bg-destructive-50 text-destructive-600">
                  {p.text}
                </del>
              ) : (
                <span key={k}>{p.text}</span>
              ),
            )}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-xs text-neutral-600">{t.after}</div>
        <p className="m-0 whitespace-pre-wrap bg-white px-3 py-2 text-sm leading-normal">
          {parts
            .filter(p => p.kind !== "removed")
            .map((p, k) =>
              p.kind === "added" ? (
                <ins key={k} className="bg-success-50 text-success-600 no-underline">
                  {p.text}
                </ins>
              ) : (
                <span key={k}>{p.text}</span>
              ),
            )}
        </p>
      </div>
    </div>
  );
};
