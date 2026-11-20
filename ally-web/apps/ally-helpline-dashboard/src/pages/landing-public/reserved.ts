import { ROUTES } from "@constants";

/** Address segments the app owns beyond the paths in ROUTES (API, assets, the admin mount). */
const EXTRA_RESERVED = ["api", "assets", "static", "admin", "b"];

const firstSegment = (path: string): string | null => {
  const segment = path.split("/").filter(Boolean)[0]?.toLowerCase();
  return segment && !segment.startsWith(":") ? segment : null;
};

/**
 * First address segments that belong to the app itself. A landing page lives at
 * `/<tenant code>/<slug>`, so a URL whose first segment is one of these is an
 * app page and never asks the server about a landing page: no extra request
 * for a signed-in learner opening, say, /settings/profile. Built from ROUTES so
 * a new top-level route is covered the day it is added.
 */
export const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set(
  [
    ...Object.values(ROUTES).flatMap(value =>
      typeof value === "string" ? [firstSegment(value)] : [],
    ),
    ...EXTRA_RESERVED,
  ].filter((segment): segment is string => segment !== null),
);

export const isReservedFirstSegment = (segment: string): boolean =>
  RESERVED_FIRST_SEGMENTS.has(segment.toLowerCase());
