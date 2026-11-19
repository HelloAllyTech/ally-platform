import React from "react";

import { en } from "@constants";
import type { RoadmapDurationStats, RoadmapPlanWaits } from "@types";

import { formatDuration } from "../utils/measures";

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <div className="flex min-w-[8rem] flex-col gap-0.5 rounded-md border border-border-light bg-white p-3">
    <span className="text-xs text-typography-600">{label}</span>
    <span className="text-xl font-semibold tabular-nums text-typography-900">{value}</span>
    {note && <span className="text-xs text-typography-600">{note}</span>}
  </div>
);

const durationNote = (stats: RoadmapDurationStats): string | undefined => {
  const copy = en.roadmapIdeaToPlan.waits;
  if (!stats.n) return undefined;
  const p75 = formatDuration(stats.p75Ms);
  return [copy.over(stats.n), p75 ? copy.p75(p75) : null].filter(Boolean).join(" · ");
};

/**
 * Measures → Waits after review (idea-to-plan audit rec 9): accepted ideas nobody is planning, and
 * the two waits after review — filed to Start planning, and Start planning to Close plan — beside
 * the review wait. Plus rec 8's check: of the plans closed, how many authors opened theirs first.
 * Absent (renders nothing) from a server older than the change.
 */
export const PlanWaits: React.FC<{ waits?: RoadmapPlanWaits }> = ({ waits }) => {
  if (!waits) return null;
  const copy = en.roadmapIdeaToPlan.waits;
  const none = en.roadmapV2Measures.none;
  return (
    <section aria-labelledby="measures-waits" className="flex flex-col gap-3">
      <div>
        <h2 id="measures-waits" className="m-0 text-lg font-semibold text-typography-900">
          {copy.title}
        </h2>
        <p className="m-0 text-sm text-typography-600">{copy.help}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Stat label={copy.acceptedUnplanned} value={String(waits.acceptedUnplannedNow)} />
        <Stat label={copy.planningNow} value={String(waits.planningNow)} />
        <Stat
          label={copy.toPlanning}
          value={formatDuration(waits.submittedToPlanning.medianMs) || none}
          note={durationNote(waits.submittedToPlanning)}
        />
        <Stat
          label={copy.toClosed}
          value={formatDuration(waits.planningToClosed.medianMs) || none}
          note={durationNote(waits.planningToClosed)}
        />
        <Stat
          label={copy.authorLooked}
          value={
            waits.authorLooked.closed
              ? copy.authorLookedValue(waits.authorLooked.opened, waits.authorLooked.closed)
              : none
          }
          note={copy.authorLookedNote}
        />
      </div>
    </section>
  );
};
