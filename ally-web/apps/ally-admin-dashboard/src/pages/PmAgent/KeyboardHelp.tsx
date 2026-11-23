import React, { useEffect, useRef } from "react";

import { copy } from "./copy";

/** The `?` reference card. Focus goes to Close on open and Escape closes it. */
export const KeyboardHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.keysTitle}
        className="w-full max-w-md rounded bg-white p-4 shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold text-typography-900">{copy.keysTitle}</h2>
        <dl className="flex flex-col gap-2">
          {copy.keys.map(row => (
            <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-typography-800">{row.label}</dt>
              <dd className="flex gap-1">
                {row.keys.map(k => (
                  <kbd key={k} className="rounded border border-neutral-500 px-1.5 text-xs">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-typography-600">{copy.keysTyping}</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-4 min-h-11 cursor-pointer rounded bg-primary-600 px-4 text-sm text-white"
        >
          {copy.keysClose}
        </button>
      </div>
    </div>
  );
};
