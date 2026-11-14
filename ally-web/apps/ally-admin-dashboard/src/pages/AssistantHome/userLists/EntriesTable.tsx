import React, { useContext, useEffect, useMemo, useState } from "react";

import {
  listRefusalOf,
  useDeleteListEntryMutation,
  useGetListEntriesQuery,
  useLazyGetListEntriesQuery,
  useRestoreListEntryMutation,
} from "@api";
import { Button, Select, Skeleton, StatusPill } from "@components/v2";
import type { Chatbot, ListEntry, ListField, ListFilter, ListRefusal, UserList } from "@types";

import { HOME, fill } from "../copy";
import { Sheet } from "../ui/Sheet";
import { HomeSavesContext } from "../useHomeField";
import { EntryForm } from "./EntryForm";
import {
  datedField,
  human,
  liveFields,
  lower,
  showValue,
  statusRule,
  titleOf,
  toneOf,
} from "./format";
import { RepeatWeekly } from "./RepeatWeekly";
import { PHONE, useMedia } from "./useMedia";

const t = () => HOME.userLists;
export const PAGE_SIZE = 50;
const SEARCHABLE = new Set(["text", "long_text", "phone", "email", "url"]);

type Editing = { kind: "add" } | { kind: "edit"; entry: ListEntry } | null;

/**
 * A list's entries (chunk 5b): search over its text details, a filter per choice, a sort on any
 * column, 50 at a time. On a phone each entry is a card (its title, then three details) and the
 * filters open in a sheet. Add and Edit open the entry form; Delete asks once, then can be undone.
 */
