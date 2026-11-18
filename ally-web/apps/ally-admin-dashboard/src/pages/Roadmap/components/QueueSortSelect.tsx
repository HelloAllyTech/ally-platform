import React from "react";

import { Select, SelectItem } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapQueueSort } from "@types";

import { QUEUE_SORTS } from "../utils/queueState";

/**
 * Sort, for whichever view you are on, default or saved: the order the list is in. On a default
 * view it is remembered for you; on a saved view it is part of the view.
 */
export const QueueSortSelect: React.FC<{
  id: string;
  sort: RoadmapQueueSort;
  onChange: (sort: RoadmapQueueSort) => void;
}> = ({ id, sort, onChange }) => {
  const copy = en.roadmapV2.sort;
  return (
    <Select
      id={id}
      labelText={copy.label}
      hideLabel
      size="sm"
      value={sort}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
        onChange(event.target.value as RoadmapQueueSort)
      }
      className="min-w-[10rem]"
    >
      {QUEUE_SORTS.map(option => (
        <SelectItem key={option} value={option} text={copy.by(copy.options[option])} />
      ))}
    </Select>
  );
};
