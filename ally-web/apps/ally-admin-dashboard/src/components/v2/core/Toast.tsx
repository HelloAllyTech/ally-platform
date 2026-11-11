import React, { useEffect } from "react";

/** How long a toast stays (DESIGN.md §3). */
export const TOAST_MS = 3600;

/** The ink pill at the bottom: "Changed" and Undo (DESIGN.md §4). Announced politely. */
export const Toast: React.FC<{
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDone: () => void;
}> = ({ message, actionLabel, onAction, onDone }) => {
  useEffect(() => {
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="ally-toast" role="status" aria-live="polite">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => {
            onAction();
            onDone();
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
