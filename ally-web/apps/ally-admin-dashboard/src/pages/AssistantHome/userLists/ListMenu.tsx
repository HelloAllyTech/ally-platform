import React, { useContext, useState } from "react";

import {
  useDeleteUserListMutation,
  useRestoreUserListMutation,
  useUpdateUserListMutation,
} from "@api";
import { Button } from "@components/v2";
import type { UserList } from "@types";

import { HOME, fill } from "../copy";
import { MoreMenu } from "../ui/Menu";
import { Sheet } from "../ui/Sheet";
import { HomeSavesContext } from "../useHomeField";

const t = () => HOME.userLists.listMenu;

/** A refusal's own words (`in_use`: another list links to this one), or the fallback. */
const messageOf = (failure: unknown, fallback: string): string =>
  (failure as { data?: { message?: string } })?.data?.message ?? fallback;

/**
 * A list's `⋯` (chunk 8a): Rename, and Delete list with one confirmation and Undo. A list another
 * list links to is refused by ally-be with the reason ("Appointments links to this list…").
 */
export const ListMenu: React.FC<{
  botId: string;
  list: UserList;
  /** Every live list, to find the ones that link to this one (chunk 8a). */
  lists: UserList[];
  onDeleted: () => void;
}> = ({ botId, list, lists, onDeleted }) => {
  const [open, setOpen] = useState<"rename" | "delete" | null>(null);
  return (
    <>
      <MoreMenu
        label={fill(t().more, { list: list.name })}
        items={[
          { label: t().rename, onSelect: () => setOpen("rename") },
          { label: t().delete, onSelect: () => setOpen("delete"), danger: true },
        ]}
      />
      {open === "rename" && (
        <RenameDialog botId={botId} list={list} onClose={() => setOpen(null)} />
      )}
      {open === "delete" && (
        <DeleteDialog
          botId={botId}
          list={list}
          linked={linkingLists(list, lists)}
          onClose={() => setOpen(null)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
};

const RenameDialog: React.FC<{ botId: string; list: UserList; onClose: () => void }> = ({
  botId,
  list,
  onClose,
}) => {
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [rename, { isLoading }] = useUpdateUserListMutation();
  const title = fill(t().renameTitle, { list: list.name });
  const save = async () => {
    const value = name.replace(/\s+/g, " ").trim();
    if (!value || value === list.name) return onClose();
    setError(null);
    try {
      await rename({ id: botId, key: list.key, name: value }).unwrap();
      onClose();
    } catch (failure) {
      setError(messageOf(failure, t().renameFailed));
    }
  };
  return (
    <Sheet side="center" label={title} onClose={onClose} testId="rename-list">
      <form
        className="ally-remove"
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 className="ally-heading">{title}</h2>
        <label className="ally-field">
          <span className="ally-field__label">{t().name}</span>
          <input
            className="ally-input"
            value={name}
            maxLength={60}
            autoFocus
            onChange={event => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="ally-small ally-remove__error" role="alert">
            {error}
          </p>
        )}
        <div className="ally-remove__actions">
          <Button onClick={onClose}>{t().cancel}</Button>
          <Button variant="primary" type="submit" disabled={isLoading}>
            {t().save}
          </Button>
        </div>
      </form>
    </Sheet>
  );
};

/** Every list that links to `list`, directly or through another (as ally-be finds them). */
export const linkingLists = (list: UserList, lists: UserList[]): UserList[] => {
  const found: UserList[] = [];
  const queue = [list.key];
  const seen = new Set([list.key]);
  while (queue.length) {
    const target = queue.shift()!;
    for (const other of lists) {
      if (other.deleted_at || seen.has(other.key)) continue;
      const links = other.fields.some(
        f => !f.archived_at && f.type === "relation" && f.options.to === target,
      );
      if (links) {
        seen.add(other.key);
        found.push(other);
        queue.push(other.key);
      }
    }
  }
  return found;
};

const names = (lists: UserList[]): string => {
  const all = lists.map(l => l.name);
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
};

const DeleteDialog: React.FC<{
  botId: string;
  list: UserList;
  /** The lists that go with it: they link to it (chunk 8a). */
  linked: UserList[];
  onClose: () => void;
  onDeleted: () => void;
}> = ({ botId, list, linked, onClose, onDeleted }) => {
  const [remove, { isLoading }] = useDeleteUserListMutation();
  const [restore] = useRestoreUserListMutation();
  const saves = useContext(HomeSavesContext);
  const [error, setError] = useState<string | null>(null);
  const others = names(linked);
  const entries = [list, ...linked].reduce((n, l) => n + l.record_count, 0);
  const title = linked.length
    ? fill(t().deleteLinkedTitle, { list: list.name, others })
    : fill(t().deleteTitle, { list: list.name });
  const body = linked.length
    ? fill(linked.length === 1 ? t().deleteLinkedOne : t().deleteLinkedMany, {
        list: list.name,
        others,
        n: entries,
      })
    : list.record_count === 0
      ? t().deleteNone
      : list.record_count === 1
        ? t().deleteOne
        : fill(t().deleteMany, { n: list.record_count });
  const confirm = async () => {
    setError(null);
    try {
      await remove({
        id: botId,
        key: list.key,
        ...(linked.length ? { withLinked: true } : {}),
      }).unwrap();
      onClose();
      onDeleted();
      // Undo: the list first, then those that link to it.
      saves.changed(
        () => {
          void (async () => {
            for (const l of [list, ...linked]) await restore({ id: botId, listId: l.id });
          })();
        },
        linked.length
          ? fill(t().deletedLinked, { list: list.name, others })
          : fill(t().deleted, { list: list.name }),
      );
    } catch (failure) {
      setError(messageOf(failure, t().deleteFailed));
    }
  };
  return (
    <Sheet side="center" label={title} onClose={onClose} testId="delete-list">
      <div className="ally-remove">
        <h2 className="ally-heading">{title}</h2>
        <p className="ally-small">{body}</p>
        {error && (
          <p className="ally-small ally-remove__error" role="alert">
            {error}
          </p>
        )}
        <div className="ally-remove__actions">
          <Button onClick={onClose}>{t().keep}</Button>
          <Button
            variant="primary"
            className="ally-remove__confirm"
            disabled={isLoading}
            onClick={() => void confirm()}
          >
            {linked.length ? t().deleteEverything : t().delete}
          </Button>
        </div>
      </div>
    </Sheet>
  );
};
