import React, { useId, useState } from "react";

import { useGetRoadmapOpportunityBriefQuery } from "@api";
import { en } from "@constants";
import type { RoadmapOpportunityBrief } from "@types";

import { CopilotBrief } from "../../ProductRoadmap/CopilotBrief";

interface IdeaAgentFindingsProps {
  brief: RoadmapOpportunityBrief | null | undefined;
  /** "live" on the draft (its recommendations are addressed to the author), "filed" on the idea. */
  variant: "live" | "filed";
  /** On the draft the panel says how to fill it; on a filed idea it is simply left out. */
  showEmpty?: boolean;
}

/**
 * "What the idea agent found" (audit rec. 6): the research brief the idea agent builds every turn
 * (evidence, assumptions, open recommendations), which was paid for and shown nowhere on the new
 * pages. Collapsed by default: it is supporting detail, and the draft's own words and checks stay
 * the first thing read.
 */
export const IdeaAgentFindings: React.FC<IdeaAgentFindingsProps> = ({
  brief,
  variant,
  showEmpty = false,
}) => {
  const copy = en.roadmapV2.draft.findings;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!brief && !showEmpty) return null;
  return (
    <section aria-label={copy.title} className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-8 items-center justify-between gap-2 text-left"
      >
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
          {copy.title}
        </h3>
        <span className="text-xs text-primary-700">{open ? copy.hide : copy.show}</span>
      </button>
      {open && (
        <div id={bodyId}>
          {brief ? (
            <CopilotBrief brief={brief} variant={variant} assessmentLabel={copy.assessment} />
          ) : (
            <p className="m-0 text-sm text-typography-secondary">{copy.empty}</p>
          )}
        </div>
      )}
    </section>
  );
};

/** The idea page's mount: the brief as filed, fetched only for an idea that has one. */
export const IdeaAgentFindingsForItem: React.FC<{ itemId?: string }> = ({ itemId }) => {
  const { data } = useGetRoadmapOpportunityBriefQuery(itemId ?? "", { skip: !itemId });
  return <IdeaAgentFindings brief={data?.brief ?? null} variant="filed" />;
};
