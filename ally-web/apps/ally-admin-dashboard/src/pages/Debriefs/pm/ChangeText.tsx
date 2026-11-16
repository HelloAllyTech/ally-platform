import React from "react";

import { en } from "@constants";
import { DebriefChange } from "@types";

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

/**
 * The whole rule, so the person deciding reads all of it, not a fragment: open by default, in a
 * scrolling box, with the changed passage marked when it is a change.
 */
export const WholeRule: React.FC<{
  rule: NonNullable<DebriefChange["rule"]>;
  changed: boolean;
}> = ({ rule, changed }) => {
  const t = en.debriefs.v2.home;
  return (
    <details open className="bg-white" data-testid="needs-rule">
      <summary className="cursor-pointer py-1 text-[13px] font-semibold text-typography-900">
        {changed ? t.wholeRuleChanged(rule.name) : t.wholeRule(rule.name)}
      </summary>
      {rule.stale && (
        <p className="m-0 py-1 text-[13px] text-[#8A3800]" data-testid="needs-rule-stale">
          {t.ruleStale}
        </p>
      )}
      <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap border border-neutral-100 px-3 py-2 text-sm leading-normal">
        {rule.segments.map((seg, k) =>
          seg.changed ? (
            <mark key={k} className="bg-success-50 text-success-600">
              {seg.text}
            </mark>
          ) : (
            <span key={k}>{seg.text}</span>
          ),
        )}
      </div>
    </details>
  );
};
