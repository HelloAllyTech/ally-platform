import { FC, ReactNode, useEffect, useState } from "react";

import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { ButtonVariant } from "@components/types";
import { en } from "@constants/en";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** What will happen. Say the consequence, not "Are you sure?". */
  consequence: string;
  /**
   * Irreversible actions get a destructive button AND an acknowledge checkbox that must be
   * ticked before the button enables. Reversible ones get neither: the checkbox is friction
   * that only earns its place when there is no way back.
   */
  irreversible?: boolean;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  children?: ReactNode;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  consequence,
  irreversible = false,
  confirmLabel,
  cancelLabel = en.adminUx.confirm.cancel,
  onConfirm,
  onCancel,
  isLoading,
  children,
}) => {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (!isOpen) setAcknowledged(false);
  }, [isOpen]);

  return (
    <ActionConfirmationPopup
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      description={consequence}
      primaryButton={{
        label: confirmLabel,
        onClick: onConfirm,
        variant: irreversible ? ButtonVariant.DESTRUCTIVE : ButtonVariant.PRIMARY,
        disabled: isLoading || (irreversible && !acknowledged),
      }}
      secondaryButton={{ label: cancelLabel, onClick: onCancel }}
    >
      {children}
      {irreversible ? (
        <label className="mt-2 flex items-center gap-2 text-sm text-typography-800">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
          />
          {en.adminUx.confirm.acknowledge}
        </label>
      ) : (
        <p className="mt-1 text-xs text-typography-600">{en.adminUx.confirm.reversibleHint}</p>
      )}
    </ActionConfirmationPopup>
  );
};
