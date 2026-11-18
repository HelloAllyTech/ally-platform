import React from "react";

import { Link, useLocation } from "react-router-dom";

import { ROUTES, en } from "@constants";

import { NewIdeaButton } from "./NewIdeaButton";
import { RoadmapMoreMenu, RoleTabKey } from "./RoadmapAreaNav";
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
  const tab = (key: TopTab, label: string, to: string) => (
    <Link
      key={key}
      to={to}
      aria-current={active === key ? "page" : undefined}
      className={`border-b-2 pb-1.5 ${
        active === key
          ? "border-primary-600 font-semibold text-typography-primary"
          : "border-transparent text-typography-secondary hover:text-typography-primary"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-[5] flex items-center justify-between gap-2 border-b border-border-light bg-white px-4 pt-3">
      <div className="flex min-w-0 items-end gap-6">
        <h1 className="m-0 pb-1 text-xl font-semibold text-typography-primary">
          {phone ? (phoneTitle ?? copy.title) : copy.title}
        </h1>
        {!phone && (
          <nav aria-label={copy.title} className="flex items-end gap-4 text-sm">
            {tab("queue", copy.mobile.queue, ROUTES.ROADMAP)}
            {tab("drafts", copy.mobile.drafts, ROUTES.ROADMAP_DRAFTS)}
            {tab("bugs", copy.mobile.bugs, ROUTES.ROADMAP_BUGS)}
            <span className="pb-1">
              <RoadmapMoreMenu
                role={role}
                active={
                  active === "agent" || active === "settings" || active === "measures"
                    ? active
                    : undefined
                }
                showShortcuts={active === "queue"}
              />
            </span>
          </nav>
        )}
      </div>
      <div className="flex items-center gap-2 pb-1">
        {!phone && withNewIdea && <NewIdeaButton />}
        {phone && phoneTrailing}
      </div>
    </header>
  );
};
