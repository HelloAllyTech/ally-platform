import React, { useState } from "react";

import { toast } from "sonner";

import {
  useCreateDirectoryCollectionMutation,
  useGetDirectoryCollectionsQuery,
  useGetEntryCollectionsQuery,
  useRemoveEntryFromCollectionMutation,
  useSaveEntryToCollectionMutation,
} from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";

import { DIR } from "./copy";
import { errMsg, inputClass, Modal } from "./ui";

/** Tick the collections that should hold this entry. Your own collections only. */
export const SaveToCollection: React.FC<{
  entryId: string;
  title: string;
  onClose: () => void;
}> = ({ entryId, title, onClose }) => {
  const collections = useGetDirectoryCollectionsQuery();
  const holding = useGetEntryCollectionsQuery(entryId);
  const [save] = useSaveEntryToCollectionMutation();
  const [remove] = useRemoveEntryFromCollectionMutation();
  const [create, { isLoading: creating }] = useCreateDirectoryCollectionMutation();
  const [name, setName] = useState("");
  const held = new Set(holding.data ?? []);

  const toggle = async (collectionId: string) => {
    try {
      if (held.has(collectionId)) await remove({ collectionId, entryId }).unwrap();
      else await save({ collectionId, entryId }).unwrap();
    } catch (error) {
      toast.error(errMsg(error, DIR.save.failed));
    }
  };

  const makeNew = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    try {
      const made = await create({ name: name.trim() }).unwrap();
      await save({ collectionId: made.id, entryId }).unwrap();
      setName("");
    } catch (error) {
      toast.error(errMsg(error, DIR.save.failed));
    }
  };

  return (
    <Modal title={`${DIR.save.heading}: ${title}`} onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="save-to-collection">
        {collections.data?.length === 0 && <p className="text-typography-700">{DIR.save.none}</p>}
        <ul className="flex flex-col">
          {(collections.data ?? []).map(c => (
            <li key={c.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border-light py-2">
                <input
                  type="checkbox"
                  checked={held.has(c.id)}
                  disabled={holding.isLoading}
                  onChange={() => toggle(c.id)}
                />
                <span className="flex-1">{c.name}</span>
                <span className="text-sm text-typography-600">
                  {DIR.collections.entries(c.entryCount)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <form onSubmit={makeNew} className="flex gap-2">
          <input
            className={inputClass}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={DIR.save.namePlaceholder}
            aria-label={DIR.save.namePlaceholder}
            maxLength={200}
          />
          <Button
            type="submit"
            variant={ButtonVariant.TERTIARY}
            disabled={!name.trim() || creating}
          >
            {DIR.save.create}
          </Button>
        </form>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            OK
          </Button>
        </div>
      </div>
    </Modal>
  );
};
