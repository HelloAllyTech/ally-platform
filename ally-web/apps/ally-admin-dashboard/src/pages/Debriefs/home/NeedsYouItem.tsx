import React from "react";

import { useGetDebriefChangeQuery } from "@api";
import { LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefHomeV2 } from "@types";

import { PmConversation } from "../pm/PmConversation";

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

const Wording: React.FC<{ before: string; after: string }> = ({ before, after }) => {
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
 * One "Needs you" change on the Debriefs home (review 2026-11-16): a one-line row that expands
 * in place to what changes, why, the wording before and after, the evidence, and the PM agent
 * conversation about this change, where the person answers. Once decided it leaves Needs you.
 */
export const NeedsYouItem: React.FC<{
  item: DebriefHomeV2["needsYou"][number];
  open: boolean;
  onToggle: (open: boolean) => void;
}> = ({ item, open, onToggle }) => {
  const t = en.debriefs.v2.home;
  const q = useGetDebriefChangeQuery(item.changeId, { skip: !open });
  const change = q.data;
  return (
    <details
      open={open}
      onToggle={e => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now !== open) onToggle(now);
      }}
      className="bg-white"
      data-testid="home-needs-item"
      data-change={item.changeId}
    >
      <summary
        className="flex cursor-pointer flex-col gap-0.5 px-3 py-2.5 text-typography-900"
        aria-label={t.expand(item.title)}
      >
        <span className="flex min-w-0 flex-nowrap items-center gap-2">
          <span className="shrink-0 rounded-full bg-[#FFF2E8] px-2 py-0.5 text-xs font-semibold text-[#8A3800]">
            {t.yourCall}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold" title={item.title}>
            {item.title}
          </span>
        </span>
        <span className="text-[13px] text-neutral-700">{item.why}</span>
      </summary>
      {open && (
        <div
          className="flex flex-col gap-3 border-t border-neutral-100 px-3 py-3"
          data-testid="needs-detail"
        >
          {q.isError ? (
            <p className="m-0 text-sm text-neutral-700">{t.changeFailed}</p>
          ) : !change ? (
            <LoadingBlock lines={3} />
          ) : (
            <>
              <p className="m-0 text-sm" data-testid="needs-result">
                {change.result}
              </p>
              {change.wording && (
                <Wording before={change.wording.before} after={change.wording.after} />
              )}
              {change.basedOn && (
                <p className="m-0 text-[13px] text-neutral-600" data-testid="needs-evidence">
                  {change.basedOn}
                </p>
              )}
            </>
          )}
          <PmConversation
            testId={`needs-pm-${item.changeId}`}
            className="border border-neutral-100"
            scoped
            about={{ kind: "change", id: item.changeId, label: item.title }}
            suggestions={en.debriefs.v2.conversation.suggestions.needsYou}
          />
        </div>
      )}
    </details>
  );
};
