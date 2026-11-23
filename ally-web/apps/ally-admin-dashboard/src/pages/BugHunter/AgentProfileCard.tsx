import { FC, useState } from "react";

import { HelpIcon } from "@icons";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetBugFindingsQuery,
  useGetBugHunterSettingsQuery,
  useUpdateBugHunterSettingsMutation,
} from "@api";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
// Direct path rather than the @components barrel: several suites on this page
// mock that barrel wholesale, and reaching past it keeps the avatar real in
// them — the same treatment ErrorBoundary gets in BugFindingsTable.
import { AgentAvatar } from "@components/agent-avatar";
import { en } from "@constants";
import { BugFinding, BugHunterMode } from "@types";

import { AgentStatusKind, deriveAgentStatus } from "./agentPersona";
import { BrailleSpinner } from "./BrailleSpinner";
import { IN_FLIGHT_STATUSES } from "./lifecycleBucket";

const MODE_ORDER: BugHunterMode[] = [BugHunterMode.OFF, BugHunterMode.MANUAL, BugHunterMode.AI];

/**
 * Read inside functions rather than hoisted: `@constants` is a barrel that
 * several suites on this page mock wholesale, and a module-scope `Record` built
 * off it is the import-time trap the ally-web CLAUDE.md names.
 */
const modeLabels = (): Record<BugHunterMode, string> => ({
  [BugHunterMode.OFF]: en.bugHunter.modeOff,
  [BugHunterMode.MANUAL]: en.bugHunter.modeManual,
  [BugHunterMode.AI]: en.bugHunter.modeAi,
});

/**
 * One title per mode rather than one template with the mode's name dropped in.
 * "Switch Bug Hunter to Off?" is the sentence a template produces, and it is
 * not how anyone talks about sending someone off duty.
 */
const modeConfirmTitles = (): Record<BugHunterMode, string> => ({
  [BugHunterMode.OFF]: en.bugHunter.modeOffConfirmTitle,
  [BugHunterMode.MANUAL]: en.bugHunter.modeManualConfirmTitle,
  [BugHunterMode.AI]: en.bugHunter.modeAiConfirmTitle,
});

const modeConfirmBodies = (): Record<BugHunterMode, string> => ({
  [BugHunterMode.OFF]: en.bugHunter.modeOffConfirmBody,
  [BugHunterMode.MANUAL]: en.bugHunter.modeManualConfirmBody,
  [BugHunterMode.AI]: en.bugHunter.modeAiConfirmBody,
});

/**
 * The state word's colour — the same four meanings as the status badges:
 * orange when it is waiting on you, red when something went red, plain
 * otherwise. "Working" is plain too: the spinner beside "Fixing N now" says it.
 */
const STATE_STYLES: Record<AgentStatusKind, string> = {
  off_duty: "text-typography-900",
  waiting_on_you: "text-orange-700",
  problem: "text-destructive-700",
  working: "text-typography-900",
  on_shift: "text-typography-900",
};

export interface AgentProfileCardProps {
  /** Opens the In progress tab — what "Fixing N now" links to. */
  onShowInProgress: () => void;
  /** Opens the About panel. */
  onShowHelp: () => void;
}

/**
 * Bug Hunter's header: one line.
 *
 * ## What is on it, and why only that (2026-10-13)
 *
 * The name; one status sentence — the state, "Fixing N now", and when the last
 * sweep ran; the working-style dropdown; a help button; and a ⋯ menu. That is
 * the whole of it, and the third cut this card has taken.
 *
 * It began at about 450px with a role line, a self-introduction, four workload
 * numbers and sweep controls. By 2026-10-01 it was one line with a 432px
 * three-way switch, a gear and a tooltip on it, and below it the Work tab
 * still stacked a live board, a today board and a UX Signals bar — about
 * 520px of chrome above the bugs table when idle and 1,050px when busy, most
 * of it the same facts said again. The product head's review found working
 * state signalled in about ten places; it is said here once, and the table's
 * spinner says which bugs.
 *
 * - **"Fixing N now"** links to the In progress tab rather than listing the
 *   bugs: they are already rows there. It replaced the live board.
 * - **The working style is a dropdown**, labelled plainly — Off, Manual,
 *   Autonomous — and still confirm-before-flip: it decides what happens to
 *   every bug the pipeline is about to find, and landing on the wrong one
 *   shouldn't be a misclick. This stays the one place the kill switch lives.
 * - **No ⋯ menu.** It held the old Bug Hunter's model settings, UX scan and
 *   feature map; all three left with that engine.
 * - **Help** opens About in a side panel, so About is no longer a tab.
 */
