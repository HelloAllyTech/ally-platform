import React, { useEffect, useRef, useState } from "react";

import { listRefusalOf, useCreateUserListMutation } from "@api";
import { Button } from "@components/v2";
import type { UserList } from "@types";

import { HOME } from "../copy";
import { keyFor } from "./DetailsBlock";

const t = () => HOME.userLists;

/**
 * Start from scratch (chunk 5b): a name, then the list opens for its details. It starts with one
 * detail, Name, so the table has something to show; the owner renames or replaces it.
 */
export const NewListForm: React.FC<{
  botId: string;
  lists: UserList[];
  onClose: (openKey?: string) => void;
}> = ({ botId, lists, onClose }) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [create, { isLoading }] = useCreateUserListMutation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    setError(null);
    const key = keyFor(
      value,
      lists.map(l => l.key),
    );
    try {
      await create({
        id: botId,
        key,
        name: value,
        fields: [{ key: "name", label: t().details.name, type: "text", required: true }],
        settings: { title_field: "name" },
      }).unwrap();
      onClose(key);
    } catch (failure) {
      setError(listRefusalOf(failure)?.message ?? t().form.failed);
    }
  };

  return (
    <form
      className="ally-card ally-setup__step ally-lists__scratch"
      onSubmit={submit}
      data-testid="new-list"
    >
      <h2 className="ally-setup__title">{t().scratch.title}</h2>
      <div className="ally-field">
        <label htmlFor="new-list-name">{t().scratch.name}</label>
        <input
          ref={input}
          id="new-list-name"
          className="ally-input"
          maxLength={120}
          placeholder={t().scratch.placeholder}
          value={name}
          aria-describedby="new-list-hint"
          onChange={e => setName(e.target.value)}
        />
        <span id="new-list-hint" className="ally-field__hint">
          {t().scratch.hint}
        </span>
      </div>
      {error && (
        <p className="ally-error" role="alert">
          {error}
        </p>
      )}
      <div className="ally-btn-row">
        <Button variant="primary" type="submit" disabled={!name.trim() || isLoading}>
          {isLoading ? t().form.saving : t().scratch.create}
        </Button>
        <Button onClick={() => onClose()}>{t().form.cancel}</Button>
      </div>
    </form>
  );
};
