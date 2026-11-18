import React from "react";

import { HelpIcon } from "@icons";
import { NavLink } from "react-router-dom";
import { toast } from "sonner";

import { CarbonToggle, OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapPreferencesQuery, useSetRoadmapPreferencesMutation } from "@api";
import { ROUTES, en } from "@constants";
import type { RoadmapRole } from "@types";

import { requestShortcuts, useRoadmapFrame } from "../RoadmapFrame";
import { canSeeAgent, canSeeMeasures, canSeeSettings } from "../utils/redirects";

type RoleTabKey = "agent" | "settings" | "measures";

/** The tabs past Queue · My drafts · Bugs, for the roles that have them (§4.1, §4.15; P8). */
export const roleTabsFor = (role: RoadmapRole): { key: RoleTabKey; to: string }[] => [
  ...(canSeeAgent(role) ? [{ key: "agent" as const, to: ROUTES.ROADMAP_AGENT }] : []),
  ...(canSeeSettings(role) ? [{ key: "settings" as const, to: ROUTES.ROADMAP_SETTINGS }] : []),
  ...(canSeeMeasures(role) ? [{ key: "measures" as const, to: ROUTES.ROADMAP_MEASURES }] : []),
];

/** A tab's label. Measures' copy lives in its own block (P8). */
const tabLabel = (key: RoleTabKey): string =>
  key === "measures" ? en.roadmapV2Measures.tab : en.roadmapV2Tools.tabs[key];

/** Agent (Builders, Owners), Settings and Measures (Owners), as links in the Roadmap's tab row. */
export const RoadmapRoleTabs: React.FC<{ role: RoadmapRole }> = ({ role }) => {
  return (
    <>
      {roleTabsFor(role).map(tab => (
        <NavLink
          key={tab.key}
          to={tab.to}
          className={({ isActive }) =>
            isActive ? "font-semibold text-typography-900" : "text-typography-600 hover:underline"
          }
        >
          {tabLabel(tab.key)}
        </NavLink>
      ))}
    </>
  );
};

/**
 * "Your ideas this week" by email (§4.14, §5.7b). Off until turned on; any Roadmap role (Idea and
 * up) may turn it on, so it lives with the person, not in the Owner's Settings.
 */
export const DigestToggle: React.FC<{ id?: string }> = ({ id = "roadmap-weekly-digest" }) => {
  const copy = en.roadmapV2Tools.help;
  const { data, isError } = useGetRoadmapPreferencesQuery();
  const [save, { isLoading }] = useSetRoadmapPreferencesMutation();
  if (isError) return null;
  return (
    <div className="flex flex-col gap-1">
      <CarbonToggle
        id={id}
        size="sm"
        labelText={copy.digest}
        labelA=""
        labelB=""
        toggled={!!data?.weeklyDigest}
        disabled={!data || isLoading}
        onToggle={(on: boolean) => {
          save({ weeklyDigest: on })
            .unwrap()
            .then(() => toast.success(on ? copy.digestOn : copy.digestOff))
            .catch(() => toast.error(copy.digestFailed));
        }}
      />
      <p className="m-0 text-xs text-typography-600">{copy.digestHelp}</p>
    </div>
  );
};

/** ? : Keyboard shortcuts · What moved · the weekly email (§4.15). */
export const RoadmapHelpMenu: React.FC<{ showShortcuts?: boolean }> = ({
  showShortcuts = true,
}) => {
  const copy = en.roadmapV2Tools.help;
  const { openWhatMoved } = useRoadmapFrame();
  const { data } = useGetRoadmapPreferencesQuery();
  const [save] = useSetRoadmapPreferencesMutation();
  const on = !!data?.weeklyDigest;
  return (
    <OverflowMenu
      aria-label={en.roadmapV2Tools.tabs.help}
      iconDescription={en.roadmapV2Tools.tabs.help}
      flipped
      menuOptionsClass="!z-[9100] !w-72 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
      renderIcon={() => <HelpIcon size={16} aria-hidden />}
      className="!h-8 !w-8"
    >
      {showShortcuts && <OverflowMenuItem itemText={copy.shortcuts} onClick={requestShortcuts} />}
      <OverflowMenuItem itemText={copy.whatMoved} onClick={openWhatMoved} />
      {data && (
        <OverflowMenuItem
          itemText={`${on ? "✓ " : ""}${copy.digest}`}
          onClick={() => {
            save({ weeklyDigest: !on })
              .unwrap()
              .then(() => toast.success(!on ? copy.digestOn : copy.digestOff))
              .catch(() => toast.error(copy.digestFailed));
          }}
        />
      )}
    </OverflowMenu>
  );
};

/** Agent and Settings on a phone: the bottom bar's ⋯ opens these (§4.17). */
export const MoreSheetContent: React.FC<{ role: RoadmapRole; onNavigate: () => void }> = ({
  role,
  onNavigate,
}) => {
  const copy = en.roadmapV2Tools;
  const { openWhatMoved } = useRoadmapFrame();
  const tabs = roleTabsFor(role);
  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 0 && (
        <nav aria-label={copy.tabs.moreTitle} className="flex flex-col gap-2">
          {tabs.map(tab => (
            <NavLink
              key={tab.key}
              to={tab.to}
              onClick={onNavigate}
              className="flex min-h-12 items-center rounded border border-border-light px-4 text-base text-typography-900"
            >
              {tabLabel(tab.key)}
            </NavLink>
          ))}
        </nav>
      )}
      <DigestToggle id="roadmap-weekly-digest-sheet" />
      <button
        type="button"
        onClick={() => {
          onNavigate();
          openWhatMoved();
        }}
        className="flex min-h-12 items-center text-left text-base text-primary-700"
      >
        {copy.help.whatMoved}
      </button>
    </div>
  );
};
