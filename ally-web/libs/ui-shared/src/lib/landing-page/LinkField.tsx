import { FC, useState } from "react";

interface LinkFieldProps {
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
}

/**
 * A link you can set while editing: shows the address (or "Add link") and
 * opens a small box on click. Only http(s) addresses and app paths are kept;
 * anything else is refused here and again by the server.
 */
export const LinkField: FC<LinkFieldProps> = ({ value, onChange, label }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const next = draft.trim();
    if (next === "") {
      onChange(null);
    } else if (/^https?:\/\/\S+$/i.test(next) || (next.startsWith("/") && !next.startsWith("//"))) {
      onChange(next);
    } else {
      setError("Use an http(s) address or a path starting with /");
      return;
    }
    setError(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="lp-link-btn"
        onClick={event => {
          event.stopPropagation();
          setDraft(value ?? "");
          setOpen(true);
        }}
      >
        {value ? `${label}: ${value}` : `Add ${label.toLowerCase()}`}
      </button>
    );
  }

  return (
    <span className="lp-link-edit" onClick={event => event.stopPropagation()}>
      <input
        type="url"
        value={draft}
        placeholder="https://… or /path"
        aria-label={label}
        autoFocus
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <button type="button" className="lp-link-btn" onClick={save}>
        Save
      </button>
      {error && (
        <span className="lp-image-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
};
