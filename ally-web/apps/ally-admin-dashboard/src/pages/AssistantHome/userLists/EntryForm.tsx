import React, { useId, useMemo, useState } from "react";

import {
  listRefusalOf,
  useCreateListEntryMutation,
  useLazyGetListEntriesQuery,
  useLazyGetListEntryQuery,
  useLazySearchListContactsQuery,
  useUpdateListEntryMutation,
} from "@api";
import { Button, Chip, Combobox, DatePicker, Select, Switch, TimePicker } from "@components/v2";
import type { SelectOption } from "@components/v2";
import type { Chatbot, ListEntry, ListField, ListRefusal, UserList } from "@types";

import { HOME, fill } from "../copy";
import {
  formatDate,
  formatDateTime,
  human,
  isoOf,
  joinOr,
  liveFields,
  lower,
  nextValues,
  noYear,
  showValue,
  titleOf,
  todayIn,
  wallOf,
} from "./format";
import { Sheet } from "../ui/Sheet";

const t = () => HOME.userLists;

type Values = Record<string, unknown>;

const initialValues = (list: UserList, entry: ListEntry | null): Values => {
  const out: Values = {};
  for (const field of liveFields(list)) {
    out[field.key] = entry ? (entry.data[field.key] ?? null) : (field.default ?? null);
  }
  return out;
};

/** What changed since the form opened: an edit sends only these, with the version it read. */
const changes = (before: Values, after: Values): Values =>
  Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key]),
    ),
  );

/**
 * Add or edit an entry (chunk 5b): one input per kind of detail; needed ones are marked. Every
 * save sends the version it read. A refusal shows next to its detail, or above the form; when
 * someone else changed the entry, Reload brings in their version.
 */
