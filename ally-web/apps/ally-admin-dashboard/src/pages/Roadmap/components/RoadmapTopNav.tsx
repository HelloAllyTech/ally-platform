import React from "react";

import { Link, useLocation } from "react-router-dom";

import { ROUTES, en } from "@constants";

import { NewIdeaButton } from "./NewIdeaButton";
import { RoadmapMoreMenu, RoleTabKey, tabLabel } from "./RoadmapAreaNav";
import { useRoadmapRole } from "../RoadmapGate";

type TopTab = "queue" | "drafts" | "bugs" | RoleTabKey;

/** Which tab the URL is on. Anything under /roadmap that is not one of the others is the Queue. */
const tabFor = (pathname: string): TopTab => {
  if (pathname.startsWith(ROUTES.ROADMAP_DRAFTS)) return "drafts";
  if (pathname.startsWith(ROUTES.ROADMAP_BUGS)) return "bugs";
  if (pathname.startsWith(ROUTES.ROADMAP_AGENT)) return "agent";
  if (pathname.startsWith(ROUTES.ROADMAP_SETTINGS)) return "settings";
  if (pathname.startsWith(ROUTES.ROADMAP_MEASURES)) return "measures";
  return "queue";
};

/** Where a role tab's own link goes. */
const roleTabTarget = (key: RoleTabKey): string =>
  ({
    agent: ROUTES.ROADMAP_AGENT,
    settings: ROUTES.ROADMAP_SETTINGS,
    measures: ROUTES.ROADMAP_MEASURES,
  })[key];

/**
 * The Roadmap's top menu, the same on every page: the title, then Queue · Drafts · Bugs and one
 * menu icon that holds Agent, Settings and Measures (and the help items). It sticks to the top, so
 * the tabs never move as you go from one page to another; what each page has sits underneath.
 *
 * A phone shows the title only: the bottom bar's ⋯ reaches the other pages there (§4.17).
 */
export const RoadmapTopNav: React.FC<{
  phone: boolean;
  /** The phone's title: the page you are on. */
  phoneTitle?: string;
  /** Phone only: what sits at the right of the title (the Queue's search). */
  phoneTrailing?: React.ReactNode;
  /** The New idea control at the right: the Queue and My drafts, where ideas are made. */
  withNewIdea?: boolean;
}> = ({ phone, phoneTitle, phoneTrailing, withNewIdea = false }) => {
  const { role } = useRoadmapRole();
  const { pathname } = useLocation();
  const copy = en.roadmapV2;
  const active = tabFor(pathname);
  const roleTab =
    active === "agent" || active === "settings" || active === "measures" ? active : null;
  // A tab sits on the bar's bottom edge: the selected one draws its 2px underline over the border,
  // so the strip reads as one navigation level whichever page you are on.
  const tab = (key: TopTab, label: string, to: string) => (
    <Link
      key={key}
      to={to}
      aria-current={active === key ? "page" : undefined}
      className={`relative inline-flex h-full items-center px-4 text-base ${
        active === key
          ? "font-semibold text-typography-primary"
          : "text-typography-secondary hover:bg-neutral-100 hover:text-typography-primary"
      }`}
    >
      {label}
      {active === key && (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-500" aria-hidden />
      )}
    </Link>
  );
  return (
    <header className="sticky top-0 z-[5] flex h-12 items-stretch justify-between gap-4 border-b border-border-light bg-white px-4">
      <div className="flex min-w-0 items-stretch gap-4">
        <h1 className="m-0 flex shrink-0 items-center text-lg font-semibold text-typography-primary">
          {phone ? (phoneTitle ?? copy.title) : copy.title}
        </h1>
        {!phone && (
          <>
            <span className="my-3 w-px bg-border-light" aria-hidden />
            <nav aria-label={copy.title} className="flex items-stretch">
              {tab("queue", copy.mobile.queue, ROUTES.ROADMAP)}
              {tab("drafts", copy.mobile.drafts, ROUTES.ROADMAP_DRAFTS)}
              {tab("bugs", copy.mobile.bugs, ROUTES.ROADMAP_BUGS)}
              {/* The page you are on from the menu (Agent, Settings, Measures) takes a tab of its own,
                  so you always see where you are. */}
              {roleTab && tab(roleTab, tabLabel(roleTab), roleTabTarget(roleTab))}
              <span className="flex items-center pl-1">
                <RoadmapMoreMenu
                  role={role}
                  active={roleTab ?? undefined}
                  showShortcuts={active === "queue"}
                />
              </span>
            </nav>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!phone && withNewIdea && <NewIdeaButton />}
        {phone && phoneTrailing}
      </div>
    </header>
  );
};
