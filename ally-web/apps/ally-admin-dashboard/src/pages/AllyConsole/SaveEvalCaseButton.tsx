import React, { useState } from "react";

import { toast } from "sonner";

import { Button, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useSaveAllyGuideTurnAsEvalCaseMutation } from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { en } from "@constants";
import { getErrorMessage } from "@utils";

const KINDS = ["regression", "golden"] as const;

/**
 * "Save as eval case" on one turn: its learner message (redacted), the conditions it was sent in
 * and what it should and should not get become a case every release is replayed against. Offered
 * only to an admin with the transcripts grant, because a case holds redacted words. A turn already
 * saved says so rather than failing.
 */
export const SaveEvalCaseButton: React.FC<{ turnId: string }> = ({ turnId }) => {
  const strings = en.allyConsole.evals.saveCase;
  const [save, { isLoading }] = useSaveAllyGuideTurnAsEvalCaseMutation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("regression");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setKind("regression");
    setTitle("");
    setNotes("");
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const handleConfirm = async () => {
    try {
      const result = await save({ turnId, kind, title, notes }).unwrap();
      toast.success(result.duplicate ? strings.duplicate : strings.saved);
      close();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <>
      <Button kind="tertiary" size="sm" onClick={() => setOpen(true)}>
        {strings.button}
      </Button>
      <ConfirmDialog
        isOpen={open}
        title={strings.title}
        cancelLabel={strings.cancel}
        confirmLabel={isLoading ? strings.working : strings.confirm}
        isWorking={isLoading}
        onConfirm={() => void handleConfirm()}
        onClose={close}
      >
        <p>{strings.body}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs tracking-wide text-typography-700">
            {strings.kindLabel}
          </legend>
          {KINDS.map(option => (
            <label key={option} className="flex items-start gap-2 text-sm text-typography-900">
              <input
                type="radio"
                name={`eval-case-kind-${turnId}`}
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="mt-1"
              />
              <span>{strings[option]}</span>
            </label>
          ))}
        </fieldset>
        <TextInput
          id={`eval-case-title-${turnId}`}
          labelText={strings.titleLabel}
          placeholder={strings.titlePlaceholder}
          value={title}
          maxLength={200}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)}
        />
        <TextArea
          id={`eval-case-notes-${turnId}`}
          labelText={strings.notesLabel}
          helperText={strings.notesHint}
          rows={3}
          maxCount={2000}
          enableCounter
          value={notes}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
        />
      </ConfirmDialog>
    </>
  );
};
