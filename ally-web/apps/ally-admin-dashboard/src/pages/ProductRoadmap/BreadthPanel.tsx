import React from "react";

import { useGetRoadmapBreadthEveryoneQuery } from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { RoadmapBreadthRow } from "@types";

import { formatMultiplier } from "./utils/points";

interface Band {
  id: string;
  label: string;
  rows: RoadmapBreadthRow[];
}

/**
 * Three bands rather than a ranked list: "Wide" (×1.20 and up), "Building" (×1.10 to under
 * ×1.20), "Getting started" (under ×1.10). Everyone's multiplier is visible, but the layout
 * deliberately has no rank numbers and no last place to be last in — and names inside a band are
 * alphabetical, not ordered by score, so the panel reads as "who's broad lately", not a table.
 */
export const bandRows = (rows: RoadmapBreadthRow[]): Band[] => {
  const byName = (a: RoadmapBreadthRow, b: RoadmapBreadthRow) => a.name.localeCompare(b.name);
  const bands: Band[] = [
    { id: "wide", label: "Wide", rows: rows.filter(r => r.multiplier >= 1.2).sort(byName) },
    {
      id: "building",
      label: "Building",
      rows: rows.filter(r => r.multiplier >= 1.1 && r.multiplier < 1.2).sort(byName),
    },
    {
      id: "starting",
      label: "Getting started",
      rows: rows.filter(r => r.multiplier < 1.1).sort(byName),
    },
  ];
  return bands.filter(b => b.rows.length > 0);
};

interface BreadthPanelProps {
  currentUserId?: number;
  onClose: () => void;
}

/** Everyone's breadth, in a right-hand panel opened from the budget readout. */
export const BreadthPanel: React.FC<BreadthPanelProps> = ({ currentUserId, onClose }) => {
  const { data, isLoading, isError, refetch } = useGetRoadmapBreadthEveryoneQuery();
  const rows = data ?? [];
  const me = rows.find(r => r.userId === currentUserId);
  const bands = bandRows(rows.filter(r => r.userId !== currentUserId));

  const renderRow = (row: RoadmapBreadthRow, isMe = false) => (
    <li key={row.userId} className="flex items-center gap-3 py-1.5">
      <span className={`flex-1 truncate ${isMe ? "text-typography-primary" : ""}`}>
        {isMe ? "You" : row.name || "Unnamed admin"}
      </span>
      <span className="tabular-nums">{formatMultiplier(row.multiplier)}</span>
      <span className="text-typography-secondary w-14 text-right text-xs tabular-nums">
        {row.qualifying} of {row.target}
      </span>
      <span aria-hidden className="bg-background-secondary h-1 w-16 shrink-0 overflow-hidden">
        <span
          className="bg-primary-500 block h-full"
          style={{
            width: `${Math.min(100, Math.round((row.qualifying / Math.max(1, row.target)) * 100))}%`,
          }}
        />
      </span>
    </li>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
      onKeyDown={event => event.key === "Escape" && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Everyone's breadth"
    >
      <aside
        className="bg-white relative flex h-full w-[26rem] max-w-full flex-col"
        onClick={event => event.stopPropagation()}
      >
        <header className="border-border-light flex items-center justify-between border-b p-4">
          <h2 className="text-typography-primary text-lg">Everyone&apos;s breadth</h2>
          <Button variant={ButtonVariant.TEXT} onClick={onClose}>
            Close
          </Button>
        </header>
        <div className="text-typography-secondary flex-1 overflow-y-auto p-4 text-sm">
          <p className="mb-4 text-xs">
            A vote is worth more when you&apos;ve recently backed more colleagues&apos;
            opportunities. Counted over the last 14 days; your own opportunities don&apos;t count.
          </p>
          {isLoading && <p>Loading…</p>}
          {isError && (
            <p>
              Couldn&apos;t load breadth.{" "}
              <button
                type="button"
                onClick={() => refetch()}
                className="text-primary-500 underline"
              >
                Retry
              </button>
            </p>
          )}
          {!isLoading && !isError && rows.length === 0 && <p>No one is voting yet.</p>}
          {me && <ul className="border-border-light mb-4 border-b pb-2">{renderRow(me, true)}</ul>}
          {bands.map(band => (
            <section key={band.id} className="mb-4">
              <h3 className="text-typography-primary mb-1 text-xs uppercase tracking-wide">
                {band.label}
              </h3>
              <ul>{band.rows.map(row => renderRow(row))}</ul>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
};
