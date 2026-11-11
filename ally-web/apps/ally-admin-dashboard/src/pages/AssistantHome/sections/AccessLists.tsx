import React, { useId, useState } from "react";

import { Button } from "@components/v2";
import { ChatbotAccessMode } from "@types";
import type { BotPageAccess, HomeListEntry } from "@types";

import { HOME, fill } from "../copy";
import { Collapsed } from "../fields";
import { AddRow, ListError, ListRow, ListRows, ListSkeleton, RemoveButton } from "../ui/List";
import { addedIn, useHomeList } from "../useHomeList";

import type { HomeField } from "../useHomeField";

const t = HOME.lists;

const entryName = (entry: HomeListEntry) =>
  entry.kind === "organisation" ? (entry.organisationName ?? entry.value) : entry.value;

const linesOf = (text: string) =>
  text
    .split(/[\r\n,;]+/)
    .map(line => line.trim())
    .filter(Boolean);

/** Undo for an add: remove what the add created. Undo for a remove: add it back. */
const undoAdd = (before: HomeListEntry[]) => (after: HomeListEntry[]) => {
  const created = addedIn(before, after);
  return created ? { op: "remove" as const, id: created.id } : null;
};
const undoRemove = (entry: HomeListEntry) => () => ({
  op: "add" as const,
  item: { kind: entry.kind, value: entry.value, label: entry.label ?? undefined },
});

/** "Add many at once": a pasted list, one per line. */
const AddMany: React.FC<{
  summary: string;
  label: string;
  addLabel: string;
  disabled?: boolean;
  onAdd: (values: string[]) => Promise<boolean>;
}> = ({ summary, label, addLabel, disabled, onAdd }) => {
  const id = useId();
  const [text, setText] = useState("");
  return (
    <Collapsed summary={summary}>
      <div className="ally-field">
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          className="ally-input"
          rows={4}
          value={text}
          disabled={disabled}
          onChange={event => setText(event.target.value)}
        />
      </div>
      <div>
        <Button
          disabled={disabled || !linesOf(text).length}
          onClick={() => void onAdd(linesOf(text)).then(ok => ok && setText(""))}
        >
          {addLabel}
        </Button>
      </div>
    </Collapsed>
  );
};

/**
 * Who can open the page (chunk 20d-2, Share → On your page): invited emails, or organisations.
 * An organisation is offered by name (the owner's own), never as an id to type.
 */
export const PageAccessList: React.FC<{
  botId: string;
  mode: Exclude<BotPageAccess, "public">;
  canEdit: boolean;
}> = ({ botId, mode, canEdit }) => {
  const list = useHomeList(botId, "pageAccess");
  const kind = mode === "organisation" ? "organisation" : "email";
  const entries = list.items.filter(entry => entry.kind === kind);
  const yours = list.yourOrganisation;
  const hasYours = Boolean(yours && entries.some(entry => entry.value === yours.id));

  if (list.loading) return <ListSkeleton />;
  if (list.failed) return <LoadFailed onRetry={list.refetch} />;
  return (
    <div className="ally-home__list-block" data-testid="page-access-list">
      {entries.length ? (
        <ListRows label={HOME.share.onPage}>
          {entries.map(entry => (
            <ListRow
              key={entry.id}
              title={entryName(entry)}
              meta={
                entry.kind === "organisation" && entry.value === yours?.id
                  ? t.page.yours
                  : (entry.label ?? undefined)
              }
              actions={
                canEdit && (
                  <RemoveButton
                    label={fill(t.remove, { item: entryName(entry) })}
                    disabled={list.saving}
                    onClick={() =>
                      void list.change({ op: "remove", id: entry.id }, undoRemove(entry))
                    }
                  />
                )
              }
            />
          ))}
        </ListRows>
      ) : (
        <p className="ally-note ally-note--warn">
          {kind === "email" ? t.page.emptyInvite : t.page.emptyOrganisation}
        </p>
      )}
      {canEdit && kind === "email" && (
        <>
          <AddRow
            label={t.page.emailLabel}
            type="email"
            addLabel={t.add}
            disabled={list.saving}
            onAdd={value => list.change({ op: "add", item: { kind, value } }, undoAdd(list.items))}
          />
          <AddMany
            summary={t.page.many}
            label={t.page.manyLabel}
            addLabel={t.page.manyAdd}
            disabled={list.saving}
            onAdd={values =>
              list.change({
                op: "add",
                item: { entries: values.map(value => ({ kind, value })) },
              })
            }
          />
        </>
      )}
      {canEdit && kind === "organisation" && yours && !hasYours && (
        <div>
          <Button
            disabled={list.saving}
            onClick={() =>
              void list.change(
                { op: "add", item: { kind, value: yours.id, label: yours.name } },
                undoAdd(list.items),
              )
            }
          >
            {fill(t.page.addYours, { organisation: yours.name })}
          </Button>
        </div>
      )}
      <ListError error={list.error} />
    </div>
  );
};

