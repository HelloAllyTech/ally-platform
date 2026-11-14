import React, { useState } from "react";

import { useSetListAbilitiesMutation } from "@api";
import { Button, Segmented } from "@components/v2";
import type { ListAbility, UserList } from "@types";

import { HOME, fill } from "../copy";
import { bookedList, fillable, lower, shortTitle } from "./format";

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
        : fill(a.exampleFindPlain, { list: lower(list.name) }),
    create: booked
      ? fill(a.exampleBook, { title })
      : fill(a.exampleAdd, { list: lower(list.name) }),
    update: a.exampleChange,
  };
};

/**
 * What your assistant can do with a list (chunk 5b): Look things up, Add entries and Change
 * entries, each Do it or Never. Add and Change show only when a detail lets the assistant fill it
 * in. Turning on Add or Change the first time shows a short note.
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
  const examples = examplesFor(list, lists, sample);
  const writes = fillable(list).length > 0;
  const a = t().assistant;

  const change = async (action: Action, value: ListAbility) => {
    const before = abilities;
    const next = { ...abilities, [action]: value };
    setAbilities(next);
    setFailed(false);
    const firstWrite =
      value === "do_it" &&
      action !== "find" &&
      before.create !== "do_it" &&
      before.update !== "do_it";
    try {
      await save({ id: botId, key: list.key, [action]: value }).unwrap();
      if (firstWrite) setNote(true);
    } catch {
      setAbilities(before);
      setFailed(true);
    }
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
                if (!isLoading) void change(action, value as ListAbility);
              }}
            />
          ) : (
            <span className={`ally-abilities__value is-${abilities[action]}`}>
              {abilities[action] === "do_it" ? a.doIt : a.never}
            </span>
          )}
        </div>
      ))}
      {!writes && <p className="ally-field__hint">{a.noFill}</p>}
      {failed && (
        <p className="ally-error" role="alert">
          {t().form.failed}
        </p>
      )}
      {note && (
        <div className="ally-lists__notice ally-abilities__note" role="status">
          <p>{a.firstNote}</p>
          <Button onClick={() => setNote(false)}>{a.gotIt}</Button>
        </div>
      )}
    </div>
  );
};
