import { useEffect, useMemo, useRef } from "react";

import { useGetUserPreferencesQuery, useUpdateUserPreferencesMutation } from "@api";

import { LiveNumbers, Seen, SinceVisit, rollSeen, sinceVisit } from "./seen";

/**
 * What changed since the person's last visit, from two snapshots kept in their
 * preferences under `prefKey` (see `seen.ts`). Decided once, when the numbers
 * have arrived: saving the new snapshot refetches the preferences, and the
 * comparison must not change under the reader. A save that fails only means the
 * next visit compares with an older one.
 *
 * Returns null until `live` is known, and on a first visit.
 */
export const useSeenComparison = (
  prefKey: string,
  live: LiveNumbers | null,
): { since: SinceVisit | null; seen: Seen | null } => {
  const preferences = useGetUserPreferencesQuery();
  const [savePreferences] = useUpdateUserPreferencesMutation();
  const ready = !preferences.isLoading && !!live;

  const rolled = useMemo(() => {
    if (!ready || !live) return null;
    const saved = (preferences.data?.data as Record<string, unknown> | null | undefined)?.[prefKey];
    return { live, ...rollSeen(saved, live, new Date()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const saved = useRef(false);
  useEffect(() => {
    if (!rolled?.changed || saved.current) return;
    saved.current = true;
    Promise.resolve(savePreferences({ [prefKey]: rolled.seen }).unwrap?.()).catch(() => undefined);
  }, [rolled, savePreferences, prefKey]);

  return {
    since: rolled ? sinceVisit(rolled.seen, rolled.live) : null,
    seen: rolled?.seen ?? null,
  };
};
