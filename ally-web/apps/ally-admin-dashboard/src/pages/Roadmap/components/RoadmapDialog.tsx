import React from "react";

import { Button, Modal } from "@ally-ui-mono/ui-shared";

import { BottomSheet } from "./BottomSheet";

interface RoadmapDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  primaryText: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryText: string;
  danger?: boolean;
  /** Phone and tablet: a bottom sheet (§4.17 "Its confirm is a bottom sheet"). */
  sheet: boolean;
  closeLabel: string;
}

/**
 * One confirm for the idea flow: Carbon's Modal on a desktop, Roadmap's bottom sheet on touch.
 * Both trap focus and give it back on close (§4.10).
 */
export const RoadmapDialog: React.FC<RoadmapDialogProps> = ({
  open,
  onClose,
  title,
  children,
  primaryText,
  onPrimary,
  primaryDisabled,
  secondaryText,
  danger,
  sheet,
  closeLabel,
}) => {
  if (sheet) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={title}
        closeLabel={closeLabel}
        footer={
          <div className="flex gap-2">
            <Button kind="secondary" size="lg" className="flex-1 max-w-none" onClick={onClose}>
              {secondaryText}
            </Button>
            <Button
              kind={danger ? "danger" : "primary"}
              size="lg"
              className="flex-1 max-w-none"
              onClick={onPrimary}
              disabled={primaryDisabled}
            >
              {primaryText}
            </Button>
          </div>
        }
      >
        {children}
      </BottomSheet>
    );
  }
  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!primaryDisabled) onPrimary();
      }}
      modalHeading={title}
      primaryButtonText={primaryText}
      secondaryButtonText={secondaryText}
      primaryButtonDisabled={primaryDisabled}
      danger={danger}
      size="sm"
      shouldSubmitOnEnter={false}
    >
      {open ? children : null}
    </Modal>
  );
};
