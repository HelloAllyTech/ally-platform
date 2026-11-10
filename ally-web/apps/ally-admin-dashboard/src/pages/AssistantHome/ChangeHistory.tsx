import React, { useState } from "react";

import { useGetHistoryQuery, useRevertEditMutation, useUndoChangeMutation } from "@api";
import type { HistoryEntry } from "@api";
import { Button } from "@components/v2";

import { HOME, fill } from "./copy";
import { when } from "./dates";
import { ListSkeleton } from "./ui/List";
import { COPY } from "../Onboarding/copy";

const t = HOME.changeControls;

const show = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value))
    return value.map(v => (typeof v === "string" ? v : JSON.stringify(v))).join(" · ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** A field's name as the owner reads it, from the home's names or change by chat's. */
const fieldName = (field: string): string =>
  (t.fields as Record<string, string>)[field] ??
  (COPY.change.fields as Record<string, string>)[field] ??
  field;

/**
 * The History (chunk 20d-2): every change, newest first, with what changed (before → after), who,
 * when, and where it came from (the Change panel or by hand). The newest change to a field can be
 * undone; an older one restored, which brings back what the field said after it. Edits to the
 * owner's own rules are listed; they're changed again from Safety.
 */
export const ChangeHistory: React.FC<{
  botId: string;
  canEdit: boolean;
  onChanged: () => void;
}> = ({ botId, canEdit, onChanged }) => {
  const { data: entries = [], isLoading } = useGetHistoryQuery(botId);
  const [revert, reverting] = useRevertEditMutation();
  const [undoChange, undoing] = useUndoChangeMutation();
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <ListSkeleton rows={3} />;
  if (!entries.length) return <p className="ally-small">{t.historyEmpty}</p>;

  // The newest entry for each field is the one Undo puts back; older ones are Restore.
  const newest = new Map<string, string>();
  for (const entry of entries) {
    for (const f of entry.fields) if (!newest.has(f.field)) newest.set(f.field, entry.id);
  }
  const isNewest = (entry: HistoryEntry) =>
    entry.fields.every(f => newest.get(f.field) === entry.id);

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      onChanged();
    } catch (failure) {
      const message = (failure as { data?: { message?: string } })?.data?.message;
      setError(message ?? HOME.saving.failed);
    }
  };

  return (
    <div className="ally-history" data-testid="change-history">
      <ul className="ally-list">
        {entries.map(entry => {
          const rules = entry.fields.some(f => f.field === "rules");
          const latest = isNewest(entry);
          return (
            <li key={entry.id} className="ally-list__row ally-history__entry">
              <div className="ally-list__main">
                <span className="ally-list__title">
                  {entry.fields.map(f => fieldName(f.field)).join(", ")}
                  <span className="ally-badge ally-badge--muted">
                    {entry.origin === "panel" ? t.fromPanel : t.byHand}
                  </span>
                  {entry.undone && <span className="ally-badge ally-badge--warn">{t.undone}</span>}
                </span>
                <span className="ally-list__meta">
                  {entry.who
                    ? fill(t.who, { who: entry.who, when: when(entry.at) })
                    : when(entry.at)}
                </span>
                {entry.fields.map(f => (
                  <p key={f.field} className="ally-small ally-history__diff">
                    <span className="ally-history__before">{show(f.before)}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="ally-sr-only">{COPY.change.after}: </span>
                    <span>{show(f.after)}</span>
                  </p>
                ))}
              </div>
              {canEdit && !entry.undone && !rules && (
                <div className="ally-list__actions">
                  {entry.kind === "change" ? (
                    <Button
                      variant="ghost"
                      className="ally-btn--sm"
                      disabled={undoing.isLoading}
                      onClick={() =>
                        void act(() => undoChange({ id: botId, eventId: entry.id }).unwrap())
                      }
                    >
                      {t.undo}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="ally-btn--sm"
                      disabled={reverting.isLoading}
                      onClick={() =>
                        void act(() =>
                          revert({
                            id: botId,
                            eventId: entry.id,
                            to: latest ? "undo" : "restore",
                          }).unwrap(),
                        )
                      }
                    >
                      {latest ? t.undo : t.restore}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
