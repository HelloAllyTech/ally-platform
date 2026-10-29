import React, { useMemo } from "react";

import { useSearchParams } from "react-router-dom";

import { Tabs } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

import { CalibrationTab } from "./CalibrationTab";

export enum DebriefConsoleTab {
  CALIBRATION = "calibration",
}

const VALID_TABS = new Set<string>(Object.values(DebriefConsoleTab));

/**
 * The Debrief Console: where the team watches the debriefs learners read after a roleplay and the
 * agent that improves them. Same shell as the Ally Console — the active tab lives in `?tab=` so a
 * link opens exactly there. Gated on the Analytics toggle, like the endpoints behind it.
 */
export const DebriefConsole: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabItems = useMemo(
    () => [{ id: DebriefConsoleTab.CALIBRATION, label: en.debriefs.tabs.calibration }],
    [],
  );

  const requested = searchParams.get("tab");
  const activeTab =
    requested && VALID_TABS.has(requested) ? requested : DebriefConsoleTab.CALIBRATION;

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
        <CalibrationTab />
      </div>
    </div>
  );
};

export default DebriefConsole;
