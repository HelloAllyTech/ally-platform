import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useCaptureAllyGuideBaselineMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import { getErrorMessage } from "@utils";

import {
  BASELINE_WINDOW_DEFAULT,
  BASELINE_WINDOW_MAX,
  BASELINE_WINDOW_MIN,
  parseBaselineWindow,
} from "./baselineCompare";

const NOTE_MAX = 500;

/** Capture a snapshot: how many days of enrollments to read, and why. Changes nothing for learners. */
export const CaptureBaselineDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const strings = en.allyConsole.baseline.captureDialog;
  const [capture, { isLoading }] = useCaptureAllyGuideBaselineMutation();
  const [windowText, setWindowText] = useState(String(BASELINE_WINDOW_DEFAULT));
  const [note, setNote] = useState("");

  useEffect(() => {
    if (isOpen) {
      setWindowText(String(BASELINE_WINDOW_DEFAULT));
      setNote("");
    }
  }, [isOpen]);

  const windowDays = parseBaselineWindow(windowText);

  const handleConfirm = async () => {
    if (windowDays === null) return;
    try {
      await capture({ windowDays, note }).unwrap();
      toast.success(strings.success);
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
      confirmLabel={isLoading ? strings.working : strings.confirm}
      confirmDisabled={windowDays === null}
      isWorking={isLoading}
      onConfirm={() => void handleConfirm()}
      onClose={onClose}
    >
      <p>{strings.body}</p>
      <TextInput
        id="ally-baseline-window"
        labelText={strings.windowLabel}
        helperText={strings.windowHelp(BASELINE_WINDOW_MIN, BASELINE_WINDOW_MAX)}
        inputMode="numeric"
        invalid={windowDays === null}
        invalidText={strings.windowInvalid(BASELINE_WINDOW_MIN, BASELINE_WINDOW_MAX)}
        value={windowText}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWindowText(event.target.value)}
      />
      <TextArea
        id="ally-baseline-note"
        labelText={strings.noteLabel}
        helperText={strings.noteHint}
        placeholder={strings.notePlaceholder}
        rows={3}
        maxCount={NOTE_MAX}
        enableCounter
        value={note}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
      />
    </ConfirmDialog>
  );
};
