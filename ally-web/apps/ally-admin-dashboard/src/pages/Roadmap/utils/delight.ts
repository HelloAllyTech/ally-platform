import { en } from "@constants";
import type { RoadmapItemDetail } from "@types";

import { shortDate } from "./copy";

/**
 * The earned moments (§4.14, §4.18): the Shipped card's facts and the outcome line. Credit is
 * positive only [FP-1019, FP-0992]: ideas shipped, never a count of declined ones.
 */

/** The outcome review as the read model sends it (`plan_outcome_reviews`, newest). */
interface OutcomeReview {
  verdict?: "hit" | "partial" | "miss" | string;
  observed?: string;
  at?: string;
}

const asReview = (value: unknown): OutcomeReview | null =>
  value && typeof value === "object" ? (value as OutcomeReview) : null;

/**
 * "Next-day return went from 41% to 52%": the result in plain words, written by whoever reviewed
 * the outcome. A bare string (an older shape) is used as it is. Empty when there is nothing to say.
 */
export const outcomeLine = (review: unknown): string => {
  if (typeof review === "string") return review.trim();
  const r = asReview(review);
  const observed = typeof r?.observed === "string" ? r.observed.replace(/\s+/g, " ").trim() : "";
  if (!observed) return "";
  const verdict = r?.verdict ? en.roadmapV2Tools.shipped.verdicts[r.verdict] : undefined;
  return verdict ? `${verdict}: ${observed}` : observed;
};

export interface ShippedFacts {
  /** "3 Nov": the first service to go live. */
  date: string;
  /** "Backend, Admin and helpline". */
  apps: string[];
  backers: number;
}

export const shippedFacts = (
  item: Pick<RoadmapItemDetail, "releases" | "votes" | "statusParts">,
): ShippedFacts => {
  const releases = Array.isArray(item.releases) ? item.releases : [];
  const live = releases.filter(r => r.state === "live");
  const services = en.roadmapV2.filter.services;
  const apps = Array.from(new Set(live.map(r => services[r.service] ?? r.service)));
  const dates = live
    .map(r => r.releasedAt)
    .filter((d): d is string => typeof d === "string")
    .sort();
  const parts = item.statusParts as { liveSince?: string | null } | undefined;
  const first = dates[0] ?? parts?.liveSince ?? null;
  return {
    date: shortDate(first),
    apps,
    backers: typeof item.votes === "number" && item.votes > 0 ? item.votes : 0,
  };
};

/** Only the idea's author gets the confetti; voters see the card without it (§4.18). */
export const isAuthorOf = (
  item: Pick<RoadmapItemDetail, "author">,
  userId: number | string | undefined | null,
): boolean =>
  userId != null && item.author?.id != null && String(item.author.id) === String(userId);