const MODES: { id: ChatbotAccessMode; label: string }[] = [
  { id: ChatbotAccessMode.ANYONE, label: t.whatsapp.anyone },
  { id: ChatbotAccessMode.RECOGNISED, label: t.whatsapp.recognised },
  { id: ChatbotAccessMode.LISTED, label: t.whatsapp.listed },
];

/** Who can message it on WhatsApp (chunk 20d-2): who, and the list when it's "only these". */
export const WhatsAppAudience: React.FC<{
  botId: string;
  mode: HomeField<ChatbotAccessMode>;
  canEdit: boolean;
}> = ({ botId, mode, canEdit }) => {
  const name = useId();
  const listed = mode.value === ChatbotAccessMode.LISTED;
  const list = useHomeList(botId, "audience", { skip: !listed });
  const [kind, setKind] = useState<"phone" | "email">("phone");

  return (
    <div className="ally-home__list-block" data-testid="whatsapp-audience">
      <fieldset className="ally-segmented-field" disabled={!canEdit}>
        <legend className="ally-field__label">{t.whatsapp.who}</legend>
        <div className="ally-home__radios">
          {MODES.map(option => (
            <label
              key={option.id}
              className={`ally-home__radio${mode.value === option.id ? " is-on" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={mode.value === option.id}
                onChange={() => mode.set(option.id, { now: true })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <span className="ally-field__hint">{t.whatsapp.listHint}</span>
      </fieldset>
      {mode.error && (
        <p className="ally-error" role="alert">
          {mode.error}
        </p>
      )}
      {listed &&
        (list.loading ? (
          <ListSkeleton />
        ) : list.failed ? (
          <LoadFailed onRetry={list.refetch} />
        ) : (
          <>
            {list.items.length ? (
              <ListRows label={t.whatsapp.listed}>
                {list.items.map(entry => (
                  <ListRow
                    key={entry.id}
                    title={entryName(entry)}
                    meta={
                      [
                        entry.kind === "phone"
                          ? t.whatsapp.kindPhone
                          : entry.kind === "email"
                            ? t.whatsapp.kindEmail
                            : t.whatsapp.kindOrganisation,
                        entry.label,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    actions={
                      canEdit && (
                        <RemoveButton
                          label={fill(t.remove, { item: entryName(entry) })}
                          disabled={list.saving}
                          onClick={() =>
                            void list.change({ op: "remove", id: entry.id }, undoRemove(entry))
                          }
                        />
                      )
                    }
                  />
                ))}
              </ListRows>
            ) : (
              <p className="ally-note ally-note--warn">{t.whatsapp.empty}</p>
            )}
            {canEdit && (
              <>
                <AddRow
                  label={kind === "phone" ? t.whatsapp.phoneLabel : t.whatsapp.emailLabel}
                  type={kind === "phone" ? "tel" : "email"}
                  addLabel={t.add}
                  disabled={list.saving}
                  extra={
                    <select
                      className="ally-input ally-input--compact"
                      aria-label={t.whatsapp.who}
                      value={kind}
                      onChange={event => setKind(event.target.value as "phone" | "email")}
                    >
                      <option value="phone">{t.whatsapp.kindPhone}</option>
                      <option value="email">{t.whatsapp.kindEmail}</option>
                    </select>
                  }
                  onAdd={value =>
                    list.change({ op: "add", item: { kind, value } }, undoAdd(list.items))
                  }
                />
                <AddMany
                  summary={t.whatsapp.many}
                  label={t.whatsapp.manyLabel}
                  addLabel={t.whatsapp.manyAdd}
                  disabled={list.saving}
                  onAdd={values =>
                    list.change({
                      op: "add",
                      item: { entries: values.map(value => ({ kind: "phone", value })) },
                    })
                  }
                />
                {list.yourOrganisation &&
                  !list.items.some(entry => entry.value === list.yourOrganisation!.id) && (
                    <div>
                      <Button
                        disabled={list.saving}
                        onClick={() =>
                          void list.change(
                            {
                              op: "add",
                              item: {
                                kind: "organisation",
                                value: list.yourOrganisation!.id,
                                label: list.yourOrganisation!.name,
                              },
                            },
                            undoAdd(list.items),
                          )
                        }
                      >
                        {fill(t.page.addYours, { organisation: list.yourOrganisation.name })}
                      </Button>
                    </div>
                  )}
              </>
            )}
            <ListError error={list.error} />
          </>
        ))}
    </div>
  );
};

export const LoadFailed: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="ally-note ally-note--warn" role="alert">
    <span>{t.loadFailed}</span>{" "}
    <button type="button" className="ally-link" onClick={onRetry}>
      {t.retry}
    </button>
  </div>
);
