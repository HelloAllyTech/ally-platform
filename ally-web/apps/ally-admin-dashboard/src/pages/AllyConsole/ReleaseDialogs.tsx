import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { Checkbox, InlineNotification, TextArea } from "@ally-ui-mono/ui-shared";
import { usePromoteAllyGuideReleaseMutation, useRollbackAllyGuideReleaseMutation } from "@api";
import { releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import { AllyGuideRelease } from "@types";
import { getErrorMessage } from "@utils";

/** The reason is stored in the audit trail; ally-be caps it at this length. */
export const ROLLBACK_REASON_MAX = 500;

interface PromoteReleaseDialogProps {
  /** The release to make live; null keeps the dialog closed. */
  release: AllyGuideRelease | null;
  /** The release that is live now and will be retired. */
  current: AllyGuideRelease | null;
  onClose: () => void;
}

/**
 * Promote a release to live. Says what changes and for whom before it does: the current release is
 * retired, conversations under way keep theirs until their next epoch, new ones start on this one.
 */
export const PromoteReleaseDialog: React.FC<PromoteReleaseDialogProps> = ({
  release,
  current,
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
        {strings.body(
          version,
          current && release?.id !== current.id ? releaseVersionLabel(current.version) : null,
        )}
      </p>
      <p className="text-typography-700">{strings.undo}</p>
    </ConfirmDialog>
  );
};

interface RollbackReleaseDialogProps {
  isOpen: boolean;
  /** The release that is live now and will be retired. */
  current: AllyGuideRelease | null;
  onClose: () => void;
}

/**
 * Roll back to the release that was live before the current one.
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
      <p>{strings.body(current ? releaseVersionLabel(current.version) : null)}</p>
      <TextArea
        id="ally-rollback-reason"
        labelText={strings.reasonLabel}
        helperText={strings.reasonHint}
        placeholder={strings.reasonPlaceholder}
        rows={3}
        maxCount={ROLLBACK_REASON_MAX}
        enableCounter
        value={reason}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
      />
      <div>
        <Checkbox
          id="ally-rollback-emergency"
          labelText={strings.emergencyLabel}
          checked={emergency}
          onChange={(_event: unknown, { checked }: { checked: boolean }) => setEmergency(checked)}
        />
        <p className="mt-1 pl-7 text-xs text-typography-700">{strings.emergencyHelp}</p>
      </div>
      {emergency && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title={strings.emergencyWarningTitle}
          subtitle={strings.emergencyWarning}
          data-testid="rollback-emergency-warning"
        />
      )}
    </ConfirmDialog>
  );
};
