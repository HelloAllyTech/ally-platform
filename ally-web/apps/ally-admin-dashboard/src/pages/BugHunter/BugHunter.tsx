import { FC, useEffect, useState } from "react";

import { useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";

import { SidePanel } from "@ally-ui-mono/ui-shared";
import { en, FeatureToggleKey } from "@constants";
import { RootState } from "@store";
import { hasFeature } from "@utils";

import { AboutAgent } from "./AboutAgent";
import { AgentProfileCard } from "./AgentProfileCard";
import { BugFindingsTable } from "./BugFindingsTable";
import { BUG_HUNTER_PARAM } from "./bugHunterUrlState";
import { KeyboardShortcutSheet } from "./KeyboardShortcutSheet";

/**
 * Bug Hunter's page: a one-line header (the agent, its status sentence, the mode, help)
 * and under it the bugs table, with its five tabs and the drawer.
 *
 * Since 2026-11-23 this is Bug Hunter v2's page: the old Bug Hunter's engine was removed
 * and these components read v2 (its queue, plus the old history read-only) through the
 * API slice in `api/bugHunter.ts`. What only the old engine had (sweeps, the Today board,
 * the feature map and notes, answering a question, editing a description, cancelling a
 * run, pinning a stage, the UX-signal scan) was removed with it.
 *
 * `?section=about` (About was a tab until 2026-10-13) still opens the help panel. The
 * shortcut sheet and help panel open flags are page state: `?` raises the sheet anywhere.
 */

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
   * Whether this reader may ACT on bugs, or only read them: the backend's own gate
   * (Bug Hunter v2's toggle). Resolved once here and threaded down.
   */
  const canTriage = hasFeature(features, FeatureToggleKey.BUG_HUNTER_V2_VERDICTS);

  const rawSection = searchParams.get("section");

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

  /** "Fixing N now" → the In progress tab. One write, so no other param is lost. */
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

  return (
    <div className="h-full font-primary flex flex-col overflow-y-auto custom-scrollbar">
      <AgentProfileCard onShowInProgress={showInProgress} onShowHelp={() => setShowHelp(true)} />

      <div className="mt-4 shrink-0">
        <BugFindingsTable onShowShortcuts={() => setShowShortcuts(true)} canTriage={canTriage} />
      </div>

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
