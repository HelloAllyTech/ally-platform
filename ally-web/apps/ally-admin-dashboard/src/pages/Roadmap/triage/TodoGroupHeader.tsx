import React from "react";

import { en } from "@constants";

import type { TodoGroupKey } from "./todoGroups";

interface TodoGroupHeaderProps {
  group: TodoGroupKey;
  count: number;
  /** Later only: folded away until asked for. */
  collapsed?: boolean;
  onToggle?: () => void;
}

/** One To do group's sticky heading: its name, its count, and what it waits for. */
export const TodoGroupHeader: React.FC<TodoGroupHeaderProps> = ({
  group,
  count,
  collapsed,
  onToggle,
}) => {
  const copy = en.roadmapIdeaToPlan;
  const label = copy.groups[group] ?? group;
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-2 bg-neutral-50 px-6 py-1.5">
      <h3
        className="m-0 text-xs font-semibold uppercase tracking-wide text-typography-secondary"
        title={copy.groupHelp[group]}
      >
        {en.roadmapV2.sectionCount(label, count)}
      </h3>
      {onToggle && count > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="ml-auto text-xs text-primary-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {collapsed ? copy.showLater(count) : copy.hideLater}
        </button>
      )}
    </div>
  );
};
