import React, { createContext, useContext, useEffect, useRef, useState } from "react";

import { en } from "@constants/en";
import { RoadmapOpportunity, RoadmapRankWeights } from "@types";

import { explainRank } from "./utils/rankExplain";

/**
 * What the "Why this rank?" popover needs: the live weights and the vote-total base. Held in a
 * context so rows and the peek read it without each fetching, and so a row rendered without a
 * provider (a test, a reader the weights did not load for) simply shows no button.
 */
export interface RankExplainValue {
  weights: RoadmapRankWeights;
  maxScore: number | undefined;
}
export const RankExplainContext = createContext<RankExplainValue | null>(null);

/**
 * A small "Why?" link that opens the rank score's workings: each factor's input, weight and the
 * points it contributes, and the two situations that most often surprise people — an unsized
 * idea counts as 50 on effort, and an idea nobody has voted on ranks on effort and goals alone.
 */
export const RankWhy: React.FC<{ opportunity: RoadmapOpportunity }> = ({ opportunity }) => {
  const context = useContext(RankExplainContext);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [isOpen]);

  if (!context) return null;
  const explanation = explainRank(opportunity, context.weights, context.maxScore);

  return (
    <span
      ref={rootRef}
      className="relative inline-block"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={en.roadmapTriage.rankWhyTip}
        onClick={() => setIsOpen(open => !open)}
        className="text-primary-500 cursor-pointer text-xs hover:underline"
      >
        {en.roadmapTriage.rankWhy}
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label={en.roadmapTriage.rankWhy}
          className="border-border-light absolute left-0 top-full z-40 mt-1 flex w-72 flex-col gap-2 border bg-white p-3 text-left shadow-md"
        >
          <p className="text-typography-primary text-sm">
            Rank score <span className="tabular-nums">{explanation.score}</span> out of 100
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-typography-secondary text-left">
                <th className="font-normal">Factor</th>
                <th className="text-right font-normal">Weight</th>
                <th className="text-right font-normal">Adds</th>
              </tr>
            </thead>
            <tbody>
              {explanation.rows.map(row => (
                <tr key={row.key} className="align-top">
                  <td className="text-typography-primary pr-2">
                    {row.label}
                    <span className="text-typography-secondary block">{row.input}</span>
                  </td>
                  <td className="text-typography-secondary text-right tabular-nums">
                    {row.sharePct}%
                  </td>
                  <td className="text-typography-primary text-right tabular-nums">
                    {row.contribution === null ? "—" : row.contribution}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {explanation.unsized && (
            <p className="text-typography-secondary text-xs">{en.roadmapTriage.rankUnsizedNote}</p>
          )}
          {explanation.noVotes && (
            <p className="text-typography-secondary text-xs">{en.roadmapTriage.rankNoVotes}</p>
          )}
          <p className="text-typography-secondary text-xs">{en.roadmapTriage.rankWeightsLink}</p>
        </div>
      )}
    </span>
  );
};
