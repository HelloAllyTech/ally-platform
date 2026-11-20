import { useEffect } from "react";

import { en } from "@constants";

/**
 * Sets the browser tab title to "<Page> · Ally Admin" while mounted. Pass `enabled: false` to leave
 * the title to someone else (a child that sets its own).
 */
export const useDocumentTitle = (page: string | undefined, enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    document.title = page ? `${page} · ${en.nav.appName}` : en.nav.appName;
  }, [page, enabled]);
};
