import React, { useId, useState } from "react";

/**
 * A section's `?` (chunk 20d-2): opens a short explainer under the heading. A disclosure, not a
 * hover tooltip, so it works with a keyboard, a screen reader and a finger alike.
 */
export const HelpToggle: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="ally-help"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(o => !o)}
      >
        ?
      </button>
      <div id={id} className="ally-help__body" hidden={!open}>
        {children}
      </div>
    </>
  );
};
