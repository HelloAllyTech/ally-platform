import { FC } from "react";

import { UseFormReturn } from "react-hook-form";

import { en } from "@constants";

import { useMemoriesAutoMap } from "./useMemoriesAutoMap";

/**
 * Mounted beside the Skill Version picker: runs the first-switch memory
 * mapping and says so while it is in flight.
 */
export const MemoriesAutoMap: FC<{ formMethods: UseFormReturn<any> }> = ({ formMethods }) => {
  const { isMapping } = useMemoriesAutoMap(formMethods);
  if (!isMapping) return null;
  return (
    <p className="mt-2 text-sm text-typography-600" role="status">
      {en.memories.mapping}
    </p>
  );
};
