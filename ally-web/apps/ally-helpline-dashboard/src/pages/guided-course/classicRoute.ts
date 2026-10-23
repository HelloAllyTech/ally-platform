import {
  buildCourseLandingRoute,
  buildTrackItemRoute,
  buildTrackRoute,
  LOCAL_STORAGE_KEYS,
} from "@constants";

/** The escape hatch: `?view=classic` always opens the classic course (journey and `/course`). */
export const CLASSIC_VIEW_PARAM = "view";
export const CLASSIC_VIEW = "classic";

const signedIn = (): boolean => {
  try {
    return Boolean(localStorage.getItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN));
  } catch {
    return false;
  }
};

/**
 * Where "classic" is for this person. A signed-in learner gets the course
 * page (at the current item when there is one). A visitor gets the public
 * landing with `?view=classic`, which `/course/:id` honours instead of
 * sending them straight back to the journey. `visitor` says which when the
 * caller knows; otherwise the stored sign-in decides.
 */
export const classicRouteFor = (
  trackId: string,
  { itemId, visitor }: { itemId?: string | null; visitor?: boolean } = {},
): string => {
  if (visitor ?? !signedIn()) {
    return `${buildCourseLandingRoute(trackId)}?${CLASSIC_VIEW_PARAM}=${CLASSIC_VIEW}`;
  }
  return itemId ? buildTrackItemRoute(trackId, itemId) : buildTrackRoute(trackId);
};
