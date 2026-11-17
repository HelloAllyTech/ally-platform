import { FC } from "react";

import { useGetRoadmapItemsQuery } from "@api";
import { en } from "@constants";

/**
 * Roadmap v2's badge: things waiting on you, the For you → Needs you count (plans §4.1, §4.8).
 * The same cache entry the Queue's For you view reads, polled slowly because it is on every page.
 * Mounted only on the Roadmap v2 entry, which shows only while `roadmap_v2` is on.
 */
export const RoadmapNavBadge: FC = () => {
  const { data } = useGetRoadmapItemsQuery(
    { view: "for-you" },
    { pollingInterval: 60_000, skipPollingIfUnfocused: true },
  );
  const sections = data && "sections" in data ? (data.sections as { needsYou?: unknown }) : null;
  const count = Array.isArray(sections?.needsYou) ? sections.needsYou.length : 0;
  if (count === 0) return null;
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-semibold text-white"
      aria-label={en.roadmapV2.mobile.forYouBadge(count)}
    >
      {count}
    </span>
  );
};
