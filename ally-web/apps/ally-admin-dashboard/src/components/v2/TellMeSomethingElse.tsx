import React, { useEffect, useRef, useState } from "react";

import { Button } from "./core";

/**
 * "Tell me something else" (chunk-20d §2): a collapsed line under every screen that opens a
 * one-line input. What's typed goes to the builder. Esc closes it; Stop cancels a running reply.
 */
export const TellMeSomethingElse: React.FC<{
  labels: { collapsed: string; placeholder: string; send: string; stop: string };
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}> = ({ labels, busy, disabled = false, onSend, onStop }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="ally-tell">
        <button
          ref={toggle}
          type="button"
          className="ally-link"
          aria-expanded={false}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {labels.collapsed}
        </button>
      </div>
    );
  }
  return (
    <div className="ally-tell">
      <form
        onSubmit={event => {
          event.preventDefault();
          const value = text.trim();
          if (!value || busy) return;
          onSend(value);
          setText("");
        }}
      >
        <input
          ref={input}
          className="ally-input"
          aria-label={labels.collapsed}
          placeholder={labels.placeholder}
          value={text}
          disabled={disabled}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setTimeout(() => toggle.current?.focus(), 0);
            }
          }}
        />
        {busy ? (
          <Button onClick={onStop}>{labels.stop}</Button>
        ) : (
          <Button type="submit" disabled={!text.trim() || disabled}>
            {labels.send}
          </Button>
        )}
      </form>
    </div>
  );
};
