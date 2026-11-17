import React, { useState } from "react";

import { Tag } from "@ally-ui-mono/ui-shared";
import { useGetPmAgentCardQuery } from "@api";
import type { PmCard, PmRecommendationPayload } from "@types";

import { copy } from "./copy";
import { absoluteTime, freshnessAge, relativeTime } from "./format";

const List: React.FC<{ title: string; items?: string[]; ordered?: boolean }> = ({
  title,
  items,
  ordered,
}) => {
  if (!items || items.length === 0) return null;
  const Tagname = ordered ? "ol" : "ul";
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
        {title}
      </h4>
      <Tagname
        className={`${ordered ? "list-decimal" : "list-disc"} pl-5 text-sm text-typography-800`}
      >
        {items.map((item, i) => (
          <li key={`${i}-${item}`}>{item}</li>
        ))}
      </Tagname>
    </div>
  );
};

/** A disclosure button: a real button with aria-expanded, so it is keyboard- and AT-friendly. */
const Disclosure: React.FC<{
  label: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
}> = ({ label, open, onToggle, controls }) => (
  <button
    type="button"
    aria-expanded={open}
    aria-controls={controls}
    onClick={onToggle}
    className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm font-medium text-primary-700 hover:underline md:min-h-0"
  >
    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
    {label}
  </button>
);

const EvidenceList: React.FC<{ cardId: string; count: number }> = ({ cardId }) => {
  const { data, isLoading, isError } = useGetPmAgentCardQuery(cardId);
  if (isLoading) return <p className="text-sm text-typography-600">{copy.evidenceLoading}</p>;
  if (isError) return <p className="text-sm text-red-700">{copy.evidenceFailed}</p>;
  const items = data?.evidence ?? [];
  if (items.length === 0) return <p className="text-sm text-typography-600">{copy.evidenceNone}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map(item => (
        <li key={item.id} className="rounded border border-neutral-500 p-2 text-sm">
          <div className="font-medium text-typography-900">
            {item.label ?? item.summary ?? item.id}
          </div>
          {item.label && item.summary && <div className="text-typography-700">{item.summary}</div>}
          {item.value !== undefined && item.value !== null && (
            <div className="text-typography-800">{String(item.value)}</div>
          )}
          <div className="text-xs text-typography-600">
            {item.source}
            {item.capturedAt && (
              <span title={absoluteTime(item.capturedAt)}> · {relativeTime(item.capturedAt)}</span>
            )}
            {item.url && (
              <>
                {" · "}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary-700 underline"
                >
                  Open source
                </a>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

export interface RecommendationCardProps {
  card: PmCard & { payload: PmRecommendationPayload };
  /** Bigger type in Focus mode. */
  focus?: boolean;
}

/**
 * The 10-second layer (headline, why, up to three change bullets, chips, impact metric) with the
 * full plan and the evidence one click away. Kind, size and risk are words, never colour alone.
 */
export const RecommendationCard: React.FC<RecommendationCardProps> = ({ card, focus }) => {
  const p = card.payload;
  const [planOpen, setPlanOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const fresh = freshnessAge(card.evidenceFreshness);
  const direction = p.impactMetric
    ? (copy.directions[p.impactMetric.direction] ?? p.impactMetric.direction)
    : "";

  return (
    <article aria-label={card.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag type="blue" size="sm">
          <span aria-hidden="true">◆ </span>
          {copy.kind.recommendation}
        </Tag>
        <Tag type="gray" size="sm">
          {copy.category[card.category]}
        </Tag>
        <Tag type="gray" size="sm">
          {copy.size[p.size] ?? p.size}
        </Tag>
        <Tag type={p.risk === "low" ? "gray" : p.risk === "medium" ? "warm-gray" : "red"} size="sm">
          <span aria-hidden="true">{copy.riskMark[p.risk]} </span>
          {copy.risk[p.risk]}
        </Tag>
      </div>

      <h2 className={`${focus ? "text-2xl" : "text-xl"} font-semibold text-typography-900`}>
        {p.title}
      </h2>

      <p className="text-base text-typography-800">
        <span className="font-semibold">{copy.why}: </span>
        {p.whyHeadline}
      </p>

      {p.change.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-typography-700">{copy.change}</h3>
          <ul className="list-disc pl-5 text-base text-typography-800">
            {p.change.slice(0, 3).map((c, i) => (
              <li key={`${i}-${c}`}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {p.impactMetric && (
        <p className="text-sm text-typography-700">{copy.impact(p.impactMetric.name, direction)}</p>
      )}

      <p className="text-xs text-typography-600">
        {copy.reviewedByCritic}
        {fresh && (
          <>
            {" · "}
            {fresh.stale ? copy.evidenceStale(fresh.label) : copy.evidenceFresh(fresh.label)}
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <Disclosure
          label={copy.fullPlan}
          open={planOpen}
          onToggle={() => setPlanOpen(o => !o)}
          controls={`plan-${card.id}`}
        />
        <Disclosure
          label={copy.evidence(card.payload.evidenceIds?.length)}
          open={evidenceOpen}
          onToggle={() => setEvidenceOpen(o => !o)}
          controls={`evidence-${card.id}`}
        />
      </div>

      {planOpen && (
        <section
          id={`plan-${card.id}`}
          aria-label={copy.fullPlan}
          className="rounded bg-neutral-100 p-3"
        >
          {p.problem && (
            <div className="mb-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-typography-600">
                {copy.planSections.problem}
              </h4>
              <p className="text-sm text-typography-800">{p.problem}</p>
            </div>
          )}
          <List title={copy.planSections.steps} items={p.plan?.steps} ordered />
          <List title={copy.planSections.files} items={p.plan?.files} />
          <List title={copy.planSections.acceptanceCriteria} items={p.plan?.acceptanceCriteria} />
          <List title={copy.planSections.testPlan} items={p.plan?.testPlan} />
          <List title={copy.planSections.defaultsChosen} items={p.plan?.defaultsChosen} />
          <List title={copy.planSections.alternativesDropped} items={p.alternativesDropped} />
          <List title={copy.planSections.repos} items={p.repos} />
          {(p.riskWhy || p.rollbackNote) && (
            <div className="text-sm text-typography-800">
              {p.riskWhy && (
                <p>
                  <span className="font-semibold">{copy.planSections.risk}: </span>
                  {p.riskWhy}
                </p>
              )}
              {p.rollbackNote && (
                <p>
                  <span className="font-semibold">{copy.planSections.rollback}: </span>
                  {p.rollbackNote}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {evidenceOpen && (
        <section id={`evidence-${card.id}`} aria-label={copy.evidence()}>
          <EvidenceList cardId={card.id} count={p.evidenceIds?.length ?? 0} />
        </section>
      )}
    </article>
  );
};
