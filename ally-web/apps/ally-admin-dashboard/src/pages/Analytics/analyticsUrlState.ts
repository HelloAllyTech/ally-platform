import { AnalyticsRange } from "@types";

/**
 * The page's filters live in the address so a view can be sent as a link and
 * survives a reload: `?tab=&range=&from=&to=&lang=&org=&ids=1`.
 *
 * Defaults are the ABSENT value (the page's own address stays `/analytics`),
 * matching how the tab param already behaved.
 */
export const DEFAULT_RANGE: AnalyticsRange = "90d";
export const CUSTOM_RANGE = "custom" as const;
export type RangeChoice = AnalyticsRange | typeof CUSTOM_RANGE;

const RANGES: RangeChoice[] = ["30d", "90d", "12m", CUSTOM_RANGE];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AnalyticsUrlState {
  range: RangeChoice;
  /** Only meaningful when range is "custom"; both present and ordered, else undefined. */
  from?: string;
  to?: string;
  language: string;
  org: string;
  showIds: boolean;
}

const validDay = (value: string | null): string | undefined =>
  value && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;

export const readAnalyticsUrlState = (params: URLSearchParams): AnalyticsUrlState => {
  const requested = params.get("range") as RangeChoice | null;
  const from = validDay(params.get("from"));
  const to = validDay(params.get("to"));
  const customOk = !!from && !!to && from <= to;
  // from/to without range=custom still means custom: a link carrying both is
  // unambiguous, and the API ignores `range` when they are present.
  const range: RangeChoice =
    customOk && (requested === CUSTOM_RANGE || !requested)
      ? CUSTOM_RANGE
      : requested && RANGES.includes(requested) && requested !== CUSTOM_RANGE
        ? requested
        : requested === CUSTOM_RANGE
          ? CUSTOM_RANGE
          : DEFAULT_RANGE;
  return {
    range,
    from: customOk ? from : undefined,
    to: customOk ? to : undefined,
    language: params.get("lang") ?? "",
    org: params.get("org") ?? "",
    showIds: params.get("ids") === "1",
  };
};

/** Apply a patch to the params, dropping any key whose value is its default. */
export const writeAnalyticsUrlState = (
  current: URLSearchParams,
  patch: Partial<AnalyticsUrlState>,
): URLSearchParams => {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | undefined, isDefault: boolean) => {
    if (!value || isDefault) next.delete(key);
    else next.set(key, value);
  };
  if ("range" in patch) {
    set("range", patch.range, patch.range === DEFAULT_RANGE);
    if (patch.range !== CUSTOM_RANGE) {
      next.delete("from");
      next.delete("to");
    }
  }
  if ("from" in patch) set("from", patch.from, false);
  if ("to" in patch) set("to", patch.to, false);
  if ("language" in patch) set("lang", patch.language, false);
  if ("org" in patch) set("org", patch.org, false);
  if ("showIds" in patch) set("ids", patch.showIds ? "1" : undefined, false);
  return next;
};
