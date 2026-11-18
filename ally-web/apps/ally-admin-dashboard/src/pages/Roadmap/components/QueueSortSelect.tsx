import React from "react";

import { en } from "@constants";
import type { RoadmapQueueSort } from "@types";

import { RoadmapDropdown } from "./RoadmapDropdown";
import { QUEUE_SORTS } from "../utils/queueState";

/**
 * Sort, for whichever view you are on, default or saved: the order the list is in. On a default
 * view it is remembered for you; on a saved view it is part of the view. A Carbon Dropdown, so its
 * list is the app's own serif listbox rather than the operating system's menu.
 */
export const QueueSortSelect: React.FC<{
  id: string;
  sort: RoadmapQueueSort;
  onChange: (sort: RoadmapQueueSort) => void;
}> = ({ id, sort, onChange }) => {
  const copy = en.roadmapV2.sort;
  return (
    <RoadmapDropdown
      id={id}
      labelText={copy.label}
      hideLabel
      size="sm"
      value={sort}
      options={QUEUE_SORTS.map(option => ({
        value: option,
        label: copy.by(copy.options[option]),
      }))}
      onChange={value => onChange(value as RoadmapQueueSort)}
      className="min-w-[12rem]"
    />
  );
};
