import React, { useMemo } from "react";

import { useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";

import { AdviceTab } from "./AdviceTab";
import { AlertsTab } from "./AlertsTab";
import { BaselineTab } from "./BaselineTab";
import { ConfigurationTab } from "./ConfigurationTab";
import { ConversationsTab } from "./ConversationsTab";
import { CrisisCopyTab } from "./CrisisCopyTab";
import { EvalsTab } from "./EvalsTab";
import { LibraryTab } from "./LibraryTab";
import { OverviewTab } from "./OverviewTab";
import { PlaygroundTab } from "./PlaygroundTab";
import { ReleasesTab } from "./ReleasesTab";
import { SettingsTab } from "./SettingsTab";

export enum AllyConsoleTab {
  OVERVIEW = "overview",
  CONVERSATIONS = "conversations",
  RELEASES = "releases",
  PLAYGROUND = "playground",
  EVALS = "evals",
  ALERTS = "alerts",
  BASELINE = "baseline",
  CONFIGURATION = "configuration",
  LIBRARY = "library",
  ADVICE = "advice",
  SETTINGS = "settings",
  CRISIS_COPY = "crisis-copy",
}

const ALL_TAB_ITEMS = [
  { id: AllyConsoleTab.OVERVIEW, label: en.allyConsole.tabs.overview },
  { id: AllyConsoleTab.CONVERSATIONS, label: en.allyConsole.tabs.conversations },
  { id: AllyConsoleTab.RELEASES, label: en.allyConsole.tabs.releases },
  { id: AllyConsoleTab.PLAYGROUND, label: en.allyConsole.tabs.playground },
  { id: AllyConsoleTab.EVALS, label: en.allyConsole.tabs.evals },
  { id: AllyConsoleTab.ALERTS, label: en.allyConsole.tabs.alerts },
  { id: AllyConsoleTab.BASELINE, label: en.allyConsole.tabs.baseline },
  { id: AllyConsoleTab.CONFIGURATION, label: en.allyConsole.tabs.configuration },
  { id: AllyConsoleTab.LIBRARY, label: en.allyConsole.tabs.library },
  { id: AllyConsoleTab.ADVICE, label: en.allyConsole.tabs.advice },
  { id: AllyConsoleTab.SETTINGS, label: en.allyConsole.tabs.settings },
  { id: AllyConsoleTab.CRISIS_COPY, label: en.allyConsole.tabs.crisisCopy },
];

const VALID_TABS = new Set<string>(ALL_TAB_ITEMS.map(tab => tab.id));

/**
 * The Ally Console: the Ally team's control room for the AI course companion.
 *
 * The route is gated on the `ally_guide` toggle AND the view permission (see RouteLayout); every
 * edit control inside narrows further on the edit permission, and transcripts and payloads on their
 * own per-person grant. The Playground calls the models and the server requires the edit grant for
 * it, so the tab is hidden without it (a link to it still explains why). The active tab lives in
 * the address (`?tab=`), so a link to "Releases" or to one conversation
 * (`?tab=conversations&thread=…`) opens exactly there.
 */
export const AllyConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canEdit } = useAllyGuideAccess();

  const tabItems = useMemo(
    () => ALL_TAB_ITEMS.filter(tab => canEdit || tab.id !== AllyConsoleTab.PLAYGROUND),
    [canEdit],
  );

  const activeTab = useMemo(() => {
    const requested = searchParams.get("tab");
    return requested && VALID_TABS.has(requested) ? requested : AllyConsoleTab.OVERVIEW;
  }, [searchParams]);

  const go = (tab: AllyConsoleTab) => setSearchParams({ tab });

  const renderTab = () => {
    switch (activeTab) {
      case AllyConsoleTab.CONVERSATIONS:
        return <ConversationsTab />;
      case AllyConsoleTab.RELEASES:
        return <ReleasesTab onOpenOverview={() => go(AllyConsoleTab.OVERVIEW)} />;
      case AllyConsoleTab.PLAYGROUND:
        return <PlaygroundTab />;
      case AllyConsoleTab.EVALS:
        return <EvalsTab />;
      case AllyConsoleTab.ALERTS:
        return <AlertsTab />;
      case AllyConsoleTab.CONFIGURATION:
        return <ConfigurationTab />;
      case AllyConsoleTab.LIBRARY:
        return <LibraryTab />;
      case AllyConsoleTab.ADVICE:
        return <AdviceTab />;
      case AllyConsoleTab.BASELINE:
        return <BaselineTab />;
      case AllyConsoleTab.SETTINGS:
        return <SettingsTab />;
      case AllyConsoleTab.CRISIS_COPY:
        return <CrisisCopyTab />;
      case AllyConsoleTab.OVERVIEW:
      default:
        return (
          <OverviewTab
            onOpenReleases={() => go(AllyConsoleTab.RELEASES)}
            onOpenAlerts={() => go(AllyConsoleTab.ALERTS)}
          />
        );
    }
  };

  return (
    <div className="relative py-[2px] font-primary" data-testid="ally-console">
      <h1 className="font-secondary text-2xl text-typography-900">{en.allyConsole.title}</h1>
      <p className="max-w-3xl pb-4 pt-1 text-sm text-typography-700 md:pb-6">
        {en.allyConsole.intro}
      </p>
      <Tabs
        items={tabItems}
        activeId={activeTab}
        onChange={id => setSearchParams({ tab: id })}
        showCount={false}
      />
      <div className="pt-6">{renderTab()}</div>
    </div>
  );
};

export default AllyConsole;
