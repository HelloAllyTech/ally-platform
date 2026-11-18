import React from "react";

import type { PlanStage } from "@api";

import { PROGRESS_STEPS, STAGE_LABEL } from "./planLabels";

interface PlanProgressProps {
  stage: PlanStage | null;
  /** One line after the stage, e.g. "Lead: user 4". */
  caption?: string;
}

/**
 * Where a plan is, as a small step bar plus its stage in words. The bar never gates anything:
 * the server decides what may happen next. Status is carried by text, not colour alone.
 */
export const PlanProgress: React.FC<PlanProgressProps> = ({ stage, caption }) => {
  if (!stage) return null;
  const index = PROGRESS_STEPS.findIndex(step => step.stage === stage);
  return (
    <div className="flex flex-col gap-1" aria-label={`Plan stage: ${STAGE_LABEL[stage]}`}>
      <ol className="flex items-center gap-1" aria-hidden="true">
        {PROGRESS_STEPS.map((step, i) => {
          let tone = "bg-gray-200";
          if (stage === "closed") tone = "bg-gray-300";
          else if (i <= index) tone = "bg-primary-500";
          return (
            <li key={step.stage} title={step.short} className={`h-1.5 w-6 rounded-full ${tone}`} />
          );
        })}
      </ol>
      <span className="text-xs text-typography-secondary">
        {STAGE_LABEL[stage]}
        {caption ? ` · ${caption}` : ""}
      </span>
    </div>
  );
};