export const EntryForm: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  entry: ListEntry | null;
  canEdit: boolean;
  side: "right" | "bottom";
  onClose: () => void;
  onDelete?: () => void;
}> = ({ bot, list, lists, entry: opened, canEdit, side, onClose, onDelete }) => {
  const [entry, setEntry] = useState(opened);
  const [start, setStart] = useState(() => initialValues(list, opened));
  const [values, setValues] = useState(start);
  const [refusal, setRefusal] = useState<ListRefusal | null>(null);
  // Titles of linked entries chosen here (from the picker or a "Free nearby" chip).
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [create, created] = useCreateListEntryMutation();
  const [update, updated] = useUpdateListEntryMutation();
  const [reload, reloading] = useLazyGetListEntryQuery();
  const saving = created.isLoading || updated.isLoading;
  const fields = liveFields(list);
  const title = entry ? t().form.editTitle : fill(t().form.addTitle, { list: list.name });

  const set = (key: string, value: unknown, label?: string) => {
    setValues(v => ({ ...v, [key]: value }));
    if (label) setLabels(l => ({ ...l, [key]: label }));
    setSaved(false);
    if (refusal?.field === key) setRefusal(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setFailed(false);
    try {
      if (entry) {
        const data = changes(start, values);
        const { record } = await update({
          id: bot.id,
          key: list.key,
          recordId: entry.id,
          version: entry.version,
          data,
        }).unwrap();
        setEntry(record);
        const next = initialValues(list, record);
        setStart(next);
        setValues(next);
        setSaved(true);
      } else {
        const data = Object.fromEntries(
          Object.entries(values).filter(([, v]) => v !== null && v !== ""),
        );
        await create({ id: bot.id, key: list.key, data }).unwrap();
        onClose();
      }
    } catch (error) {
      const found = listRefusalOf(error);
      if (found) setRefusal(found);
      else setFailed(true);
    }
  };

  const doReload = async () => {
    if (!entry) return;
    const fresh = await reload({ id: bot.id, key: list.key, recordId: entry.id }).unwrap();
    setEntry(fresh);
    const next = initialValues(list, fresh);
    setStart(next);
    setValues(next);
    setRefusal(null);
  };

  const fieldRefusal = refusal?.field && fields.some(f => f.key === refusal.field) ? refusal : null;
  const formRefusal = refusal && !fieldRefusal ? refusal : null;

  return (
    <Sheet label={title} side={side} onClose={onClose} testId="entry-form">
      <form className="ally-lists__sheet ally-lists__form" onSubmit={save} noValidate>
        <div className="ally-home__panel-head">
          <h2 className="ally-heading ally-home__panel-title">{title}</h2>
          <Button onClick={onClose}>{t().form.close}</Button>
        </div>

        {entry && <CreatedBy list={list} entry={entry} />}

        {formRefusal && (
          <div className="ally-lists__refusal" role="alert">
            <p>{formRefusal.message}</p>
            {formRefusal.code === "version_conflict" && (
              <Button onClick={() => void doReload()} disabled={reloading.isFetching}>
                {t().form.reload}
              </Button>
            )}
          </div>
        )}

        {fields.map(field => (
          <FieldInput
            key={field.key}
            bot={bot}
            list={list}
            lists={lists}
            field={field}
            entry={entry}
            value={values[field.key]}
            current={start[field.key]}
            disabled={
              !canEdit || saving || (Boolean(entry) && field.key === list.settings.person_field)
            }
            refusal={fieldRefusal?.field === field.key ? fieldRefusal : null}
            knownLabel={labels[field.key]}
            onChange={(value, label) => set(field.key, value, label)}
          />
        ))}

        {failed && (
          <p className="ally-error" role="alert">
            {t().form.failed}
          </p>
        )}

        {canEdit && (
          <div className="ally-lists__form-actions">
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? t().form.saving : entry ? t().form.save : t().form.add}
            </Button>
            <Button onClick={onClose}>{t().form.cancel}</Button>
            <span className="ally-small" aria-live="polite">
              {saved ? t().form.saved : ""}
            </span>
            {onDelete && (
              <Button
                variant="ghost"
                className="ally-btn--danger ally-lists__form-delete"
                onClick={onDelete}
              >
                {t().remove.confirm}
              </Button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
};

/** Who added it: you, a teammate, the assistant (with its conversation) or a file. */
const CreatedBy: React.FC<{ list: UserList; entry: ListEntry }> = ({ list, entry }) => {
  const by = entry.created_by;
  if (!by) return null;
  const date = formatDateTime(entry.created_at, list.time_zone);
  const text =
    by.kind === "agent"
      ? fill(t().form.addedByAssistant, { date })
      : by.kind === "import"
        ? fill(t().form.addedByImport, { date })
        : by.you || !by.name
          ? fill(t().form.addedByYou, { date })
          : fill(t().form.addedBy, { name: by.name, date });
  return (
    <p className={`ally-lists__created${by.kind === "agent" ? " is-assistant" : ""}`}>
      <span>{text}</span>
      {by.kind === "agent" && by.conversation_id && (
        <a href={`?section=conversations&conversation=${encodeURIComponent(by.conversation_id)}`}>
          {t().form.openConversation}
        </a>
      )}
    </p>
  );
};

/** One detail's input, by kind. Repeat weekly's "For each one" uses it too. */
export const FieldInput: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  field: ListField;
  entry: ListEntry | null;
  value: unknown;
  current: unknown;
  disabled: boolean;
  refusal: ListRefusal | null;
  /** A linked entry's title, when it was chosen here. */
  knownLabel?: string;
  onChange: (value: unknown, label?: string) => void;
}> = ({
  bot,
  list,
  lists,
  field,
  entry,
  value,
  current,
  disabled,
  refusal,
  knownLabel,
  onChange,
}) => {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const label = field.required ? (
    <>
      {field.label} <span className="ally-lists__needed">{t().form.needed}</span>
    </>
  ) : (
    field.label
  );
  const plainLabel = field.required ? `${field.label} (${t().form.needed})` : field.label;
  const invalid = Boolean(refusal);
  const describedBy = [invalid && errorId].filter(Boolean).join(" ") || undefined;
  let control: React.ReactNode;
  let hint: string | null = field.privacy.never_store ? t().form.hiddenFromAssistant : null;

  switch (field.type) {
    case "long_text":
      control = (
        <textarea
          id={id}
          className="ally-input"
          rows={3}
          value={String(value ?? "")}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={e => onChange(e.target.value)}
        />
      );
      break;
    case "number":
    case "money":
    case "duration":
      control = (
        <input
          id={id}
          className="ally-input"
          inputMode="numeric"
          value={value === null || value === undefined ? "" : String(value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={e => {
            const raw = e.target.value.replace(/[,\s₹]/g, "");
            onChange(raw === "" ? null : Number.isNaN(Number(raw)) ? raw : Number(raw));
          }}
        />
      );
      break;
    case "select": {
      const allowed = nextValues(list, field.key, (current as string | null) ?? null);
      const values = allowed ?? field.options.values ?? [];
      if (allowed && current) {
        const next = allowed.filter(v => v !== current);
        hint = next.length
          ? fill(t().form.canMoveTo, {
              status: human(String(current)),
              next: joinOr(next.map(v => lower(human(v)))),
            })
          : fill(t().form.endsHere, { status: human(String(current)) });
      }
      control = (
        <Select
          label={plainLabel}
          showLabel={false}
          value={String(value ?? "")}
          placeholder={t().form.choose}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
          options={[
            ...(field.required ? [] : [{ value: "", label: t().table.notSet }]),
            ...values.map(v => ({ value: v, label: human(v) })),
          ]}
          onChange={v => onChange(v || null)}
        />
      );
      break;
    }
    case "boolean":
      return (
        <div className="ally-field">
          <Switch
            label={field.label}
            checked={Boolean(value)}
            disabled={disabled}
            onChange={onChange}
          />
          <FieldError id={errorId} refusal={refusal} />
        </div>
      );
    case "date":
      control = (
        <DatePicker
          label={plainLabel}
          value={String(value ?? "")}
          onChange={onChange}
          labels={t().picker}
          format={formatDate}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
          today={todayIn(list.time_zone)}
        />
      );
      break;
    case "datetime": {
      const [day, time] =
        typeof value === "string" && value ? wallOf(value, list.time_zone) : ["", ""];
      const put = (d: string, h: string) => onChange(d && h ? isoOf(d, h, list.time_zone) : null);
      return (
        <fieldset className="ally-field ally-lists__datetime">
          <legend className="ally-field__label">{label}</legend>
          <div className="ally-lists__datetime-row">
            <DatePicker
              label={t().picker.date}
              value={day}
              onChange={d => put(d, time || "10:00")}
              labels={t().picker}
              format={formatDate}
              disabled={disabled}
              invalid={invalid}
              describedBy={describedBy}
              today={todayIn(list.time_zone)}
            />
            <TimePicker
              label={t().picker.time}
              value={time}
              onChange={h => put(day || todayIn(list.time_zone), h)}
              disabled={disabled}
              invalid={invalid}
            />
          </div>
          <FieldError id={errorId} refusal={refusal} />
        </fieldset>
      );
    }
    case "relation":
      return (
        <div className="ally-field">
          <LinkedPicker
            bot={bot}
            list={list}
            lists={lists}
            field={field}
            entry={entry}
            value={value}
            label={plainLabel}
            labelNode={label}
            disabled={disabled}
            invalid={invalid}
            describedBy={describedBy}
            knownLabel={knownLabel}
            onChange={onChange}
          />
          <FieldError
            id={errorId}
            refusal={refusal}
            onPick={alt => onChange(alt.id, noYear(alt.title))}
          />
        </div>
      );
    default:
      control = (
        <input
          id={id}
          className="ally-input"
          type={
            field.type === "email"
              ? "email"
              : field.type === "url"
                ? "url"
                : field.type === "phone"
                  ? "tel"
                  : "text"
          }
          value={String(value ?? "")}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={e => onChange(e.target.value)}
        />
      );
  }

  const labelled = field.type === "select" || field.type === "date";
  return (
    <div className="ally-field">
      {labelled ? (
        <span className="ally-field__label" aria-hidden="true">
          {label}
        </span>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      {control}
      {hint && (
        <span id={hintId} className="ally-field__hint">
          {hint}
        </span>
      )}
      <FieldError id={errorId} refusal={refusal} />
    </div>
  );
};

/**
 * A refusal under its detail. Its alternatives (a taken slot's free neighbours) are chips under
 * "Free nearby:"; tapping one fills the detail.
 */
const FieldError: React.FC<{
  id: string;
  refusal: ListRefusal | null;
  onPick?: (alternative: { id: string; title: string }) => void;
}> = ({ id, refusal, onPick }) =>
  refusal ? (
    <div id={id} className="ally-lists__field-error" role="alert">
      <p className="ally-error">{refusal.message}</p>
      {!!refusal.conflict?.alternatives?.length && onPick && (
        <div className="ally-lists__nearby">
          <span className="ally-small">{t().form.freeNearby}</span>
          <div className="ally-chips">
            {refusal.conflict.alternatives.map(a => (
              <Chip key={a.id} outline onToggle={() => onPick(a)}>
                <span aria-hidden="true">{noYear(a.title)}</span>
                <span className="sr-only">
                  {fill(t().form.useThis, { title: noYear(a.title) })}
                </span>
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null;

/**
 * A detail linked to another list, or to a person: a combobox that searches the target. Options
 * read as the entry's title and its first text detail ("Thu 19 Nov, 11:00 · Dr Mehta").
 */
const LinkedPicker: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  field: ListField;
  entry: ListEntry | null;
  value: unknown;
  label: string;
  labelNode: React.ReactNode;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  knownLabel?: string;
  onChange: (value: unknown, label?: string) => void;
}> = ({
  bot,
  list,
  lists,
  field,
  entry,
  value,
  label,
  labelNode,
  disabled,
  invalid,
  describedBy,
  knownLabel,
  onChange,
}) => {
  const to = field.options.to;
  const target = lists.find(l => l.key === to);
  const toPerson = to === "contact";
  const [findEntries, entries] = useLazyGetListEntriesQuery();
  const [findPeople, people] = useLazySearchListContactsQuery();
  const [picked, setPicked] = useState<SelectOption | null>(null);

  const options = useMemo<SelectOption[]>(() => {
    if (toPerson) {
      return (people.data?.contacts ?? []).map(c => ({ value: c.id, label: c.name, hint: c.hint }));
    }
    if (!target) return [];
    const extra = liveFields(target).find(
      f => f.type === "text" && f.key !== target.settings.title_field,
    );
    return (entries.data?.records ?? []).map(r => {
      const second = extra ? showValue(target, extra, r) : "";
      return {
        value: r.id,
        label: second ? `${titleOf(target, r)} · ${second}` : titleOf(target, r),
      };
    });
  }, [toPerson, people.data, entries.data, target]);

  const shown: SelectOption | null =
    picked && picked.value === value
      ? picked
      : value && knownLabel
        ? { value: String(value), label: knownLabel }
        : value && entry
          ? { value: String(value), label: showValue(list, field, entry) || String(value) }
          : null;

  return (
    <Combobox
      label={label}
      labelNode={labelNode}
      value={shown}
      options={options}
      loading={entries.isFetching || people.isFetching}
      disabled={disabled}
      invalid={invalid}
      describedBy={describedBy}
      placeholder={
        toPerson
          ? t().form.choosePerson
          : fill(t().form.chooseFrom, { list: target?.name ?? field.label })
      }
      emptyText={t().form.noMatches}
      onSearch={query => {
        if (toPerson) void findPeople({ id: bot.id, search: query });
        else if (target)
          void findEntries({
            id: bot.id,
            key: target.key,
            query: { ...(query ? { search: query } : {}), limit: 20 },
          });
      }}
      onChange={option => {
        setPicked(option);
        onChange(option?.value ?? null, option?.label);
      }}
    />
  );
};
