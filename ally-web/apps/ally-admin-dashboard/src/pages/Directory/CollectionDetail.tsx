import React, { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  CollectionSettings,
  DirectoryCollection,
  useClearCollectionDomainMutation,
  useDeleteDirectoryCollectionMutation,
  useGetDirectoryCollectionQuery,
  useRemoveEntryFromCollectionMutation,
  useSetCollectionDomainMutation,
  useUpdateDirectoryCollectionMutation,
  useVerifyCollectionDomainMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { DIR } from "./copy";
import { placeOf } from "./EntryCard";
import { Badge, copyText, errMsg, Field, inputClass, publicPageUrl } from "./ui";

const D = DIR.detail;
type Tab = "entries" | "page" | "domain";

const EntriesPanel: React.FC<{ collection: DirectoryCollection }> = ({ collection }) => {
  const [remove] = useRemoveEntryFromCollectionMutation();
  if (collection.entries.length === 0) {
    return <p className="py-6 text-typography-700">{D.entriesEmpty}</p>;
  }
  return (
    <ul className="flex flex-col">
      {collection.entries.map(e => (
        <li
          key={e.id}
          className="flex flex-wrap items-center gap-3 border-b border-border-light py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{e.title}</p>
            <p className="text-sm text-typography-600">
              {[e.organization, placeOf(e)].filter(Boolean).join(" · ")}
            </p>
            {e.visibility === "private" && (
              <p className="text-xs text-typography-600">{D.privateEntry}</p>
            )}
          </div>
          <Badge tone={e.visibility === "public" ? "public" : "private"}>
            {e.visibility === "public" ? DIR.entry.public : DIR.entry.private}
          </Badge>
          <Button
            size="sm"
            variant={ButtonVariant.TEXT}
            onClick={() =>
              remove({ collectionId: collection.id, entryId: e.id })
                .unwrap()
                .catch(error => toast.error(errMsg(error, D.failed)))
            }
          >
            {D.remove}
          </Button>
        </li>
      ))}
    </ul>
  );
};

const PagePanel: React.FC<{ collection: DirectoryCollection }> = ({ collection }) => {
  const [update, { isLoading }] = useUpdateDirectoryCollectionMutation();
  const [draft, setDraft] = useState({
    name: collection.name,
    description: collection.description,
    slug: collection.slug,
    ...collection.settings,
  });
  // A save from elsewhere (or this one) comes back as the new truth.
  useEffect(() => {
    setDraft({
      name: collection.name,
      description: collection.description,
      slug: collection.slug,
      ...collection.settings,
    });
  }, [collection]);

  const text =
    (key: keyof typeof draft) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(prev => ({ ...prev, [key]: event.target.value }));
  const flag = (key: "showSearch" | "showCategoryFilter" | "showContactDetails") => (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        checked={draft[key]}
        onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.checked }))}
      />
      {D.settings[key]}
    </label>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { name, description, slug, ...settings } = draft;
    try {
      await update({
        id: collection.id,
        body: { name: name.trim(), description, slug, settings: settings as CollectionSettings },
      }).unwrap();
      toast.success(D.savedSettings);
    } catch (error) {
      toast.error(errMsg(error, D.failed));
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4" data-testid="page-settings">
      <Field label={D.settings.name} htmlFor="c-name">
        <input
          id="c-name"
          className={inputClass}
          value={draft.name}
          onChange={text("name")}
          required
          maxLength={200}
        />
      </Field>
      <Field label={D.settings.description} htmlFor="c-desc">
        <textarea
          id="c-desc"
          className={`${inputClass} min-h-20`}
          value={draft.description}
          onChange={text("description")}
          maxLength={1000}
        />
      </Field>
      <Field label={D.settings.slug} hint={D.settings.slugHint} htmlFor="c-slug">
        <input
          id="c-slug"
          className={inputClass}
          value={draft.slug}
          onChange={text("slug")}
          maxLength={48}
        />
      </Field>
      <Field label={D.settings.headline} htmlFor="c-headline">
        <input
          id="c-headline"
          className={inputClass}
          value={draft.headline}
          onChange={text("headline")}
          maxLength={120}
        />
      </Field>
      <Field label={D.settings.tagline} htmlFor="c-tagline">
        <input
          id="c-tagline"
          className={inputClass}
          value={draft.tagline}
          onChange={text("tagline")}
          maxLength={300}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={D.settings.accentColor} htmlFor="c-accent">
          <input
            id="c-accent"
            type="color"
            className="h-10 w-full cursor-pointer border border-border-light bg-white"
            value={draft.accentColor}
            onChange={text("accentColor")}
          />
        </Field>
        <Field label={D.settings.layout} htmlFor="c-layout">
          <select
            id="c-layout"
            className={inputClass}
            value={draft.layout}
            onChange={e =>
              setDraft(prev => ({ ...prev, layout: e.target.value as "grid" | "list" }))
            }
          >
            <option value="grid">{D.settings.layoutGrid}</option>
            <option value="list">{D.settings.layoutList}</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-col">
        {flag("showSearch")}
        {flag("showCategoryFilter")}
        {flag("showContactDetails")}
      </div>
      <Field label={D.settings.contactEmail} htmlFor="c-contact">
        <input
          id="c-contact"
          type="email"
          className={inputClass}
          value={draft.contactEmail}
          onChange={text("contactEmail")}
        />
      </Field>
      <Field label={D.settings.footerNote} htmlFor="c-footer">
        <textarea
          id="c-footer"
          className={`${inputClass} min-h-16`}
          value={draft.footerNote}
          onChange={text("footerNote")}
          maxLength={500}
        />
      </Field>
      <div>
        <Button type="submit" disabled={isLoading || !draft.name.trim()}>
          {D.saveSettings}
        </Button>
      </div>
    </form>
  );
};

