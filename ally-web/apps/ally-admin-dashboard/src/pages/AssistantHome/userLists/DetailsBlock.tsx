import React, { useEffect, useRef, useState } from "react";

import {
  listRefusalOf,
  useAddListFieldMutation,
  useArchiveListFieldMutation,
  useUpdateListFieldMutation,
  useUpdateUserListMutation,
} from "@api";
import { Button, Select, Switch } from "@components/v2";
import type { ListField, ListFieldType, UserList } from "@types";

import { HOME, fill } from "../copy";
import { human, liveFields, lower } from "./format";

const t = () => HOME.userLists;

const KINDS: ListFieldType[] = [
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "datetime",
  "duration",
  "select",
  "boolean",
  "phone",
  "email",
  "url",
  "relation",
];

/** A detail's kind as owners read it: "Choice", "Linked to Slots", "Linked to a person". */
export const kindOf = (field: ListField, lists: UserList[]): string => {
  const d = t().details;
  if (field.type === "relation") {
    if (field.options.to === "contact") return d.linkedToPerson;
    const target = lists.find(l => l.key === field.options.to);
    return fill(d.linkedTo, { list: target?.name ?? field.options.to ?? "" });
  }
  return d.kinds[field.type];
};

/** A detail's key from its name, by 5a's slug rule (lower case, `_`, 40 at most). */
export const keyFor = (name: string, taken: string[]): string => {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "detail";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
};

/**
 * A list's details (chunk 5b): add, rename, move up and down, change the kind, choices, needed,
 * what it starts as, privacy in plain words, and remove. Whose entry is this? is chosen once. A
 * refused change shows the engine's reason under the detail.
 */
