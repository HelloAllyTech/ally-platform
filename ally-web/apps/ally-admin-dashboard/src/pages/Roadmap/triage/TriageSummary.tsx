import React from "react";

import { Link, useLocation } from "react-router-dom";

import { ROUTES, en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { useGetRoadmapItemSimilarQuery } from "../../../api/roadmapV2Flow";
import { CodeText } from "../components/CodeChip";

/** A short "who / pain / outcome" block from the idea's summary; the same in the pane and the card. */
export const SummaryFacts: React.FC<{ item: RoadmapItemDetail; compact?: boolean }> = ({
  item,
  compact,
}) => {
  const s = en.roadmapV2.idea.summary;
  const summary = item.summary ?? {};
  const facts: [string, string | undefined][] = [
    [s.who, summary.who],
    [s.problem, summary.problem],
    [s.outcome, summary.outcome],
  ];
  const shown = facts.filter(([, v]) => v && v.trim());
  if (shown.length === 0) return <p className="m-0 text-sm text-typography-secondary">{s.empty}</p>;
  return (
    <dl className="m-0 flex flex-col gap-2">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold text-typography-secondary">{label}</dt>
          <dd className={`m-0 text-sm text-typography-primary ${compact ? "line-clamp-3" : ""}`}>
            <CodeText text={value ?? ""} />
          </dd>
        </div>
      ))}
    </dl>
  );
};

/** "Similar: OPP-212 (▲32, Accepted)". */
export const SimilarLine: React.FC<{ code: string; bare?: boolean }> = ({ code, bare }) => {
  const copy = en.roadmapV2;
  const { data } = useGetRoadmapItemSimilarQuery(code);
  const { pathname, search } = useLocation();
  // In the Queue a similar idea opens in the reading pane, not on another page.
  const to = (target: string) => {
    if (pathname !== ROUTES.ROADMAP) return ROUTES.ROADMAP_IDEA(target);
    const params = new URLSearchParams(search);
    params.set("open", target);
    return { pathname, search: `?${params.toString()}` };
  };
  const matches = Array.isArray(data?.matches) ? data!.matches : [];
  return (
    <p className="m-0 text-sm text-typography-primary">
      {!bare && (
        <span className="text-xs font-semibold text-typography-secondary">
          {copy.triage.similar}:{" "}
        </span>
      )}
      {matches.length === 0
        ? copy.triage.similarNone
        : matches.map((m, i) => (
            <React.Fragment key={m.code}>
              {i > 0 && " · "}
              <Link to={to(m.code)} className="text-primary-700 hover:underline">
                {m.code}
              </Link>{" "}
              ({copy.status.votes(m.votes)}, {copy.stages[m.shownStage] ?? m.shownStage})
            </React.Fragment>
          ))}
    </p>
  );
};
