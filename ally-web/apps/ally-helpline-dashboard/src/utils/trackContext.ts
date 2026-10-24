import { buildJourneyRoute, buildTrackRoute } from "@constants";
import { ACTIVE_TRACK_CONTEXT_KEY, ActiveTrackContext } from "@types";

/** Reads the return-to-track context stashed before launching a track item. */
export const readTrackContext = (): ActiveTrackContext | null => {
  try {
    const raw = sessionStorage.getItem(ACTIVE_TRACK_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveTrackContext;
    if (parsed?.trackId && parsed?.itemId) return parsed;
    return null;
  } catch {
    return null;
  }
};

/**
 * The course page a launched item returns to: Ally's journey when the guided
 * journey launched it, otherwise the classic course page.
 */
export const trackHomeRoute = (context: ActiveTrackContext): string =>
  context.returnTo === "guided"
    ? buildJourneyRoute(context.trackId, { returned: context.cardId })
    : buildTrackRoute(context.trackId);
