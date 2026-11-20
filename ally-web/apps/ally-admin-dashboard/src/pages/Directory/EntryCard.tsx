import React from "react";

import { DirectoryEntry } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { DIR } from "./copy";
import { Badge } from "./ui";

export const placeOf = (e: Pick<DirectoryEntry, "city" | "region" | "country">) =>
  [e.city, e.region, e.country].filter(Boolean).join(", ");

/** One resource. Owners get Edit/Delete; everyone gets Save to collection. */
export const EntryCard: React.FC<{
  entry: DirectoryEntry;
  onSave: (entry: DirectoryEntry) => void;
  onEdit: (entry: DirectoryEntry) => void;
  onDelete: (entry: DirectoryEntry) => void;
}> = ({ entry, onSave, onEdit, onDelete }) => {
  const place = placeOf(entry);
  return (
    <article
      className="flex flex-col gap-2 border border-border-light bg-white p-4"
      data-testid="entry-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={entry.visibility === "public" ? "public" : "private"}>
          {entry.visibility === "public" ? DIR.entry.public : DIR.entry.private}
        </Badge>
        {entry.category && <Badge>{entry.category}</Badge>}
      </div>
      <h3 className="font-secondary text-xl text-typography-900">{entry.title}</h3>
      {entry.organization && <p className="text-typography-700">{entry.organization}</p>}
      {entry.description && (
        <p className="line-clamp-3 text-sm text-typography-700">{entry.description}</p>
      )}
      {place && <p className="text-sm text-typography-600">{place}</p>}
      {entry.tags.length > 0 && (
        <p className="text-xs text-typography-600">{entry.tags.map(t => `#${t}`).join("  ")}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant={ButtonVariant.TERTIARY} onClick={() => onSave(entry)}>
          {DIR.entry.saveTo}
        </Button>
        {entry.isOwner && (
          <>
            <Button size="sm" variant={ButtonVariant.TEXT} onClick={() => onEdit(entry)}>
              {DIR.entry.edit}
            </Button>
            <Button size="sm" variant={ButtonVariant.TEXT} onClick={() => onDelete(entry)}>
              {DIR.entry.delete}
            </Button>
          </>
        )}
      </div>
    </article>
  );
};
