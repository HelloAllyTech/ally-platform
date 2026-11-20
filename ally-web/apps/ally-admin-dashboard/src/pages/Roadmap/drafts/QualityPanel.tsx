import React, { useId, useState } from "react";

import { en } from "@constants";

import type { RoadmapDraftQuality } from "../../../types/roadmapV2Flow";

interface QualityPanelProps {
  quality: RoadmapDraftQuality | null | undefined;
  /** On the draft the panel says how to fill it before the first turn; elsewhere it is left out. */
  showEmpty?: boolean;
}

/**
 * "Idea quality": the 0-100 score the idea must reach on top of its checks, with the six
 * dimensions it is made of. Not-passed names the weakest dimension so the author knows what the
 * next answer should strengthen; passed reads as "Ready for the board". The breakdown is collapsed
 * by default: the verdict and the one thing to fix are the point.
 */
export const QualityPanel: React.FC<QualityPanelProps> = ({ quality, showEmpty = false }) => {
  const copy = en.roadmapV2.draft.quality;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!quality) {
    return showEmpty ? (
      <section aria-label={copy.title} className="flex flex-col gap-1">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
          {copy.title}
        </h3>
        <p className="m-0 text-sm text-typography-secondary">{copy.empty}</p>
      </section>
    ) : null;
  }

  const dimensions = Array.isArray(quality.dimensions) ? quality.dimensions : [];
  const weakest = dimensions.find(d => d.id === quality.weakest) ?? null;
  const pct = Math.max(0, Math.min(100, Math.round(quality.score)));
  const passMark = Math.max(0, Math.min(100, Math.round(quality.passScore)));

  return (
    <section
      aria-label={copy.title}
      data-quality-passed={quality.passed || undefined}
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        quality.passed ? "border-success-600" : "border-border-light"
      }`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-typography-primary">{copy.title}</h3>
        <span className="text-sm tabular-nums text-typography-secondary">
          <span className="sr-only">{copy.scoreLong(pct, passMark)}</span>
          <span aria-hidden>{copy.scoreLine(pct, passMark)}</span>
        </span>
      </header>

      {/* The score as a bar with the pass mark ticked on it; the words carry the same fact. */}
      <div aria-hidden className="relative h-2 rounded-full bg-neutral-100">
        <div
          className={`h-2 rounded-full transition-[width] duration-200 motion-reduce:transition-none ${
            quality.passed ? "bg-success-600" : "bg-primary-600"
          }`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute -top-0.5 h-3 w-0.5 bg-typography-secondary"
          style={{ left: `${passMark}%` }}
        />
      </div>

      <p className="m-0 text-sm text-typography-primary" role="status">
        {quality.passed ? copy.passed : copy.notPassed}
        <span className="text-typography-secondary">
          {" · "}
          {quality.passed ? copy.passedHelp : copy.notPassedHelp}
        </span>
      </p>
      {!quality.passed && weakest && (
        <p className="m-0 text-xs font-medium text-typography-primary">
          {copy.weakest(weakest.label)}
          {weakest.note ? (
            <span className="font-normal text-typography-secondary"> · {weakest.note}</span>
          ) : null}
        </p>
      )}

      {dimensions.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(value => !value)}
            className="self-start text-xs text-primary-700"
          >
            {open ? copy.hide : copy.show}
          </button>
          {open && (
            <ul id={bodyId} className="m-0 flex list-none flex-col gap-2 p-0">
              {dimensions.map(d => (
                <DimensionRow key={d.id} dimension={d} max={quality.scaleMax} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

const DimensionRow: React.FC<{
  dimension: RoadmapDraftQuality["dimensions"][number];
  max: number;
}> = ({ dimension, max }) => {
  const copy = en.roadmapV2.draft.quality;
  const below = dimension.score < dimension.floor;
  const dots = Array.from({ length: Math.max(1, max) }, (_, i) => i < dimension.score);
  return (
    <li className="flex flex-col gap-0.5" data-dimension={dimension.id}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-typography-primary">
          {dimension.label}
          {below && <span className="text-xs text-warning-700"> · {copy.belowFloor}</span>}
        </span>
        <span
          className="flex items-center gap-1"
          role="img"
          aria-label={copy.dimensionScore(dimension.score, max)}
        >
          {dots.map((on, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-2 w-2 rounded-full ${on ? "bg-primary-600" : "bg-neutral-200"}`}
            />
          ))}
        </span>
      </div>
      {dimension.note && (
        <span className="text-xs text-typography-secondary">{dimension.note}</span>
      )}
    </li>
  );
};
