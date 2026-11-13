import { ROUTES } from "@constants";

/** The Analytics tab the Debriefs metrics live under (kept here so this module stays light). */
export const ANALYTICS_DEBRIEFS_TAB = "debriefs";

/** Analytics › Debriefs: the debriefs' metrics, PM agent and agent numbers included. */
export const analyticsDebriefsPath = () => `${ROUTES.ANALYTICS}?tab=${ANALYTICS_DEBRIEFS_TAB}`;

/** Where a PM agent link opens: `?view=` picks the tab, `?idea=` the idea in focus. */
export type PmAgentView = "ideas" | "releases" | "reports" | "test-sets";
export const pmAgentPath = (view: PmAgentView = "ideas", idea?: string): string => {
  const q = new URLSearchParams();
  if (view !== "ideas") q.set("view", view);
  if (idea) q.set("idea", idea);
  const qs = q.toString();
  return `${ROUTES.DEBRIEFS_PM_AGENT}${qs ? `?${qs}` : ""}`;
};

/** PM agent › Reports at one report: `?view=reports&kind=monthly&period=2026-10`. */
export const pmReportPath = (kind: "weekly" | "monthly", period: string): string =>
  `${ROUTES.DEBRIEFS_PM_AGENT}?${new URLSearchParams({ view: "reports", kind, period })}`;

/** PM agent › Releases with one release open. */
export const pmReleasePath = (releaseId: string): string =>
  `${ROUTES.DEBRIEFS_PM_AGENT}?${new URLSearchParams({ view: "releases", releaseId })}`;

export type SettingsSection =
  | "orgs"
  | "budget"
  | "tests"
  | "autonomy"
  | "weights"
  | "pinned"
  | "schedules"
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
      return `${ROUTES.DEBRIEFS}?cat=all`;
    case "review":
      return `${ROUTES.DEBRIEFS}?cat=needs`;
    case "expert-review": {
      const run = params.get("review");
      return run ? ROUTES.DEBRIEF_SESSION(run) : `${ROUTES.DEBRIEFS}?cat=needs`;
    }
    case "pm-agent":
      return pmAgentPath("ideas");
    case "releases":
      return pmAgentPath("releases");
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
