import { FC, useEffect, useId, useState } from "react";

import { effectiveBehaviourScore, validateBehaviourScore } from "@utils";

interface BehaviourScoreInputProps {
  /** Category of the row this score belongs to; it sets the allowed sign. */
  category?: string;
  /** The row's authored score; undefined means "the category default". */
  score?: number | null;
  /** Called with a valid integer, on blur or Enter. Never called with a bad value. */
  onCommit: (score: number) => void;
  ariaLabel: string;
}

/**
 * One behaviour's score in the scoring rubric.
 *
 * Shows the score the row is actually worth (the authored one, else +10 / -10),
 * so the default is visible and editable rather than implied. Typing is free;
 * the value is checked and committed on blur or Enter, because a committed
 * score can move the behaviour to a different row. An invalid entry shows its
 * reason, is never committed (the last valid score is what gets saved), and
 * Escape puts the last valid one back.
 */
export const BehaviourScoreInput: FC<BehaviourScoreInputProps> = ({
  category,
  score,
  onCommit,
  ariaLabel,
}) => {
  const current = effectiveBehaviourScore(category, score);
  const [draft, setDraft] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // Follow the committed value (a category change resets it to the new default).
  useEffect(() => {
    setDraft(String(current));
    setError(null);
  }, [current, category]);

  const commit = () => {
    const result = validateBehaviourScore(draft, category);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(String(result.value));
    if (result.value !== current) onCommit(result.value);
  };

  return (
    <div className="flex flex-col">
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={e => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(String(current));
            setError(null);
          }
        }}
        className={`w-full rounded border bg-white px-2 py-1.5 text-sm tabular-nums text-typography-900 focus:outline-none focus:ring-1 ${
          error
            ? "border-destructive-500 focus:ring-destructive-500"
            : "border-border-light focus:ring-primary"
        }`}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1 text-xs text-destructive-600">
          {error}
        </span>
      )}
    </div>
  );
};
