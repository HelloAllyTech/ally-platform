import type { RoadmapReleaseWindow, RoadmapV2SettingsFields, RoadmapV2SettingsPatch } from "@types";

/**
 * The Settings tab's roadmap form (P0's fields): what the inputs hold, and the PATCH they make.
 * Kept apart from the component so the rules — held paths one per line, empty means the defaults,
 * a window needs a day and two different hours — are tested on their own.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export interface RoadmapSettingsForm {
  windowOn: boolean;
  days: number[];
  /** 0–23. */
  startHour: number;
  /** 1–24, exclusive; below startHour runs past midnight. */
  endHour: number;
  timeZone: string;
  /** One glob per line; empty restores the defaults. */
  heldPaths: string;
  inProgressLimit: string;
  maxLeadCeilingUsd: string;
  awaitingReviewAmberDays: string;
}

const hourOf = (hhmm: unknown): number | undefined => {
  if (typeof hhmm !== "string") return undefined;
  const m = hhmm.match(/^(\d{1,2}):\d{2}$/);
  return m ? Number(m[1]) : undefined;
};

/** Reads P0's hours or P5's "HH:MM", whichever the stored window has. */
export const readWindow = (
  window: RoadmapReleaseWindow | null | undefined,
): { days: number[] | null; startHour: number; endHour: number; timeZone: string } | null => {
  if (!window || typeof window !== "object") return null;
  const startHour = window.startHour ?? hourOf(window.start);
  let endHour = window.endHour ?? hourOf(window.end);
  if (startHour === undefined || endHour === undefined) return null;
  if (endHour === 0) endHour = 24;
  return {
    days: Array.isArray(window.days) ? window.days : null,
    startHour,
    endHour,
    timeZone: window.timeZone ?? window.timezone ?? DEFAULT_TIME_ZONE,
  };
};

const hhmm = (hour: number): string => `${String(hour % 24).padStart(2, "0")}:00`;

/** Both shapes in one object: P0's DTO validates the hours, P5's policy reads the rest. */
export const writeWindow = (
  form: Pick<RoadmapSettingsForm, "days" | "startHour" | "endHour" | "timeZone">,
): RoadmapReleaseWindow => {
  const timeZone = form.timeZone.trim() || DEFAULT_TIME_ZONE;
  const days = [...form.days].sort((a, b) => a - b);
  return {
    startHour: form.startHour,
    endHour: form.endHour,
    timezone: timeZone,
    days: days.length === 7 ? null : days,
    start: hhmm(form.startHour),
    end: hhmm(form.endHour),
    timeZone,
  };
};

export const formFromSettings = (s: RoadmapV2SettingsFields | undefined): RoadmapSettingsForm => {
  const window = readWindow(s?.releaseWindow);
  return {
    windowOn: !!window,
    days: window?.days ?? [0, 1, 2, 3, 4, 5, 6],
    startHour: window?.startHour ?? 10,
    endHour: window?.endHour ?? 17,
    timeZone: window?.timeZone ?? DEFAULT_TIME_ZONE,
    heldPaths: Array.isArray(s?.autoReleaseHeldPaths) ? s!.autoReleaseHeldPaths.join("\n") : "",
    inProgressLimit: s?.inProgressLimit != null ? String(s.inProgressLimit) : "3",
    maxLeadCeilingUsd: s?.maxLeadCeilingUsd != null ? String(Number(s.maxLeadCeilingUsd)) : "200",
    awaitingReviewAmberDays:
      s?.awaitingReviewAmberDays != null ? String(s.awaitingReviewAmberDays) : "5",
  };
};

/** Lines, trimmed, blanks and duplicates dropped. Null (= the defaults in code) when none remain. */
export const parseHeldPaths = (text: string): string[] | null => {
  const lines = Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean),
    ),
  );
  return lines.length ? lines : null;
};

export const windowIsValid = (
  form: Pick<RoadmapSettingsForm, "days" | "startHour" | "endHour">,
): boolean =>
  form.days.length > 0 &&
  Number.isInteger(form.startHour) &&
  form.startHour >= 0 &&
  form.startHour <= 23 &&
  Number.isInteger(form.endHour) &&
  form.endHour >= 1 &&
  form.endHour <= 24 &&
  form.startHour !== form.endHour % 24;

const intIn = (value: string, min: number, max: number): number | undefined => {
  const n = Number(value);
  return value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/**
 * The PATCH body, or null when something is invalid (the form says why). Ranges mirror ally-be's
 * DTO: in-progress limit 1..12, amber days 1..60, ceiling 1..100000.
 */
export const patchFromForm = (form: RoadmapSettingsForm): RoadmapV2SettingsPatch | null => {
  if (form.windowOn && !windowIsValid(form)) return null;
  const inProgressLimit = intIn(form.inProgressLimit, 1, 12);
  const awaitingReviewAmberDays = intIn(form.awaitingReviewAmberDays, 1, 60);
  const ceiling = Number(form.maxLeadCeilingUsd);
  if (inProgressLimit === undefined || awaitingReviewAmberDays === undefined) return null;
  if (
    !form.maxLeadCeilingUsd.trim() ||
    !Number.isFinite(ceiling) ||
    ceiling < 1 ||
    ceiling > 100_000
  ) {
    return null;
  }
  return {
    releaseWindow: form.windowOn ? writeWindow(form) : null,
    autoReleaseHeldPaths: parseHeldPaths(form.heldPaths),
    inProgressLimit,
    maxLeadCeilingUsd: ceiling,
    awaitingReviewAmberDays,
  };
};
