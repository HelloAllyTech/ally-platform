import { useGetRoadmapBreadthQuery } from "@api";

/**
 * What the priority score is CALLED on screen.
 *
 * With the breadth feature off the score is a plain vote total and says "votes", exactly as it
 * always has. With it on, the score is votes weighted by each voter's breadth, so it can read
 * 41.3 from 38 votes — calling that "votes" looks like a bug, so it becomes "points". `enabled`
 * comes from the server (one cached request shared with the header badge), so the label and the
 * arithmetic can never disagree. Until the answer arrives it stays "votes".
 */
export const useScoreUnit = (): { enabled: boolean; unit: "votes" | "points" } => {
  const { data } = useGetRoadmapBreadthQuery();
  const enabled = !!data?.enabled;
  return { enabled, unit: enabled ? "points" : "votes" };
};