export const EntriesTable: React.FC<{
  bot: Chatbot;
  list: UserList;
  lists: UserList[];
  canEdit: boolean;
}> = ({ bot, list, lists, canEdit }) => {
  const phone = useMedia(PHONE);
  const saves = useContext(HomeSavesContext);
  const fields = liveFields(list);
  const choices = fields.filter(f => f.type === "select");
  const searchable = fields.some(f => SEARCHABLE.has(f.type));
  const dated = datedField(list);

  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [more, setMore] = useState<ListEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<ListEntry | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const query = useMemo(
    () => ({
      filters: Object.entries(filters)
        .filter(([, value]) => value)
        .map(([field, value]): ListFilter => ({ field, op: "eq", value })),
      ...(search ? { search } : {}),
      ...(sort ? { sort } : {}),
      limit: PAGE_SIZE,
    }),
    [filters, search, sort],
  );
  const first = useGetListEntriesQuery({ id: bot.id, key: list.key, query });
  const [loadMore, moreState] = useLazyGetListEntriesQuery();

  // A new first page (a change, a filter, a refetch) starts the paging again.
  useEffect(() => {
    setMore([]);
    setCursor(first.data?.next_cursor ?? null);
  }, [first.data]);

  const entries = [...(first.data?.records ?? []), ...more];
  const total = first.data?.total ?? 0;
  const narrowed = Boolean(search) || Object.values(filters).some(Boolean);

  const showMore = async () => {
    if (!cursor) return;
    const page = await loadMore({
      id: bot.id,
      key: list.key,
      query: { ...query, cursor },
    }).unwrap();
    setMore(m => [...m, ...page.records]);
    setCursor(page.next_cursor);
  };

  const clear = () => {
    setTyped("");
    setSearch("");
    setFilters({});
  };

  const toolbar = (
    <div className="ally-lists__toolbar">
      {searchable && (
        <div className="ally-lists__search">
          <label className="sr-only" htmlFor={`search-${list.key}`}>
            {fill(t().table.search, { list: list.name })}
          </label>
          <input
            id={`search-${list.key}`}
            className="ally-input"
            type="search"
            placeholder={fill(t().table.search, { list: lower(list.name) })}
            value={typed}
            onChange={event => setTyped(event.target.value)}
          />
        </div>
      )}
      {choices.length > 0 &&
        (phone ? (
          <Button onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
            {t().table.filters}
            {Object.values(filters).filter(Boolean).length
              ? ` · ${Object.values(filters).filter(Boolean).length}`
              : ""}
          </Button>
        ) : (
          choices.map(field => (
            <FilterSelect
              key={field.key}
              field={field}
              value={filters[field.key] ?? ""}
              onChange={value => setFilters(f => ({ ...f, [field.key]: value }))}
            />
          ))
        ))}
      <div className="ally-lists__toolbar-actions">
        {canEdit && dated && <Button onClick={() => setRepeating(true)}>{t().repeat.open}</Button>}
        {canEdit && (
          <Button variant="primary" onClick={() => setEditing({ kind: "add" })}>
            {t().table.add}
          </Button>
        )}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (first.isLoading) {
    body = <TableSkeleton columns={Math.min(fields.length, 4)} />;
  } else if (first.isError) {
    body = (
      <div className="ally-lists__problem" role="alert">
        <p>{t().table.loadFailed}</p>
        <Button onClick={() => void first.refetch()}>{t().table.retry}</Button>
      </div>
    );
  } else if (!entries.length && narrowed) {
    body = (
      <div className="ally-lists__nothing" role="status">
        <p>{search ? fill(t().table.noMatch, { query: search }) : t().table.noMatchFilters}</p>
        <Button onClick={clear}>{t().table.clear}</Button>
      </div>
    );
  } else if (!entries.length) {
    body = (
      <div className="ally-lists__nothing" data-testid="entries-empty">
        <p className="ally-lists__nothing-title">{t().table.emptyTitle}</p>
        <p className="ally-small">{dated ? t().table.emptyDated : t().table.emptyBody}</p>
        {canEdit && (
          <div className="ally-btn-row">
            <Button variant="primary" onClick={() => setEditing({ kind: "add" })}>
              {t().table.add}
            </Button>
            {dated && <Button onClick={() => setRepeating(true)}>{t().repeat.open}</Button>}
          </div>
        )}
      </div>
    );
  } else if (phone) {
    body = (
      <ul className="ally-lists__cards" aria-label={list.name}>
        {entries.map(entry => (
          <EntryCard
            key={entry.id}
            list={list}
            fields={fields}
            entry={entry}
            onOpen={() => setEditing({ kind: "edit", entry })}
          />
        ))}
      </ul>
    );
  } else {
    body = (
      <div className="ally-lists__table-wrap">
        <table className="ally-lists__table">
          <caption className="sr-only">{list.name}</caption>
          <thead>
            <tr>
              {fields.map(field => {
                const active =
                  sort === field.key
                    ? "ascending"
                    : sort === `-${field.key}`
                      ? "descending"
                      : "none";
                return (
                  <th key={field.key} scope="col" aria-sort={active}>
                    <button
                      type="button"
                      className="ally-lists__sort"
                      aria-label={fill(t().table.sortBy, { detail: lower(field.label) })}
                      onClick={() =>
                        setSort(s =>
                          s === field.key
                            ? `-${field.key}`
                            : s === `-${field.key}`
                              ? undefined
                              : field.key,
                        )
                      }
                    >
                      {field.label}
                      <span aria-hidden="true" className="ally-lists__sort-mark">
                        {active === "ascending" ? "↑" : active === "descending" ? "↓" : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col">
                <span className="sr-only">{t().form.editTitle}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id}>
                {fields.map((field, index) => (
                  <td key={field.key}>
                    <Value list={list} field={field} entry={entry} />
                    {index === 0 && entry.created_by?.kind === "agent" && (
                      <span className="ally-lists__by-assistant">{t().table.byAssistant}</span>
                    )}
                  </td>
                ))}
                <td className="ally-lists__row-actions">
                  <Button
                    variant="ghost"
                    aria-label={fill(t().table.edit, { title: titleOf(list, entry) })}
                    onClick={() => setEditing({ kind: "edit", entry })}
                  >
                    {canEdit ? t().table.editShort : t().table.open}
                  </Button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      className="ally-lists__delete"
                      aria-label={fill(t().table.delete, { title: titleOf(list, entry) })}
                      onClick={() => setRemoving(entry)}
                    >
                      <TrashIcon />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section
      className="ally-card ally-lists__entries"
      aria-label={list.name}
      data-testid="list-entries"
    >
      {toolbar}
      {body}
      {entries.length > 0 && (
        <div className="ally-lists__paging">
          <span className="ally-small">
            {fill(t().table.showing, { shown: entries.length, total })}
          </span>
          {cursor && (
            <Button onClick={() => void showMore()} disabled={moreState.isFetching}>
              {t().table.more}
            </Button>
          )}
        </div>
      )}

      {editing && (
        <EntryForm
          bot={bot}
          list={list}
          lists={lists}
          entry={editing.kind === "edit" ? editing.entry : null}
          canEdit={canEdit}
          side={phone ? "bottom" : "right"}
          onDelete={
            canEdit && editing.kind === "edit"
              ? () => {
                  setRemoving(editing.entry);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      )}

      {removing && (
        <RemoveEntry
          bot={bot}
          list={list}
          entry={removing}
          onClose={() => setRemoving(null)}
          onRemoved={restore => saves.changed(restore, t().remove.done)}
        />
      )}

      {repeating && dated && (
        <Sheet
          label={t().repeat.title}
          side={phone ? "bottom" : "right"}
          onClose={() => setRepeating(false)}
        >
          <div className="ally-lists__sheet">
            <div className="ally-home__panel-head">
              <h2 className="ally-heading ally-home__panel-title">{t().repeat.title}</h2>
              <Button onClick={() => setRepeating(false)}>{t().form.close}</Button>
            </div>
            <RepeatWeekly
              botId={bot.id}
              list={list}
              field={dated}
              onDone={() => setRepeating(false)}
            />
          </div>
        </Sheet>
      )}

      {filtersOpen && (
        <Sheet label={t().table.filters} side="bottom" onClose={() => setFiltersOpen(false)}>
          <div className="ally-lists__sheet">
            <div className="ally-home__panel-head">
              <h2 className="ally-heading ally-home__panel-title">{t().table.filters}</h2>
              <Button onClick={() => setFiltersOpen(false)}>{t().form.close}</Button>
            </div>
            {choices.map(field => (
              <FilterSelect
                key={field.key}
                field={field}
                showLabel
                value={filters[field.key] ?? ""}
                onChange={value => setFilters(f => ({ ...f, [field.key]: value }))}
              />
            ))}
            <Button onClick={() => setFilters({})}>{t().table.clearFilters}</Button>
          </div>
        </Sheet>
      )}
    </section>
  );
};

const FilterSelect: React.FC<{
  field: ListField;
  value: string;
  onChange: (value: string) => void;
  showLabel?: boolean;
}> = ({ field, value, onChange, showLabel = false }) => {
  const any = fill(t().table.any, { detail: lower(field.label) });
  return (
    <Select
      label={field.label}
      showLabel={showLabel}
      compact={!showLabel}
      value={value}
      placeholder={any}
      options={[
        { value: "", label: any },
        ...(field.options.values ?? []).map(v => ({ value: v, label: human(v) })),
      ]}
      onChange={onChange}
    />
  );
};

/** One value: a status as a coloured pill, anything else as text. */
export const Value: React.FC<{ list: UserList; field: ListField; entry: ListEntry }> = ({
  list,
  field,
  entry,
}) => {
  const shown = showValue(list, field, entry);
  if (!shown) return <span className="ally-lists__unset">{t().table.notSet}</span>;
  const rule = statusRule(list);
  if (field.type === "select" && rule?.field === field.key) {
    return (
      <StatusPill label={shown} tone={toneOf(list, field.key, String(entry.data[field.key]))} />
    );
  }
  return (
    <span className={field.type === "long_text" ? "ally-lists__long" : undefined}>{shown}</span>
  );
};

/** An entry on a phone: its title, then the first three details. */
const EntryCard: React.FC<{
  list: UserList;
  fields: ListField[];
  entry: ListEntry;
  onOpen: () => void;
}> = ({ list, fields, entry, onOpen }) => {
  const titleKey = list.settings.title_field;
  const rest = fields.filter(f => f.key !== titleKey).slice(0, 3);
  return (
    <li>
      <button type="button" className="ally-lists__card ally-press" onClick={onOpen}>
        <span className="ally-lists__card-title">{titleOf(list, entry)}</span>
        {entry.created_by?.kind === "agent" && (
          <span className="ally-lists__by-assistant">{t().table.byAssistant}</span>
        )}
        <dl className="ally-lists__card-details">
          {rest.map(field => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                <Value list={list} field={field} entry={entry} />
              </dd>
            </div>
          ))}
        </dl>
      </button>
    </li>
  );
};

/** Delete, asked once. A refusal (entries in another list use it) shows here, with them. */
const RemoveEntry: React.FC<{
  bot: Chatbot;
  list: UserList;
  entry: ListEntry;
  onClose: () => void;
  onRemoved: (restore: () => void) => void;
}> = ({ bot, list, entry, onClose, onRemoved }) => {
  const [remove, { isLoading }] = useDeleteListEntryMutation();
  const [restore] = useRestoreListEntryMutation();
  const [refusal, setRefusal] = useState<ListRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const title = titleOf(list, entry);
  return (
    <Sheet label={t().remove.question} side="center" onClose={onClose}>
      <div className="ally-lists__confirm" data-testid="remove-entry">
        <h2 className="ally-heading">{t().remove.question}</h2>
        {refusal ? (
          <div className="ally-lists__refusal" role="alert">
            <p>{refusal.message}</p>
            {!!refusal.conflict?.records?.length && (
              <ul className="ally-lists__refusal-list">
                {refusal.conflict.records.slice(0, 5).map(r => (
                  <li key={r.id}>{r.title}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="ally-small">{fill(t().remove.body, { title })}</p>
        )}
        {failed && (
          <p className="ally-error" role="alert">
            {t().form.failed}
          </p>
        )}
        <div className="ally-btn-row">
          {!refusal && (
            <Button
              className="ally-btn--danger"
              disabled={isLoading}
              onClick={async () => {
                setFailed(false);
                try {
                  await remove({ id: bot.id, key: list.key, recordId: entry.id }).unwrap();
                  onRemoved(() => void restore({ id: bot.id, key: list.key, recordId: entry.id }));
                  onClose();
                } catch (error) {
                  const found = listRefusalOf(error);
                  if (found) setRefusal(found);
                  else setFailed(true);
                }
              }}
            >
              {t().remove.confirm}
            </Button>
          )}
          <Button onClick={onClose}>{t().remove.keep}</Button>
        </div>
      </div>
    </Sheet>
  );
};

const TableSkeleton: React.FC<{ columns: number }> = ({ columns }) => (
  <div className="ally-lists__table-skeleton" aria-busy="true">
    {[0, 1, 2, 3, 4, 5].map(row => (
      <div key={row} className="ally-lists__skeleton-row">
        {Array.from({ length: Math.max(columns, 2) }, (_, i) => (
          <Skeleton key={i} width={`${18 + ((row + i) % 3) * 6}%`} />
        ))}
      </div>
    ))}
  </div>
);

const TrashIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
    <path
      d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
