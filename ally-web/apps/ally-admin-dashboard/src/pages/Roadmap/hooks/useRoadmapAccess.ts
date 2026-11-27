import { useContext, useSyncExternalStore } from "react";

import { ReactReduxContext } from "react-redux";

/**
 * What the signed-in person may open, read from the store when there is one. The Roadmap pages are
 * always inside it; a page rendered alone (a test, a preview) has no store and so no extra tabs.
 */
export const useRoadmapAccess = (): { permissions: string[]; features: string[] } => {
  const store = useContext(ReactReduxContext)?.store;
  const state = useSyncExternalStore(
    store ? store.subscribe : () => () => undefined,
    () => store?.getState().user,
    () => undefined,
  );
  return { permissions: state?.permissions ?? [], features: state?.features ?? [] };
};
