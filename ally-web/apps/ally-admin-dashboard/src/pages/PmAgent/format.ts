import type {
  PmCard,
  PmCardStatus,
  PmQuestionPayload,
  PmRecommendationPayload,
  PmRiskLevel,
} from "@types";

export const isRecommendation = (
  card: PmCard,
): card is PmCard & { payload: PmRecommendationPayload } => card.kind === "recommendation";

export const isQuestion = (card: PmCard): card is PmCard & { payload: PmQuestionPayload } =>
  card.kind === "question";

/** A card that needs a person rather than a decision: failed build, merged but not released. */
export const isNeedsYou = (card: PmCard): boolean =>
  Boolean(card.needsYou) ||
  card.status === "failed" ||
  card.status === "needs_attention" ||
  card.status === "merged_not_released";

export const riskOf = (card: PmCard): PmRiskLevel =>
  isRecommendation(card) ? card.payload.risk : "low";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2d ago", "in 3h". Absolute time goes in a `title`. */
export const relativeTime = (iso: string | number | null | undefined, now = Date.now()): string => {
  if (iso === null || iso === undefined || iso === "") return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  const abs = Math.abs(diff);
  let unit: string;
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) unit = `${Math.round(abs / MINUTE)}m`;
  else if (abs < DAY) unit = `${Math.round(abs / HOUR)}h`;
  else unit = `${Math.round(abs / DAY)}d`;
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
};

export const absoluteTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
};

/** Age of evidence as words. Accepts an ISO timestamp or an age in days. */
export const freshnessAge = (
  value: string | number | null | undefined,
  now = Date.now(),
): { label: string; stale: boolean } | null => {
  if (value === null || value === undefined || value === "") return null;
  let days: number;
  if (typeof value === "number") days = value;
  else {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    days = (now - t) / DAY;
  }
  const label =
    days < 1 ? "today" : `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago`;
  return { label, stale: days > 7 };
};

export const formatUsd = (value: number | null | undefined, cents = true): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return cents ? `$${value.toFixed(2)}` : `$${Math.round(value).toLocaleString()}`;
};

export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
};

/** "tomorrow at 09:00" / "today at 14:30" for the next-run line. */
export const nextRunLabel = (iso: string | null | undefined, now = Date.now()): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(d) - startOf(n)) / DAY);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (dayDiff <= 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  return `on ${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
};

/** Index (0-5) into the six-step stepper for a status, or -1 when it is not on the path. */
export const stepIndex = (status: PmCardStatus): number => {
  switch (status) {
    case "accepted_pending":
    case "queued":
      return 0;
    case "designing":
      return 1;
    case "building":
    case "failed":
    case "needs_attention":
      return 2;
    case "pr_open":
      return 3;
    case "merged":
    case "merged_not_released":
      return 4;
    case "released":
      return 5;
    default:
      return -1;
  }
};

/** True when `target` is editable text: shortcuts must stay out of the way. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

/** Browser download of a text file. */
export const saveTextFile = (filename: string, text: string, type = "text/markdown"): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "plan";
