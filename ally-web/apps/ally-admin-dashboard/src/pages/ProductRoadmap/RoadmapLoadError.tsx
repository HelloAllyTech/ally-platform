import React from "react";

interface RoadmapLoadErrorProps {
  /** What failed to load, in the reader's words: "the queue", "the board". */
  what: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

/**
 * A failed fetch, said as one.
 *
 * Before this, a failed list request fell through to the empty state — "No opportunities yet /
 * File the first one" — which tells someone triaging that there is nothing to triage when in fact
 * the page simply could not ask. A failure and an empty result are different facts and need
 * different copy, and only the failure has a retry.
 */
export const RoadmapLoadError: React.FC<RoadmapLoadErrorProps> = ({
  what,
  onRetry,
  isRetrying,
}) => (
  <div
    role="alert"
    className="border-border-light flex flex-col items-center gap-3 border px-4 py-12 text-center"
  >
    <h2 className="text-typography-primary text-xl font-normal">Couldn't load {what}</h2>
    <p className="text-typography-secondary max-w-md text-sm">
      Nothing is lost — this is a loading problem, not an empty list. Check your connection and try
      again.
    </p>
    <button
      type="button"
      disabled={isRetrying}
      onClick={onRetry}
      className="border-border-light text-typography-primary hover:border-primary-500 border px-4 py-2 text-sm disabled:opacity-50"
    >
      {isRetrying ? "Retrying…" : "Try again"}
    </button>
  </div>
);
