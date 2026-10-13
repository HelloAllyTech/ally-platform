import { FC, useEffect, useMemo, useState } from "react";

import { useSelector } from "react-redux";
import { Navigate, useSearchParams } from "react-router-dom";

import { SidePanel, Tabs } from "@ally-ui-mono/ui-shared";
import { en, FeatureToggleKey, ROUTES } from "@constants";
import { RootState } from "@store";
import { hasFeature } from "@utils";

import { AboutAgent } from "./AboutAgent";
import { AgentProfileCard } from "./AgentProfileCard";
import { BugFindingsTable } from "./BugFindingsTable";
import { BUG_HUNTER_PARAM } from "./bugHunterUrlState";
import { FeatureMapPanel } from "./FeatureMapPanel";
import { KeyboardShortcutSheet } from "./KeyboardShortcutSheet";
import { NotebookPanel } from "./NotebookPanel";
import { ANALYTICS_BUG_AGENT_TAB_ID, ANALYTICS_TAB_PARAM } from "../Analytics/Analytics";

/**
 * Bug Hunter's page: a one-line header, and under it the work.
 *
 * ## The 2026-10-13 simplification
 *
 * The product head found the page cluttered, and a review the same day found
 * that most of the clutter was one fact shown in several places rather than
 * missing features: about 520px of chrome above the bugs table when idle and
 * 1,050px when busy, working state signalled in about ten places, and every
 * in-flight bug shown twice — once on a live board, once as a table row. What
 * changed, and where each thing went:
 *
 * - **The header is one line** (`AgentProfileCard`): name, a status sentence,
 *   the working-style dropdown, help, and a ⋯ menu holding Model settings,
 *   "Scan UX signals now" and "Map features now".
 * - **The live board is gone.** In-flight bugs are rows in the In progress tab,
 *   with a spinner, and the header's "Fixing N now" links there.
 * - **"Today, by repo" moved** to Analytics → Bug Agent, beside the shift log —
 *   it is a report on the day, read by the same governor who reads the runs.
 * - **The UX Signals bar is gone**: its button and last-scan line are in the ⋯
 *   menu, and what it printed when a scan finished is a toast.
 * - **About left the tab strip** for a side panel behind the header's help
 *   button. It is reference material, read once; a tab gave it the same
 *   weight as the work. `?section=about` still opens it.
 *
 * So the Work tab is the bugs table and nothing else, and the strip reads
 * Work | Notebook. Stacks' *Eliminate distractions that don't drive desired
 * actions* is the general form: every element on the reviewer's surface has
 * to move them toward a decision, or it goes somewhere else.
 *
 * Earlier passes had already removed the needs-you queue and the messages
 * inbox (2026-10-01) and moved performance to Analytics → Bug Agent
 * (OPP-0749); `?section=performance` still redirects there.
 *
 * ## State
 *
 * The section lives in `?section=`, alongside the table's own params, so
 * "look at the notebook" is a link. It is read here with `useSearchParams`
 * rather than added to `useBugHunterUrlState`: it is the page's business and
 * not the table's, and the table is also mounted by the roadmap's Bugs tab,
 * which has its own `?tab=`/`?view=` params.
 *
 * The shortcut sheet's and the help panel's open flags are the page-level
 * `useState`: `?` raises the sheet from anywhere on the page, and the help
 * button sits in the header, outside both tabs.
 */

/** The two sections, and the `?section=` values that address them. */
const SECTION = {
  work: "work",
  notebook: "notebook",
} as const;

type Section = (typeof SECTION)[keyof typeof SECTION];

const SECTIONS: Section[] = [SECTION.work, SECTION.notebook];

/** The section that moved to Analytics; its old address is honoured with a redirect. */
const RETIRED_PERFORMANCE_SECTION = "performance";
const PERFORMANCE_REDIRECT = `${ROUTES.ANALYTICS}?${ANALYTICS_TAB_PARAM}=${ANALYTICS_BUG_AGENT_TAB_ID}`;

