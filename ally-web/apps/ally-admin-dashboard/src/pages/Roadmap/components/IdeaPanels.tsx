import React from "react";

import { BuildView, PrdDocPanel, TechnicalDesignPanel } from "@components/builder";
import { ErrorBoundary } from "@components/error-boundary";
import { en } from "@constants";
import type { BuilderSessionDetail, RoadmapItemDetail } from "@types";

import { CodeText } from "./CodeChip";
import { ShipActions } from "./ReleaseDialog";
import { SimilarLine } from "../triage/TriageSummary";
import { IdeaPanelTab, shortDate, usd } from "../utils/copy";
import { outcomeLine } from "../utils/delight";

const noopSave = async () => undefined;

/** "Why it ranks here" arrives as data of no fixed shape; show it only when it reads as text. */
const whyRanksText = (value: unknown): string[] => {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string" && !!v.trim());
  return [];
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
      {label}
    </h4>
    <div className="text-sm text-typography-primary">{children}</div>
  </div>
);

export const SummaryPanel: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const copy = en.roadmapV2.idea.summary;
  const s = item.summary ?? {};
  const why = whyRanksText(s.whyRanks);
  const images = Array.isArray(s.images) ? s.images.filter(src => typeof src === "string") : [];
  const empty = !s.problem && !s.who && !s.outcome && why.length === 0 && images.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {item.declineReason && (
        <Field label={en.roadmapV2.idea.declineReasonTitle}>
          <CodeText text={item.declineReason} />
        </Field>
      )}
      {item.goal && <Field label={copy.goal}>{item.goal.name}</Field>}
      {s.problem && (
        <Field label={copy.problem}>
          <p className="m-0 whitespace-pre-wrap">
            <CodeText text={s.problem} />
          </p>
        </Field>
      )}
      {s.who && <Field label={copy.who}>{s.who}</Field>}
      {s.outcome && <Field label={copy.outcome}>{s.outcome}</Field>}
      {/* The one who decides, deciding: what it overlaps with, right where they read it. */}
      {item.can?.review && (
        <Field label={en.roadmapV2.triage.similar}>
          <SimilarLine code={item.code} bare />
        </Field>
      )}
      {why.length > 0 && (
        <Field label={copy.whyRanks}>
          <ul className="m-0 list-disc pl-4">
            {why.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Field>
      )}
      {images.length > 0 && (
        <Field label={copy.images}>
          <div className="grid grid-cols-2 gap-2">
            {images.map((src, i) => (
              // Fixed aspect box, so nothing shifts when an image arrives (§4.12).
              <a
                key={src}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-video overflow-hidden rounded border border-border-light bg-neutral-50"
              >
                <img
                  src={src}
                  alt={copy.image(i + 1)}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </Field>
      )}
      {empty && !item.declineReason && (
        <p className="text-sm text-typography-secondary">{copy.empty}</p>
      )}
    </div>
  );
};

export const PrdPanel: React.FC<{ item: RoadmapItemDetail; session?: BuilderSessionDetail }> = ({
  item,
  session,
}) => {
  const copy = en.roadmapV2.idea;
  if (!item.sessionId || !session?.prd || !session.readiness) {
    return <p className="text-sm text-typography-secondary">{copy.prdNone}</p>;
  }
  return (
    <ErrorBoundary variant="panel">
      {/* Read-only here: the PRD is edited in the plan session, not from the idea page (P2). */}
      <PrdDocPanel
        prd={session.prd}
        readiness={session.readiness}
        versionNumber={session.prdVersionNumber}
        editable={false}
        lockedReason=""
        onSaveSection={noopSave}
        sessionTitle={item.title}
        repos={session.repos ?? []}
        createdByName={session.createdByName}
      />
    </ErrorBoundary>
  );
};

export const DesignPanel: React.FC<{ item: RoadmapItemDetail; session?: BuilderSessionDetail }> = ({
  item,
  session,
}) => {
  const copy = en.roadmapV2.idea;
  const state = item.design?.state ?? "none";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-typography-primary">{copy.designStates[state]}</p>
      {item.sessionId && session ? (
        <ErrorBoundary variant="panel">
          <TechnicalDesignPanel
            sessionId={item.sessionId}
            design={session.prd?.technicalDesign ?? null}
            designReadiness={session.designReadiness}
            prdReady={!!session.readiness?.ready}
            // Approving is the lead's (or an Owner's) call; for everyone else the buttons are absent.
            readOnly={!item.can?.approveDesign}
          />
        </ErrorBoundary>
      ) : (
        <p className="text-sm text-typography-secondary">{copy.designNone}</p>
      )}
    </div>
  );
};

export const BuildPanel: React.FC<{ item: RoadmapItemDetail; session?: BuilderSessionDetail }> = ({
  item,
  session,
}) => {
  const copy = en.roadmapV2.idea;
  const runs = Array.isArray(item.runs) ? item.runs : [];
  const prs = Array.isArray(item.prs) ? item.prs : [];
  const ciWords = en.roadmapV2.status.ciWords;
  return (
    <div className="flex flex-col gap-4">
      {/* Absent for Viewers and for an idea with no session: then nothing is said about money. */}
      {item.spend && (
        <div className="flex flex-col gap-0.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
            {copy.spend}
          </h4>
          <p className="m-0 text-sm tabular-nums text-typography-primary">
            {en.roadmapV2.status.spend(usd(item.spend.spentUsd), usd(item.spend.ceilingUsd))}
          </p>
        </div>
      )}
      {prs.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
            {copy.prs}
          </h4>
          <ul className="m-0 list-none p-0 text-sm">
            {prs.map(pr => (
              <li
                key={`${pr.repo}#${pr.number}`}
                className="flex flex-wrap items-center gap-2 py-1"
              >
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {copy.prLine(pr.repo, pr.number)}
                </a>
                <span className="text-xs text-typography-secondary">
                  {pr.state}
                  {pr.ci ? ` · CI ${ciWords[pr.ci] ?? pr.ci}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {runs.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
            {copy.runs}
          </h4>
          <ul className="m-0 list-none p-0 text-sm">
            {runs.map(run => (
              <li key={run.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  {run.phase} · {run.state}
                </span>
                <span className="tabular-nums text-typography-secondary">{usd(run.costUsd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.sessionId && session && (runs.length > 0 || prs.length > 0) ? (
        <ErrorBoundary variant="panel">
          <BuildView
            sessionId={item.sessionId}
            status={session.status}
            sessionError={session.error}
            readOnly={!item.can?.merge}
          />
        </ErrorBoundary>
      ) : (
        runs.length === 0 &&
        prs.length === 0 && <p className="text-sm text-typography-secondary">{copy.buildNone}</p>
      )}
    </div>
  );
};

/** Ship: per-service release state from P1's item_releases, and the outcome review. */
export const ShipPanel: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const copy = en.roadmapV2.idea.ship;
  const releases = Array.isArray(item.releases) ? item.releases : [];
  const services = en.roadmapV2.filter.services;
  return (
    <div className="flex flex-col gap-4">
      {/* Release lists every commit it would ship before it ships (P5's plan). */}
      {item.can?.release && (
        <div>
          <ShipActions item={item} kind="release" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
          {copy.releases}
        </h4>
        {releases.length === 0 ? (
          <p className="m-0 text-sm text-typography-secondary">{copy.none}</p>
        ) : (
          <ul className="m-0 list-none p-0 text-sm">
            {releases.map(release => (
              <li
                key={release.service}
                className="flex flex-wrap items-center justify-between gap-2 py-1"
              >
                <span className="text-typography-primary">
                  {services[release.service] ?? release.service}
                </span>
                <span
                  className={
                    release.state === "failed" ? "text-red-700" : "text-typography-secondary"
                  }
                >
                  {copy.states[release.state] ?? release.state}
                  {release.tag ? ` · ${release.tag}` : ""}
                  {release.releasedAt ? ` · ${copy.liveSince(shortDate(release.releasedAt))}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {outcomeLine(item.outcome?.review) && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-typography-secondary">
            {copy.outcome}
          </h4>
          <p className="m-0 text-sm text-typography-primary">{outcomeLine(item.outcome?.review)}</p>
        </div>
      )}
    </div>
  );
};

/** One tab's content. */
export const IdeaPanelContent: React.FC<{
  tab: IdeaPanelTab;
  item: RoadmapItemDetail;
  session?: BuilderSessionDetail;
}> = ({ tab, item, session }) => {
  switch (tab) {
    case "prd":
      return <PrdPanel item={item} session={session} />;
    case "design":
      return <DesignPanel item={item} session={session} />;
    case "build":
      return <BuildPanel item={item} session={session} />;
    case "ship":
      return <ShipPanel item={item} />;
    default:
      return <SummaryPanel item={item} />;
  }
};
