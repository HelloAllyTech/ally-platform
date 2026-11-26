import { createContext, useContext, useEffect, useState } from "react";

import type { ManualPageRow } from "@types";

/**
 * What every manual component needs from the tree without asking for it again: the rows by slug
 * (wikilink checks and hover previews use these, so a preview never makes a request).
 */
export interface ManualDataValue {
  pages: ManualPageRow[];
  bySlug: Map<string, ManualPageRow>;
}

export const ManualDataContext = createContext<ManualDataValue>({
  pages: [],
  bySlug: new Map(),
});

export const useManualData = (): ManualDataValue => useContext(ManualDataContext);

/** True while the tab is visible: the state banner polls only then. */
export const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
};
