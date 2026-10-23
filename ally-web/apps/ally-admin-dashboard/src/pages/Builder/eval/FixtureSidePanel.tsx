import React, { useState } from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, SidePanel, Tag, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import { useDeleteBuilderEvalFixtureMutation, useUpdateBuilderEvalFixtureMutation } from "@api";
import { en, ROUTES } from "@constants";
import type { BuilderEvalChecklistItem, BuilderEvalFixture } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

import { ChecklistEditor } from "./ChecklistEditor";
import {
  checklistOf,
  checklistsEqual,
  cleanChecklist,
  expectationOf,
  expectsNothingToBuild,
  interviewContextOf,
  MAX_FIXTURE_NAME,
  MAX_FIXTURE_NOTES,
} from "./evalFormat";

interface FixtureFormProps {
  fixture: BuilderEvalFixture;
  onClose: () => void;
}

/**
 * Keyed by fixture id by its parent, so the draft is seeded once per fixture and
 * is not overwritten when the list refetches under it (the table's active
 * switch invalidates the same query).
 */
const FixtureForm: React.FC<FixtureFormProps> = ({ fixture, onClose }) => {
  const strings = en.builder.eval.fixturePanel;
  const navigate = useNavigate();

  const savedChecklist = checklistOf(fixture);
  const [name, setName] = useState(fixture.name);
  const [notes, setNotes] = useState(fixture.notes ?? "");
  const [checklist, setChecklist] = useState<BuilderEvalChecklistItem[]>(savedChecklist);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [updateFixture, { isLoading: isSaving }] = useUpdateBuilderEvalFixtureMutation();
  const [deleteFixture, { isLoading: isDeleting }] = useDeleteBuilderEvalFixtureMutation();

  const isInterview = fixture.kind === "interview";
  const context = interviewContextOf(fixture);
  const expectation = expectationOf(fixture);

  const trimmedName = name.trim();
  const isDirty =
    trimmedName !== fixture.name ||
    notes !== (fixture.notes ?? "") ||
    (isInterview && !checklistsEqual(cleanChecklist(checklist), savedChecklist));
  const canSave = isDirty && trimmedName.length > 0 && !isSaving;

  const handleSave = async () => {
    try {
      await updateFixture({
        id: fixture.id,
        name: trimmedName,
        notes,
        ...(isInterview ? { checklist: cleanChecklist(checklist) } : {}),
      }).unwrap();
      // Show what was stored: blanks are dropped on save, so the draft follows.
      if (isInterview) setChecklist(cleanChecklist(checklist));
      toast.success(strings.saved);
    } catch (error) {
      toast.error(getErrorMessage(error, strings.saveFailed));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFixture(fixture.id).unwrap();
      toast.success(strings.deleted);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.deleteFailed));
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag type={isInterview ? "blue" : "purple"} size="sm" className="shrink-0">
          {en.builder.eval.kind[fixture.kind] ?? fixture.kind}
        </Tag>
        {fixture.sourceSessionId && (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-typography-600">
            <span className="truncate">
              {strings.sourceSession(fixture.sourceSessionId.slice(0, 8))}
            </span>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => navigate(ROUTES.BUILDER_SESSION(fixture.sourceSessionId as string))}
            >
              {strings.openSession}
            </Button>
          </span>
        )}
      </div>

      <TextInput
        id="builder-eval-fixture-name"
        labelText={strings.nameLabel}
        maxLength={MAX_FIXTURE_NAME}
        value={name}
        onChange={event => setName(event.target.value)}
      />

      <TextArea
        id="builder-eval-fixture-notes"
        labelText={strings.notesLabel}
        helperText={strings.notesHelper}
        rows={3}
        maxCount={MAX_FIXTURE_NOTES}
        enableCounter
        value={notes}
        onChange={event => setNotes(event.target.value)}
      />

      {isInterview && context && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-typography-900">{strings.recordedHeading}</h3>
          <p className="text-xs text-typography-600">{strings.recordedHint}</p>
          <p className="whitespace-pre-wrap border-l-2 border-neutral-200 pl-3 text-sm text-typography-800">
            {context.openingMessage || strings.noOpeningMessage}
          </p>
          <details className="text-sm text-typography-700">
            <summary className="cursor-pointer text-xs text-typography-600">
              {strings.scriptSummary(context.adminScript.length)}
            </summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
              {context.adminScript.map((line, index) => (
                <li key={index} className="whitespace-pre-wrap">
                  {line}
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}

      {isInterview && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-typography-900">{strings.outcomeHeading}</h3>
          <p className="text-sm text-typography-700">
            {expectsNothingToBuild(fixture) ? strings.outcomeNothingToBuild : strings.outcomePrd}
          </p>
          <p className="text-xs text-typography-600">{strings.outcomeReadOnly}</p>
        </section>
      )}

      {isInterview ? (
        <ChecklistEditor items={checklist} onChange={setChecklist} disabled={isSaving} />
      ) : (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-typography-900">{strings.expectHeading}</h3>
          <p className="text-sm text-typography-700">
            {expectation === null
              ? strings.expectUnknown
              : expectation.blocking
                ? strings.expectBlocking(expectation.via)
                : strings.expectClean}
          </p>
          <p className="text-xs text-typography-600">{strings.expectReadOnly}</p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-4">
        <Button kind="primary" size="md" disabled={!canSave} onClick={() => void handleSave()}>
          {isSaving ? strings.saving : strings.save}
        </Button>
        <Button kind="tertiary" size="md" onClick={onClose}>
          {strings.close}
        </Button>
        <span className="flex-1" />
        {!confirmingDelete && (
          <Button kind="danger--tertiary" size="md" onClick={() => setConfirmingDelete(true)}>
            {strings.delete}
          </Button>
        )}
      </div>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-label={strings.deleteConfirmTitle}
          className="flex flex-col gap-2 border border-neutral-300 p-3"
        >
          <p className="text-sm font-medium text-typography-900">{strings.deleteConfirmTitle}</p>
          <p className="text-xs text-typography-600">{strings.deleteConfirmBody}</p>
          <div className="flex gap-2">
            <Button
              kind="danger"
              size="sm"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {strings.deleteConfirm}
            </Button>
            <Button kind="tertiary" size="sm" onClick={() => setConfirmingDelete(false)}>
              {strings.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

interface FixtureSidePanelProps {
  fixture: BuilderEvalFixture | null;
  onClose: () => void;
}

/**
 * Edit one fixture: its name and notes, and (for an interview) the checklist
 * that says what a correct PRD contains. Saved explicitly, not on every
 * keystroke: a checklist is read by the judge on the next suite, and a
 * half-written item scored as written is noise in a result someone will compare.
 */
export const FixtureSidePanel: React.FC<FixtureSidePanelProps> = ({ fixture, onClose }) => {
  const strings = en.builder.eval.fixturePanel;
  return (
    <SidePanel
      open={Boolean(fixture)}
      onClose={onClose}
      title={fixture ? fixture.name : strings.title}
      className="w-[50vw] min-w-[560px]"
      closeLabel={strings.close}
    >
      {fixture && <FixtureForm key={fixture.id} fixture={fixture} onClose={onClose} />}
    </SidePanel>
  );
};
