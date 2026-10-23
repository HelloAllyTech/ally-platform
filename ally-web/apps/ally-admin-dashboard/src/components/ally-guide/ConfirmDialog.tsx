import React from "react";

import { Button, ComposedModal, ModalBody } from "@ally-ui-mono/ui-shared";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** The body: what will happen, and to whom. */
  children: React.ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** A destructive or hard-to-reverse action wears Carbon's danger button. */
  danger?: boolean;
  /** Extra gate on the confirm button (a required checkbox, a minimum length). */
  confirmDisabled?: boolean;
  /** True while the request is in flight: both buttons lock so it cannot be sent twice. */
  isWorking?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The console's one confirm dialog: Carbon's modal with a heading, the consequences in plain words,
 * and Cancel beside the action. Used for everything that changes what learners experience.
 *
 * Cancel is always on the left and always reachable, including while a request is in flight on the
 * confirm side: closing does not abort the request, but it must not be impossible.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  children,
  cancelLabel,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  isWorking = false,
  onConfirm,
  onClose,
}) => (
  <ComposedModal open={isOpen} onClose={onClose} size="sm" aria-label={title}>
    <ModalBody>
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-typography-900">{title}</h2>
        <div className="flex flex-col gap-3 text-sm text-typography-800">{children}</div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button kind="tertiary" className="max-sm:!w-full max-sm:!max-w-none" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            kind={danger ? "danger" : "primary"}
            className="max-sm:!w-full max-sm:!max-w-none"
            disabled={confirmDisabled || isWorking}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalBody>
  </ComposedModal>
);
