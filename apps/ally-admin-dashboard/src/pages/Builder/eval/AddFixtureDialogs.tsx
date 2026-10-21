import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Modal, Select, SelectItem, TextArea, TextInput } from "@ally-ui-mono/ui-shared";
import {
  useCreateBuilderEvalFixtureFromExportMutation,
  useCreateBuilderEvalFixtureFromSessionMutation,
  useGetBuilderSessionsQuery,
  useImportBuilderEvalFixturesMutation,
} from "@api";
import { en } from "@constants";
import type { BuilderEvalFixture } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

import { MAX_FIXTURE_NAME, MAX_FIXTURE_NOTES, parsePastedExport } from "./evalFormat";

/** How many recent sessions the picker offers. */
const SESSION_PICKER_LIMIT = 100;

interface DialogProps {
  onClose: () => void;
  /** A fixture was created: the page opens it so its checklist can be written. */
  onCreated: (fixture: BuilderEvalFixture) => void;
}

/**
 * "From a session": cut a Builder session in this environment into a fixture.
 * The checklist is written afterwards, in the fixture's panel — it needs the
 * recorded interview in front of the person writing it.
 */
export const FromSessionDialog: React.FC<DialogProps> = ({ onClose, onCreated }) => {
  const strings = en.builder.eval.fromSession;
  const { data, isLoading, isError } = useGetBuilderSessionsQuery();
  const [createFromSession, { isLoading: isSaving }] =
    useCreateBuilderEvalFixtureFromSessionMutation();

  const sessions = useMemo(
    () =>
      [...(Array.isArray(data) ? data : [])]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, SESSION_PICKER_LIMIT),
    [data],
  );

  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [notes, setNotes] = useState("");

  const pick = (id: string) => {
    setSessionId(id);
    // Until the person names it themselves, the session's title is the name.
    if (!nameTouched) {
      const session = sessions.find(candidate => candidate.id === id);
      setName((session?.title ?? "").slice(0, MAX_FIXTURE_NAME));
    }
  };

  const trimmedName = name.trim();
  const canSave = Boolean(sessionId) && trimmedName.length > 0 && !isSaving;

  const submit = async () => {
    try {
      const fixture = await createFromSession({
        sessionId,
        name: trimmedName,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }).unwrap();
      toast.success(strings.created);
      onCreated(fixture);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  return (
    <Modal
      open
      size="md"
      modalHeading={strings.title}
      primaryButtonText={isSaving ? strings.saving : strings.submit}
      secondaryButtonText={en.builder.eval.cancel}
      primaryButtonDisabled={!canSave}
      onRequestSubmit={() => void submit()}
      onRequestClose={onClose}
      onSecondarySubmit={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-typography-700">{strings.intro}</p>

        <Select
          id="builder-eval-from-session"
          labelText={strings.sessionLabel}
          value={sessionId}
          disabled={isLoading}
          invalid={isError}
          invalidText={strings.loadFailed}
          onChange={event => pick(event.target.value)}
        >
          <SelectItem
            value=""
            text={isLoading ? strings.loading : sessions.length ? strings.choose : strings.none}
          />
          {sessions.map(session => (
            <SelectItem
              key={session.id}
              value={session.id}
              text={strings.option(
                session.title,
                en.builder.status[session.status] ?? session.status,
                session.createdAt,
              )}
            />
          ))}
        </Select>

        <TextInput
          id="builder-eval-from-session-name"
          labelText={strings.nameLabel}
          helperText={strings.nameHelper}
          maxLength={MAX_FIXTURE_NAME}
          value={name}
          onChange={event => {
            setNameTouched(true);
            setName(event.target.value);
          }}
        />

        <TextArea
          id="builder-eval-from-session-notes"
          labelText={strings.notesLabel}
          helperText={strings.notesHelper}
          rows={3}
          maxCount={MAX_FIXTURE_NOTES}
          enableCounter
          value={notes}
          onChange={event => setNotes(event.target.value)}
        />

        <p className="text-xs text-typography-600">{en.builder.eval.privacy.short}</p>
      </div>
    </Modal>
  );
};

/**
 * "Paste an export": a fixtures export from another environment (imported,
 * matched by name), or a session copied from another environment's
 * `GET /v1/builder/sessions/:id` (cut into one fixture, which needs a name —
 * this is how a production interview becomes a fixture on a laptop).
 */
export const PasteExportDialog: React.FC<DialogProps> = ({ onClose, onCreated }) => {
  const strings = en.builder.eval.paste;
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  const [importFixtures, { isLoading: isImporting }] = useImportBuilderEvalFixturesMutation();
  const [createFromExport, { isLoading: isCreating }] =
    useCreateBuilderEvalFixtureFromExportMutation();

  const parsed = useMemo(() => parsePastedExport(text), [text]);
  const isBusy = isImporting || isCreating;

  // A session carries its own title; offer it as the name until the person types one.
  const effectiveName = name || (parsed.type === "session" ? parsed.title : "");
  const trimmedName = effectiveName.trim().slice(0, MAX_FIXTURE_NAME);

  const canSubmit =
    !isBusy &&
    (parsed.type === "fixtures" || (parsed.type === "session" && trimmedName.length > 0));

  const invalidText =
    parsed.type === "invalid" && parsed.reason !== "empty" ? strings.invalid[parsed.reason] : "";

  const submit = async () => {
    try {
      if (parsed.type === "fixtures") {
        const result = await importFixtures({ fixtures: parsed.fixtures }).unwrap();
        toast.success(strings.imported(result.created, result.updated));
        onClose();
      } else if (parsed.type === "session") {
        const fixture = await createFromExport({
          name: trimmedName,
          session: parsed.session,
        }).unwrap();
        toast.success(en.builder.eval.fromSession.created);
        onCreated(fixture);
        onClose();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, strings.failed));
    }
  };

  const submitLabel =
    parsed.type === "fixtures"
      ? strings.importCount(parsed.fixtures.length)
      : parsed.type === "session"
        ? strings.saveSession
        : strings.submit;

  return (
    <Modal
      open
      size="md"
      modalHeading={strings.title}
      primaryButtonText={isBusy ? strings.working : submitLabel}
      secondaryButtonText={en.builder.eval.cancel}
      primaryButtonDisabled={!canSubmit}
      onRequestSubmit={() => void submit()}
      onRequestClose={onClose}
      onSecondarySubmit={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-typography-700">{strings.intro}</p>

        <TextArea
          id="builder-eval-paste-json"
          labelText={strings.jsonLabel}
          placeholder={strings.jsonPlaceholder}
          rows={10}
          invalid={Boolean(invalidText)}
          invalidText={invalidText}
          value={text}
          onChange={event => setText(event.target.value)}
        />

        {parsed.type === "fixtures" && (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-typography-800">
              {strings.foundFixtures(parsed.fixtures.length)}
            </p>
            <ul className="list-disc pl-5 text-xs text-typography-600">
              {parsed.fixtures.slice(0, 8).map((fixture, index) => (
                <li key={index} className="truncate">
                  {typeof fixture.name === "string" && fixture.name
                    ? fixture.name
                    : strings.unnamed}
                </li>
              ))}
              {parsed.fixtures.length > 8 && (
                <li className="list-none text-typography-500">
                  {strings.andMore(parsed.fixtures.length - 8)}
                </li>
              )}
            </ul>
            <p className="text-xs text-typography-600">{strings.matchedByName}</p>
          </div>
        )}

        {parsed.type === "session" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-typography-800">{strings.foundSession}</p>
            <TextInput
              id="builder-eval-paste-name"
              labelText={strings.nameLabel}
              helperText={strings.nameHelper}
              maxLength={MAX_FIXTURE_NAME}
              value={effectiveName}
              onChange={event => setName(event.target.value)}
            />
          </div>
        )}

        <p className="text-xs text-typography-600">{en.builder.eval.privacy.short}</p>
      </div>
    </Modal>
  );
};
