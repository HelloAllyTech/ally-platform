import { en } from "@constants";

/** What `summary.whyRanks` carries from ally-be (`RoadmapItemReadService.detail`). */
interface WhyRanksFacts {
  queueRank?: number | null;
  votes?: number;
  voters?: number;
  goalsHelped?: number;
  goalsAssessed?: number;
  starred?: boolean;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * "Why it ranks here" as one line (idea-to-plan audit rec 9): the server sends the facts behind the
 * rank as an object, which the page used to drop because it expected text. Plain text (an older or
 * newer server) still reads as itself. Empty when there is nothing to say.
 */
export const whyRanksLine = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string" && !!v.trim()).join(" · ");
  if (!value || typeof value !== "object") return "";
  const f = value as WhyRanksFacts;
  const copy = en.roadmapIdeaToPlan.whyRanks;
  const parts: string[] = [];
  if (finite(f.queueRank)) parts.push(copy.rank(f.queueRank));
  if (finite(f.votes) && f.votes > 0) {
    parts.push(copy.votes(Math.round(f.votes * 10) / 10, finite(f.voters) ? f.voters : 0));
  }
  if (finite(f.goalsAssessed) && f.goalsAssessed > 0) {
    parts.push(copy.goals(finite(f.goalsHelped) ? f.goalsHelped : 0, f.goalsAssessed));
  }
  if (f.starred === true) parts.push(copy.starred);
  return parts.join(" · ");
};
