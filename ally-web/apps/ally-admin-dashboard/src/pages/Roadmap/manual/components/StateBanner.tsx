import React from "react";

import { InlineNotification } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { ManualState } from "@types";
import { formatDate, formatRelativeTime } from "@utils";

/** How often `GET /state` is read while the tab is visible. */
export const MANUAL_STATE_POLL_MS = 60_000;

/** How often state and the run list are read while the weekly agent is running, so the drawer is live. */
export const MANUAL_RUN_POLL_MS = 5_000;

/** When the weekly agent last finished (or ran), if the state says. */
export const lastCheckedAt = (state: ManualState | undefined): string | null => {
  const run = state?.lastRun;
  return run?.finishedAt ?? run?.at ?? run?.startedAt ?? null;
};

/**
 * The manual's one banner: the server's own sentence when weekly updates are paused or the month's
 * budget is spent. Nothing at all otherwise — the reader stays quiet.
 */
export const StateBanner: React.FC<{ state: ManualState | undefined }> = ({ state }) => {
  if (!state?.banner) return null;
  return (
    <InlineNotification
      kind="info"
      lowContrast
      hideCloseButton
      title=""
      subtitle={state.banner}
      className="!m-0 !max-w-none"
    />
  );
};

/** The rail's footer: "Checked against the code …" and, for those who run the manual, the gaps. */
export const StateFooter: React.FC<{
  state: ManualState | undefined;
  onOpenGaps?: () => void;
}> = ({ state, onOpenGaps }) => {
  const copy = en.productManual.state;
  const checked = lastCheckedAt(state);
  return (
    <>
      {checked && (
        <p className="m-0" title={formatDate(checked)}>
          {copy.lastChecked(formatRelativeTime(checked))}
        </p>
      )}
      {state?.canAdminister && state.openGaps > 0 && onOpenGaps && (
        <button
          type="button"
          onClick={onOpenGaps}
          className="self-start text-left text-xs text-primary-700 hover:underline"
        >
          {copy.gaps(state.openGaps)}
        </button>
      )}
    </>
  );
};
