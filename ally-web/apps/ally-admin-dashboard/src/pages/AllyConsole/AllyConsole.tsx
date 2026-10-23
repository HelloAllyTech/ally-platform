import React, { useMemo } from "react";

import { useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { ConversationsTab } from "./ConversationsTab";
import { CrisisCopyTab } from "./CrisisCopyTab";
import { OverviewTab } from "./OverviewTab";
import { ReleasesTab } from "./ReleasesTab";
import { SettingsTab } from "./SettingsTab";

export enum AllyConsoleTab {
  OVERVIEW = "overview",
  CONVERSATIONS = "conversations",
  RELEASES = "releases",
  SETTINGS = "settings",
  CRISIS_COPY = "crisis-copy",
}

const TAB_ITEMS = [
  { id: AllyConsoleTab.OVERVIEW, label: en.allyConsole.tabs.overview },
  { id: AllyConsoleTab.CONVERSATIONS, label: en.allyConsole.tabs.conversations },
  { id: AllyConsoleTab.RELEASES, label: en.allyConsole.tabs.releases },
  { id: AllyConsoleTab.SETTINGS, label: en.allyConsole.tabs.settings },
  { id: AllyConsoleTab.CRISIS_COPY, label: en.allyConsole.tabs.crisisCopy },
];

const VALID_TABS = new Set<string>(TAB_ITEMS.map(tab => tab.id));

/**
 * The Ally Console: the Ally team's control room for the AI course companion.
 *
 * The route is gated on the `ally_guide` toggle AND the view permission (see RouteLayout); every
 * edit control inside narrows further on the edit permission, and transcripts and payloads on their
 * own per-person grant. The active tab lives in the address (`?tab=`), so a link to "Releases" or to
 * one conversation (`?tab=conversations&thread=…`) opens exactly there.
 */
export const AllyConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const requested = searchParams.get("tab");
    return requested && VALID_TABS.has(requested) ? requested : AllyConsoleTab.OVERVIEW;
  }, [searchParams]);

  const renderTab = () => {
    switch (activeTab) {
      case AllyConsoleTab.CONVERSATIONS:
        return <ConversationsTab />;
      case AllyConsoleTab.RELEASES:
        return <ReleasesTab />;
      case AllyConsoleTab.SETTINGS:
        return <SettingsTab />;
      case AllyConsoleTab.CRISIS_COPY:
        return <CrisisCopyTab />;
      case AllyConsoleTab.OVERVIEW:
      default:
        return (
          <OverviewTab onOpenReleases={() => setSearchParams({ tab: AllyConsoleTab.RELEASES })} />
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
        items={TAB_ITEMS}
        activeId={activeTab}
        onChange={id => setSearchParams({ tab: id })}
        showCount={false}
      />
      <div className="pt-6">{renderTab()}</div>
    </div>
  );
};

export default AllyConsole;
