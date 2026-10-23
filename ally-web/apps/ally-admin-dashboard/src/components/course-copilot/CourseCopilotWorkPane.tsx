import React, { useEffect, useId, useMemo, useRef, useState } from "react";

import { ErrorBoundary } from "@components/error-boundary";
import { en } from "@constants";
import type {
  CourseBlueprint,
  CourseBrief,
  CourseBriefReadiness,
  CourseCopilotBlueprintResponse,
  CourseCopilotSessionDetail,
  CourseCopilotSessionStatus,
} from "@types";

import { BlueprintTree } from "./BlueprintTree";
import { BriefPanel } from "./BriefPanel";
import { BuildPanel } from "./BuildPanel";
import { asArray } from "./courseCopilotFormat";
import { CourseOutlinePanel } from "./CourseOutlinePanel";

import type { PublishCheck } from "./PublishReadiness";

export interface CourseCopilotWorkPaneProps {
  detail: CourseCopilotSessionDetail;
  /** Brief from the latest `brief` frame; wins over the saved one while a turn streams. */
  liveBrief?: CourseBrief | null;
  liveBriefReadiness?: CourseBriefReadiness | null;
  /** Blueprint from the latest `blueprint` frame or save reply. */
  liveBlueprint?: CourseCopilotBlueprintResponse | null;
  /** Outline item ids the copilot just changed — highlighted briefly in the course view. */
  flashItemIds?: string[];
  onBlueprintSave: (
    blueprint: CourseBlueprint,
    version: number,
  ) => Promise<CourseCopilotBlueprintResponse | null>;
  onApprove: (version: number) => Promise<boolean>;
  onRetryJobs: (jobIds?: string[]) => Promise<void>;
  onCancelBuild: () => Promise<void>;
  onRaiseBudget: (budgetUsd: number) => Promise<boolean>;
  onOpenEditor: () => void;
  onSendMessage: (text: string) => void;
  /** A turn is running: the blueprint may be patched under the trainer, so editing pauses. */
  isBusy?: boolean;
}

type PaneTab = "brief" | "blueprint" | "build" | "course";

const TAB_ORDER: PaneTab[] = ["brief", "blueprint", "build", "course"];

/** Where to land when nothing else says otherwise, most useful first. */
const FALLBACK_ORDER: PaneTab[] = ["course", "build", "blueprint", "brief"];

interface DraftBlueprint {
  blueprint: CourseBlueprint;
  version: number;
  /** Server-found problems for this version; absent when it came from a bare session detail. */
  problems?: string[];
}

/**
 * The newest unapproved blueprint we hold. A `blueprint` frame or save reply is preferred,
 * but only while it is not older than the session's own copy: a stale live copy that
 * outlived a refetch must not shadow what the server now has.
 */
const pickDraft = (
  live: CourseCopilotBlueprintResponse | null | undefined,
  session: CourseCopilotSessionDetail["session"],
): DraftBlueprint | null => {
  if (live?.blueprint && (!session.blueprint || live.version >= session.blueprintVersion)) {
    return {
      blueprint: live.blueprint,
      version: live.version,
      // Absent (not empty) when the frame did not carry it, so the tree falls back to its own checks.
      problems: Array.isArray(live.problems) ? live.problems : undefined,
    };
  }
  if (session.blueprint) {
    return { blueprint: session.blueprint, version: session.blueprintVersion };
  }
  return null;
};

/** The tab each status opens on (contract, "Session status -> right pane"). */
export const defaultTabForStatus = (
  status: CourseCopilotSessionStatus,
  has: { draft: boolean; course: boolean },
): PaneTab => {
  switch (status) {
    case "AWAITING_BLUEPRINT":
      return "blueprint";
    case "BUILDING":
    case "BUILD_FAILED":
      return "build";
    case "EDITING":
      return "course";
    case "ARCHIVED":
      return has.course ? "course" : "brief";
    case "INTERVIEWING":
    default:
      // A blueprint frame can land a moment before the status flips; show it as soon as it exists.
      return has.draft ? "blueprint" : "brief";
  }
};

/**
 * The right-hand pane of Course Copilot: Brief while interviewing, Blueprint to approve,
 * Build while it runs, Course once it exists.
 *
 * The pane follows the session — each status opens on its own tab and a change of status
 * moves it — but never yanks the trainer off a tab they picked in the same status: reading
 * the brief while the copilot drafts a blueprint is a choice, and the Blueprint tab says
 * it has an update instead of stealing the view. Every panel sits in its own error
 * boundary so one malformed agent payload cannot take the whole page down (Builder's
 * lesson).
 */
