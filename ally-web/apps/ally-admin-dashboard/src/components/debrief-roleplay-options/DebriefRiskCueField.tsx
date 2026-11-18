import React from "react";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { en } from "@constants";

import { useDebriefOptionsVisible } from "./useDebriefOptionsVisible";

/** The saved value of the practised choice; anything else (or unset) is the default. */
export const PRACTISED_RISK_CUE_KEY = "part_of_practice";

/**
 * Simulation editor › the roleplay's one Debrief risk-cue question. Reads and writes the form
 * value `debriefRiskCueOption` (the practised key for Yes, or null for No), saved on the scenario.
 */
export const DebriefRiskCueField: React.FC<{
  id?: string;
  formMethods: any;
  readOnly?: boolean;
}> = ({ id = "debriefRiskCueOption", formMethods, readOnly }) => {
  const s = en.debriefRoleplayOptions;
  const visible = useDebriefOptionsVisible(formMethods);
  const yes = (formMethods?.watch(id) as string | null | undefined) === PRACTISED_RISK_CUE_KEY;
  if (!visible) return null;

  const choose = (practised: boolean) => {
    formMethods.setValue(id, practised ? PRACTISED_RISK_CUE_KEY : null, { shouldDirty: true });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="debrief-risk-cue-field">
      <span className="flex items-center gap-1 text-base text-typography-900" id={`${id}-label`}>
        {s.riskCueLabel}
        <Tooltip label={s.riskCueTip} align="top">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
        {[
          { value: false, label: s.riskCueNo, testId: "risk-cue-no" },
          { value: true, label: s.riskCueYes, testId: "risk-cue-yes" },
        ].map(o => (
          <label key={o.testId} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name={id}
              className="mt-1"
              data-testid={o.testId}
              checked={yes === o.value}
              disabled={readOnly}
              onChange={() => choose(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};
