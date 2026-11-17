import React from "react";

import { Link } from "react-router-dom";

import { ROUTES, en } from "@constants";

import { RoadmapHelpMenu, RoadmapRoleTabs } from "./RoadmapAreaNav";
import { useRoadmapRole } from "../RoadmapGate";

/**
 * The tab row for the Roadmap's own areas past the Queue (Agent, Settings): Queue · My drafts · Bugs
 * · Agent · Settings, by role, and ? for help. A phone shows the title only; the bottom bar's ⋯
 * reaches these areas there (§4.17).
 */
export const RoadmapAreaHeader: React.FC<{ phone: boolean; current: string }> = ({
  phone,
  current,
}) => {
  const { role } = useRoadmapRole();
  const copy = en.roadmapV2;
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border-light px-4 pb-2 pt-3">
      <div className="flex min-w-0 items-baseline gap-4">
        <h1 className="m-0 text-xl font-semibold text-typography-900">
          {phone ? current : copy.title}
        </h1>
        {!phone && (
          <nav aria-label={copy.title} className="flex items-center gap-3 text-sm">
            <Link to={ROUTES.ROADMAP} className="text-typography-600 hover:underline">
              {copy.mobile.queue}
            </Link>
            <Link
              to={`${ROUTES.PRODUCT_ROADMAP}?tab=drafts`}
              className="text-typography-600 hover:underline"
            >
              {copy.mobile.drafts}
            </Link>
            <Link to={ROUTES.ROADMAP_BUGS} className="text-typography-600 hover:underline">
              {copy.mobile.bugs}
            </Link>
            <RoadmapRoleTabs role={role} />
          </nav>
        )}
      </div>
      {!phone && <RoadmapHelpMenu showShortcuts={false} />}
    </header>
  );
};
