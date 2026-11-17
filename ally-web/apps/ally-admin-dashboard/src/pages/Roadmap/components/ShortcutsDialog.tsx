import React from "react";

import { Modal } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** "?" lists the Queue's keys (§4.10). TODO(P3): A / L / D / X / U join this list with triage. */
export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onClose }) => {
  const copy = en.roadmapV2.shortcuts;
  const rows: [string, string][] = [
    ["J", copy.next],
    ["K", copy.previous],
    ["Enter", copy.open],
    ["Esc", copy.close],
    ["⌘K / Ctrl K", copy.quickOpen],
    ["?", copy.help],
  ];
  return (
    <Modal
      open={open}
      passiveModal
      size="sm"
      modalHeading={copy.title}
      onRequestClose={onClose}
      closeButtonLabel={copy.dismiss}
    >
      <p className="mb-3 text-sm text-typography-secondary">{copy.intro}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([key, label]) => (
          <React.Fragment key={key}>
            <dt>
              <kbd className="rounded border border-border-light px-1.5 py-0.5 text-xs">{key}</kbd>
            </dt>
            <dd className="m-0 text-typography-primary">{label}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Modal>
  );
};
