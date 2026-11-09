import React, { useState } from "react";

import {
  ProposedChange,
  useApplyChangeMutation,
  useGetChangesQuery,
  useProposeChangeMutation,
  useUndoChangeMutation,
} from "@api";
import type { ChangeProposal } from "@api";
import { AssistantLine, Button, Chip, PrimaryButton } from "@components/v2";

import { HOME } from "./copy";
import { COPY, fill } from "../Onboarding/copy";

const t = COPY.change;

const show = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.join(" · ") || "—";
  return String(value);
};

/** One change, as the owner reads it: what it is, then what it was and what it becomes. */
const ChangeCard: React.FC<{ change: ProposedChange }> = ({ change }) => (
  <div className="ally-change__row">
    <p className="ally-label">{t.fields[change.field]}</p>
    <div className="ally-change__columns">
      <div className="ally-change__before">
        <span className="ally-label">{t.before}</span>
        <p>{show(change.before)}</p>
      </div>
      <div className="ally-change__after">
        <span className="ally-label">{t.after}</span>
        <p>{show(change.after)}</p>
      </div>
    </div>
  </div>
);

/**
 * Change your assistant (chunk 20a-2, screenshot 03's right panel): the owner asks in their own
 * words, sees the change as a before and after, and applies it or says "Not quite". Nothing
 * changes until Apply. Recent changes can be undone. A request that would weaken safety gets the
 * deck's refusal.
 */
export const ChangePanel: React.FC<{
  botId: string;
  canEdit: boolean;
  onApplied: (undo: () => void) => void;
  onUndone: () => void;
  onClose: () => void;
}> = ({ botId, canEdit, onApplied, onUndone, onClose }) => {
  const [request, setRequest] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ChangeProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; summary: string } | null>(null);
  const [propose, proposing] = useProposeChangeMutation();
  const [apply, applying] = useApplyChangeMutation();
  const [undo, undoing] = useUndoChangeMutation();
  const history = useGetChangesQuery(botId);

  const ask = async (text: string) => {
    if (!text.trim()) return;
    setAsked(text.trim());
    setRequest("");
    setProposal(null);
    setError(null);
    try {
      setProposal(await propose({ id: botId, request: text.trim() }).unwrap());
    } catch {
      setError(COPY.problems.generic);
    }
  };

  const applyIt = async () => {
    if (!proposal) return;
    try {
      const { eventId } = await apply({ id: botId, changes: proposal.changes }).unwrap();
      setProposal(null);
      setAsked(null);
      onApplied(() => void undo({ id: botId, eventId }).then(onUndone));
    } catch (err) {
      // A stale apply (409) carries the deck's own message from ally-be.
      const message = (err as { data?: { message?: string } })?.data?.message;
      setError(message ?? COPY.problems.generic);
    }
  };

  const entries = (history.data ?? []).filter(e => e.kind === "change");

  return (
    <div className="ally-change" data-testid="change-panel">
      <header className="ally-home__panel-head">
        <h2 className="ally-home__panel-title">{t.title}</h2>
        <Button onClick={onClose}>{HOME.tryPanel.close}</Button>
      </header>

      <div className="ally-change__thread" aria-live="polite">
        {asked && <p className="ally-change__ask">{asked}</p>}
        {proposing.isLoading && <AssistantLine working>{COPY.working.thinking}</AssistantLine>}
        {proposal?.refused && <AssistantLine>{proposal.message}</AssistantLine>}
        {proposal && !proposal.refused && (
          <section className="ally-card ally-change__proposal" data-testid="change-proposal">
            {proposal.message && <p className="ally-body">{proposal.message}</p>}
            {proposal.changes.length > 0 && (
              <>
                <h3 className="ally-heading">{t.proposal}</h3>
                {proposal.changes.map(change => (
                  <ChangeCard key={`${change.field}-${show(change.after)}`} change={change} />
                ))}
                <div className="ally-btn-row">
                  <PrimaryButton onClick={() => void applyIt()} disabled={applying.isLoading}>
                    {t.apply}
                  </PrimaryButton>
                  <Button
                    onClick={() => {
                      setProposal(null);
                      setAsked(null);
                    }}
                  >
                    {t.notQuite}
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
        {error && (
          <p className="ally-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {entries.length > 0 && (
        <section className="ally-change__history">
          <h3 className="ally-label">{t.history}</h3>
          <ul>
            {entries.map(entry => (
              <li key={entry.id} className="ally-change__entry">
                <span>{entry.summary}</span>
                {canEdit && !entry.undone && (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirming({ id: entry.id, summary: entry.summary })}
                  >
                    {t.undo}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {confirming && (
            <div className="ally-card ally-change__confirm" role="group">
              <p className="ally-body">{fill(t.undoConfirm, { change: confirming.summary })}</p>
              <div className="ally-btn-row">
                <PrimaryButton
                  disabled={undoing.isLoading}
                  onClick={async () => {
                    await undo({ id: botId, eventId: confirming.id });
                    setConfirming(null);
                    onUndone();
                  }}
                >
                  {t.undo}
                </PrimaryButton>
                <Button onClick={() => setConfirming(null)}>{t.cancel}</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {canEdit && (
        <footer className="ally-change__compose">
          <div className="ally-change__chips">
            {t.examples.map(example => (
              <Chip key={example} onToggle={() => void ask(example)}>
                {example}
              </Chip>
            ))}
          </div>
          <form
            onSubmit={event => {
              event.preventDefault();
              void ask(request);
            }}
          >
            <label className="sr-only" htmlFor="change-request">
              {t.title}
            </label>
            <input
              id="change-request"
              className="ally-input"
              placeholder={t.placeholder}
              value={request}
              maxLength={1000}
              onChange={event => setRequest(event.target.value)}
            />
            <Button type="submit" disabled={!request.trim() || proposing.isLoading}>
              {t.send}
            </Button>
          </form>
        </footer>
      )}
    </div>
  );
};
