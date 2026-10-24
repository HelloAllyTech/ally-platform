import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { Checkbox, InlineNotification, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import {
  usePromoteAllyGuideReleaseMutation,
  useRollbackAllyGuideReleaseMutation,
  useStartAllyGuideCanaryMutation,
  useStopAllyGuideCanaryMutation,
} from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import { AllyGuideRollbackTarget } from "@types";
import { getErrorMessage } from "@utils";

import { CANARY_MAX_PERCENT, DEFAULT_CANARY_PERCENT, parseCanaryPercent } from "./canaryShare";

/** The reason is stored in the audit trail; ally-be caps it at this length. */
export const ROLLBACK_REASON_MAX = 500;

/** The least the dialogs need to know about a release: which one, and its number. */
export interface ReleaseRef {
  id: string;
  version: number;
}

interface ReasonStrings {
  reasonLabel: string;
  reasonHint: string;
  reasonPlaceholder: string;
}

const ReasonField: React.FC<{
  id: string;
  strings: ReasonStrings;
  value: string;
  onChange: (value: string) => void;
}> = ({ id, strings, value, onChange }) => (
  <TextArea
    id={id}
    labelText={strings.reasonLabel}
    helperText={strings.reasonHint}
    placeholder={strings.reasonPlaceholder}
    rows={3}
    maxCount={ROLLBACK_REASON_MAX}
    enableCounter
    value={value}
    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
  />
);

interface EmergencyStrings {
  emergencyLabel: string;
  emergencyHelp: string;
  emergencyWarningTitle: string;
  emergencyWarning: string;
}

/** The emergency tick box, with its cost in plain words, and the warning that appears once it is ticked. */
const EmergencyField: React.FC<{
  id: string;
  strings: EmergencyStrings;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, strings, checked, onChange }) => (
  <>
    <div>
      <Checkbox
        id={id}
        labelText={strings.emergencyLabel}
        checked={checked}
        onChange={(_event: unknown, { checked: next }: { checked: boolean }) => onChange(next)}
      />
      <p className="mt-1 pl-7 text-xs text-typography-700">{strings.emergencyHelp}</p>
    </div>
    {checked && (
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title={strings.emergencyWarningTitle}
        subtitle={strings.emergencyWarning}
        data-testid="emergency-warning"
      />
    )}
  </>
);

interface PromoteReleaseDialogProps {
  /** The release to make live; null keeps the dialog closed. */
  release: ReleaseRef | null;
  /** The release that is live now and will be retired. */
  current: ReleaseRef | null;
  /** The release in canary, if any: promoting it ends the canary, promoting another leaves it running. */
  canary?: ReleaseRef | null;
  onClose: () => void;
}

/**
 * Promote a release to live. Says what changes and for whom before it does: the current release is
 * retired, conversations under way keep theirs until their next epoch, new ones start on this one.
 * Promoting the release that is in canary also ends the canary, and the words say so.
 */
