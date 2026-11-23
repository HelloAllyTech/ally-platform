import React, { useId, useRef, useState } from "react";

import { useSetListAbilitiesMutation } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { Segmented } from "@components/v2";
import type { ListAbility, UserList } from "@types";

import { HOME, fill } from "../copy";
import { bookedList, fillable, shortTitle } from "./format";

const t = () => HOME.userLists;

type Action = "find" | "create" | "update";

/** "Look things up in it: Do it" and so on, shown on the closed block. */
export const assistantSummary = (list: UserList): string => {
  const a = t().assistant;
  const on = (ability: ListAbility) => (ability === "do_it" ? a.doIt : a.never);
  const parts = [`${a.find}: ${on(list.abilities.find)}`];
  if (fillable(list).length) {
    parts.push(
      `${a.add}: ${on(list.abilities.create)}`,
      `${a.change}: ${on(list.abilities.update)}`,
    );
  }
  return parts.join(" · ");
};

/** What the assistant might say for each action, from this list (chunk 5b). */
export const examplesFor = (
  list: UserList,
  lists: UserList[],
  sample?: string,
): Record<Action, string> => {
  const a = t().assistant;
  const booked = bookedList(list, lists);
  const title = sample ? shortTitle(list, sample) : "Thu 19 Nov, 11:00";
  return {
    find:
      list.settings.title_field && /starts|at$|date|time/.test(list.settings.title_field)
        ? fill(a.exampleFind, { title })
        : fill(a.exampleFindPlain, { list: list.name }),
    create: booked ? fill(a.exampleBook, { title }) : fill(a.exampleAdd, { list: list.name }),
    update: a.exampleChange,
  };
};

/**
 * What your assistant can do with a list (chunk 5b): Look things up, Add entries and Change
 * entries, each Do it or Never. Add and Change show only when a detail lets the assistant fill it
 * in; a list another list books says where booking happens instead (8a). Turning on Add or
 * Change the first time shows a short note.
 */
export const AssistantBlock: React.FC<{
  botId: string;
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
  /** The guided setup shows the same rows; it asks for the note as well. */
  sample?: string;
}> = ({ botId, list, lists, canEdit, sample }) => {
  const [save, { isLoading }] = useSetListAbilitiesMutation();
  const [abilities, setAbilities] = useState(list.abilities);
  const [note, setNote] = useState(false);
  const [failed, setFailed] = useState(false);
  const [instruction, setInstruction] = useState(list.settings.instruction ?? "");
  const [savedLine, setSavedLine] = useState(list.settings.instruction ?? "");
  const instructionId = useId();
  const examples = examplesFor(list, lists, sample);
  const writes = fillable(list).length > 0;
  // The list that books this one: it has a live detail that points here (Reservations → Tables).
  const booker = lists.find(
    other =>
      other.key !== list.key &&
      !other.deleted_at &&
      other.fields.some(f => !f.archived_at && f.type === "relation" && f.options.to === list.key),
  );
  const a = t().assistant;

  // Q4 B11: changes made while one is saving are queued, never dropped (the wizard's "Change
  // entries: Do it" clicked right after "Add entries" was lost).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const change = (action: Action, value: ListAbility) => {
    const before = abilities;
    setAbilities(current => ({ ...current, [action]: value }));
    setFailed(false);
    const firstWrite =
      value === "do_it" &&
      action !== "find" &&
      before.create !== "do_it" &&
      before.update !== "do_it";
    queue.current = queue.current.then(async () => {
      try {
        await save({ id: botId, key: list.key, [action]: value }).unwrap();
        if (firstWrite) setNote(true);
      } catch {
        setAbilities(current => ({ ...current, [action]: before[action] }));
        setFailed(true);
      }
    });
    return queue.current;
  };

  const rows: { action: Action; label: string }[] = [
    { action: "find", label: a.find },
    ...(writes
      ? [
          { action: "create" as const, label: a.add },
          { action: "update" as const, label: a.change },
        ]
      : []),
  ];

  return (
    <div className="ally-abilities" data-testid="list-abilities">
      {rows.map(({ action, label }) => (
        <div key={action} className="ally-abilities__row">
          <div className="ally-abilities__text">
            <span className="ally-abilities__label">{label}</span>
            <span className="ally-abilities__example">
              <span className="ally-abilities__might">{a.mightSay}</span> {examples[action]}
            </span>
          </div>
          {canEdit ? (
            <Segmented
              label={label}
              value={abilities[action]}
              options={[
                { id: "do_it", label: a.doIt },
                { id: "never", label: a.never },
              ]}
              onChange={value => {
                void change(action, value as ListAbility);
              }}
            />
          ) : (
            <span className={`ally-abilities__value is-${abilities[action]}`}>
              {abilities[action] === "do_it" ? a.doIt : a.never}
            </span>
          )}
        </div>
      ))}
      {!writes && (
        <p className="ally-field__hint" data-testid="list-booked-through">
          {booker
            ? fill(booker.abilities.create === "do_it" ? a.bookedThrough : a.bookThroughOff, {
                list: booker.name,
              })
            : a.noFill}
        </p>
      )}
      {canEdit ? (
        <form
          className="ally-abilities__instruction"
          data-testid="list-instruction"
          onSubmit={async event => {
            event.preventDefault();
            setFailed(false);
            try {
              await save({ id: botId, key: list.key, instruction: instruction.trim() }).unwrap();
              setSavedLine(instruction.trim());
            } catch {
              setFailed(true);
            }
          }}
        >
          <label htmlFor={instructionId} className="ally-abilities__label">
            {a.instructionLabel}
          </label>
          <p className="ally-field__hint">{a.instructionHint}</p>
          <textarea
            id={instructionId}
            className="ally-input"
            rows={2}
            value={instruction}
            aria-describedby={`${instructionId}-count`}
            aria-invalid={instruction.trim().length > 300}
            onChange={event => setInstruction(event.target.value)}
          />
          <p
            id={`${instructionId}-count`}
            className={instruction.trim().length > 300 ? "ally-error" : "ally-field__hint"}
            role={instruction.trim().length > 300 ? "alert" : undefined}
            data-testid="list-instruction-count"
          >
            {instruction.trim().length > 300
              ? a.instructionTooLong
              : a.instructionCount(instruction.trim().length)}
          </p>
          <Button
            variant={ButtonVariant.TERTIARY}
            type="submit"
            disabled={
              isLoading || instruction.trim() === savedLine || instruction.trim().length > 300
            }
          >
            {instruction.trim() === savedLine && savedLine ? a.instructionSaved : a.instructionSave}
          </Button>
        </form>
      ) : (
        list.settings.instruction && (
          <p className="ally-field__hint" data-testid="list-instruction">
            {a.instructionLabel} {list.settings.instruction}
          </p>
        )
      )}
      {failed && (
        <p className="ally-error" role="alert">
          {t().form.failed}
        </p>
      )}
      {note && (
        <div className="ally-lists__notice ally-abilities__note" role="status">
          <p>{a.firstNote}</p>
          <Button variant={ButtonVariant.TERTIARY} type="button" onClick={() => setNote(false)}>
            {a.gotIt}
          </Button>
        </div>
      )}
    </div>
  );
};
