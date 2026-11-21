import React, { useState } from "react";

import { toast } from "sonner";

import {
  DirectoryEntry,
  DirectoryVisibility,
  useCreateDirectoryEntryMutation,
  useUpdateDirectoryEntryMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { DIR, splitList } from "./copy";
import { errMsg, Field, inputClass, Modal } from "./ui";

const F = DIR.entry.form;

/** Add an entry, or edit one the caller owns. New entries start private. */
export const EntryDialog: React.FC<{
  entry?: DirectoryEntry;
  onClose: () => void;
}> = ({ entry, onClose }) => {
  const [create, { isLoading: creating }] = useCreateDirectoryEntryMutation();
  const [update, { isLoading: updating }] = useUpdateDirectoryEntryMutation();
  const [form, setForm] = useState({
    title: entry?.title ?? "",
    organization: entry?.organization ?? "",
    category: entry?.category ?? "",
    description: entry?.description ?? "",
    websiteUrl: entry?.websiteUrl ?? "",
    phone: entry?.phone ?? "",
    email: entry?.email ?? "",
    address: entry?.address ?? "",
    city: entry?.city ?? "",
    region: entry?.region ?? "",
    country: entry?.country ?? "",
    tags: (entry?.tags ?? []).join(", "),
    languages: (entry?.languages ?? []).join(", "),
    visibility: (entry?.visibility ?? "private") as DirectoryVisibility,
  });
  const set =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: event.target.value }));
  const busy = creating || updating;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || busy) return;
    const body = {
      ...form,
      title: form.title.trim(),
      tags: splitList(form.tags),
      languages: splitList(form.languages),
    };
    try {
      if (entry) await update({ id: entry.id, body }).unwrap();
      else await create(body).unwrap();
      toast.success(F.saved);
      onClose();
    } catch (error) {
      toast.error(errMsg(error, F.failed));
    }
  };

  const text = (
    key: keyof typeof form,
    label: string,
    extra?: { hint?: string; type?: string },
  ) => (
    <Field label={label} hint={extra?.hint} htmlFor={`dir-${key}`}>
      <input
        id={`dir-${key}`}
        type={extra?.type ?? "text"}
        className={inputClass}
        value={form[key]}
        onChange={set(key)}
      />
    </Field>
  );

  return (
    <Modal title={entry ? F.editTitle : F.addTitle} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="entry-form">
        <Field label={F.title} htmlFor="dir-title">
          <input
            id="dir-title"
            className={inputClass}
            value={form.title}
            onChange={set("title")}
            maxLength={200}
            required
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("organization", F.organization)}
          {text("category", F.category, { hint: F.categoryHint })}
        </div>
        <Field label={F.description} htmlFor="dir-description">
          <textarea
            id="dir-description"
            className={`${inputClass} min-h-24`}
            value={form.description}
            onChange={set("description")}
            maxLength={4000}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("websiteUrl", F.websiteUrl, { type: "url" })}
          {text("phone", F.phone, { type: "tel" })}
          {text("email", F.email, { type: "email" })}
          {text("address", F.address)}
          {text("city", F.city)}
          {text("region", F.region)}
          {text("country", F.country)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("tags", F.tags, { hint: F.tagsHint })}
          {text("languages", F.languages, { hint: F.languagesHint })}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-typography-800">
            {DIR.entry.visibility}
          </legend>
          {(["private", "public"] as const).map(v => (
            <label key={v} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="visibility"
                className="mt-1"
                checked={form.visibility === v}
                onChange={() => setForm(prev => ({ ...prev, visibility: v }))}
              />
              <span>
                <span className="font-medium">
                  {v === "public" ? DIR.entry.public : DIR.entry.private}
                </span>
                <span className="block text-sm text-typography-600">
                  {v === "public" ? DIR.entry.publicHint : DIR.entry.privateHint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant={ButtonVariant.TERTIARY} onClick={onClose}>
            {F.cancel}
          </Button>
          <Button type="submit" disabled={busy || !form.title.trim()}>
            {busy ? F.saving : F.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
