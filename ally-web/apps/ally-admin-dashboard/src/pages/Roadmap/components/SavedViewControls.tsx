import React, { useState } from "react";

import { Button, Modal, OverflowMenu, OverflowMenuItem, TextInput } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import type { RoadmapSavedView } from "@types";

/**
 * Making, changing and deleting your own views. Changing filters or sort on any view offers
 * "Save as a view"; on a view of your own it also offers "Update …" when it has changed, and a
 * menu to rename or delete it. The five default views can't be renamed or deleted. A view is yours
 * alone, on every device.
 */
export const SavedViewControls: React.FC<{
  /** Filters or sort have moved off what the current view is, so there is something to save. */
  canSaveAsView: boolean;
  active: RoadmapSavedView | null;
  isDirty: boolean;
  isSaving: boolean;
  onSave: (name: string) => void;
  onUpdate: () => void;
  onRename: (view: RoadmapSavedView, name: string) => Promise<boolean>;
  onDelete: (view: RoadmapSavedView) => Promise<boolean>;
}> = ({ canSaveAsView, active, isDirty, isSaving, onSave, onUpdate, onRename, onDelete }) => {
  const copy = en.roadmapV2.savedViews;
  const [dialog, setDialog] = useState<"save" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const close = () => setDialog(null);

  return (
    <div className="flex items-center gap-1">
      {active && isDirty && (
        <Button kind="ghost" size="sm" onClick={onUpdate} disabled={isSaving}>
          {copy.update(active.name)}
        </Button>
      )}
      {(canSaveAsView || (active && isDirty)) && (
        <Button
          kind="ghost"
          size="sm"
          onClick={() => {
            setName("");
            setDialog("save");
          }}
          disabled={isSaving}
        >
          {copy.save}
        </Button>
      )}
      {active && (
        <OverflowMenu
          aria-label={copy.menu(active.name)}
          iconDescription={copy.menu(active.name)}
          flipped
          size="sm"
        >
          <OverflowMenuItem
            itemText={copy.rename}
            onClick={() => {
              setName(active.name);
              setDialog("rename");
            }}
          />
          <OverflowMenuItem itemText={copy.delete} isDelete onClick={() => setDialog("delete")} />
        </OverflowMenu>
      )}

      <Modal
        open={dialog === "save"}
        size="xs"
        modalHeading={copy.saveTitle}
        primaryButtonText={copy.saveConfirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={!name.trim() || isSaving}
        onRequestClose={close}
        onRequestSubmit={() => {
          if (!name.trim()) return;
          onSave(name.trim());
          close();
        }}
      >
        <NameField id="roadmap-view-name-save" value={name} onChange={setName} />
      </Modal>
      <Modal
        open={dialog === "rename" && !!active}
        size="xs"
        modalHeading={copy.renameTitle}
        primaryButtonText={copy.renameConfirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={!name.trim() || isSaving}
        onRequestClose={close}
        onRequestSubmit={async () => {
          if (!active || !name.trim()) return;
          if (await onRename(active, name.trim())) close();
        }}
      >
        <NameField id="roadmap-view-name-rename" value={name} onChange={setName} />
      </Modal>
      <Modal
        open={dialog === "delete" && !!active}
        size="xs"
        danger
        modalHeading={active ? copy.deleteTitle(active.name) : ""}
        primaryButtonText={copy.deleteConfirm}
        secondaryButtonText={copy.cancel}
        primaryButtonDisabled={isSaving}
        onRequestClose={close}
        onRequestSubmit={async () => {
          if (active && (await onDelete(active))) close();
        }}
      >
        <p className="m-0 text-sm text-typography-primary">{copy.deleteBody}</p>
      </Modal>
    </div>
  );
};

const NameField: React.FC<{ id: string; value: string; onChange: (value: string) => void }> = ({
  id,
  value,
  onChange,
}) => {
  const copy = en.roadmapV2.savedViews;
  return (
    <TextInput
      id={id}
      labelText={copy.nameLabel}
      placeholder={copy.namePlaceholder}
      value={value}
      maxLength={60}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  );
};
