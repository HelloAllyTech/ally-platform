import { useParams } from "react-router-dom";

import { useGetDebriefOptionsAvailabilityQuery } from "@api";

/**
 * Do the roleplay's Debrief choice shows in the editor? Only where the new Debrief is on for
 * the roleplay (nothing while that loads), or when the roleplay already holds a non-default
 * choice, so a saved choice is never invisible. `formMethods` is the editor's form.
 */
export const useDebriefOptionsVisible = (formMethods: any, scenarioId?: string): boolean => {
  const params = useParams<{ id: string }>();
  const id = scenarioId ?? params.id;
  const q = useGetDebriefOptionsAvailabilityQuery({ scenarioId: id });
  const saved = (name: string) => {
    const v = formMethods?.watch?.(name);
    return typeof v === "string" && v !== "";
  };
  const hasSavedChoice = saved("debriefRiskCueOption");
  return hasSavedChoice || q.data?.enabled === true;
};