/** About was a tab until 2026-10-13; a link to it opens the help panel instead. */
const RETIRED_ABOUT_SECTION = "about";

export const BugHunter: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHelp, setShowHelp] = useState(
    () => searchParams.get("section") === RETIRED_ABOUT_SECTION,
  );

  const features = useSelector((state: RootState) => state.user.features);

  /**
   * Whether this reader may ACT on bugs, or only read them.
   *
   * Mirrors the backend's own gate (`@RequireFeatureToggle(BUG_HUNTER)`).
   * Resolved once here and threaded down, rather than re-derived in each
   * component: two copies of an authorisation rule is one copy too many.
   */
  const canTriage = hasFeature(features, FeatureToggleKey.BUG_HUNTER);

  /**
   * The open section. An unrecognised `?section=` falls back to Work rather
   * than erroring, the same way the table treats a mistyped facet — a
   * hand-edited link is not something to complain about on screen.
   */
  const rawSection = searchParams.get("section");
  const section: Section = SECTIONS.includes(rawSection as Section)
    ? (rawSection as Section)
    : SECTION.work;

  // The retired `?section=about` has done its job once the panel is open;
  // dropping it keeps a reload or a copied link from reopening the panel.
  useEffect(() => {
    if (rawSection !== RETIRED_ABOUT_SECTION) return;
    setSearchParams(
      current => {
        const params = new URLSearchParams(current);
        params.delete("section");
        return params;
      },
      { replace: true },
    );
  }, [rawSection, setSearchParams]);

  const setSection = (next: string) =>
    setSearchParams(
      current => {
        const params = new URLSearchParams(current);
        // The default section is the absent one, so the page's own address
        // stays `/bug-hunter` — same rule `bugHunterUrlState.write` follows.
        if (next === SECTION.work) params.delete("section");
        else params.set("section", next);
        return params;
      },
      { replace: true },
    );

  /** "Fixing N now" → the In progress tab, from whichever section you're on. One write, so neither param is lost. */
  const showInProgress = () =>
    setSearchParams(
      current => {
        const params = new URLSearchParams(current);
        params.delete("section");
        params.set(BUG_HUNTER_PARAM.bucket, "in_progress");
        return params;
      },
      { replace: true },
    );

  const tabItems = useMemo(
    () => [
      { id: SECTION.work, label: en.bugHunter.sectionWork },
      // What the agent wrote down for its future self, and what admins added.
      // Its own tab: it is neither today's work nor a metric, and a reader who
      // wants to teach the agent something should not have to hunt for where.
      { id: SECTION.notebook, label: en.bugHunter.sectionNotebook },
    ],
    [],
  );

  if (rawSection === RETIRED_PERFORMANCE_SECTION) {
    return <Navigate to={PERFORMANCE_REDIRECT} replace />;
  }

  return (
    <div className="h-full font-primary flex flex-col overflow-y-auto custom-scrollbar">
      <AgentProfileCard
        onShowInProgress={showInProgress}
        onShowHelp={() => setShowHelp(true)}
        canTriage={canTriage}
      />

      <div className="mt-4 shrink-0">
        {/* `showCount={false}`: the shared strip renders a literal "0" beside
            any tab without a count, and neither of these is a countable
            collection. The table's own tabs carry the counts. */}
        <Tabs items={tabItems} activeId={section} onChange={setSection} showCount={false} />
      </div>

      {section === SECTION.work && (
        <div className="mt-4 shrink-0">
          <BugFindingsTable onShowShortcuts={() => setShowShortcuts(true)} canTriage={canTriage} />
        </div>
      )}

      {section === SECTION.notebook && (
        <div className="mt-6 flex-1">
          <NotebookPanel canTriage={canTriage} />
          <FeatureMapPanel canTriage={canTriage} />
        </div>
      )}

      <SidePanel
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title={en.bugHunter.faqTitle}
        className="w-[36rem]"
      >
        <AboutAgent />
      </SidePanel>

      {showShortcuts && <KeyboardShortcutSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
};
