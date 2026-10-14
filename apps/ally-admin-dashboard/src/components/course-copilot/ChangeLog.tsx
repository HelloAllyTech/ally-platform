import React, { useMemo, useState } from "react";

import { en } from "@constants";
import type { CourseChangeLogEntry } from "@types";
import { asAgentText, formatDateTime, formatRelativeTime } from "@utils";

import { asArray } from "./courseCopilotFormat";

export interface ChangeLogProps {
  entries: CourseChangeLogEntry[] | null | undefined;
}

/** Entries shown before "Show more" — enough to see the last few edits without turning the pane into a log viewer. */
const VISIBLE_ENTRIES = 8;

/**
 * What the copilot has changed, newest first, one line each. It is the trail behind the
 * highlight that fades after a couple of seconds: the trainer who looked away can still
 * find out what moved (Stacks, "Making Agent Trustworthiness Visible Through
 * Transparency": change logs so the agent's edits stay inspectable).
 *
 * Nothing renders for an empty log.
 */
export const ChangeLog: React.FC<ChangeLogProps> = ({ entries }) => {
  const strings = en.courseCopilotPane.course.changeLog;
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const list = asArray<CourseChangeLogEntry>(entries).filter(
      entry => entry && typeof entry === "object" && asAgentText(entry.summary).trim(),
    );
    // Entries are appended, so the stored order is oldest-first; sort by time and fall back
    // to reversing for entries whose timestamp is unreadable.
    return list
      .map((entry, index) => ({ entry, index, at: new Date(entry.at).getTime() }))
      .sort((a, b) => {
        const aValid = Number.isFinite(a.at);
        const bValid = Number.isFinite(b.at);
        if (aValid && bValid && a.at !== b.at) return b.at - a.at;
        return b.index - a.index;
      })
      .map(({ entry }) => entry);
  }, [entries]);

  if (sorted.length === 0) return null;

  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_ENTRIES);

  return (
    <section aria-label={strings.heading} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-typography-700">
        {strings.heading}
      </h3>
      <ol className="space-y-1.5">
        {visible.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-sm">
            <time
              dateTime={entry.at}
              title={formatDateTime(entry.at)}
              className="w-16 shrink-0 text-xs text-typography-700"
            >
              {formatRelativeTime(entry.at)}
            </time>
            <span className="min-w-0 flex-1 text-typography-900">{asAgentText(entry.summary)}</span>
          </li>
        ))}
      </ol>
      {sorted.length > VISIBLE_ENTRIES && (
        <button
          type="button"
          onClick={() => setShowAll(open => !open)}
          className="text-xs font-medium text-primary-600 hover:underline"
        >
          {showAll ? strings.showLess : strings.showMore(sorted.length - VISIBLE_ENTRIES)}
        </button>
      )}
    </section>
  );
};
