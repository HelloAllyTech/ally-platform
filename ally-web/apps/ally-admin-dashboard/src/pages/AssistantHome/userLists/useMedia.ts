import { useEffect, useState } from "react";

/** Phones (and narrow windows) get cards and bottom sheets: the home's own breakpoint. */
export const PHONE = "(max-width: 959px)";

export const useMedia = (query: string): boolean => {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const on = () => setMatches(list.matches);
    on();
    list.addEventListener?.("change", on);
    return () => list.removeEventListener?.("change", on);
  }, [query]);
  return matches;
};
