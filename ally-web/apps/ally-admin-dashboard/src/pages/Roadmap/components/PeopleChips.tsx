import React from "react";

import { DefinitionTooltip } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapItemRow, RoadmapPersonRef } from "@types";

/**
 * A person's name as a chip. Hover or focus (a tap on a phone focuses it) shows "ideas shipped: 3"
 * (§4.14). Credit is positive only [FP-1019, FP-0992]: nothing shows for zero, and no declined
 * count exists anywhere.
 */
export const PersonChip: React.FC<{ person: RoadmapPersonRef; prefix?: string }> = ({
  person,
  prefix,
}) => {
  const shipped =
    typeof person.ideasShipped === "number" && person.ideasShipped > 0 ? person.ideasShipped : 0;
  const text = prefix ? `${prefix} ${person.name}` : person.name;
  if (!shipped) {
    return <span className="text-xs text-typography-600">{text}</span>;
  }
  const hint = en.roadmapV2Tools.people.ideasShipped(shipped);
  // A definition tooltip: the name stays the button's name and the count is its description, so a
  // screen reader hears "Ravi, ideas shipped: 3". Hover, focus or a tap opens it.
  return (
    <DefinitionTooltip definition={hint} openOnHover align="bottom" className="text-xs">
      {text}
    </DefinitionTooltip>
  );
};

/** "Ravi wrote it · Priya leads", with each name a chip. */
export const PeopleChips: React.FC<{ item: Pick<RoadmapItemRow, "author" | "lead"> }> = ({
  item,
}) => {
  const p = en.roadmapV2Tools.people;
  const parts: React.ReactNode[] = [];
  if (item.author?.name) {
    parts.push(
      <span key="author" className="inline-flex items-center gap-1">
        <PersonChip person={item.author} />
        <span className="text-xs text-typography-600">{p.wroteIt}</span>
      </span>,
    );
  }
  if (item.lead?.name) {
    parts.push(
      <span key="lead" className="inline-flex items-center gap-1">
        <PersonChip person={item.lead} />
        <span className="text-xs text-typography-600">{p.leadsIt}</span>
      </span>,
    );
  }
  if (!parts.length) return null;
  return (
    <p
      className="m-0 flex flex-wrap items-center gap-x-1 text-xs text-typography-600"
      aria-label={en.roadmapV2Tools.people.label}
    >
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span aria-hidden>·</span>}
          {part}
        </React.Fragment>
      ))}
    </p>
  );
};