const DomainPanel: React.FC<{ collection: DirectoryCollection }> = ({ collection }) => {
  const [domain, setDomain] = useState(collection.customDomain ?? "");
  const [setDomainApi, { isLoading: setting }] = useSetCollectionDomainMutation();
  const [clear] = useClearCollectionDomainMutation();
  const [verify, { isLoading: verifying }] = useVerifyCollectionDomainMutation();
  const T = D.domain;
  const v = collection.domainVerification;

  const run = async (
    fn: () => Promise<DirectoryCollection>,
    after?: (c: DirectoryCollection) => void,
  ) => {
    try {
      after?.(await fn());
    } catch (error) {
      toast.error(errMsg(error, D.failed));
    }
  };

  const record = (label: string, name: string, value: string) => (
    <div className="flex flex-col gap-1 border border-border-light p-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="break-all text-sm">
        <span className="text-typography-600">{T.name}: </span>
        <code>{name}</code>
      </p>
      <p className="break-all text-sm">
        <span className="text-typography-600">{T.value}: </span>
        <code>{value}</code>
      </p>
    </div>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="domain-panel">
      <p className="text-typography-700">{T.intro}</p>
      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          if (domain.trim()) run(() => setDomainApi({ id: collection.id, domain }).unwrap());
        }}
      >
        <input
          className={inputClass}
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="resources.yourorg.org"
          aria-label={T.field}
        />
        <Button type="submit" disabled={!domain.trim() || setting}>
          {T.set}
        </Button>
      </form>
      {collection.customDomain && v && (
        <>
          <p
            role="status"
            className={
              collection.domainVerified ? "font-medium text-[#14532D]" : "text-typography-700"
            }
          >
            {collection.domainVerified ? T.verifiedLabel : T.pendingLabel}
          </p>
          {!collection.published && <p className="text-sm text-typography-700">{T.needsPublish}</p>}
          <h3 className="font-secondary text-lg">{T.stepsHeading}</h3>
          {record(T.step1, `TXT  ${v.txtName}`, v.txtValue)}
          {record(T.step2, `CNAME  ${collection.customDomain}`, v.cnameTarget || T.noTarget)}
          <div className="flex gap-2">
            <Button
              variant={ButtonVariant.TERTIARY}
              disabled={verifying}
              onClick={() =>
                run(
                  () => verify(collection.id).unwrap(),
                  c => {
                    if (!c.domainVerified) toast(T.checked);
                  },
                )
              }
            >
              {T.verify}
            </Button>
            <Button
              variant={ButtonVariant.TEXT}
              onClick={() =>
                run(
                  () => clear(collection.id).unwrap(),
                  () => setDomain(""),
                )
              }
            >
              {T.remove}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

/** One collection you own: its entries, its page's settings, its domain. */
export const CollectionDetail: React.FC = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("entries");
  const { data, isLoading, isError } = useGetDirectoryCollectionQuery(id);
  const [update] = useUpdateDirectoryCollectionMutation();
  const [remove] = useDeleteDirectoryCollectionMutation();

  if (isLoading)
    return (
      <p role="status" className="p-6">
        …
      </p>
    );
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p>{D.notFound}</p>
        <Button
          className="mt-4"
          variant={ButtonVariant.TERTIARY}
          onClick={() => navigate(`${ROUTES.DIRECTORY}?tab=collections`)}
        >
          {D.back}
        </Button>
      </div>
    );
  }
  const url = publicPageUrl(data.slug);

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6"
      data-testid="collection-detail"
    >
      <button
        type="button"
        className="self-start text-sm text-primary-500 hover:underline"
        onClick={() => navigate(`${ROUTES.DIRECTORY}?tab=collections`)}
      >
        ← {D.back}
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-secondary text-3xl">{data.name}</h1>
        <Badge tone={data.published ? "public" : "neutral"}>
          {data.published ? DIR.collections.published : DIR.collections.draft}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3 border border-border-light bg-white p-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={data.published}
            onChange={e =>
              update({ id: data.id, body: { published: e.target.checked } })
                .unwrap()
                .catch(error => toast.error(errMsg(error, D.failed)))
            }
          />
          <span>
            <span className="font-medium">{D.publishedLabel}</span>
            <span className="block text-sm text-typography-600">{D.publishHint}</span>
          </span>
        </label>
        <code className="ml-auto break-all text-sm">
          {data.customDomain && data.domainVerified ? `https://${data.customDomain}` : url}
        </code>
        <Button size="sm" variant={ButtonVariant.TERTIARY} onClick={() => copyText(url, D.copied)}>
          {D.copy}
        </Button>
        <Button
          size="sm"
          variant={ButtonVariant.TERTIARY}
          onClick={() => window.open(url, "_blank", "noopener")}
        >
          {D.visit}
        </Button>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-border-light">
        {(["entries", "page", "domain"] as const).map(t => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 px-4 ${
              tab === t ? "border-b-2 border-primary-500 font-medium" : "text-typography-600"
            }`}
          >
            {D.tabs[t]}
          </button>
        ))}
      </div>
      {tab === "entries" && <EntriesPanel collection={data} />}
      {tab === "page" && <PagePanel collection={data} />}
      {tab === "domain" && <DomainPanel collection={data} />}
      <div className="border-t border-border-light pt-4">
        <Button
          variant={ButtonVariant.TEXT}
          onClick={async () => {
            if (!window.confirm(D.deleteConfirm)) return;
            try {
              await remove(data.id).unwrap();
              navigate(`${ROUTES.DIRECTORY}?tab=collections`);
            } catch (error) {
              toast.error(errMsg(error, D.failed));
            }
          }}
        >
          {D.delete}
        </Button>
      </div>
    </div>
  );
};
