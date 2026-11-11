import React, { useId, useState } from "react";

import { Button } from "@components/v2";
import type { HomeQuickReply } from "@types";

import { HOME, fill } from "../copy";
import { ListError, ListRow, ListRows, ListSkeleton, RemoveButton } from "../ui/List";
import { addedIn, useHomeList } from "../useHomeList";
import { LoadFailed } from "./AccessLists";

const t = HOME.lists.replies;

interface Draft {
  name: string;
  patterns: string;
  responseText: string;
}

/** The add or reword form: when someone writes these words, it replies with this. */
const ReplyForm: React.FC<{
  initial: Draft;
  withName: boolean;
  wordsLocked?: boolean;
  disabled: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onCancel: () => void;
}> = ({ initial, withName, wordsLocked, disabled, onSave, onCancel }) => {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const ready =
    draft.responseText.trim() &&
    (wordsLocked || draft.patterns.trim()) &&
    (!withName || draft.name.trim());
  return (
    <form
      className="ally-home__reply-form"
      onSubmit={event => {
        event.preventDefault();
        if (ready) void onSave(draft);
      }}
    >
      {withName && (
        <div className="ally-field">
          <label htmlFor={`${id}-name`}>{t.nameLabel}</label>
          <input
            id={`${id}-name`}
            className="ally-input"
            maxLength={80}
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
          />
        </div>
      )}
      {!wordsLocked && (
        <div className="ally-field">
          <label htmlFor={`${id}-words`}>{t.patternsLabel}</label>
          <span id={`${id}-words-hint`} className="ally-field__hint">
            {t.patternsHint}
          </span>
          <input
            id={`${id}-words`}
            className="ally-input"
            aria-describedby={`${id}-words-hint`}
            value={draft.patterns}
            onChange={event => setDraft({ ...draft, patterns: event.target.value })}
          />
        </div>
      )}
      <div className="ally-field">
        <label htmlFor={`${id}-reply`}>{t.replyLabel}</label>
        <textarea
          id={`${id}-reply`}
          className="ally-input"
          rows={3}
          maxLength={1000}
          value={draft.responseText}
          onChange={event => setDraft({ ...draft, responseText: event.target.value })}
        />
      </div>
      <div className="ally-btn-row">
        <Button type="submit" disabled={disabled || !ready}>
          {t.save}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
};

const stateLabel = (reply: HomeQuickReply) =>
  reply.state === "own"
    ? t.yours
    : reply.state === "customised"
      ? t.reworded
      : reply.state === "off"
        ? t.off
        : t.byAlly;

/**
 * Quick replies (chunk 20d-2, Personality): fixed answers sent on WhatsApp when someone writes
 * certain words. The owner's own can be added, reworded and removed. Ally's can be reworded, and
 * the optional ones turned off; a safety reply can be reworded but never turned off (ally-be
 * refuses it as before). Each change saves on its own.
 */
export const QuickReplies: React.FC<{ botId: string; canEdit: boolean }> = ({ botId, canEdit }) => {
  const list = useHomeList(botId, "quickReplies");
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const save = async (reply: HomeQuickReply, draft: Draft) => {
    const own = reply.state === "own";
    const ok = await list.change(
      {
        op: "edit",
        id: reply.id,
        item: own
          ? { responseText: draft.responseText, patterns: draft.patterns }
          : { responseText: draft.responseText },
      },
      () => ({ op: "edit", id: reply.id, item: { responseText: reply.responseText } }),
    );
    if (ok) setEditing(null);
    return ok;
  };

  if (list.loading) return <ListSkeleton rows={3} />;
  if (list.failed) return <LoadFailed onRetry={list.refetch} />;
  return (
    <div className="ally-home__list-block" data-testid="quick-replies">
      <ListRows label={HOME.personality.quickReplies}>
        {list.items.map(reply => (
          <ListRow
            key={reply.id}
            title={reply.name}
            badge={<span className="ally-badge ally-badge--muted">{stateLabel(reply)}</span>}
            meta={reply.patterns.join(", ")}
            actions={
              canEdit &&
              editing !== reply.id && (
                <>
                  <Button className="ally-btn--sm" onClick={() => setEditing(reply.id)}>
                    {t.reword}
                  </Button>
                  {reply.state !== "own" && !reply.required && (
                    <Button
                      variant="ghost"
                      className="ally-btn--sm"
                      disabled={list.saving}
                      onClick={() =>
                        void list.change(
                          { op: "edit", id: reply.id, item: { active: !reply.active } },
                          () => ({ op: "edit", id: reply.id, item: { active: reply.active } }),
                        )
                      }
                    >
                      {reply.active ? t.turnOff : t.turnOn}
                    </Button>
                  )}
                  {reply.state === "own" && (
                    <RemoveButton
                      label={fill(HOME.lists.remove, { item: reply.name })}
                      disabled={list.saving}
                      onClick={() => void list.change({ op: "remove", id: reply.id })}
                    />
                  )}
                </>
              )
            }
          >
            <p className="ally-body ally-home__reply-text">{reply.responseText}</p>
            {reply.required && <p className="ally-small">{t.safety}</p>}
            {editing === reply.id && (
              <ReplyForm
                initial={{
                  name: reply.name,
                  patterns: reply.patterns.join(", "),
                  responseText: reply.responseText,
                }}
                withName={false}
                wordsLocked={reply.state !== "own"}
                disabled={list.saving}
                onSave={draft => save(reply, draft)}
                onCancel={() => setEditing(null)}
              />
            )}
          </ListRow>
        ))}
      </ListRows>
      {!list.items.some(reply => reply.state === "own") && (
        <p className="ally-small">{t.ownEmpty}</p>
      )}
      {canEdit &&
        (editing === "new" ? (
          <ReplyForm
            initial={{ name: "", patterns: "", responseText: "" }}
            withName
            disabled={list.saving}
            onSave={async draft => {
              const before = list.items;
              const ok = await list.change({ op: "add", item: { ...draft } }, after => {
                const created = addedIn(before, after);
                return created ? { op: "remove", id: created.id } : null;
              });
              if (ok) setEditing(null);
              return ok;
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div>
            <Button onClick={() => setEditing("new")}>{t.add}</Button>
          </div>
        ))}
      <ListError error={list.error} />
    </div>
  );
};
