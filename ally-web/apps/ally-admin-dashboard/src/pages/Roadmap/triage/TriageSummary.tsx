import React from "react";

import { Link } from "react-router-dom";

import { Button, SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapItemQuery } from "@api";
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
export const SimilarLine: React.FC<{ code: string }> = ({ code }) => {
  const copy = en.roadmapV2;
  const { data } = useGetRoadmapItemSimilarQuery(code);
  const matches = Array.isArray(data?.matches) ? data!.matches : [];
  return (
    <p className="m-0 text-sm text-typography-primary">
      <span className="text-xs font-semibold text-typography-secondary">
        {copy.triage.similar}:{" "}
      </span>
      {matches.length === 0
        ? copy.triage.similarNone
        : matches.map((m, i) => (
            <React.Fragment key={m.code}>
              {i > 0 && " · "}
              <Link to={ROUTES.ROADMAP_IDEA(m.code)} className="text-primary-700 hover:underline">
                {m.code}
              </Link>{" "}
              ({copy.status.votes(m.votes)}, {copy.stages[m.shownStage] ?? m.shownStage})
            </React.Fragment>
          ))}
    </p>
  );
};

/**
 * The triage reading pane (§4.6): the Summary first, not the conversation — who, pain, outcome,
 * similar ideas, votes and goal fit — then Pick a lead (which accepts it) and Decline.
 */
export const TriageSummary: React.FC<{
  code: string;
  /** Still awaiting review, so it can be declined as well as given a lead. */
  awaitingReview: boolean;
  onPickLead: () => void;
  onDecline: () => void;
}> = ({ code, awaitingReview, onPickLead, onDecline }) => {
  const copy = en.roadmapV2;
  const { data: item, isLoading } = useGetRoadmapItemQuery(code);
  if (isLoading || !item) {
    return (
      <div className="p-6" aria-busy="true">
        <SkeletonText heading width="60%" />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }
  return (
    <article className="flex flex-col gap-4 p-6" aria-label={`${item.code} ${item.title}`}>
      <header className="flex flex-col gap-1">
        <span className="text-xs tabular-nums text-typography-secondary">{item.code}</span>
        <h2
          tabIndex={-1}
          className="m-0 text-lg font-semibold text-typography-primary outline-none"
        >
          {item.title}
        </h2>
        <p className="m-0 text-sm text-typography-secondary">
          {copy.people.wrote(item.author?.name ?? copy.idea.unknownPerson)} ·{" "}
          {copy.row.votes(item.votes ?? 0)}
        </p>
      </header>
      <section aria-label={copy.triage.summaryFirst} className="flex flex-col gap-3">
        <SummaryFacts item={item} />
        <SimilarLine code={item.code} />
        <p className="m-0 text-sm text-typography-primary">
          {item.goal ? copy.triage.fitsGoal(item.goal.name) : copy.triage.noGoal}
        </p>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" size="md" onClick={onPickLead} aria-keyshortcuts="l">
          {copy.review.pickLead}
        </Button>
        {awaitingReview && (
          <Button kind="secondary" size="md" onClick={onDecline} aria-keyshortcuts="d">
            {copy.review.decline}
          </Button>
        )}
        <Link
          to={ROUTES.ROADMAP_IDEA(item.code)}
          className="inline-flex items-center px-2 text-sm text-primary-700 hover:underline"
        >
          {copy.triage.open}
        </Link>
      </div>
    </article>
  );
};