export const DetailsBlock: React.FC<{
  botId: string;
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
  focus?: string | null;
}> = ({ botId, list, lists, canEdit, focus }) => {
  const fields = liveFields(list);
  const [editing, setEditing] = useState<string | null>(focus ?? null);
  const [update] = useUpdateListFieldMutation();
  const [moveError, setMoveError] = useState<string | null>(null);

  const move = async (field: ListField, step: -1 | 1) => {
    const other = fields[fields.indexOf(field) + step];
    if (!other) return;
    setMoveError(null);
    try {
      await update({
        id: botId,
        key: list.key,
        field: field.key,
        change: { position: other.position },
      }).unwrap();
    } catch (error) {
      setMoveError(listRefusalOf(error)?.message ?? t().form.failed);
    }
  };

  return (
    <div className="ally-details" data-testid="details-block">
      <WhoseEntry botId={botId} list={list} canEdit={canEdit} />
      <ul className="ally-details__list">
        {fields.map((field, index) =>
          editing === field.key ? (
            <li key={field.key} className="ally-details__item is-editing">
              <DetailEditor
                botId={botId}
                list={list}
                lists={lists}
                field={field}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={field.key} className="ally-details__item">
              <div className="ally-details__main">
                <span className="ally-details__name">
                  {field.label}
                  {field.required && <span className="ally-lists__needed">{t().form.needed}</span>}
                </span>
                <span className="ally-details__kind">
                  {kindOf(field, lists)}
                  {field.type === "select" && field.options.values?.length
                    ? `: ${field.options.values.map(human).join(", ")}`
                    : ""}
                </span>
                <PrivacyLine field={field} />
              </div>
              {canEdit && (
                <div className="ally-details__actions">
                  <button
                    type="button"
                    className="ally-icon-btn"
                    aria-label={fill(t().details.up, { detail: field.label })}
                    disabled={index === 0}
                    onClick={() => void move(field, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ally-icon-btn"
                    aria-label={fill(t().details.down, { detail: field.label })}
                    disabled={index === fields.length - 1}
                    onClick={() => void move(field, 1)}
                  >
                    ↓
                  </button>
                  <Button
                    variant="ghost"
                    aria-label={fill(t().details.edit, { detail: field.label })}
                    onClick={() => setEditing(field.key)}
                  >
                    {t().table.editShort}
                  </Button>
                </div>
              )}
            </li>
          ),
        )}
        {editing === "" && (
          <li className="ally-details__item is-editing">
            <DetailEditor
              botId={botId}
              list={list}
              lists={lists}
              field={null}
              onDone={() => setEditing(null)}
            />
          </li>
        )}
      </ul>
      {moveError && (
        <p className="ally-error" role="alert">
          {moveError}
        </p>
      )}
      {canEdit && editing === null && (
        <div>
          <Button onClick={() => setEditing("")}>
            <span aria-hidden="true">+ </span>
            {t().details.add}
          </Button>
        </div>
      )}
    </div>
  );
};

/** The privacy switches that are on, as a quiet line. */
const PrivacyLine: React.FC<{ field: ListField }> = ({ field }) => {
  const d = t().details;
  const on = [
    field.privacy.never_store ? d.neverStore : null,
    !field.privacy.never_store && field.agent_read ? d.see : null,
    !field.privacy.never_store && field.agent_write ? d.fill : null,
    field.privacy.masked ? d.masked : null,
  ].filter(Boolean);
  return on.length ? <span className="ally-details__privacy">{on.join(" · ")}</span> : null;
};

interface Draft {
  label: string;
  type: ListFieldType;
  to: string;
  values: string[];
  required: boolean;
  default: unknown;
  agent_read: boolean;
  agent_write: boolean;
  masked: boolean;
  never_store: boolean;
}

const draftOf = (field: ListField | null): Draft => ({
  label: field?.label ?? "",
  type: field?.type ?? "text",
  to: field?.options.to ?? "contact",
  values: field?.options.values ?? [],
  required: field?.required ?? false,
  default: field?.default ?? null,
  agent_read: field?.agent_read ?? true,
  agent_write: field?.agent_write ?? false,
  masked: field?.privacy.masked ?? false,
  never_store: field?.privacy.never_store ?? false,
});

const DetailEditor: React.FC<{
  botId: string;
  list: UserList;
  lists: UserList[];
  field: ListField | null;
  onDone: () => void;
}> = ({ botId, list, lists, field, onDone }) => {
  const d = t().details;
  const [draft, setDraft] = useState(() => draftOf(field));
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [add, adding] = useAddListFieldMutation();
  const [update, updating] = useUpdateListFieldMutation();
  const [archive, archiving] = useArchiveListFieldMutation();
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => name.current?.focus(), []);
  const busy = adding.isLoading || updating.isLoading || archiving.isLoading;
  const set = (patch: Partial<Draft>) => setDraft(x => ({ ...x, ...patch }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.label.trim()) return;
    setError(null);
    const body = {
      label: draft.label.trim(),
      type: draft.type,
      options:
        draft.type === "select"
          ? { values: draft.values }
          : draft.type === "relation"
            ? { to: draft.to }
            : {},
      required: draft.required,
      default: draft.default === "" ? null : draft.default,
      agent_read: draft.never_store ? false : draft.agent_read,
      agent_write: draft.never_store ? false : draft.agent_write,
      privacy: { masked: draft.masked, never_store: draft.never_store },
    };
    try {
      if (field) {
        await update({ id: botId, key: list.key, field: field.key, change: body }).unwrap();
      } else {
        const key = keyFor(
          draft.label,
          list.fields.map(f => f.key),
        );
        await add({ id: botId, key: list.key, field: { key, ...body } }).unwrap();
      }
      onDone();
    } catch (failure) {
      setError(listRefusalOf(failure)?.message ?? t().form.failed);
    }
  };

  const remove = async () => {
    if (!field) return;
    setError(null);
    try {
      await archive({ id: botId, key: list.key, field: field.key }).unwrap();
      onDone();
    } catch (failure) {
      setError(listRefusalOf(failure)?.message ?? t().form.failed);
    }
  };

  const kinds = [
    ...KINDS.filter(k => k !== "relation").map(k => ({ value: k, label: d.kinds[k] })),
    { value: "relation:contact", label: d.kinds.contact },
    { value: "relation", label: d.kinds.relation },
  ];
  const kindValue =
    draft.type === "relation"
      ? draft.to === "contact"
        ? "relation:contact"
        : "relation"
      : draft.type;
  const others = lists.filter(l => l.key !== list.key);

  return (
    <form className="ally-details__editor" onSubmit={save}>
      <div className="ally-field">
        <label htmlFor={`detail-name-${field?.key ?? "new"}`}>{d.name}</label>
        <input
          ref={name}
          id={`detail-name-${field?.key ?? "new"}`}
          className="ally-input"
          value={draft.label}
          maxLength={60}
          onChange={e => set({ label: e.target.value })}
        />
      </div>
      <div className="ally-details__pair">
        <Select
          label={d.kind}
          value={kindValue}
          options={kinds}
          onChange={value =>
            value === "relation:contact"
              ? set({ type: "relation", to: "contact" })
              : value === "relation"
                ? set({ type: "relation", to: others[0]?.key ?? "" })
                : set({ type: value as ListFieldType })
          }
        />
        {draft.type === "relation" && draft.to !== "contact" && (
          <Select
            label={d.whichList}
            value={draft.to}
            options={others.map(l => ({ value: l.key, label: l.name }))}
            onChange={to => set({ to })}
          />
        )}
      </div>

      {draft.type === "select" && (
        <fieldset className="ally-field">
          <legend className="ally-field__label">{d.choices}</legend>
          <div className="ally-chips">
            {draft.values.map(value => (
              <span key={value} className="ally-choice">
                {human(value)}
                <button
                  type="button"
                  aria-label={fill(d.removeChoice, { value: human(value) })}
                  onClick={() => set({ values: draft.values.filter(v => v !== value) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="ally-details__add-choice">
            <input
              className="ally-input"
              aria-label={d.addChoice}
              placeholder={d.addChoice}
              value={choice}
              onChange={e => setChoice(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const v = choice.trim();
                  if (v && !draft.values.includes(v)) set({ values: [...draft.values, v] });
                  setChoice("");
                }
              }}
            />
            <Button
              onClick={() => {
                const v = choice.trim();
                if (v && !draft.values.includes(v)) set({ values: [...draft.values, v] });
                setChoice("");
              }}
            >
              {t().setup.addChoice}
            </Button>
          </div>
        </fieldset>
      )}

      <Switch label={d.needed} checked={draft.required} onChange={required => set({ required })} />
      {(draft.type === "select" || draft.type === "boolean") && (
        <Select
          label={d.startsAs}
          value={draft.default === null || draft.default === undefined ? "" : String(draft.default)}
          options={[
            { value: "", label: d.nothing },
            ...(draft.type === "boolean"
              ? [
                  { value: "true", label: t().form.yes },
                  { value: "false", label: t().form.no },
                ]
              : draft.values.map(v => ({ value: v, label: human(v) }))),
          ]}
          onChange={value =>
            set({
              default: value === "" ? null : draft.type === "boolean" ? value === "true" : value,
            })
          }
        />
      )}

      <fieldset className="ally-field ally-details__privacy-set">
        <legend className="ally-field__label">{d.privacy}</legend>
        <Switch
          label={d.see}
          checked={draft.agent_read && !draft.never_store}
          disabled={draft.never_store}
          onChange={agent_read => set({ agent_read })}
        />
        <Switch
          label={d.fill}
          checked={draft.agent_write && !draft.never_store}
          disabled={draft.never_store}
          onChange={agent_write => set({ agent_write })}
        />
        <Switch label={d.masked} checked={draft.masked} onChange={masked => set({ masked })} />
        <Switch
          label={d.neverStore}
          checked={draft.never_store}
          onChange={never_store => set({ never_store })}
        />
      </fieldset>

      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <div className="ally-btn-row">
        <Button variant="primary" type="submit" disabled={busy || !draft.label.trim()}>
          {busy ? t().form.saving : d.save}
        </Button>
        <Button onClick={onDone}>{d.cancel}</Button>
        {field && (
          <Button
            variant="ghost"
            className="ally-btn--danger"
            onClick={() => void remove()}
            disabled={busy}
          >
            {fill(d.remove, { detail: lower(field.label) })}
          </Button>
        )}
      </div>
      {field && <p className="ally-field__hint">{d.removeHint}</p>}
    </form>
  );
};

/** Whose entry is this? Chosen once from the details linked to a person; locked once it has entries. */
const WhoseEntry: React.FC<{ botId: string; list: UserList; canEdit: boolean }> = ({
  botId,
  list,
  canEdit,
}) => {
  const d = t().details;
  const [save, { isLoading }] = useUpdateUserListMutation();
  const [error, setError] = useState<string | null>(null);
  const people = liveFields(list).filter(f => f.type === "relation" && f.options.to === "contact");
  const locked = list.record_count > 0;
  if (!people.length && !list.settings.person_field) return null;
  return (
    <div className="ally-details__whose">
      <Select
        label={d.whose}
        value={list.settings.person_field ?? ""}
        disabled={!canEdit || locked || isLoading}
        describedBy={`whose-${list.key}`}
        options={[
          { value: "", label: d.whoseNobody },
          ...people.map(f => ({ value: f.key, label: f.label })),
        ]}
        onChange={async value => {
          setError(null);
          try {
            await save({
              id: botId,
              key: list.key,
              settings: { ...list.settings, person_field: value || undefined },
            }).unwrap();
          } catch (failure) {
            setError(listRefusalOf(failure)?.message ?? t().form.failed);
          }
        }}
      />
      <p id={`whose-${list.key}`} className="ally-field__hint">
        {locked ? d.whoseLocked : d.whoseHint}
      </p>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
