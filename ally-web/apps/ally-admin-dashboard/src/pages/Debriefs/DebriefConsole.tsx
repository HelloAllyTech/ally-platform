import React, { useMemo } from "react";

import { useSelector } from "react-redux";
import { Navigate, useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { en, Permissions, ROUTES } from "@constants";
import { RootState } from "@store";

import { CalibrationTab } from "./CalibrationTab";
import { ExpertReviewTab } from "./ExpertReviewTab";
import { GuidanceTab } from "./GuidanceTab";
import { OrganisationsTab } from "./OrganisationsTab";
import { PmAgentTab } from "./PmAgentTab";
import { ReleasesTab } from "./ReleasesTab";
import { ReviewTab } from "./ReviewTab";
import { RunsTab } from "./RunsTab";
import { SettingsTab } from "./SettingsTab";
import { ANALYTICS_DEBRIEFS_TAB_ID } from "../Analytics/Analytics";

export enum DebriefConsoleTab {
  RUNS = "runs",
  REVIEW = "review",
  EXPERT_REVIEW = "expert-review",
  PM_AGENT = "pm-agent",
  RELEASES = "releases",
  ORGANISATIONS = "organisations",
  CALIBRATION = "calibration",
  // Kept as `knowledge` so links to the old Knowledge tab still open here.
  GUIDANCE = "knowledge",
  SETTINGS = "settings",
}

const TAB_CONTENT: Record<DebriefConsoleTab, React.FC> = {
  [DebriefConsoleTab.RUNS]: RunsTab,
  [DebriefConsoleTab.REVIEW]: ReviewTab,
  [DebriefConsoleTab.EXPERT_REVIEW]: ExpertReviewTab,
  [DebriefConsoleTab.PM_AGENT]: PmAgentTab,
  [DebriefConsoleTab.RELEASES]: ReleasesTab,
  [DebriefConsoleTab.ORGANISATIONS]: OrganisationsTab,
  [DebriefConsoleTab.CALIBRATION]: CalibrationTab,
  [DebriefConsoleTab.GUIDANCE]: GuidanceTab,
  [DebriefConsoleTab.SETTINGS]: SettingsTab,
};

/** The Console's former Metrics tab id: links to it now open Analytics → Debriefs. */
const MOVED_METRICS_TAB = "metrics";

/** Tabs shown only to holders of a permission beyond the Console's toggle. */
const TAB_PERMISSION: Partial<Record<DebriefConsoleTab, Permissions>> = {
  [DebriefConsoleTab.EXPERT_REVIEW]: Permissions.REVIEW_DEBRIEFS,
};

export const visibleDebriefTabs = (permissions: string[] | undefined): DebriefConsoleTab[] =>
  Object.values(DebriefConsoleTab).filter(tab => {
    const needed = TAB_PERMISSION[tab];
    return !needed || (permissions ?? []).includes(needed);
  });

/**
 * The Debrief Console: where the team watches the debriefs learners read after a roleplay and the
 * agent that improves them. Same shell as the Ally Console — the active tab lives in `?tab=` so a
 * link opens exactly there. Gated on the Analytics toggle, like the endpoints behind it.
 */
export const DebriefConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Read from the store, as useAllyGuideAccess does; PrivateLayout fills it.
  const permissions = useSelector((state: RootState) => state.user?.permissions);
  const visible = useMemo(() => visibleDebriefTabs(permissions), [permissions]);

  const tabItems = useMemo(
    () => visible.map(id => ({ id, label: en.debriefs.tabs[id] })),
    [visible],
  );

  const requested = searchParams.get("tab");
  // Debrief metrics moved to Analytics → Debriefs (2026-11-11); old links follow them there.
  if (requested === MOVED_METRICS_TAB) {
    return <Navigate to={`${ROUTES.ANALYTICS}?tab=${ANALYTICS_DEBRIEFS_TAB_ID}`} replace />;
  }
  const activeTab =
    requested && (visible as string[]).includes(requested)
      ? (requested as DebriefConsoleTab)
      : DebriefConsoleTab.RUNS;
  const Content = TAB_CONTENT[activeTab];

  return (
    <div className="relative py-[2px] font-primary" data-testid="debrief-console">
      <h1 className="font-secondary text-2xl text-typography-900">{en.debriefs.title}</h1>
      <p className="max-w-3xl pb-4 pt-1 text-sm text-typography-700 md:pb-6">{en.debriefs.intro}</p>
      <Tabs
        items={tabItems}
        activeId={activeTab}
        onChange={id => setSearchParams({ tab: id })}
        showCount={false}
      />
      <div className="pt-6">
        <Content />
      </div>
    </div>
  );
};

export default DebriefConsole;
