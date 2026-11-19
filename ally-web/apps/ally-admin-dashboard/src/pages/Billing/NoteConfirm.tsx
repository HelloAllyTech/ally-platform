import React, { useEffect, useState } from "react";

import { ActionConfirmationPopup } from "@components";
import { ButtonVariant } from "@components/types";

import { BILLING } from "./copy";

export interface NoteConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Sends the change with its note. Rejecting keeps the dialog open so the note isn't lost. */
  onConfirm: (note: string) => Promise<void>;
}

interface NoteConfirmProps {
  request: NoteConfirmRequest | null;
  onClose: () => void;
}

/**
 * Every CR1 admin change says why and asks to confirm (chunk-cr1 §A1): the existing confirmation
 * popup, with a required note. Confirm stays off until the note has words.
 */
export const NoteConfirm: React.FC<NoteConfirmProps> = ({ request, onClose }) => {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote("");
    setBusy(false);
  }, [request]);

  const confirm = async () => {
    if (!request || !note.trim() || busy) return;
    setBusy(true);
    try {
      await request.onConfirm(note.trim());
      onClose();
    } catch {
      // The caller has shown the server's message; keep the dialog and the note.
      setBusy(false);
    }
  };

  return (
    <ActionConfirmationPopup
      isOpen={Boolean(request)}
      onClose={onClose}
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      primaryButton={{
        label: request?.confirmLabel ?? "",
        onClick: confirm,
        disabled: !note.trim() || busy,
        variant: request?.destructive ? ButtonVariant.DESTRUCTIVE : ButtonVariant.PRIMARY,
      }}
      secondaryButton={{ label: BILLING.note.cancel, onClick: onClose }}
    >
      <div className="w-full text-left mt-2">
        <label htmlFor="billing-note" className="block text-sm text-typography-700 mb-1">
          {BILLING.note.label}
        </label>
        <textarea
          id="billing-note"
          data-testid="billing-note"
          className="w-full border border-border-light rounded-md px-3 py-2 text-base focus:outline-none focus:border-primary-500"
          rows={3}
          value={note}
          placeholder={BILLING.note.placeholder}
          onChange={event => setNote(event.target.value)}
        />
        <p className="mt-1 text-xs text-typography-500">{BILLING.note.help}</p>
      </div>
    </ActionConfirmationPopup>
  );
};
