import React, { useEffect, useRef, useState } from "react";

import { Link } from "react-router-dom";

import { ROUTES } from "@constants";

import { SPLIT_COPY } from "../copy";

const T = SPLIT_COPY.breadcrumb;
const MAX = 80;

/**
 * "Back to Ally Chatbots / <name>", in the top bar of the Create and Build screen. The name is
 * edited in place: press it (or Enter on it), type, and Enter or leaving the box saves it as the
 * chatbot's name; Escape puts the old one back. An empty name is not saved. While it saves the new
 * name already shows; if the save fails the box stays open with the reason beside it.
 */
export const BuildBreadcrumb: React.FC<{
  name: string;
  /** Saves the new name; resolves false when it could not be saved. */
  onRename: (next: string) => Promise<boolean>;
}> = ({ name, onRename }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Enter saves and then the box unmounts, which blurs it: the second call is ignored.
  const busy = useRef(false);

  useEffect(() => {
    if (!editing) setText(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const close = () => {
    setEditing(false);
    setFailed(false);
    // Back to the name, where the keyboard was.
    window.setTimeout(() => trigger.current?.focus(), 0);
  };

  const save = async () => {
    if (busy.current) return;
    const next = text.trim().slice(0, MAX);
    if (!next || next === name) {
      setText(name);
      close();
      return;
    }
    busy.current = true;
    setSaving(true);
    setFailed(false);
    const ok = await onRename(next);
    busy.current = false;
    setSaving(false);
    if (ok) close();
    else setFailed(true);
  };

  return (
    <nav aria-label={T.label} className="ally-crumb" data-testid="build-breadcrumb">
      <Link to={ROUTES.WHATSAPP_BOT} className="ally-crumb__back">
        {T.back}
      </Link>
      <span aria-hidden="true" className="ally-crumb__sep">
        /
      </span>
      {editing ? (
        <span className="ally-crumb__edit">
          <input
            ref={input}
            className="ally-crumb__input"
            aria-label={T.rename}
            aria-invalid={failed || undefined}
            value={text}
            maxLength={MAX}
            disabled={saving}
            data-testid="build-name-input"
            onChange={event => setText(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                busy.current = true; // the blur that follows must not save
                setText(name);
                close();
                window.setTimeout(() => {
                  busy.current = false;
                }, 0);
              }
            }}
          />
          {saving && (
            <span className="ally-crumb__status" role="status">
              {T.saving}
            </span>
          )}
          {failed && (
            <span className="ally-crumb__status ally-crumb__status--error" role="alert">
              {T.failed}
            </span>
          )}
        </span>
      ) : (
        <button
          ref={trigger}
          type="button"
          className="ally-crumb__name"
          aria-label={`${T.rename}: ${name}`}
          title={T.rename}
          data-testid="build-name"
          onClick={() => setEditing(true)}
        >
          <span aria-current="page">{name}</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M12.1 1.6a1.5 1.5 0 0 1 2.1 2.1l-8.6 8.6-3 .9.9-3 8.6-8.6Zm-.7 1.4L4.1 10.3l-.4 1.3 1.3-.4 7.3-7.3L11.4 3Z" />
          </svg>
        </button>
      )}
    </nav>
  );
};