export const AgentProfileCard: FC<AgentProfileCardProps> = ({ onShowInProgress, onShowHelp }) => {
  const { data: settings, isLoading, isError } = useGetBugHunterSettingsQuery();
  const [updateSettings, { isLoading: isUpdating }] = useUpdateBugHunterSettingsMutation();

  // Identical query args to BugFindingsTable's initial state and to
  // RunHistoryTable's, so these share one RTK Query cache entry each rather
  // than opening a second request per surface.
  const { data: findingsData } = useGetBugFindingsQuery(
    { status: "all", limit: 100 },
    { pollingInterval: 15_000 },
  );

  const [pendingMode, setPendingMode] = useState<BugHunterMode | null>(null);

  const findings: BugFinding[] = findingsData?.items ?? [];
  const status = deriveAgentStatus({ mode: settings?.mode, findings, liveRun: null });
  const fixingCount = findings.filter(finding =>
    IN_FLIGHT_STATUSES.includes(finding.status),
  ).length;

  const handleConfirm = async () => {
    if (pendingMode === null) return;
    try {
      await updateSettings({ mode: pendingMode }).unwrap();
    } catch {
      toast.error(en.bugHunter.updateFailed);
    } finally {
      setPendingMode(null);
    }
  };

  const labels = modeLabels();

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-light bg-white px-4 py-2.5">
      <AgentAvatar size="sm" label={`${en.bugHunter.agentName}, ${en.bugHunter.agentRole}`} />
      <h1 className="text-lg text-typography-900 font-secondary leading-none">
        {en.bugHunter.agentName}
      </h1>

      {/* The one status sentence. Suppressed while settings are still loading
          rather than guessing at a state from a half-loaded page. Separate
          fragments joined by dots, each in sentence case, so any of them can
          drop out without the rest needing re-punctuating. */}
      {!isLoading && !isError && (
        <p
          className="min-w-0 flex-1 basis-[16rem] text-sm text-typography-700 sm:truncate"
          data-testid="bug-hunter-status-line"
        >
          {/* "Working" says nothing "Fixing 2 now" doesn't, so it gives way. */}
          {status.kind !== "working" && (
            <span className={`font-medium ${STATE_STYLES[status.kind]}`} title={status.detail}>
              {status.label}
            </span>
          )}
          {fixingCount > 0 && (
            <>
              {status.kind !== "working" && <span aria-hidden="true"> · </span>}
              <button
                type="button"
                onClick={onShowInProgress}
                className="inline-flex items-center gap-1 text-primary-700 hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
              >
                <BrailleSpinner className="text-typography-500" />
                {en.bugHunter.headerFixingNow.replace("{count}", String(fixingCount))}
              </button>
            </>
          )}
        </p>
      )}
      {isError && (
        <p className="text-sm text-destructive-600 flex-1">{en.bugHunter.updateFailed}</p>
      )}

      <div className="ml-auto flex items-center gap-1">
        {/* The kill switch. A native select, controlled by the saved mode, so
            a cancelled confirmation needs no remount to snap back — the value
            simply never changed. Labelled for screen readers by the same
            words the old switcher printed beside itself. */}
        {!isLoading && !isError && settings && (
          <label className="flex items-center gap-1.5 text-xs text-typography-600">
            <span className="sr-only">{en.bugHunter.modeLabel}</span>
            <select
              aria-label={en.bugHunter.modeLabel}
              value={settings.mode}
              disabled={isUpdating}
              onChange={event => {
                const mode = event.target.value as BugHunterMode;
                if (mode !== settings.mode) setPendingMode(mode);
              }}
              data-testid="bug-hunter-mode-select"
              className="h-10 rounded-md border border-border-light bg-white pl-2 pr-7 text-sm text-typography-900 md:h-8 cursor-pointer hover:border-border-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {MODE_ORDER.map(mode => (
                <option key={mode} value={mode}>
                  {labels[mode]}
                </option>
              ))}
            </select>
          </label>
        )}

        <Button
          size="sm"
          kind="ghost"
          hasIconOnly
          iconDescription={en.bugHunter.helpButtonLabel}
          tooltipAlignment="end"
          renderIcon={HelpIcon}
          onClick={onShowHelp}
        />
      </div>

      {pendingMode !== null && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setPendingMode(null)}
          title={modeConfirmTitles()[pendingMode]}
          description={modeConfirmBodies()[pendingMode]}
          primaryButton={{ label: en.bugHunter.modeConfirm, onClick: handleConfirm }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setPendingMode(null) }}
        />
      )}
    </section>
  );
};
