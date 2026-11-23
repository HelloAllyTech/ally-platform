import React, { useMemo, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  DirectoryEntry,
  EntryScope,
  useCreateDirectoryCollectionMutation,
  useDeleteDirectoryEntryMutation,
  useGetDirectoryCollectionsQuery,
  useGetDirectoryEntriesQuery,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { DIR } from "./copy";
import { EntryCard } from "./EntryCard";
import { EntryDialog } from "./EntryDialog";
import { SaveToCollection } from "./SaveToCollection";
import { Badge, errMsg, inputClass } from "./ui";

type Tab = "browse" | "mine" | "collections";
const TABS: Tab[] = ["browse", "mine", "collections"];

const EntriesTab: React.FC<{ scope: EntryScope }> = ({ scope }) => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<DirectoryEntry | "new" | null>(null);
  const [saving, setSaving] = useState<DirectoryEntry | null>(null);
  const entries = useGetDirectoryEntriesQuery({ scope, search: search.trim() || undefined });
  const [remove] = useDeleteDirectoryEntryMutation();
  const rows = useMemo(
    () => (entries.data ?? []).filter(e => !category || e.category === category),
    [entries.data, category],
  );
  // Categories come from the unfiltered-by-category rows we have, so the list doesn't shrink as you pick.
  const categories = useMemo(
    () => [...new Set((entries.data ?? []).map(e => e.category).filter(Boolean))].sort(),
    [entries.data],
  );

  const onDelete = async (entry: DirectoryEntry) => {
    if (!window.confirm(DIR.entry.deleteConfirm)) return;
    try {
      await remove(entry.id).unwrap();
    } catch (error) {
      toast.error(errMsg(error, DIR.entry.form.failed));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-md flex-1`}
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={DIR.browse.search}
          aria-label={DIR.browse.search}
        />
        <select
          className={`${inputClass} w-auto`}
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label={DIR.browse.allCategories}
        >
          <option value="">{DIR.browse.allCategories}</option>
          {categories.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button className="ml-auto" onClick={() => setEditing("new")} data-testid="add-entry">
          {DIR.entry.add}
        </Button>
      </div>
      {entries.isError ? (
        <div role="alert" className="flex items-center gap-3">
          <span>{DIR.browse.loadFailed}</span>
          <Button size="sm" variant={ButtonVariant.TERTIARY} onClick={() => entries.refetch()}>
            {DIR.browse.retry}
          </Button>
        </div>
      ) : entries.isLoading ? (
        <p role="status">…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-typography-700">
          {scope === "mine" ? DIR.browse.emptyMine : DIR.browse.empty}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onSave={setSaving}
              onEdit={setEditing}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {editing && (
        <EntryDialog
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {saving && (
        <SaveToCollection
          entryId={saving.id}
          title={saving.title}
          onClose={() => setSaving(null)}
        />
      )}
    </div>
  );
};

const CollectionsTab: React.FC = () => {
  const navigate = useNavigate();
  const collections = useGetDirectoryCollectionsQuery();
  const [create, { isLoading }] = useCreateDirectoryCollectionMutation();
  const [name, setName] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isLoading) return;
    try {
      const made = await create({ name: name.trim() }).unwrap();
      navigate(ROUTES.DIRECTORY_COLLECTION_OF(made.id));
    } catch (error) {
      toast.error(errMsg(error, DIR.save.failed));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-typography-700">{DIR.collections.intro}</p>
      <form onSubmit={submit} className="flex max-w-md gap-2">
        <input
          className={inputClass}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={DIR.collections.name}
          aria-label={DIR.collections.name}
          maxLength={200}
        />
        <Button type="submit" disabled={!name.trim() || isLoading}>
          {DIR.collections.create}
        </Button>
      </form>
      {collections.data?.length === 0 && (
        <p className="py-4 text-typography-700">{DIR.collections.empty}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(collections.data ?? []).map(c => (
          <article
            key={c.id}
            className="flex flex-col gap-2 border border-border-light bg-white p-4"
          >
            <Badge tone={c.published ? "public" : "neutral"}>
              {c.published ? DIR.collections.published : DIR.collections.draft}
            </Badge>
            <h3 className="font-secondary text-xl">{c.name}</h3>
            <p className="text-sm text-typography-600">{DIR.collections.entries(c.entryCount)}</p>
            {c.customDomain && <p className="text-sm text-typography-600">{c.customDomain}</p>}
            <Button
              className="mt-auto self-start"
              size="sm"
              variant={ButtonVariant.TERTIARY}
              onClick={() => navigate(ROUTES.DIRECTORY_COLLECTION_OF(c.id))}
            >
              {DIR.collections.open}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
};

/** The directory home: browse everything you can see, manage your entries, curate collections. */
export const Directory: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "browse";
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6"
      data-testid="directory-home"
    >
      <div>
        <h1 className="font-secondary text-3xl text-typography-900">{DIR.navTitle}</h1>
        <p className="text-typography-700">{DIR.browse.intro}</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-border-light">
        {TABS.map(id => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setParams(id === "browse" ? {} : { tab: id }, { replace: true })}
            className={`min-h-11 px-4 text-base ${
              tab === id
                ? "border-b-2 border-primary-500 font-medium text-typography-900"
                : "text-typography-600 hover:text-typography-900"
            }`}
          >
            {DIR.tabs[id]}
          </button>
        ))}
      </div>
      {tab === "collections" ? (
        <CollectionsTab />
      ) : (
        <EntriesTab key={tab} scope={tab === "mine" ? "mine" : "all"} />
      )}
    </div>
  );
};
