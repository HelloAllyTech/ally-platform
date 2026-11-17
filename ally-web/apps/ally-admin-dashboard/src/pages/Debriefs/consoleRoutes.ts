import { ROUTES } from "@constants";

/** The Analytics tab the Debriefs metrics live under (kept here so this module stays light). */
export const ANALYTICS_DEBRIEFS_TAB = "debriefs";

/** Analytics › Debriefs: the debriefs' metrics, PM agent and agent numbers included. */
export const analyticsDebriefsPath = () => `${ROUTES.ANALYTICS}?tab=${ANALYTICS_DEBRIEFS_TAB}`;

/**
 * Changes (v2: the old PM agent page). `?view=` picks the tab, `?change=` the change in focus.
 * Older links (`?view=ideas|releases`, `?idea=`) open on Changes; see `readChangesView`.
 */
export type PmAgentView = "changes" | "reports" | "test-sets";
export const pmAgentPath = (view: PmAgentView = "changes", change?: string): string => {
  const q = new URLSearchParams();
  if (view !== "changes") q.set("view", view);
  if (change) q.set("change", change);
  const qs = q.toString();
  return `${ROUTES.DEBRIEFS_PM_AGENT}${qs ? `?${qs}` : ""}`;
};

/** Changes with one change open. */
export const changesPath = (changeId?: string): string => pmAgentPath("changes", changeId);

/** The tab and change a Changes link opens, old PM agent links included. */
export const readChangesView = (
  params: URLSearchParams,
): { view: PmAgentView; change: string | null } => {
  const raw = params.get("view");
  const view: PmAgentView = raw === "reports" || raw === "test-sets" ? raw : "changes";
  return { view, change: params.get("change") ?? params.get("idea") };
};

/** Changes › Reports at one report: `?view=reports&kind=monthly&period=2026-10`. */
export const pmReportPath = (kind: "weekly" | "monthly", period: string): string =>
  `${ROUTES.DEBRIEFS_PM_AGENT}?${new URLSearchParams({ view: "reports", kind, period })}`;

export type SettingsSection =
  | "orgs"
  | "budget"
  | "tests"
  | "autonomy"
  | "weights"
  | "pinned"
  | "clinical"
  | "progress"
  | "schedules"
  | "risk-cues"
  | "guidance";
export const settingsPath = (section?: SettingsSection): string =>
  `${ROUTES.DEBRIEFS_SETTINGS}${section ? `#${section}` : ""}`;

/**
 * The console had tabs in `?tab=` until the redesign (2026-11-12). Each old link still opens
 * where its content lives now; null means "stay on the Debriefs home".
 */
export function redirectForOldTab(params: URLSearchParams): string | null {
  const tab = params.get("tab");
  if (!tab) return null;
  switch (tab) {
    case "runs":
    case "review":
      return ROUTES.DEBRIEFS;
    case "expert-review": {
      const run = params.get("review");
      return run ? ROUTES.DEBRIEF_SESSION(run) : ROUTES.DEBRIEFS;
    }
    case "pm-agent":
    case "releases":
      return changesPath();
    case "organisations":
      return settingsPath("orgs");
    case "settings":
      return settingsPath();
    case "knowledge":
      return settingsPath("guidance");
    case "calibration":
    case "metrics":
      return `${ROUTES.ANALYTICS}?tab=${ANALYTICS_DEBRIEFS_TAB}`;
    default:
      return ROUTES.DEBRIEFS;
  }
}
