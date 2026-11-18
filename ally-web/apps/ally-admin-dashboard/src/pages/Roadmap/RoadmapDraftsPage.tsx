import React, { useState } from "react";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, CarbonToggle, SkeletonText } from "@ally-ui-mono/ui-shared";
import { ROUTES, en } from "@constants";

import { useGetRoadmapDraftsQuery, useRestoreRoadmapDraftMutation } from "../../api/roadmapV2Flow";
import {
  fadeUpVariants,
  listStaggerDelay,
  motionTransition,
  useReducedMotionPreference,
} from "../../motion";
import { NewIdeaButton } from "./components/NewIdeaButton";
import { RoadmapBottomBar } from "./components/RoadmapBottomBar";
import { RoadmapTopNav } from "./components/RoadmapTopNav";
import { agoText, dueSoon } from "./drafts/draftUtils";
import { useRoadmapBreakpoint } from "./hooks/useRoadmapBreakpoint";
import { useKeyboardInset } from "./hooks/useVisualViewport";
import { shortDate } from "./utils/copy";

import type { RoadmapDraftRow } from "../../types/roadmapV2Flow";

/**
 * `/roadmap/drafts` — My drafts (§4.4): private drafts, newest first, each with its title, "3 of
 * 5", when it was last edited and Continue. Untouched drafts archive at 30 days and are deleted at
 * 60; seven days before either, the row says when, next to Continue — the one thing that keeps it
 * [FP-1300]. Declined ideas never come back here (D10).
 */
export const RoadmapDraftsPage: React.FC = () => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2;
  const breakpoint = useRoadmapBreakpoint();
  const isPhone = breakpoint === "phone";
  const touch = isPhone || breakpoint === "tablet";
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, isError, refetch } = useGetRoadmapDraftsQuery(
    showArchived ? { archived: true } : undefined,
  );
  const keyboardInset = useKeyboardInset();
  const rows = Array.isArray(data?.drafts) ? data!.drafts : [];
  const active = rows.filter(r => !r.archivedAt);
  const archived = rows.filter(r => r.archivedAt);

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <div className="flex h-full min-h-0 flex-col bg-white">
        {isPhone && <RoadmapTopNav phone />}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-4 py-2">
          <p className="m-0 text-sm text-typography-secondary">{copy.drafts.intro}</p>
          <CarbonToggle
            id="roadmap-drafts-archived"
            size="sm"
            labelText={copy.drafts.showArchived}
            hideLabel={false}
            labelA=""
            labelB=""
            toggled={showArchived}
            onToggle={(on: boolean) => setShowArchived(on)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <ul aria-busy="true" className="m-0 list-none p-0">
              {[0, 1, 2].map(i => (
                <li key={i} className="border-b border-border-light px-6 py-3">
                  <SkeletonText width="50%" />
                  <SkeletonText width="25%" />
                </li>
              ))}
            </ul>
          ) : isError ? (
            <div className="flex flex-col items-start gap-3 p-6" role="alert">
              <p className="text-sm text-typography-primary">{copy.drafts.loadError}</p>
              <Button kind="tertiary" size="sm" onClick={() => refetch()}>
                {copy.retry}
              </Button>
            </div>
          ) : active.length === 0 && archived.length === 0 ? (
            <div className="flex flex-col items-start gap-3 p-6">
              <p className="m-0 text-sm text-typography-secondary">{copy.drafts.empty}</p>
              <NewIdeaButton />
            </div>
          ) : (
            <>
              <DraftList rows={active} touch={touch} />
              {archived.length > 0 && (
                <section aria-label={copy.drafts.archivedSection}>
                  <h2 className="sticky top-0 bg-neutral-50 px-6 py-1.5 text-xs font-semibold uppercase tracking-wide text-typography-secondary">
                    {copy.drafts.archivedSection}
                  </h2>
                  <DraftList rows={archived} touch={touch} />
                </section>
              )}
            </>
          )}
          {isPhone && <div className="h-20" aria-hidden />}
        </div>
        {isPhone && <RoadmapBottomBar hidden={keyboardInset > 0} active="drafts" />}
      </div>
    </MotionConfig>
  );
};

const DraftList: React.FC<{ rows: RoadmapDraftRow[]; touch: boolean }> = ({ rows, touch }) => {
  const reduced = useReducedMotionPreference();
  const copy = en.roadmapV2.drafts;
  const navigate = useNavigate();
  const [restore] = useRestoreRoadmapDraftMutation();
  return (
    <ul className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {rows.map((row, index) => {
          const title = row.title?.trim() || copy.untitled;
          const warnArchive = !row.archivedAt && dueSoon(row.archiveAt);
          const warnPurge = !!row.archivedAt && dueSoon(row.purgeAt);
          return (
            <motion.li
              key={row.code}
              layout={reduced ? false : "position"}
              {...fadeUpVariants(reduced)}
              transition={{
                ...motionTransition("moderate", "productive", reduced),
                delay: listStaggerDelay(index, reduced),
              }}
              className={`flex items-center gap-3 border-b border-border-light px-6 ${
                touch ? "min-h-[72px]" : "min-h-12"
              } py-2`}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-typography-primary" title={title}>
                  {title}
                </span>
                <span className="text-xs text-typography-secondary">
                  {row.code} · {copy.checks(row.checksMet, row.checksTotal)} ·{" "}
                  {copy.edited(agoText(new Date(row.updatedAt).getTime()))}
                  {warnArchive && row.archiveAt && (
                    <span className="text-warning-700">
                      {" "}
                      · {copy.archivesOn(shortDate(row.archiveAt))}
                    </span>
                  )}
                  {row.archivedAt && <> · {copy.archivedOn(shortDate(row.archivedAt))}</>}
                  {warnPurge && row.purgeAt && (
                    <span className="text-warning-700">
                      {" "}
                      · {copy.deletesOn(shortDate(row.purgeAt))}
                    </span>
                  )}
                </span>
              </div>
              {row.archivedAt ? (
                <Button
                  kind="tertiary"
                  size={touch ? "md" : "sm"}
                  onClick={async () => {
                    try {
                      await restore(row.code).unwrap();
                      navigate(ROUTES.ROADMAP_IDEA(row.code));
                    } catch {
                      toast.error(en.roadmapV2.draft.restoreFailed);
                    }
                  }}
                >
                  {en.roadmapV2.draft.restore}
                </Button>
              ) : (
                <Button
                  kind="tertiary"
                  size={touch ? "md" : "sm"}
                  aria-label={copy.continueLabel(title)}
                  onClick={() => navigate(ROUTES.ROADMAP_IDEA(row.code))}
                >
                  {copy.continue}
                </Button>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
};
