import React from "react";

import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { en } from "@constants";
import { DebriefHomeV2 } from "@types";

import { changesPath } from "../consoleRoutes";

/**
 * Needs you on Home (review 2026-11-16): the changes that wait for a person, one row each. A row
 * opens the change on the PM agent page, where the whole change, the decision and its own
 * conversation are; nothing is decided on Home.
 */
export const NeedsYouList: React.FC<{
  items: DebriefHomeV2["needsYou"];
}> = ({ items }) => {
  const t = en.debriefs.v2.home;
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="home-needs"
      className="flex flex-col gap-2.5 border-t-[3px] border-[#F1C21B] bg-neutral-50 px-5 py-[18px]"
      data-testid="home-needs-you"
    >
      <h2 id="home-needs" className="m-0 text-base font-semibold">
        {t.needsHeading(items.length)}
      </h2>
      {items.map(n => (
        <Link
          key={n.changeId}
          to={changesPath(n.changeId)}
          data-testid="home-needs-item"
          className="flex min-w-0 flex-nowrap items-center gap-3 bg-white px-[18px] py-3 text-typography-900 no-underline hover:bg-neutral-100"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-nowrap items-center gap-2.5">
              <span className="shrink-0 rounded-full bg-[#FFF2E8] px-2.5 py-0.5 text-xs font-semibold text-[#8A3800]">
                {t.yourCall}
              </span>
              <span className="min-w-0 truncate text-[15px] font-semibold">{n.title}</span>
            </span>
            {n.why && <span className="truncate text-sm text-neutral-700">{n.why}</span>}
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-600" />
        </Link>
      ))}
    </section>
  );
};