export const PromoteReleaseDialog: React.FC<PromoteReleaseDialogProps> = ({
  release,
  current,
  canary = null,
  onClose,
}) => {
  const strings = en.allyConsole.releases.promoteDialog;
  const [promote, { isLoading }] = usePromoteAllyGuideReleaseMutation();

  const handleConfirm = async () => {
    if (!release) return;
    try {
      await promote(release.id).unwrap();
      toast.success(strings.success(releaseVersionLabel(release.version)));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  const version = release ? releaseVersionLabel(release.version) : "";
  const retiring =
    current && release?.id !== current.id ? releaseVersionLabel(current.version) : null;
  const promotingCanary = Boolean(release && canary && canary.id === release.id);
  const otherCanary = release && canary && canary.id !== release.id ? canary : null;
  return (
    <ConfirmDialog
      isOpen={release !== null}
      title={strings.title(version)}
      cancelLabel={strings.cancel}
      confirmLabel={isLoading ? strings.working : strings.confirm(version)}
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>
        {promotingCanary ? strings.canaryBody(version, retiring) : strings.body(version, retiring)}
      </p>
      {otherCanary && (
        <p data-testid="promote-other-canary">
          {strings.otherCanary(releaseVersionLabel(otherCanary.version), version)}
        </p>
      )}
      <p className="text-typography-700">{strings.undo}</p>
    </ConfirmDialog>
  );
};

interface RollbackReleaseDialogProps {
  isOpen: boolean;
  /** The release that is live now and will be retired. */
  current: ReleaseRef | null;
  /** Where the server says a rollback lands; null when it could not be worked out, so the words stay general. */
  target: AllyGuideRollbackTarget | null;
  onClose: () => void;
}

/**
 * Roll back to the release that was live before the current one, naming it.
 *
 * A normal rollback behaves like a promotion: conversations move at their next epoch. An EMERGENCY
 * rollback moves every conversation at its next turn, at the cost of a cache miss for each, and is
 * for safety reasons only: ticking it reveals that cost in plain words and changes the button, so it
 * is never chosen by accident. The reason is optional on the wire and stays optional here: asking for
 * an essay during an incident would slow down the one action meant to be fast.
 */
export const RollbackReleaseDialog: React.FC<RollbackReleaseDialogProps> = ({
  isOpen,
  current,
  target,
  onClose,
}) => {
  const strings = en.allyConsole.releases.rollbackDialog;
  const [rollback, { isLoading }] = useRollbackAllyGuideReleaseMutation();
  const [reason, setReason] = useState("");
  const [emergency, setEmergency] = useState(false);

  // A dialog that reopens starts clean: a ticked emergency box left over from last time is the
  // worst thing to find already checked.
  useEffect(() => {
    if (isOpen) {
      setReason("");
      setEmergency(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    try {
      const live = await rollback({ emergency, reason }).unwrap();
      toast.success(strings.success(releaseVersionLabel(live.version)));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={strings.title}
      cancelLabel={strings.cancel}
      confirmLabel={
        isLoading ? strings.working : emergency ? strings.confirmEmergency : strings.confirm
      }
      danger
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>
        {strings.body(
          current ? releaseVersionLabel(current.version) : null,
          target ? releaseVersionLabel(target.version) : null,
        )}
      </p>
      <ReasonField
        id="ally-rollback-reason"
        strings={strings}
        value={reason}
        onChange={setReason}
      />
      <EmergencyField
        id="ally-rollback-emergency"
        strings={strings}
        checked={emergency}
        onChange={setEmergency}
      />
    </ConfirmDialog>
  );
};

interface StartCanaryDialogProps {
  /** The release to put in canary (or whose share to change); null keeps the dialog closed. */
  release: (ReleaseRef & { rolloutPercent?: number | null; status?: string }) | null;
  /** The release that is live now and serves everyone else. */
  live: ReleaseRef | null;
  onClose: () => void;
}

/**
 * Put a release in front of a share of new conversations, or change the share of one already there.
 *
 * It says who sees it and who does not, that only one canary runs at a time, and that promoting or
 * stopping is a person's decision: ally-be does neither on its own in this milestone. The share is
 * typed, not dragged: a slider invites a 7% nobody chose, and the cap (30) is easy to state.
 */
export const StartCanaryDialog: React.FC<StartCanaryDialogProps> = ({ release, live, onClose }) => {
  const strings = en.allyConsole.releases.startCanaryDialog;
  const [start, { isLoading }] = useStartAllyGuideCanaryMutation();
  const [share, setShare] = useState(String(DEFAULT_CANARY_PERCENT));
  const [reason, setReason] = useState("");

  const releaseId = release?.id ?? null;
  const currentShare = release?.rolloutPercent ?? null;
  useEffect(() => {
    if (releaseId) {
      setShare(String(currentShare ?? DEFAULT_CANARY_PERCENT));
      setReason("");
    }
  }, [releaseId, currentShare]);

  const percent = parseCanaryPercent(share);
  const changing = release?.status === "canary";
  const version = release ? releaseVersionLabel(release.version) : "";

  const handleConfirm = async () => {
    if (!release || percent === null) return;
    try {
      await start({ id: release.id, percent, reason }).unwrap();
      toast.success(strings.success(version, percent));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <ConfirmDialog
      isOpen={release !== null}
      title={changing ? strings.changeTitle(version) : strings.title(version)}
      cancelLabel={strings.cancel}
      confirmLabel={
        isLoading
          ? strings.working
          : changing
            ? strings.confirmChange(percent)
            : strings.confirm(percent)
      }
      confirmDisabled={percent === null}
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>{strings.body(version, live ? releaseVersionLabel(live.version) : null)}</p>
      <TextInput
        id="ally-canary-share"
        labelText={strings.shareLabel}
        helperText={strings.shareHelp(CANARY_MAX_PERCENT)}
        inputMode="numeric"
        invalid={percent === null}
        invalidText={strings.shareInvalid(CANARY_MAX_PERCENT)}
        value={share}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShare(event.target.value)}
      />
      <ReasonField id="ally-canary-reason" strings={strings} value={reason} onChange={setReason} />
      <p className="text-typography-700">{strings.oneAtATime}</p>
    </ConfirmDialog>
  );
};

interface StopCanaryDialogProps {
  /** The release in canary; null keeps the dialog closed. */
  canary: ReleaseRef | null;
  /** The release that is live now. */
  live: ReleaseRef | null;
  onClose: () => void;
}

/**
 * End the canary without promoting it. The release is retired and new conversations all go to the
 * live one. An EMERGENCY stop also moves the conversations already in the canary at their next turn,
 * at the cost of one cache miss each: ticking it shows that cost and changes the button, as the
 * emergency rollback does, so a safety stop is deliberate and an ordinary one stays gentle.
 */
export const StopCanaryDialog: React.FC<StopCanaryDialogProps> = ({ canary, live, onClose }) => {
  const strings = en.allyConsole.releases.stopCanaryDialog;
  const [stop, { isLoading }] = useStopAllyGuideCanaryMutation();
  const [reason, setReason] = useState("");
  const [emergency, setEmergency] = useState(false);

  const canaryId = canary?.id ?? null;
  useEffect(() => {
    if (canaryId) {
      setReason("");
      setEmergency(false);
    }
  }, [canaryId]);

  const version = canary ? releaseVersionLabel(canary.version) : "";

  const handleConfirm = async () => {
    try {
      await stop({ emergency, reason }).unwrap();
      toast.success(strings.success(version));
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <ConfirmDialog
      isOpen={canary !== null}
      title={strings.title(version)}
      cancelLabel={strings.cancel}
      confirmLabel={
        isLoading ? strings.working : emergency ? strings.confirmEmergency : strings.confirm
      }
      danger
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>{strings.body(version, live ? releaseVersionLabel(live.version) : null)}</p>
      <p className="text-typography-700">{strings.retired}</p>
      <ReasonField
        id="ally-canary-stop-reason"
        strings={strings}
        value={reason}
        onChange={setReason}
      />
      <EmergencyField
        id="ally-canary-stop-emergency"
        strings={strings}
        checked={emergency}
        onChange={setEmergency}
      />
    </ConfirmDialog>
  );
};