export const CourseCopilotWorkPane: React.FC<CourseCopilotWorkPaneProps> = ({
  detail,
  liveBrief,
  liveBriefReadiness,
  liveBlueprint,
  flashItemIds,
  onBlueprintSave,
  onApprove,
  onRetryJobs,
  onCancelBuild,
  onRaiseBudget,
  onOpenEditor,
  onSendMessage,
  isBusy = false,
}) => {
  const strings = en.courseCopilotPane;
  const session = detail.session;
  const status = session.status;
  const idPrefix = useId();

  const draft = useMemo(() => pickDraft(liveBlueprint, session), [liveBlueprint, session]);
  const approved = session.approvedBlueprint ?? null;

  // The tree edits the draft only while the session is waiting on an approval; every other
  // status shows the blueprint that was (or is being) built, read-only.
  const blueprintEditable = status === "AWAITING_BLUEPRINT";
  const shownBlueprint: DraftBlueprint | null = blueprintEditable
    ? draft
    : approved
      ? { blueprint: approved, version: session.blueprintVersion }
      : draft;

  const available: Record<PaneTab, boolean> = {
    brief: true,
    blueprint: shownBlueprint !== null,
    build: asArray(detail.jobs).length > 0 || status === "BUILDING" || status === "BUILD_FAILED",
    course: Boolean(detail.outline),
  };

  const [picked, setPicked] = useState<{ status: CourseCopilotSessionStatus; tab: PaneTab } | null>(
    null,
  );

  // A blueprint appearing for the first time takes the view even over a picked tab: until
  // now there was nothing to look at there, so the pick cannot have been about it.
  const hasDraft = draft !== null;
  const hadDraftRef = useRef(hasDraft);
  useEffect(() => {
    if (hasDraft && !hadDraftRef.current) setPicked(null);
    hadDraftRef.current = hasDraft;
  }, [hasDraft]);

  const wanted =
    picked && picked.status === status && available[picked.tab]
      ? picked.tab
      : defaultTabForStatus(status, { draft: hasDraft, course: available.course });
  const activeTab: PaneTab = available[wanted]
    ? wanted
    : (FALLBACK_ORDER.find(tab => available[tab]) ?? "brief");

  // Tell the trainer the blueprint changed while they were reading something else.
  const draftVersion = draft?.version ?? 0;
  const [seenBlueprintVersion, setSeenBlueprintVersion] = useState(draftVersion);
  useEffect(() => {
    if (activeTab === "blueprint") setSeenBlueprintVersion(draftVersion);
  }, [activeTab, draftVersion]);
  const blueprintUpdated = activeTab !== "blueprint" && draftVersion > seenBlueprintVersion;

  const tabRefs = useRef<Partial<Record<PaneTab, HTMLButtonElement | null>>>({});

  const selectTab = (tab: PaneTab) => {
    if (!available[tab]) return;
    setPicked({ status, tab });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = TAB_ORDER.filter(tab => available[tab]);
    const current = enabled.indexOf(activeTab);
    let next: PaneTab | undefined;
    if (event.key === "ArrowRight") next = enabled[(current + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      next = enabled[(current - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  const openEditorDisabledReason =
    status === "BUILDING" ? strings.course.openEditorBuildingHint : null;
  // The copilot can only act on a finished, live course: not mid-build, not mid-turn, not archived.
  const canAskCopilot = status === "EDITING" && !isBusy;

  const handleAskCopilot = (check: PublishCheck) => {
    const detailText = check.detail ? ` (${check.detail})` : "";
    onSendMessage(strings.course.readiness.askCopilotMessage(check.label, detailText));
  };

  const brief = liveBrief ?? session.brief;
  const briefReadiness = liveBriefReadiness ?? session.briefReadiness;

  const panelId = (tab: PaneTab) => `${idPrefix}-panel-${tab}`;
  const tabId = (tab: PaneTab) => `${idPrefix}-tab-${tab}`;

  const renderPanel = () => {
    switch (activeTab) {
      case "brief":
        return <BriefPanel brief={brief} readiness={briefReadiness} />;
      case "blueprint":
        return shownBlueprint ? (
          <BlueprintTree
            blueprint={shownBlueprint.blueprint}
            version={shownBlueprint.version}
            problems={shownBlueprint.problems}
            budget={detail.budget}
            brief={brief}
            editable={blueprintEditable}
            isBusy={isBusy}
            readOnlyReason={
              status === "INTERVIEWING"
                ? strings.blueprint.draftNotice
                : strings.blueprint.approvedNotice
            }
            onSave={onBlueprintSave}
            onApprove={onApprove}
            onRaiseBudget={onRaiseBudget}
          />
        ) : null;
      case "build":
        return (
          <BuildPanel
            detail={detail}
            flashItemIds={flashItemIds}
            onRetryJobs={onRetryJobs}
            onCancelBuild={onCancelBuild}
            onRaiseBudget={onRaiseBudget}
            onOpenEditor={onOpenEditor}
            openEditorDisabledReason={openEditorDisabledReason}
          />
        );
      case "course":
        return (
          <CourseOutlinePanel
            outline={detail.outline}
            readiness={detail.readiness}
            changeLog={session.changeLog}
            flashItemIds={flashItemIds}
            onOpenEditor={onOpenEditor}
            openEditorDisabledReason={openEditorDisabledReason}
            onAskCopilot={canAskCopilot ? handleAskCopilot : undefined}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="course-copilot-work-pane">
      <div
        role="tablist"
        aria-label={strings.paneLabel}
        onKeyDown={handleTabKeyDown}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-neutral-200 px-2"
      >
        {TAB_ORDER.map(tab => {
          const isActive = tab === activeTab;
          const isEnabled = available[tab];
          return (
            <button
              key={tab}
              ref={node => {
                tabRefs.current[tab] = node;
              }}
              id={tabId(tab)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId(tab)}
              tabIndex={isActive ? 0 : -1}
              disabled={!isEnabled}
              title={isEnabled ? undefined : strings.tabs.unavailable}
              onClick={() => selectTab(tab)}
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
                isActive
                  ? "border-primary-500 font-medium text-primary-700"
                  : "border-transparent text-typography-800 hover:text-typography-900"
              } disabled:cursor-not-allowed disabled:text-typography-disabled`}
            >
              {strings.tabs[tab]}
              {tab === "blueprint" && blueprintUpdated && (
                <span
                  role="img"
                  aria-label={strings.tabs.updated}
                  title={strings.tabs.updated}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-primary-500"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-labelledby={tabId(activeTab)}
        className={`min-h-0 flex-1 ${activeTab === "blueprint" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        <ErrorBoundary variant="panel" resetKey={`${session.id}:${activeTab}`} className="m-4">
          {renderPanel()}
        </ErrorBoundary>
      </div>
    </div>
  );
};
