import React from "react";

import { RoadmapBriefEvidenceSource, RoadmapBriefRating, RoadmapOpportunityBrief } from "@types";

/**
 * Three words, never a number. A score per lens summed into a rank reads as an answer and stops
 * people arguing with the reasons — the reasons are the useful part, so they sit beside it.
 */
export const BRIEF_RATING_LABEL: Record<RoadmapBriefRating, string> = {
  needs_work: "Needs work",
  promising: "Promising",
  strong: "Strong",
};

const RATING_STYLE: Record<RoadmapBriefRating, string> = {
  needs_work: "bg-background-secondary text-typography-primary",
  promising: "bg-primary-50 text-primary-600",
  strong: "bg-green-50 text-green-700",
};

const SOURCE_LABEL: Record<RoadmapBriefEvidenceSource, string> = {
  admin: "Filer",
  analytics: "Analytics",
  ux_signals: "UX signals",
  bug_findings: "Bug Hunter",
  user_interviews: "User interviews",
  roadmap: "Roadmap",
  codebase: "Code",
  wiki: "Wiki",
  stacks: "Stacks",
  strategy: "Strategy",
};

/** Agent-written lists are not trusted to be lists — see normaliseOpportunityBrief server-side. */
const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const BriefRatingChip: React.FC<{ rating: RoadmapBriefRating }> = ({ rating }) => (
  // A plain span, not a Carbon Tag: Tag renders a <button>, which is invalid inside the
  // clickable rows this sometimes sits in.
  <span
    className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs ${
      RATING_STYLE[rating] ?? RATING_STYLE.needs_work
    }`}
  >
    {BRIEF_RATING_LABEL[rating] ?? BRIEF_RATING_LABEL.needs_work}
  </span>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="flex flex-col gap-1">
    <h4 className="text-typography-700 text-xs font-medium">{title}</h4>
    {children}
  </div>
);

interface CopilotBriefProps {
  brief: RoadmapOpportunityBrief;
  /**
   * "live" while the interview is still building it — the recommendations are addressed to the
   * filer. "filed" on an opportunity — the same recommendations are now open questions a voter
   * should weigh, and the copy says so.
   */
  variant: "live" | "filed";
}

/**
 * The opportunity copilot's brief: the case behind the draft.
 *
 * Sections with nothing in them are left out rather than shown empty — an empty "Evidence"
 * heading reads as "the copilot found nothing", which is a claim, and only the assessment can
 * make it. The assessment always shows, because the rating is the one thing every reader looks
 * for.
 */
export const CopilotBrief: React.FC<CopilotBriefProps> = ({ brief, variant }) => {
  const strategicFit = asList<{ goal: string; why: string }>(brief.strategicFit);
  const evidence = asList<RoadmapOpportunityBrief["evidence"][number]>(brief.evidence);
  const assumptions = asList<string>(brief.assumptions);
  const dropped = asList<string>(brief.alternativesDropped);
  const recommendations = asList<string>(brief.assessment?.openRecommendations);
  const reach = brief.reach ?? { howMany: null, howOften: null };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BriefRatingChip rating={brief.assessment?.rating ?? "needs_work"} />
          <span className="text-typography-700 text-xs">Copilot's assessment</span>
        </div>
        {!!brief.assessment?.summary && (
          <p className="text-typography-900 text-sm">{brief.assessment.summary}</p>
        )}
      </div>

      {recommendations.length > 0 && (
        <Section title={variant === "live" ? "Ways to make it stronger" : "Left open at filing"}>
          <ul className="text-typography-900 flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {recommendations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {strategicFit.length > 0 && (
        <Section title="Strategic fit">
          <ul className="flex flex-col gap-1 text-sm">
            {strategicFit.map((fit, index) => (
              <li key={index}>
                <span className="text-typography-900 font-medium">{fit.goal}</span>
                <span className="text-typography-700"> — {fit.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(reach.howMany || reach.howOften) && (
        <Section title="Reach">
          <dl className="text-sm">
            {reach.howMany && (
              <div className="flex gap-1">
                <dt className="text-typography-700 shrink-0">How many:</dt>
                <dd className="text-typography-900 min-w-0">{reach.howMany}</dd>
              </div>
            )}
            {reach.howOften && (
              <div className="flex gap-1">
                <dt className="text-typography-700 shrink-0">How often:</dt>
                <dd className="text-typography-900 min-w-0">{reach.howOften}</dd>
              </div>
            )}
          </dl>
        </Section>
      )}

      {evidence.length > 0 && (
        <Section title="Evidence">
          <ul className="flex flex-col gap-1.5 text-sm">
            {evidence.map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="bg-background-secondary text-typography-700 mt-0.5 shrink-0 rounded px-1.5 text-xs">
                  {SOURCE_LABEL[item.source] ?? item.source}
                </span>
                <span className="min-w-0">
                  <span className="text-typography-900">{item.claim}</span>
                  {!!item.ref && (
                    <span className="text-typography-secondary block break-words text-xs">
                      {item.ref}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!brief.successMetric && (
        <Section title="How we'd know it worked">
          <p className="text-typography-900 text-sm">{brief.successMetric}</p>
        </Section>
      )}

      {assumptions.length > 0 && (
        <Section title="What has to be true">
          <ul className="text-typography-900 flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {assumptions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {dropped.length > 0 && (
        <Section title="Considered and set aside">
          <ul className="text-typography-700 flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {dropped.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};
