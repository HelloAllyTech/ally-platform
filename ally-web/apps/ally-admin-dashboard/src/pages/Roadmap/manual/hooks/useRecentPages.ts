import { useCallback, useState } from "react";

import type { ManualPageRef } from "@types";

/** Per browser, like the Roadmap's other conveniences. Losing it costs nothing. */
export const RECENT_PAGES_KEY = "ally.productManual.recent";
export const RECENT_PAGES_MAX = 6;

export const readRecentPages = (): ManualPageRef[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_PAGES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is ManualPageRef =>
              !!item &&
              typeof (item as ManualPageRef).slug === "string" &&
              typeof (item as ManualPageRef).title === "string",
          )
          .slice(0, RECENT_PAGES_MAX)
      : [];
  } catch {
    return [];
  }
};

/** Puts `page` first, without duplicates, capped. Pure, for tests. */
export const withRecentPage = (list: ManualPageRef[], page: ManualPageRef): ManualPageRef[] =>
  [{ slug: page.slug, title: page.title }, ...list.filter(item => item.slug !== page.slug)].slice(
    0,
    RECENT_PAGES_MAX,
  );

/** The pages read most recently, newest first: what the search palette offers before you type. */
export const useRecentPages = (): {
  recent: ManualPageRef[];
  remember: (page: ManualPageRef) => void;
} => {
  const [recent, setRecent] = useState<ManualPageRef[]>(readRecentPages);
  const remember = useCallback((page: ManualPageRef) => {
    setRecent(current => {
      const next = withRecentPage(current, page);
      try {
        window.localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the list lasts for this page only.
      }
      return next;
    });
  }, []);
  return { recent, remember };
};
